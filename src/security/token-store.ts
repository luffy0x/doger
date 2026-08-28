import { AsyncEntry } from "@napi-rs/keyring";

import { DogerError } from "../core/errors.ts";

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  delete(): Promise<void>;
}

export interface KeyringEntry {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
  deleteCredential(): Promise<boolean | void>;
}

export function normalizeKeyringToken(value: string | null | undefined): string | null {
  return value == null ? null : value;
}

export function validateToken(value: string): string {
  const token = value.trim();
  if (token === "" || token.length > 16_384 || /[\0\r\n]/u.test(token)) {
    throw new DogerError("TOKEN_INVALID", "The token is empty or contains unsupported characters.");
  }
  return token;
}

function isMissingEntryError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("no entry") || message.includes("not found") || message.includes("element not found");
}

export class KeyringTokenStore implements TokenStore {
  readonly #entry: KeyringEntry;

  constructor(service = "doger", account = "jd-token", entry?: KeyringEntry) {
    this.#entry = entry ?? new AsyncEntry(service, account);
  }

  async get(): Promise<string | null> {
    try {
      return normalizeKeyringToken(await this.#entry.getPassword());
    } catch (error) {
      if (isMissingEntryError(error)) return null;
      throw new DogerError("STORAGE_ERROR", "Unable to read the Doger token entry.");
    }
  }

  async set(token: string): Promise<void> {
    const validated = validateToken(token);
    try {
      await this.#entry.setPassword(validated);
    } catch {
      throw new DogerError("STORAGE_ERROR", "Unable to update the Doger token entry.");
    }
  }

  async delete(): Promise<void> {
    try {
      await this.#entry.deleteCredential();
    } catch (error) {
      if (!isMissingEntryError(error)) {
        throw new DogerError("STORAGE_ERROR", "Unable to delete the Doger token entry.");
      }
    }
  }
}
