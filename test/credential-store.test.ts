import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EncryptedCredentialStore, type CredentialBundle } from "../src/security/credential-store.ts";
import type { KeyProvider } from "../src/security/key-provider.ts";

class MemoryKeyProvider implements KeyProvider {
  key: Uint8Array | null = null;

  async get(): Promise<Uint8Array | null> {
    return this.key;
  }

  async set(key: Uint8Array): Promise<void> {
    this.key = key;
  }

  async delete(): Promise<void> {
    this.key = null;
  }
}

const credential: CredentialBundle = {
  version: 1,
  capturedAt: "2026-08-28T01:02:03.000Z",
  cookieHeader: "session=synthetic-secret-cookie",
  query: "signature=synthetic-secret-signature",
  requestBody: "{\"accountId\":\"synthetic-account-id\"}",
  headers: { "x-csrf-token": "synthetic-secret-csrf" },
};

test("encrypts credentials at rest and decrypts them with the key provider", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-credential-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "credentials.enc");
  const provider = new MemoryKeyProvider();
  const store = new EncryptedCredentialStore(path, provider);

  await store.save(credential);

  const persisted = await readFile(path, "utf8");
  assert.doesNotMatch(persisted, /synthetic-secret-cookie/);
  assert.doesNotMatch(persisted, /synthetic-secret-csrf/);
  assert.doesNotMatch(persisted, /synthetic-secret-signature/);
  assert.doesNotMatch(persisted, /synthetic-account-id/);
  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  assert.deepEqual(await store.load(), credential);
});

test("deleting credentials removes both encrypted data and the key", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-credential-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "credentials.enc");
  const provider = new MemoryKeyProvider();
  const store = new EncryptedCredentialStore(path, provider);

  await store.save(credential);
  await store.delete();

  assert.equal(await store.load(), null);
  assert.equal(provider.key, null);
});

test("rejects a tampered encrypted credential payload", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-credential-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "credentials.enc");
  const provider = new MemoryKeyProvider();
  const store = new EncryptedCredentialStore(path, provider);

  await store.save(credential);
  const envelope = JSON.parse(await readFile(path, "utf8")) as { ciphertext: string };
  envelope.ciphertext = Buffer.from("tampered", "utf8").toString("base64");
  await writeFile(path, JSON.stringify(envelope), { mode: 0o600 });

  await assert.rejects(store.load(), /Unable to decrypt stored credentials/);
});
