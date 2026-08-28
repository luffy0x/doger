import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { resolveDataDirectory } from "../src/infra/paths.ts";

test("stores Windows runtime data under the current user's LocalAppData directory", () => {
  const localAppData = "C:\\Users\\tester\\AppData\\Local";

  assert.equal(
    resolveDataDirectory({
      env: { LOCALAPPDATA: localAppData },
      homeDirectory: "C:\\Users\\tester",
      platform: "win32",
    }),
    join(localAppData, "doger"),
  );
});

test("falls back to the standard Windows user-profile path when LocalAppData is unavailable", () => {
  const homeDirectory = "C:\\Users\\tester";

  assert.equal(
    resolveDataDirectory({ env: {}, homeDirectory, platform: "win32" }),
    join(homeDirectory, "AppData", "Local", "doger"),
  );
});
