import { DogerError } from "../core/errors.ts";
import { readJsonFile, writeJsonAtomic } from "./json-store.ts";

export const INSTALLATION_MARKER = { schemaVersion: 1, product: "doger" } as const;

function parseInstallationMarker(value: unknown): typeof INSTALLATION_MARKER {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== INSTALLATION_MARKER.schemaVersion ||
    !("product" in value) ||
    value.product !== INSTALLATION_MARKER.product
  ) {
    throw new DogerError("STORAGE_ERROR", "Doger installation marker is invalid.");
  }
  return INSTALLATION_MARKER;
}

export async function hasInstallationMarker(path: string): Promise<boolean> {
  return (await readJsonFile(path, parseInstallationMarker)) !== null;
}

export async function writeInstallationMarker(path: string): Promise<void> {
  await writeJsonAtomic(path, INSTALLATION_MARKER);
}
