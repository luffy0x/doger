import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDoctor } from "../src/core/doctor-service.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";

test("reports healthy dependencies and a pre-initialization warning", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-doctor-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  const report = await runDoctor({
    paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }),
    platform: "darwin",
    nodeVersion: "24.0.0",
    probeCurl: async () => true,
    probeAgentBrowser: async () => true,
  });

  assert.equal(report.healthy, true);
  assert.deepEqual(report.checks.at(-1), {
    name: "configuration",
    status: "warning",
    code: "not_initialized",
  });
});

test("accepts Windows as a supported native platform", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-doctor-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  const report = await runDoctor({
    paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }),
    platform: "win32",
    nodeVersion: "24.0.0",
    probeCurl: async () => true,
    probeAgentBrowser: async () => true,
  });

  assert.equal(report.healthy, true);
  assert.deepEqual(report.checks.find((item) => item.name === "platform"), {
    name: "platform",
    status: "ok",
    code: "windows_supported",
  });
});

test("reports an unavailable dependency without subprocess diagnostics", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-doctor-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  const report = await runDoctor({
    paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }),
    platform: "darwin",
    nodeVersion: "24.0.0",
    probeCurl: async () => false,
    probeAgentBrowser: async () => true,
  });

  assert.equal(report.healthy, false);
  assert.deepEqual(report.checks.find((item) => item.name === "curl"), {
    name: "curl",
    status: "error",
    code: "curl_missing",
  });
});

test("reports corrupt local configuration as a redacted diagnostic", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-doctor-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const paths = resolveDogerPaths({ env: { DOGER_DATA_DIR: root } });
  await writeFile(paths.config, "{}", "utf8");

  const report = await runDoctor({
    paths,
    platform: "darwin",
    nodeVersion: "24.0.0",
    probeCurl: async () => true,
    probeAgentBrowser: async () => true,
  });

  assert.equal(report.healthy, false);
  assert.deepEqual(report.checks.find((item) => item.name === "configuration"), {
    name: "configuration",
    status: "error",
    code: "configuration_invalid",
  });
});
