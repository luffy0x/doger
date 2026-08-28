import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createConfig, parseConfig } from "../src/core/config.ts";
import { DogerError } from "../src/core/errors.ts";
import {
  initializeDoger,
  readStatus,
  reauthenticateDoger,
  uninstallLocalData,
  type ConfigurationPrompts,
} from "../src/core/lifecycle-service.ts";
import { createConfiguredState, parseRuntimeState, recordOutcome } from "../src/core/state.ts";
import { readJsonFile, writeJsonAtomic } from "../src/infra/json-store.ts";
import { hasInstallationMarker, writeInstallationMarker } from "../src/infra/installation.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";
import type { TokenStore } from "../src/security/token-store.ts";

const TOKEN_ONE = "session=synthetic-token-one";
const TOKEN_TWO = "session=synthetic-token-two";

class MemoryTokenStore implements TokenStore {
  value: string | null = null;
  async get(): Promise<string | null> { return this.value; }
  async set(value: string): Promise<void> { this.value = value; }
  async delete(): Promise<void> { this.value = null; }
}

function prompts(id = "1234567", token = TOKEN_ONE, manualRefreshConfirmed = false): ConfigurationPrompts {
  return {
    async readDeliveryRecordId() { return id; },
    async readToken() { return token; },
    async confirmManualRefresh() { return manualRefreshConfirmed; },
  };
}

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "doger-lifecycle-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }), tokenStore: new MemoryTokenStore() };
}

test("init stores one target and token locally without creating a success anchor", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  const report = await initializeDoger({
    paths,
    tokenStore,
    prompts: prompts(),
    now: () => { throw new Error("unconfirmed initialization must not read the anchor clock"); },
  });
  const [config, state] = await Promise.all([
    readJsonFile(paths.config, parseConfig),
    readJsonFile(paths.runtimeState, parseRuntimeState),
  ]);

  assert.deepEqual(report, {
    schemaVersion: 2,
    command: "init",
    outcome: "SUCCESS",
    scheduleAnchored: false,
    firstSuccessAt: null,
    nextEligibleAt: null,
  });
  assert.equal(config?.deliveryRecordId, 1_234_567);
  assert.equal(state?.firstSuccessAt, null);
  assert.equal(tokenStore.value, TOKEN_ONE);
  assert.equal(await hasInstallationMarker(paths.installationMarker), true);
  assert.equal((await readFile(paths.config, "utf8")).includes(TOKEN_ONE), false);
});

test("init anchors a confirmed manual refresh without recording a Doger request", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  const confirmedAt = new Date("2026-08-28T01:02:03.000Z");
  const report = await initializeDoger({
    paths,
    tokenStore,
    prompts: prompts("1234567", TOKEN_ONE, true),
    now: () => confirmedAt,
  });
  const state = await readJsonFile(paths.runtimeState, parseRuntimeState);

  assert.deepEqual(report, {
    schemaVersion: 2,
    command: "init",
    outcome: "SUCCESS",
    scheduleAnchored: true,
    firstSuccessAt: confirmedAt.toISOString(),
    nextEligibleAt: "2026-08-28T09:02:03.000Z",
  });
  assert.equal(state?.lastSuccessAt, confirmedAt.toISOString());
  assert.equal(state?.lastAttemptAt, null);
  assert.equal(state?.lastOutcome, null);
  assert.equal((await readFile(paths.runtimeState, "utf8")).includes(TOKEN_ONE), false);
  const status = await readStatus(paths);
  assert.equal(status.scheduleAnchored, true);
  assert.equal(status.nextEligibleAt, report.nextEligibleAt);
  assert.equal(JSON.stringify(status).includes("1234567"), false);
});

test("init refuses any existing installation state before prompting or replacing a token", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  await writeJsonAtomic(paths.config, createConfig("1"));
  let prompted = false;
  await assert.rejects(
    initializeDoger({
      paths,
      tokenStore,
      prompts: {
        async readDeliveryRecordId() { prompted = true; return "2"; },
        async readToken() { prompted = true; return TOKEN_ONE; },
        async confirmManualRefresh() { prompted = true; return true; },
      },
    }),
    (error: unknown) => error instanceof DogerError && error.code === "CONFIG_INVALID",
  );
  assert.equal(prompted, false);
  assert.equal(tokenStore.value, null);
});

test("reauth replaces the token locally and clears only reauthentication state", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  await initializeDoger({ paths, tokenStore, prompts: prompts() });
  const blocked = recordOutcome(createConfiguredState(), "REAUTH_REQUIRED", new Date("2026-08-28T00:00:00.000Z"));
  await writeJsonAtomic(paths.runtimeState, blocked);

  const report = await reauthenticateDoger({ paths, tokenStore, prompts: prompts("unused", TOKEN_TWO) });
  const next = await readJsonFile(paths.runtimeState, parseRuntimeState);
  assert.equal(report.outcome, "SUCCESS");
  assert.equal(report.firstSuccessAt, null);
  assert.equal(report.nextEligibleAt, null);
  assert.equal(tokenStore.value, TOKEN_TWO);
  assert.equal(next?.status, "ready");

  await writeJsonAtomic(paths.runtimeState, recordOutcome(createConfiguredState(), "MANUAL_CHECK", new Date()));
  await reauthenticateDoger({ paths, tokenStore, prompts: prompts("unused", TOKEN_ONE) });
  assert.equal((await readJsonFile(paths.runtimeState, parseRuntimeState))?.status, "manual_check");
});

test("reauth can replace a malformed stored token", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  await Promise.all([
    writeInstallationMarker(paths.installationMarker),
    writeJsonAtomic(paths.config, createConfig("1")),
    writeJsonAtomic(paths.runtimeState, createConfiguredState()),
  ]);
  tokenStore.value = "bad\r\ntoken";

  await reauthenticateDoger({ paths, tokenStore, prompts: prompts("unused", TOKEN_TWO) });
  assert.equal(tokenStore.value, TOKEN_TWO);
});

test("status omits both token and delivery-record ID", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  await initializeDoger({ paths, tokenStore, prompts: prompts() });
  const serialized = JSON.stringify(await readStatus(paths));
  assert.equal(serialized.includes(TOKEN_ONE), false);
  assert.equal(serialized.includes("1234567"), false);
});

test("uninstall removes known v2 and legacy files but preserves unknown files", async (context) => {
  const { root, paths, tokenStore } = await fixture(context);
  await initializeDoger({ paths, tokenStore, prompts: prompts() });
  await writeFile(join(root, "recipe.json"), "legacy", "utf8");
  await writeFile(join(root, "credentials.enc"), "legacy", "utf8");
  const unknown = join(root, "user-note.txt");
  await writeFile(unknown, "preserve", "utf8");

  const legacyKeyStore = new MemoryTokenStore();
  legacyKeyStore.value = "synthetic-legacy-key";
  const report = await uninstallLocalData(paths, tokenStore, legacyKeyStore);
  assert.equal(report.outcome, "SUCCESS");
  assert.equal(report.removed.token, true);
  assert.equal(report.removed.legacyCredentialKey, true);
  assert.equal(legacyKeyStore.value, null);
  assert.equal(report.removed.legacyData, true);
  assert.equal(await readFile(unknown, "utf8"), "preserve");
  await assert.rejects(access(paths.installationMarker), { code: "ENOENT" });
});

test("schema-v1 data requires explicit uninstall and reinitialization", async (context) => {
  const { paths } = await fixture(context);
  await writeInstallationMarker(paths.installationMarker);
  await writeJsonAtomic(paths.config, { schemaVersion: 1, applicationUrl: "https://campus.jd.com/" });
  await writeJsonAtomic(paths.runtimeState, { schemaVersion: 1 });
  await assert.rejects(
    readStatus(paths),
    (error: unknown) => error instanceof DogerError && error.code === "CONFIG_MIGRATION_REQUIRED",
  );
});

test("confirmed uninstall recovers an orphaned native token without a marker", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  tokenStore.value = TOKEN_ONE;
  const legacyKeyStore = new MemoryTokenStore();

  const report = await uninstallLocalData(paths, tokenStore, legacyKeyStore);
  assert.equal(report.removed.token, true);
  assert.equal(tokenStore.value, null);

  await initializeDoger({ paths, tokenStore, prompts: prompts() });
  assert.equal(tokenStore.value, TOKEN_ONE);
});

test("confirmed uninstall recovers partial files and a token after interrupted initialization", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  await writeInstallationMarker(paths.installationMarker);
  await writeJsonAtomic(paths.config, createConfig("1"));
  tokenStore.value = TOKEN_ONE;

  const report = await uninstallLocalData(paths, tokenStore, new MemoryTokenStore());
  assert.equal(report.removed.config, true);
  assert.equal(report.removed.token, true);
  assert.equal(tokenStore.value, null);
});

test("uninstall without an ownership marker preserves same-named files", async (context) => {
  const { root, paths, tokenStore } = await fixture(context);
  const config = "unrelated-config";
  const runtime = "unrelated-runtime";
  const recipe = "unrelated-recipe";
  await Promise.all([
    writeFile(paths.config, config, "utf8"),
    writeFile(paths.runtimeState, runtime, "utf8"),
    writeFile(join(root, "recipe.json"), recipe, "utf8"),
  ]);
  tokenStore.value = TOKEN_ONE;

  const report = await uninstallLocalData(paths, tokenStore, new MemoryTokenStore());

  assert.equal(report.removed.config, false);
  assert.equal(report.removed.runtimeState, false);
  assert.equal(report.removed.legacyData, false);
  assert.equal(await readFile(paths.config, "utf8"), config);
  assert.equal(await readFile(paths.runtimeState, "utf8"), runtime);
  assert.equal(await readFile(join(root, "recipe.json"), "utf8"), recipe);
  assert.equal(tokenStore.value, null);
});
