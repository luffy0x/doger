import { unlink } from "node:fs/promises";

import { DogerError } from "../core/errors.ts";
import { readJsonFile, writeJsonAtomic } from "../infra/json-store.ts";
import { decryptJson, encryptJson, parseEncryptedEnvelope } from "./crypto.ts";
import { getOrCreateKey, type KeyProvider } from "./key-provider.ts";

export interface CredentialBundle {
  readonly version: 1;
  readonly capturedAt: string;
  readonly cookieHeader?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodySecrets: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringRecord(value: unknown, field: string): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    throw new DogerError("CREDENTIALS_INVALID", `${field} must be an object.`);
  }

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new DogerError("CREDENTIALS_INVALID", `${field} values must be strings.`);
    }
    result[key] = item;
  }
  return result;
}

export function parseCredentialBundle(value: unknown): CredentialBundle {
  if (!isRecord(value) || value.version !== 1) {
    throw new DogerError("CREDENTIALS_INVALID", "Credential bundle has an unsupported schema.");
  }

  if (typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))) {
    throw new DogerError("CREDENTIALS_INVALID", "Credential capture time is invalid.");
  }

  if (value.cookieHeader !== undefined && typeof value.cookieHeader !== "string") {
    throw new DogerError("CREDENTIALS_INVALID", "Cookie header must be a string when present.");
  }

  const bundle: CredentialBundle = {
    version: 1,
    capturedAt: new Date(value.capturedAt).toISOString(),
    headers: parseStringRecord(value.headers, "headers"),
    bodySecrets: parseStringRecord(value.bodySecrets, "bodySecrets"),
  };

  return value.cookieHeader === undefined ? bundle : { ...bundle, cookieHeader: value.cookieHeader };
}

export class EncryptedCredentialStore {
  readonly #path: string;
  readonly #keyProvider: KeyProvider;

  constructor(path: string, keyProvider: KeyProvider) {
    this.#path = path;
    this.#keyProvider = keyProvider;
  }

  async save(bundle: CredentialBundle): Promise<void> {
    const parsed = parseCredentialBundle(bundle);
    const key = await getOrCreateKey(this.#keyProvider);
    await writeJsonAtomic(this.#path, encryptJson(parsed, key));
  }

  async load(): Promise<CredentialBundle | null> {
    const envelope = await readJsonFile(this.#path, parseEncryptedEnvelope);
    if (envelope === null) {
      return null;
    }

    const key = await this.#keyProvider.get();
    if (key === null) {
      throw new DogerError("CREDENTIALS_MISSING", "Credential key is missing from the operating-system keychain.");
    }

    return parseCredentialBundle(decryptJson(envelope, key));
  }

  async delete(): Promise<void> {
    await unlink(this.#path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw new DogerError("STORAGE_ERROR", "Unable to delete encrypted credentials.", { cause: error });
      }
    });
    await this.#keyProvider.delete();
  }
}
