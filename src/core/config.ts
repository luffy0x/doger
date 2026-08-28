import { DogerError } from "./errors.ts";

export const CONFIG_SCHEMA_VERSION = 2 as const;
export const REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1_000;
export const JD_REFRESH_ENDPOINT = "https://campus.jd.com/api/wx/resume/refresh";

export interface DogerConfig {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  readonly deliveryRecordId: number;
}

interface EndpointValidationOptions {
  readonly allowLoopbackForTests?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOfficialJdHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "jd.com" || normalized.endsWith(".jd.com");
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

export function validateRefreshEndpoint(
  endpoint: string,
  options: EndpointValidationOptions = {},
): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DogerError("CONFIG_INVALID", "The fixed JD refresh endpoint is invalid.");
  }

  const isApprovedProductionEndpoint =
    url.protocol === "https:" && isOfficialJdHost(url.hostname) && url.toString() === JD_REFRESH_ENDPOINT;
  const isApprovedTestEndpoint =
    options.allowLoopbackForTests === true && url.protocol === "http:" && isLoopback(url.hostname);
  if (!isApprovedProductionEndpoint && !isApprovedTestEndpoint) {
    throw new DogerError("CONFIG_INVALID", "The fixed JD refresh endpoint is not approved.");
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new DogerError("CONFIG_INVALID", "The fixed JD refresh endpoint is invalid.");
  }
  return url.toString();
}

function parseDeliveryRecordId(value: unknown): number {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (
    (typeof normalized === "string" && !/^\d+$/u.test(normalized)) ||
    (typeof normalized !== "string" && typeof normalized !== "number")
  ) {
    throw new DogerError("CONFIG_INVALID", "Delivery record ID must be a positive decimal integer.");
  }

  const number = typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new DogerError("CONFIG_INVALID", "Delivery record ID must be a positive decimal integer.");
  }
  return number;
}

export function createConfig(deliveryRecordId: string | number): DogerConfig {
  return { schemaVersion: CONFIG_SCHEMA_VERSION, deliveryRecordId: parseDeliveryRecordId(deliveryRecordId) };
}

export function parseConfig(value: unknown): DogerConfig {
  if (!isRecord(value)) {
    throw new DogerError("CONFIG_INVALID", "Configuration must be a JSON object.");
  }
  if (value.schemaVersion === 1) {
    throw new DogerError(
      "CONFIG_MIGRATION_REQUIRED",
      "Doger schema version 1 must be removed with doger uninstall and configured again with doger init.",
    );
  }
  if (value.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new DogerError("CONFIG_INVALID", "Unsupported configuration schema version.");
  }
  const allowedKeys = new Set(["schemaVersion", "deliveryRecordId"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new DogerError("CONFIG_INVALID", "Configuration contains unsupported fields.");
  }
  return createConfig(parseDeliveryRecordId(value.deliveryRecordId));
}
