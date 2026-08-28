import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { InteractiveCapturePrompts, InteractiveCaptureSession } from "../src/core/lifecycle-service.ts";
import {
  initializeDoger,
  readStatus,
  reauthenticateDoger,
  uninstallLocalData,
} from "../src/core/lifecycle-service.ts";
import { createConfig, parseConfig } from "../src/core/config.ts";
import { DogerError } from "../src/core/errors.ts";
import { createInitialState, parseRuntimeState, recordSuccess, withRevisions } from "../src/core/state.ts";
import { parseRequestRecipe } from "../src/http/recipe.ts";
import { readJsonFile, writeJsonAtomic } from "../src/infra/json-store.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";
import { EncryptedCredentialStore } from "../src/security/credential-store.ts";
import type { KeyProvider } from "../src/security/key-provider.ts";

const SECRET_COOKIE = "synthetic-secret-cookie";
const SECRET_CSRF = "synthetic-secret-csrf";

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

function listPayload(requestId = "123.4"): unknown {
  return {
    success: true,
    data: {
      requests: [
        {
          requestId,
          method: "POST",
          url: "https://api.jd.com/activity/refresh?application=synthetic-application",
          status: 200,
        },
      ],
    },
    error: null,
  };
}

function detailPayload(requestId = "123.4"): unknown {
  return {
    success: true,
    data: {
      requestId,
      method: "POST",
      url: "https://api.jd.com/activity/refresh?application=synthetic-application",
      status: 200,
      headers: { "content-type": "application/json", "x-csrf-token": SECRET_CSRF },
      postData: '{"target":"synthetic-target"}',
      responseBody: '{"code":0,"message":"刷新成功"}',
    },
    error: null,
  };
}

function cookiesPayload(): unknown {
  return {
    success: true,
    data: {
      cookies: [
        { domain: ".jd.com", name: "session", path: "/", secure: true, value: SECRET_COOKIE },
      ],
    },
    error: null,
  };
}

class FakeSession implements InteractiveCaptureSession {
  readonly actions: string[] = [];
  list = listPayload();
  detail = detailPayload();
  cookies = cookiesPayload();

  async open(): Promise<void> {
    this.actions.push("open");
  }

  async clearNetworkRequests(): Promise<void> {
    this.actions.push("clear");
  }

  async listNetworkRequests(): Promise<unknown> {
    this.actions.push("list");
    return this.list;
  }

  async getNetworkRequest(requestId: string): Promise<unknown> {
    this.actions.push(`detail:${requestId}`);
    return this.detail;
  }

  async getCookies(): Promise<unknown> {
    this.actions.push("cookies");
    return this.cookies;
  }

  async close(): Promise<void> {
    this.actions.push("close");
  }
}

function prompts(confirm: boolean, actions: string[]): InteractiveCapturePrompts {
  return {
    async waitForLogin() {
      actions.push("login-ready");
    },
    async confirmRefresh() {
      actions.push("confirm");
      return confirm;
    },
    async waitForRefresh() {
      actions.push("refresh-done");
    },
  };
}

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "doger-lifecycle-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }),
    keyProvider: new MemoryKeyProvider(),
  };
}

test("initializes only after explicit confirmation and authoritative capture", async (context) => {
  const { paths, keyProvider } = await fixture(context);
  const browser = new FakeSession();
  const promptActions: string[] = [];
  const now = new Date("2026-08-28T01:02:03.000Z");

  const report = await initializeDoger("https://campus.jd.com/application", {
    paths,
    keyProvider,
    now: () => now,
    browserFactory: () => browser,
    prompts: prompts(true, promptActions),
  });
  const [config, recipe, state, credentials] = await Promise.all([
    readJsonFile(paths.config, parseConfig),
    readJsonFile(paths.recipe, parseRequestRecipe),
    readJsonFile(paths.runtimeState, parseRuntimeState),
    new EncryptedCredentialStore(paths.credentials, keyProvider).load(),
  ]);

  assert.equal(report.outcome, "SUCCESS");
  assert.equal(report.firstSuccessAt, now.toISOString());
  assert.equal(report.nextEligibleAt, "2026-08-28T09:02:03.000Z");
  assert.deepEqual(config?.allowedHosts, ["campus.jd.com", "api.jd.com"]);
  assert.equal(recipe?.endpoint, "https://api.jd.com/activity/refresh");
  assert.equal(state?.recipeRevision, 1);
  assert.equal(state?.credentialRevision, 1);
  assert.equal(credentials?.cookieHeader, `session=${SECRET_COOKIE}`);
  assert.deepEqual(promptActions, ["login-ready", "confirm", "refresh-done"]);
  assert.deepEqual(browser.actions, ["open", "clear", "list", "detail:123.4", "cookies", "close"]);
});

test("declining the action closes the browser without persisting configuration", async (context) => {
  const { paths, keyProvider } = await fixture(context);
  const browser = new FakeSession();

  const report = await initializeDoger("https://campus.jd.com/application", {
    paths,
    keyProvider,
    browserFactory: () => browser,
    prompts: prompts(false, []),
  });

  assert.equal(report.outcome, "CANCELLED");
  assert.deepEqual(browser.actions, ["open", "clear", "close"]);
  assert.equal(await readJsonFile(paths.config, parseConfig), null);
  assert.equal(await readJsonFile(paths.runtimeState, parseRuntimeState), null);
  assert.equal(keyProvider.key, null);
});

test("rejects a second initialization before opening a browser", async (context) => {
  const { paths, keyProvider } = await fixture(context);
  await writeJsonAtomic(paths.config, createConfig("https://campus.jd.com/application"));
  let browsers = 0;

  await assert.rejects(
    initializeDoger("https://campus.jd.com/other", {
      paths,
      keyProvider,
      browserFactory: () => {
        browsers += 1;
        return new FakeSession();
      },
      prompts: prompts(true, []),
    }),
    (error: unknown) => error instanceof DogerError && error.code === "CONFIG_INVALID",
  );
  assert.equal(browsers, 0);
});

test("reauthentication preserves the first-success anchor and advances revisions", async (context) => {
  const { paths, keyProvider } = await fixture(context);
  const first = new Date("2026-08-28T00:00:00.000Z");
  const reauthenticated = new Date("2026-08-28T08:30:00.000Z");
  const config = { ...createConfig("https://campus.jd.com/application"), allowedHosts: ["campus.jd.com", "api.jd.com"] };
  const state = withRevisions(recordSuccess(createInitialState(), first), {
    recipeRevision: 1,
    credentialRevision: 1,
  });
  await Promise.all([
    writeJsonAtomic(paths.config, config),
    writeJsonAtomic(paths.runtimeState, state),
  ]);
  const browser = new FakeSession();

  const report = await reauthenticateDoger({
    paths,
    keyProvider,
    now: () => reauthenticated,
    browserFactory: () => browser,
    prompts: prompts(true, []),
  });
  const nextState = await readJsonFile(paths.runtimeState, parseRuntimeState);

  assert.equal(report.firstSuccessAt, first.toISOString());
  assert.equal(report.nextEligibleAt, "2026-08-28T16:30:00.000Z");
  assert.equal(nextState?.recipeRevision, 2);
  assert.equal(nextState?.credentialRevision, 2);
});

test("capture failure closes the browser and stores no credentials", async (context) => {
  const { paths, keyProvider } = await fixture(context);
  const browser = new FakeSession();
  browser.list = { success: true, data: { requests: [] }, error: null };

  await assert.rejects(
    initializeDoger("https://campus.jd.com/application", {
      paths,
      keyProvider,
      browserFactory: () => browser,
      prompts: prompts(true, []),
    }),
  );
  assert.equal(browser.actions.at(-1), "close");
  assert.equal(keyProvider.key, null);
});

test("status is redacted and uninstall removes only known local files", async (context) => {
  const { root, paths, keyProvider } = await fixture(context);
  const browser = new FakeSession();
  await initializeDoger("https://campus.jd.com/application", {
    paths,
    keyProvider,
    now: () => new Date("2026-08-28T01:02:03.000Z"),
    browserFactory: () => browser,
    prompts: prompts(true, []),
  });
  const unknownPath = join(root, "user-note.txt");
  await writeFile(unknownPath, "preserve me", "utf8");

  const status = await readStatus(paths);
  const serialized = JSON.stringify(status);
  assert.equal(status.initialized, true);
  assert.equal(serialized.includes(SECRET_COOKIE), false);
  assert.equal(serialized.includes(SECRET_CSRF), false);
  assert.equal(serialized.includes("campus.jd.com"), false);

  const uninstall = await uninstallLocalData(paths, keyProvider);
  assert.equal(uninstall.outcome, "SUCCESS");
  assert.equal(uninstall.removed.credentials, true);
  assert.equal(uninstall.removed.keychainEntry, true);
  assert.equal(await readFile(unknownPath, "utf8"), "preserve me");
});
