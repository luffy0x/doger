import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { probeCredentialStore, runDoctor } from "../src/core/doctor-service.ts";
import { resolveDogerPaths } from "../src/infra/paths.ts";
import type { TokenStore } from "../src/security/token-store.ts";

test("reports Windows, curl, and credential storage without browser diagnostics", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-doctor-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const report = await runDoctor({
    paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }),
    platform: "win32",
    nodeVersion: "24.0.0",
    probeCurl: async () => true,
    probeCredentialStore: async () => true,
  });

  assert.equal(report.healthy, true);
  assert.deepEqual(report.checks.map((item) => item.name), ["platform", "node", "curl", "credential-store", "configuration"]);
  assert.equal(report.checks.some((item) => item.name.includes("browser")), false);
  assert.equal(report.checks.at(-1)?.status, "warning");
});

test("reports corrupt configuration without returning its contents", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-doctor-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const paths = resolveDogerPaths({ env: { DOGER_DATA_DIR: root } });
  await writeFile(paths.config, '{"deliveryRecordId":"synthetic-private-id"}', "utf8");

  const report = await runDoctor({
    paths,
    platform: "win32",
    nodeVersion: "24.0.0",
    probeCurl: async () => true,
    probeCredentialStore: async () => true,
  });
  assert.equal(report.healthy, false);
  assert.equal(JSON.stringify(report).includes("synthetic-private-id"), false);
});

test("fails closed on unsupported Windows architectures", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "doger-doctor-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const report = await runDoctor({
    paths: resolveDogerPaths({ env: { DOGER_DATA_DIR: root } }),
    platform: "win32",
    arch: "ia32",
    nodeVersion: "24.0.0",
    probeCurl: async () => true,
    probeCredentialStore: async () => true,
  });
  assert.equal(report.healthy, false);
  assert.equal(report.checks[0]?.code, "unsupported_platform_architecture");
});

test("credential-store probe fails when cleanup fails", async () => {
  const store: TokenStore = {
    async get() { return "synthetic-probe"; },
    async set() {},
    async delete() { throw new Error("cleanup failed"); },
  };
  assert.equal(await probeCredentialStore(store, "synthetic-probe"), false);
});
