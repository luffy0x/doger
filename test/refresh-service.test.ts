import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createConfig } from "../src/core/config.ts";
import { runGuardedRefresh } from "../src/core/refresh-service.ts";
import { createInitialState, parseRuntimeState, recordSuccess } from "../src/core/state.ts";
import type { CurlResponse } from "../src/http/classifier.ts";
import { parseRequestRecipe } from "../src/http/recipe.ts";
import { readJsonFile, writeJsonAtomic } from "../src/infra/json-store.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";
import { EncryptedCredentialStore } from "../src/security/credential-store.ts";
import type { KeyProvider } from "../src/security/key-provider.ts";

class MemoryKeyProvider implements KeyProvider {
  key: Uint8Array | null = null;

  async get(): Promise<Uint8Array | null> {
    return this.key;
  }

  async set(key: Uint8Array): Promise<void> {
    this.key = key;
  }

  async delete(): Promise<void> {
    this.key = null;
  }
}

const recipe = parseRequestRecipe({
  schemaVersion: 1,
  endpoint: "https://api.jd.com/activity/refresh",
  method: "POST",
  allowedHosts: ["api.jd.com"],
  headerNames: [],
  includeCookie: false,
  includeQuery: false,
  includeBody: false,
  response: {
    success: { statusCodes: [200], bodyIncludesAny: ["synthetic_success"] },
    authBodyIncludesAny: [],
    authLocationIncludesAny: [],
    rateLimitBodyIncludesAny: [],
  },
});

async function fixture(context: test.TestContext, now: Date) {
  const root = await mkdtemp(join(tmpdir(), "doger-refresh-service-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const paths = resolveDogerPaths({ env: { DOGER_DATA_DIR: root } });
  const keyProvider = new MemoryKeyProvider();
  const config = { ...createConfig("https://campus.jd.com/application"), allowedHosts: ["campus.jd.com", "api.jd.com"] };
  const state = recordSuccess(createInitialState(), now);

  await Promise.all([
    writeJsonAtomic(paths.config, config),
    writeJsonAtomic(paths.recipe, recipe),
    writeJsonAtomic(paths.runtimeState, state),
  ]);
  await new EncryptedCredentialStore(paths.credentials, keyProvider).save({
    version: 1,
    capturedAt: now.toISOString(),
    headers: {},
  });
  return { paths, keyProvider, state };
}

function response(overrides: Partial<CurlResponse> = {}): CurlResponse {
  return { exitCode: 0, statusCode: 200, headers: {}, body: "synthetic_success", ...overrides };
}

test("returns NOT_DUE without loading credentials or making a request", async (context) => {
  const first = new Date("2026-08-28T00:00:00.000Z");
  const { paths, keyProvider } = await fixture(context, first);
  keyProvider.key = null;
  let requests = 0;

  const result = await runGuardedRefresh({
    paths,
    keyProvider,
    now: () => new Date("2026-08-28T07:59:59.999Z"),
    refreshClient: {
      execute: async () => {
        requests += 1;
        return response();
      },
    },
  });

  assert.equal(result.outcome, "NOT_DUE");
  assert.equal(result.attempted, false);
  assert.equal(requests, 0);
});

test("persists success and advances eligibility from completion time", async (context) => {
  const first = new Date("2026-08-28T00:00:00.000Z");
  const completed = new Date("2026-08-28T08:00:00.000Z");
  const { paths, keyProvider } = await fixture(context, first);

  const result = await runGuardedRefresh({
    paths,
    keyProvider,
    now: () => completed,
    refreshClient: { execute: async () => response() },
  });
  const state = await readJsonFile(paths.runtimeState, parseRuntimeState);

  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.attempted, true);
  assert.equal(result.nextEligibleAt, "2026-08-28T16:00:00.000Z");
  assert.equal(state?.firstSuccessAt, first.toISOString());
  assert.equal(state?.lastSuccessAt, completed.toISOString());
});

test("persists reauthentication state without exposing the response", async (context) => {
  const first = new Date("2026-08-28T00:00:00.000Z");
  const now = new Date("2026-08-28T08:00:00.000Z");
  const { paths, keyProvider } = await fixture(context, first);

  const result = await runGuardedRefresh({
    paths,
    keyProvider,
    now: () => now,
    refreshClient: { execute: async () => response({ statusCode: 401, body: "synthetic-secret-response" }) },
  });
  const state = await readJsonFile(paths.runtimeState, parseRuntimeState);

  assert.equal(result.outcome, "REAUTH_REQUIRED");
  assert.equal(state?.status, "reauth_required");
  assert.equal(JSON.stringify(result).includes("synthetic-secret-response"), false);
});

test("honors Retry-After without retrying rate limits", async (context) => {
  const first = new Date("2026-08-28T00:00:00.000Z");
  const now = new Date("2026-08-28T08:00:00.000Z");
  const { paths, keyProvider } = await fixture(context, first);
  let requests = 0;

  const result = await runGuardedRefresh({
    paths,
    keyProvider,
    now: () => now,
    refreshClient: {
      execute: async () => {
        requests += 1;
        return response({ statusCode: 429, headers: { "retry-after": ["120"] }, body: "synthetic-rate" });
      },
    },
  });

  assert.equal(result.outcome, "RATE_LIMITED");
  assert.equal(result.retryAfterAt, "2026-08-28T08:02:00.000Z");
  assert.equal(result.nextEligibleAt, "2026-08-28T08:02:00.000Z");
  assert.equal(requests, 1);
});

test("returns MANUAL_CHECK when the recipe host is not approved by configuration", async (context) => {
  const first = new Date("2026-08-28T00:00:00.000Z");
  const now = new Date("2026-08-28T08:00:00.000Z");
  const { paths, keyProvider } = await fixture(context, first);
  await writeJsonAtomic(paths.config, createConfig("https://campus.jd.com/application"));
  let requests = 0;

  const result = await runGuardedRefresh({
    paths,
    keyProvider,
    now: () => now,
    refreshClient: {
      execute: async () => {
        requests += 1;
        return response();
      },
    },
  });
  const state = await readJsonFile(paths.runtimeState, parseRuntimeState);

  assert.equal(result.outcome, "MANUAL_CHECK");
  assert.equal(result.reason, "host_not_approved");
  assert.equal(state?.status, "manual_check");
  assert.equal(requests, 0);
});
