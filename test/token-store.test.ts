import assert from "node:assert/strict";
import test from "node:test";

import {
  KeyringTokenStore,
  normalizeKeyringToken,
  validateToken,
  type KeyringEntry,
} from "../src/security/token-store.ts";

class MemoryEntry implements KeyringEntry {
  value: string | null | undefined;

  async getPassword(): Promise<string | null | undefined> {
    return this.value;
  }

  async setPassword(value: string): Promise<void> {
    this.value = value;
  }

  async deleteCredential(): Promise<void> {
    this.value = null;
  }
}

test("treats native missing-value representations as an absent token", () => {
  assert.equal(normalizeKeyringToken(undefined), null);
  assert.equal(normalizeKeyringToken(null), null);
});

test("stores, replaces, reads, and deletes the token directly", async () => {
  const entry = new MemoryEntry();
  const store = new KeyringTokenStore("doger-test", "jd-token", entry);

  await store.set("session=synthetic-token-one");
  assert.equal(await store.get(), "session=synthetic-token-one");
  await store.set("session=synthetic-token-two");
  assert.equal(await store.get(), "session=synthetic-token-two");
  await store.delete();
  assert.equal(await store.get(), null);
});

test("rejects empty tokens and curl-header injection characters", () => {
  for (const token of ["", "   ", "session=value\r\nheader: injected", "value\0tail"]) {
    assert.throws(() => validateToken(token));
  }
});
