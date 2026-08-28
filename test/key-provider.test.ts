import assert from "node:assert/strict";
import test from "node:test";

import { decodeKeyringValue } from "../src/security/key-provider.ts";

test("treats both native missing-value representations as an absent credential", () => {
  assert.equal(decodeKeyringValue(undefined), null);
  assert.equal(decodeKeyringValue(null), null);
});

test("decodes a stored keyring value from base64", () => {
  const key = Buffer.from("synthetic-key", "utf8");
  assert.deepEqual(decodeKeyringValue(key.toString("base64")), key);
});
