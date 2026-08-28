import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { resolveDataDirectory, resolveDogerPaths } from "../src/infra/paths.ts";

test("stores Windows runtime data under the current user's LocalAppData directory", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";
  assert.equal(
    resolveDataDirectory({ env: { LOCALAPPDATA: localAppData }, homeDirectory: "C:\\Users\\tester", platform: "win32" }),
    join(localAppData, "doger"),
  );
});

test("the public path contract contains no recipe or credential files", () => {
  const paths = resolveDogerPaths({ env: { DOGER_DATA_DIR: "C:\\doger-test" }, platform: "win32" });
  assert.deepEqual(Object.keys(paths).sort(), ["config", "installationMarker", "refreshLock", "root", "runtimeState"]);
});
