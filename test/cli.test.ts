import assert from "node:assert/strict";
import test from "node:test";

import { helpText, VERSION } from "../src/cli.ts";

test("help identifies Doger and its CLI entrypoint", () => {
  const help = helpText();

  assert.match(help, /doger, a jd-activity-keeper/);
  assert.match(help, /Usage: doger <command>/);
});

test("version is a valid semantic version", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
