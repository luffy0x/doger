import { AsyncEntry } from "@napi-rs/keyring";

import { DogerError } from "../core/errors.ts";
import { generateEncryptionKey } from "./crypto.ts";

export interface KeyProvider {
  get(): Promise<Uint8Array | null>;
  set(key: Uint8Array): Promise<void>;
  delete(): Promise<void>;
}

export class KeyringKeyProvider implements KeyProvider {
  readonly #entry: AsyncEntry;

  constructor(service = "doger", account = "credential-encryption-key") {
    this.#entry = new AsyncEntry(service, account);
  }

  async get(): Promise<Uint8Array | null> {
    try {
      const encoded = await this.#entry.getPassword();
      return encoded === undefined ? null : Buffer.from(encoded, "base64");
    } catch (error) {
      if (String(error).toLowerCase().includes("no entry")) {
        return null;
      }
      throw new DogerError("STORAGE_ERROR", "Unable to read the Doger keychain entry.", { cause: error });
    }
  }

  async set(key: Uint8Array): Promise<void> {
    try {
      await this.#entry.setPassword(Buffer.from(key).toString("base64"));
    } catch (error) {
      throw new DogerError("STORAGE_ERROR", "Unable to update the Doger keychain entry.", { cause: error });
    }
  }

  async delete(): Promise<void> {
    try {
      await this.#entry.deleteCredential();
    } catch (error) {
      if (!String(error).toLowerCase().includes("no entry")) {
        throw new DogerError("STORAGE_ERROR", "Unable to delete the Doger keychain entry.", { cause: error });
      }
    }
  }
}

export async function getOrCreateKey(provider: KeyProvider): Promise<Uint8Array> {
  const existing = await provider.get();
  if (existing !== null) {
    return existing;
  }

  const generated = generateEncryptionKey();
  await provider.set(generated);
  return generated;
}
