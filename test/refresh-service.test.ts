import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createConfig, REFRESH_INTERVAL_MS } from "../src/core/config.ts";
import { runGuardedRefresh } from "../src/core/refresh-service.ts";
import { createConfiguredState, parseRuntimeState, recordOutcome, recordSuccess } from "../src/core/state.ts";
import type { CurlResponse } from "../src/http/classifier.ts";
import { readJsonFile, writeJsonAtomic } from "../src/infra/json-store.ts";
import { writeInstallationMarker } from "../src/infra/installation.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";
import type { TokenStore } from "../src/security/token-store.ts";

class MemoryTokenStore implements TokenStore {
  value: string | null = "session=synthetic-token";
  reads = 0;
  async get(): Promise<string | null> { this.reads += 1; return this.value; }
  async set(value: string): Promise<void> { this.value = value; }
  async delete(): Promise<void> { this.value = null; }
}

function response(overrides: Partial<CurlResponse> = {}): CurlResponse {
  return {
    exitCode: 0,
    statusCode: 200,
    headers: {},
    body: '{"success":true,"body":{"success":true}}',
    responseTooLarge: false,
    ...overrides,
  };
}

async function fixture(context: test.TestContext, state = createConfiguredState()) {
  const root = await mkdtemp(join(tmpdir(), "doger-refresh-service-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const paths = resolveDogerPaths({ env: { DOGER_DATA_DIR: root } });
  await Promise.all([
    writeInstallationMarker(paths.installationMarker),
    writeJsonAtomic(paths.config, createConfig("1234567")),
    writeJsonAtomic(paths.runtimeState, state),
  ]);
  return { paths, state, tokenStore: new MemoryTokenStore() };
}

test("the first explicit refresh is immediately due and anchors the schedule", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  const completed = new Date("2026-08-28T08:00:00.000Z");
  let calls = 0;
  const report = await runGuardedRefresh({
    paths,
    tokenStore,
    now: () => completed,
    refreshClient: { execute: async () => { calls += 1; return response(); } },
  });
  const state = await readJsonFile(paths.runtimeState, parseRuntimeState);

  assert.equal(report.outcome, "SUCCESS");
  assert.equal(calls, 1);
  assert.equal(state?.firstSuccessAt, completed.toISOString());
  assert.equal(state?.nextEligibleAt, new Date(completed.getTime() + REFRESH_INTERVAL_MS).toISOString());
});

test("NOT_DUE and blocked states do not read the token or start curl", async (context) => {
  const first = new Date("2026-08-28T00:00:00.000Z");
  for (const state of [
    recordSuccess(createConfiguredState(), first),
    recordOutcome(createConfiguredState(), "MANUAL_CHECK", first),
  ]) {
    const { paths, tokenStore } = await fixture(context, state);
    let calls = 0;
    const report = await runGuardedRefresh({
      paths,
      tokenStore,
      now: () => new Date("2026-08-28T01:00:00.000Z"),
      refreshClient: { execute: async () => { calls += 1; return response(); } },
    });
    assert.equal(report.attempted, false);
    assert.equal(tokenStore.reads, 0);
    assert.equal(calls, 0);
  }
});

test("a missing token persists REAUTH_REQUIRED without starting curl", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  tokenStore.value = null;
  let calls = 0;
  const report = await runGuardedRefresh({
    paths,
    tokenStore,
    refreshClient: { execute: async () => { calls += 1; return response(); } },
  });
  const state = await readJsonFile(paths.runtimeState, parseRuntimeState);
  assert.equal(report.outcome, "REAUTH_REQUIRED");
  assert.equal(report.attempted, false);
  assert.equal(state?.status, "reauth_required");
  assert.equal(calls, 0);
});

test("a malformed stored token becomes REAUTH_REQUIRED and can be replaced", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  tokenStore.value = "bad\r\ntoken";
  let calls = 0;
  const report = await runGuardedRefresh({
    paths,
    tokenStore,
    refreshClient: { execute: async () => { calls += 1; return response(); } },
  });
  assert.equal(report.outcome, "REAUTH_REQUIRED");
  assert.equal((await readJsonFile(paths.runtimeState, parseRuntimeState))?.status, "reauth_required");
  assert.equal(calls, 0);
});

test("persists redacted authentication and rate-limit results with one attempt", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  const now = new Date("2026-08-28T08:00:00.000Z");
  const report = await runGuardedRefresh({
    paths,
    tokenStore,
    now: () => now,
    refreshClient: {
      execute: async () => response({ statusCode: 429, headers: { "retry-after": ["120"] }, body: "private" }),
    },
  });
  assert.equal(report.outcome, "RATE_LIMITED");
  assert.equal(report.attempts, 1);
  assert.equal(report.retryAfterAt, "2026-08-28T08:02:00.000Z");
  assert.equal(JSON.stringify(report).includes("private"), false);
});

test("rejects a non-JD endpoint before reading the token", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  await assert.rejects(runGuardedRefresh({
    paths,
    tokenStore,
    refreshClient: { curl: { endpoint: "https://example.com/refresh" } },
  }));
  assert.equal(tokenStore.reads, 0);
});

test("reports schema-v1 migration deterministically before parsing legacy state", async (context) => {
  const { paths, tokenStore } = await fixture(context);
  await writeJsonAtomic(paths.config, { schemaVersion: 1, applicationUrl: "https://campus.jd.com/" });
  await writeJsonAtomic(paths.runtimeState, { schemaVersion: 1 });
  await assert.rejects(
    runGuardedRefresh({ paths, tokenStore }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CONFIG_MIGRATION_REQUIRED",
  );
});
