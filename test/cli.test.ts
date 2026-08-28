import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXIT_CODES,
  exitCodeForOutcome,
  helpText,
  readHiddenInput,
  run,
  VERSION,
  type CliDependencies,
  type HiddenInput,
} from "../src/cli.ts";
import { DogerError } from "../src/core/errors.ts";
import type { RefreshReport } from "../src/core/refresh-service.ts";
import type { RefreshOutcome } from "../src/core/state.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";
import type { TokenStore } from "../src/security/token-store.ts";

class Output {
  value = "";
  write(chunk: string): void { this.value += chunk; }
}

class MemoryTokenStore implements TokenStore {
  async get(): Promise<string | null> { return null; }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
}

class FakeHiddenInput extends EventEmitter implements HiddenInput {
  isTTY = true;
  isRaw = false;
  resumed = false;
  setEncoding(): this { return this; }
  setRawMode(value: boolean): this { this.isRaw = value; return this; }
  resume(): this { this.resumed = true; return this; }
  pause(): this { this.resumed = false; return this; }
}

function refreshReport(outcome: RefreshOutcome): RefreshReport {
  return {
    schemaVersion: 2,
    command: "refresh",
    outcome,
    attempted: outcome === "SUCCESS" || outcome === "RATE_LIMITED" || outcome === "TRANSIENT_FAILURE",
    attempts: outcome === "SUCCESS" || outcome === "RATE_LIMITED" || outcome === "TRANSIENT_FAILURE" ? 1 : 0,
    completedAt: "2026-08-28T08:00:00.000Z",
    nextEligibleAt: null,
    reason: "synthetic_reason",
  };
}

function harness(overrides: CliDependencies = {}) {
  const stdout = new Output();
  const stderr = new Output();
  return {
    stdout,
    stderr,
    dependencies: {
      tokenStore: new MemoryTokenStore(),
      paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: join(tmpdir(), "doger-cli-test") } }),
      stdout,
      stderr,
      ...overrides,
    } satisfies CliDependencies,
  };
}

test("help describes local token configuration and all commands", () => {
  const help = helpText();
  assert.match(help, /doger, a jd-activity-keeper/);
  assert.match(help, /init\s+Configure one delivery record and token locally/);
  for (const command of ["init", "refresh", "status", "reauth", "doctor", "uninstall"]) {
    assert.match(help, new RegExp(`\\b${command}\\b`));
  }
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("maps every refresh outcome to a distinct stable exit code", async () => {
  const expected = new Map<RefreshOutcome, number>([
    ["SUCCESS", EXIT_CODES.SUCCESS], ["NOT_DUE", EXIT_CODES.NOT_DUE],
    ["REAUTH_REQUIRED", EXIT_CODES.REAUTH_REQUIRED], ["RATE_LIMITED", EXIT_CODES.RATE_LIMITED],
    ["TRANSIENT_FAILURE", EXIT_CODES.TRANSIENT_FAILURE], ["MANUAL_CHECK", EXIT_CODES.MANUAL_CHECK],
  ]);
  assert.equal(new Set(expected.values()).size, expected.size);
  for (const [outcome, exitCode] of expected) {
    const { dependencies, stdout } = harness({ services: { refresh: async () => refreshReport(outcome) } });
    assert.equal(await run(["refresh", "--json"], dependencies), exitCode);
    assert.equal(JSON.parse(stdout.value).outcome, outcome);
    assert.equal(exitCodeForOutcome(outcome), exitCode);
  }
});

test("init accepts no secret-bearing arguments and uses injected local prompts", async () => {
  let calls = 0;
  const { dependencies, stdout } = harness({
    prompts: {
      async readDeliveryRecordId() { return "1234567"; },
      async readToken() { return "session=synthetic-token"; },
      async confirmUninstall() { return false; },
    },
    services: {
      initialize: async () => {
        calls += 1;
        return { schemaVersion: 2, command: "init", outcome: "SUCCESS", scheduleAnchored: false };
      },
    },
  });
  assert.equal(await run(["init", "--json"], dependencies), EXIT_CODES.SUCCESS);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(stdout.value).scheduleAnchored, false);

  const rejected = harness();
  assert.equal(await run(["init", "secret", "--json"], rejected.dependencies), EXIT_CODES.CONFIGURATION_FAILURE);
  assert.equal(rejected.stdout.value.includes("secret"), false);
});

test("hidden token input never echoes the token", async () => {
  const input = new FakeHiddenInput();
  const output = new Output();
  const pending = readHiddenInput(input, output, "Token: ");
  input.emit("data", "session=synthetic-token\r");
  assert.equal(await pending, "session=synthetic-token");
  assert.equal(output.value, "Token: \n");
  assert.equal(input.isRaw, false);
});

test("redacts internal errors and unknown command text", async () => {
  const secret = "synthetic-private-response";
  const { dependencies, stdout, stderr } = harness({
    services: { refresh: async () => { throw new DogerError("CURL_EXECUTION_FAILED", secret); } },
  });
  assert.equal(await run(["refresh", "--json"], dependencies), EXIT_CODES.TRANSIENT_FAILURE);
  assert.equal(`${stdout.value}${stderr.value}`.includes(secret), false);

  const unknown = harness();
  assert.equal(await run(["synthetic-secret-command", "--json"], unknown.dependencies), EXIT_CODES.CONFIGURATION_FAILURE);
  assert.equal(unknown.stdout.value.includes("synthetic-secret-command"), false);
});

test("status JSON never contains a delivery-record field", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-cli-status-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { dependencies, stdout } = harness({ paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }) });
  assert.equal(await run(["status", "--json"], dependencies), EXIT_CODES.SUCCESS);
  assert.equal(stdout.value.includes("deliveryRecordId"), false);
});
