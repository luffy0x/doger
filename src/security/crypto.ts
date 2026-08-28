import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { DogerError } from "../core/errors.ts";

const ALGORITHM = "aes-256-gcm";
const AAD = Buffer.from("doger.credentials.v1", "utf8");
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedEnvelope {
  readonly version: 1;
  readonly algorithm: typeof ALGORITHM;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

export function generateEncryptionKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

function assertKey(key: Uint8Array): void {
  if (key.byteLength !== KEY_BYTES) {
    throw new DogerError("CREDENTIALS_INVALID", "Credential encryption key must be 32 bytes.");
  }
}

export function encryptJson(value: unknown, key: Uint8Array): EncryptedEnvelope {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);

  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptJson(envelope: EncryptedEnvelope, key: Uint8Array): unknown {
  assertKey(key);

  if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM) {
    throw new DogerError("CREDENTIALS_INVALID", "Unsupported credential envelope.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch (error) {
    throw new DogerError("CREDENTIALS_INVALID", "Unable to decrypt stored credentials.", { cause: error });
  }
}

export function parseEncryptedEnvelope(value: unknown): EncryptedEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DogerError("CREDENTIALS_INVALID", "Credential envelope must be an object.");
  }

  const candidate = value as Partial<EncryptedEnvelope>;
  if (
    candidate.version !== 1 ||
    candidate.algorithm !== ALGORITHM ||
    typeof candidate.iv !== "string" ||
    typeof candidate.authTag !== "string" ||
    typeof candidate.ciphertext !== "string"
  ) {
    throw new DogerError("CREDENTIALS_INVALID", "Credential envelope is malformed.");
  }

  return candidate as EncryptedEnvelope;
}
