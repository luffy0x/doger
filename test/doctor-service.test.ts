import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
