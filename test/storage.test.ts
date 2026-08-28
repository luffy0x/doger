import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createInitialState, parseRuntimeState } from "../src/core/state.ts";
import { readJsonFile, writeJsonAtomic } from "../src/infra/json-store.ts";

test("writes owner-only JSON atomically and reads it through a parser", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-store-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "runtime.json");
  const state = createInitialState();

  await writeJsonAtomic(path, state);

  assert.deepEqual(await readJsonFile(path, parseRuntimeState), state);
  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  assert.match(await readFile(path, "utf8"), /"schemaVersion": 1/);
});
