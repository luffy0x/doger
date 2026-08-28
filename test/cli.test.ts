import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EXIT_CODES, exitCodeForOutcome, helpText, run, VERSION, type CliDependencies } from "../src/cli.ts";
import { DogerError } from "../src/core/errors.ts";
import type { RefreshReport } from "../src/core/refresh-service.ts";
import type { RefreshOutcome } from "../src/core/state.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";
import type { KeyProvider } from "../src/security/key-provider.ts";

class Output {
  value = "";

  write(chunk: string): void {
    this.value += chunk;
  }
}

class MemoryKeyProvider implements KeyProvider {
  async get(): Promise<Uint8Array | null> {
    return null;
  }

  async set(): Promise<void> {}

  async delete(): Promise<void> {}
}

function refreshReport(outcome: RefreshOutcome): RefreshReport {
  return {
    schemaVersion: 1,
    command: "refresh",
    outcome,
    attempted: outcome !== "NOT_DUE" && outcome !== "REAUTH_REQUIRED" && outcome !== "MANUAL_CHECK",
    attempts: outcome === "NOT_DUE" ? 0 : 1,
    completedAt: "2026-08-28T08:00:00.000Z",
    nextEligibleAt: "2026-08-28T16:00:00.000Z",
    reason: "synthetic_reason",
  };
}

function harness(overrides: CliDependencies = {}): {
  readonly dependencies: CliDependencies;
  readonly stderr: Output;
  readonly stdout: Output;
} {
  const stdout = new Output();
  const stderr = new Output();
  return {
    stdout,
    stderr,
    dependencies: {
      keyProvider: new MemoryKeyProvider(),
      paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: "/tmp/doger-cli-test" } }),
      stdout,
      stderr,
      ...overrides,
    },
  };
}

test("help identifies Doger and all CLI commands", () => {
  const help = helpText();

  assert.match(help, /doger, a jd-activity-keeper/);
  assert.match(help, /Usage: doger <command>/);
  for (const command of ["init", "refresh", "status", "reauth", "doctor", "uninstall"]) {
    assert.match(help, new RegExp(`\\b${command}\\b`));
  }
});

test("version is a valid semantic version", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("maps every refresh outcome to a distinct stable exit code", async () => {
  const expected = new Map<RefreshOutcome, number>([
    ["SUCCESS", EXIT_CODES.SUCCESS],
    ["NOT_DUE", EXIT_CODES.NOT_DUE],
    ["REAUTH_REQUIRED", EXIT_CODES.REAUTH_REQUIRED],
    ["RATE_LIMITED", EXIT_CODES.RATE_LIMITED],
    ["TRANSIENT_FAILURE", EXIT_CODES.TRANSIENT_FAILURE],
    ["MANUAL_CHECK", EXIT_CODES.MANUAL_CHECK],
  ]);
  assert.equal(new Set(expected.values()).size, expected.size);

  for (const [outcome, exitCode] of expected) {
    const { dependencies, stdout } = harness({
      services: { refresh: async () => refreshReport(outcome) },
    });
    assert.equal(await run(["refresh", "--json"], dependencies), exitCode);
    assert.equal(JSON.parse(stdout.value).outcome, outcome);
    assert.equal(exitCodeForOutcome(outcome), exitCode);
  }
});

test("redacts subprocess diagnostics from JSON errors", async () => {
  const secret = "synthetic-secret-response-body";
  const { dependencies, stdout, stderr } = harness({
    services: {
      refresh: async () => {
        throw new DogerError("CURL_EXECUTION_FAILED", secret);
      },
    },
  });

  assert.equal(await run(["refresh", "--json"], dependencies), EXIT_CODES.TRANSIENT_FAILURE);
  assert.equal(stdout.value.includes(secret), false);
  assert.equal(stderr.value.includes(secret), false);
  assert.deepEqual(JSON.parse(stdout.value), {
    schemaVersion: 1,
    command: "refresh",
    outcome: "TRANSIENT_FAILURE",
    error: { code: "CURL_EXECUTION_FAILED", message: "The local curl process failed." },
  });
});

test("runs init only with one URL and injected interactive prompts", async () => {
  let initializedUrl: string | undefined;
  const { dependencies, stdout } = harness({
    prompts: {
      async waitForLogin() {},
      async confirmRefresh() {
        return true;
      },
      async waitForRefresh() {},
      async confirmUninstall() {
        return false;
      },
    },
    services: {
      initialize: async (applicationUrl) => {
        initializedUrl = applicationUrl;
        return { schemaVersion: 1, command: "init", outcome: "CANCELLED" };
      },
    },
  });

  assert.equal(
    await run(["init", "https://campus.jd.com/application", "--json"], dependencies),
    EXIT_CODES.SUCCESS,
  );
  assert.equal(initializedUrl, "https://campus.jd.com/application");
  assert.equal(JSON.parse(stdout.value).outcome, "CANCELLED");
});

test("uninstall cancellation does not invoke destructive cleanup", async () => {
  let uninstallCalls = 0;
  const { dependencies, stdout } = harness({
    prompts: {
      async waitForLogin() {},
      async confirmRefresh() {
        return false;
      },
      async waitForRefresh() {},
      async confirmUninstall() {
        return false;
      },
    },
    services: {
      uninstall: async () => {
        uninstallCalls += 1;
        throw new Error("must not run");
      },
    },
  });

  assert.equal(await run(["uninstall", "--json"], dependencies), EXIT_CODES.SUCCESS);
  assert.equal(uninstallCalls, 0);
  assert.equal(JSON.parse(stdout.value).outcome, "CANCELLED");
});

test("status JSON is redacted when Doger is not initialized", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-cli-status-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { dependencies, stdout } = harness({ paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }) });

  assert.equal(await run(["status", "--json"], dependencies), EXIT_CODES.SUCCESS);
  const report = JSON.parse(stdout.value);
  assert.equal(report.initialized, false);
  assert.deepEqual(Object.keys(report).sort(), [
    "command",
    "credentialRevision",
    "files",
    "firstSuccessAt",
    "initialized",
    "lastAttemptAt",
    "lastOutcome",
    "lastSuccessAt",
    "nextEligibleAt",
    "recipeRevision",
    "schemaVersion",
    "status",
  ]);
});

test("unknown commands return a redacted configuration failure", async () => {
  const { dependencies, stdout } = harness();
  assert.equal(await run(["synthetic-secret-command", "--json"], dependencies), EXIT_CODES.CONFIGURATION_FAILURE);
  assert.equal(stdout.value.includes("synthetic-secret-command"), false);
  assert.equal(JSON.parse(stdout.value).command, "unknown");
});
