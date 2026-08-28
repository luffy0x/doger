import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentBrowserSession,
  browserDomainPatterns,
  resolveAgentBrowserExecutable,
  runBrowserProcess,
  sanitizeAgentBrowserEnvironment,
  type AgentBrowserCommand,
  type AgentBrowserCommandResult,
} from "../src/browser/agent-browser.ts";
import { DogerError } from "../src/core/errors.ts";

function recordingRunner(
  commands: AgentBrowserCommand[],
  results: AgentBrowserCommandResult[] = [],
): (command: AgentBrowserCommand) => Promise<AgentBrowserCommandResult> {
  return async (command) => {
    commands.push(command);
    return results.shift() ?? { exitCode: 0, stdout: '{"success":true}', stderr: "" };
  };
}

test("uses a fresh allowlisted headed session without restore or state replay", async () => {
  const commands: AgentBrowserCommand[] = [];
  const session = new AgentBrowserSession("https://campus.jd.com/application/123", {
    environment: {
      AGENT_BROWSER_RESTORE: "unsafe-restore",
      AGENT_BROWSER_STATE: "/unsafe/state.json",
      AGENT_BROWSER_PROFILE: "/unsafe/profile",
      PATH: "/usr/bin",
    },
    runner: recordingRunner(commands),
    sessionName: "doger-test-session",
  });

  await session.open("https://campus.jd.com/application/123");
  await session.close();

  assert.equal(commands.length, 2);
  const open = commands[0];
  if (open === undefined) {
    assert.fail("Expected the open command to be recorded.");
  }
  assert.deepEqual(open.args.slice(-2), ["open", "https://campus.jd.com/application/123"]);
  assert.ok(open.args.includes("--headed"));
  assert.ok(open.args.includes("--allowed-domains"));
  assert.ok(open.args.includes("jd.com,*.jd.com,360buyimg.com,*.360buyimg.com"));
  assert.ok(open.args.includes("--pin-tab"));
  assert.equal(open.args.includes("--restore"), false);
  assert.equal(open.args.includes("--state"), false);
  assert.equal(open.args.includes("--profile"), false);
  assert.equal(open.environment.AGENT_BROWSER_RESTORE, undefined);
  assert.equal(open.environment.AGENT_BROWSER_STATE, undefined);
  assert.equal(open.environment.AGENT_BROWSER_PROFILE, undefined);
  assert.equal(open.environment.PATH, "/usr/bin");
  assert.equal(open.timeoutMs, 120_000);
  assert.deepEqual(commands[1]?.args.slice(-2), ["close", "--all"]);
  assert.ok(commands[1]?.args.includes("--headed"));
  assert.equal(commands[1]?.timeoutMs, 30_000);
});

test("captures structured network data without returning command diagnostics", async () => {
  const commands: AgentBrowserCommand[] = [];
  const result = { success: true, data: { requests: [{ requestId: "123.4" }] } };
  const session = new AgentBrowserSession("https://campus.jd.com/application/123", {
    runner: recordingRunner(commands, [
      { exitCode: 0, stdout: '{"success":true}', stderr: "" },
      { exitCode: 0, stdout: '{"success":true}', stderr: "" },
      { exitCode: 0, stdout: JSON.stringify(result), stderr: "" },
      { exitCode: 0, stdout: '{"success":true,"data":{"requestId":"123.4"}}', stderr: "" },
      { exitCode: 0, stdout: '{"success":true,"data":{"cookies":[]}}', stderr: "" },
    ]),
    sessionName: "doger-test-session",
  });

  await session.open("https://campus.jd.com/application/123");
  await session.clearNetworkRequests();
  assert.deepEqual(await session.listNetworkRequests(), result);
  assert.deepEqual(await session.getNetworkRequest("123.4"), {
    success: true,
    data: { requestId: "123.4" },
  });
  assert.deepEqual(await session.getCookies(), { success: true, data: { cookies: [] } });

  assert.deepEqual(commands[1]?.args.slice(-3), ["network", "requests", "--clear"]);
  assert.deepEqual(commands[2]?.args.slice(-4), ["network", "requests", "--type", "xhr,fetch"]);
  assert.deepEqual(commands[3]?.args.slice(-3), ["network", "request", "123.4"]);
  assert.deepEqual(commands[4]?.args.slice(-2), ["cookies", "get"]);
});

test("does not expose captured browser output in failures", async () => {
  const secret = "synthetic-secret-cookie";
  const session = new AgentBrowserSession("https://campus.jd.com/application/123", {
    runner: async () => ({ exitCode: 1, stdout: secret, stderr: secret }),
    sessionName: "doger-test-session",
  });

  await assert.rejects(
    session.open("https://campus.jd.com/application/123"),
    (error: unknown) =>
      error instanceof DogerError &&
      error.code === "BROWSER_EXECUTION_FAILED" &&
      !error.message.includes(secret),
  );
});

test("treats a structured success false response as a command failure", async () => {
  const secret = "synthetic-secret-browser-error";
  const session = new AgentBrowserSession("https://campus.jd.com/application/123", {
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ success: false, data: null, error: secret }),
      stderr: "",
    }),
    sessionName: "doger-test-session",
  });

  await assert.rejects(
    session.open("https://campus.jd.com/application/123"),
    (error: unknown) =>
      error instanceof DogerError &&
      error.code === "BROWSER_EXECUTION_FAILED" &&
      !error.message.includes(secret),
  );
});

test("rejects malformed structured output without echoing it", async () => {
  const secret = "not-json-synthetic-secret";
  const session = new AgentBrowserSession("https://campus.jd.com/application/123", {
    runner: recordingRunner([], [
      { exitCode: 0, stdout: '{"success":true}', stderr: "" },
      { exitCode: 0, stdout: secret, stderr: "" },
    ]),
    sessionName: "doger-test-session",
  });
  await session.open("https://campus.jd.com/application/123");

  await assert.rejects(
    session.listNetworkRequests(),
    (error: unknown) =>
      error instanceof DogerError && error.code === "BROWSER_OUTPUT_INVALID" && !error.message.includes(secret),
  );
});

test("allows only official JD application URLs for interactive authentication", () => {
  assert.deepEqual(browserDomainPatterns("https://campus.jd.com/application/123"), [
    "jd.com",
    "*.jd.com",
    "360buyimg.com",
    "*.360buyimg.com",
  ]);
  assert.throws(() => browserDomainPatterns("https://example.com/application/123"));
  assert.throws(() => browserDomainPatterns("http://campus.jd.com/application/123"));
});

test("removes inherited agent-browser controls and Node injection", () => {
  assert.deepEqual(
    sanitizeAgentBrowserEnvironment({
      AGENT_BROWSER_CONFIG: "/unsafe/config.json",
      agent_browser_state: "/unsafe/state.json",
      NODE_OPTIONS: "--require=/unsafe/inject.js",
      Node_Options: "--require=/unsafe/mixed-case-inject.js",
      PATH: "/usr/bin",
    }),
    { PATH: "/usr/bin", NO_COLOR: "1" },
  );
});

test("resolves the bundled Windows agent-browser executable", () => {
  assert.match(
    resolveAgentBrowserExecutable({ platform: "win32", arch: "x64" }),
    /agent-browser-win32-x64\.exe$/u,
  );
  assert.match(
    resolveAgentBrowserExecutable({ platform: "win32", arch: "arm64" }),
    /agent-browser-win32-x64\.exe$/u,
  );
});

test("returns when the CLI exits even if its daemon keeps inherited pipes open", async () => {
  const childScript = [
    'const { spawn } = require("node:child_process");',
    'const daemon = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], { detached: true, stdio: ["ignore", 1, 2], windowsHide: true });',
    "daemon.unref();",
    'process.stdout.write("{\\"success\\":true}");',
  ].join(" ");
  const startedAt = Date.now();

  const result = await runBrowserProcess(process.execPath, {
    args: ["--input-type=commonjs", "-e", childScript],
    environment: process.env,
    maxOutputBytes: 1024,
    timeoutMs: 750,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"success":true}');
  assert.ok(Date.now() - startedAt < 750);
});

test("waits for a complete JSON result after the CLI exits", async () => {
  const delayedWriter = 'setTimeout(() => process.stdout.write("true}"), 100); setTimeout(() => {}, 1500);';
  const childScript = [
    'const { spawn } = require("node:child_process");',
    `const daemon = spawn(process.execPath, ["-e", ${JSON.stringify(delayedWriter)}], { detached: true, stdio: ["ignore", 1, 2], windowsHide: true });`,
    "daemon.unref();",
    'process.stdout.write("{\\"success\\":");',
  ].join(" ");
  const startedAt = Date.now();

  const result = await runBrowserProcess(process.execPath, {
    args: ["--input-type=commonjs", "-e", childScript],
    environment: process.env,
    maxOutputBytes: 1024,
    timeoutMs: 750,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"success":true}');
  assert.ok(Date.now() - startedAt < 750);
});
