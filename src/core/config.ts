import { DogerError } from "./errors.ts";

export const CONFIG_SCHEMA_VERSION = 1 as const;
export const REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1_000;

export function isOfficialJdHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "jd.com" || normalized.endsWith(".jd.com");
}

export interface DogerConfig {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  readonly applicationUrl: string;
  readonly allowedHosts: readonly string[];
  readonly intervalMs: typeof REFRESH_INTERVAL_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHttpsUrl(rawUrl: string): URL {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new DogerError("CONFIG_INVALID", "Application URL is invalid.", { cause: error });
  }

  if (url.protocol !== "https:") {
    throw new DogerError("CONFIG_INVALID", "Application URL must use HTTPS.");
  }

  if (url.username !== "" || url.password !== "") {
    throw new DogerError("CONFIG_INVALID", "Application URL must not contain credentials.");
  }

  if (!isOfficialJdHost(url.hostname)) {
    throw new DogerError("CONFIG_INVALID", "Application URL must use an official JD domain.");
  }

  return url;
}

function normalizeAllowedHosts(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DogerError("CONFIG_INVALID", "At least one allowed host is required.");
  }

  const hosts = value.map((host) => {
    if (typeof host !== "string" || host.trim() === "") {
      throw new DogerError("CONFIG_INVALID", "Allowed hosts must be non-empty strings.");
    }

    const normalized = host.trim().toLowerCase();
    if (normalized.includes("://") || normalized.includes("/") || normalized.includes("@")) {
      throw new DogerError("CONFIG_INVALID", "Allowed hosts must contain hostnames only.");
    }
    if (!isOfficialJdHost(normalized)) {
      throw new DogerError("CONFIG_INVALID", "Allowed hosts must belong to the official JD domain.");
    }

    return normalized;
  });

  return [...new Set(hosts)];
}

export function createConfig(applicationUrl: string): DogerConfig {
  const url = parseHttpsUrl(applicationUrl);

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    applicationUrl: url.toString(),
    allowedHosts: [url.hostname.toLowerCase()],
    intervalMs: REFRESH_INTERVAL_MS,
  };
}

export function parseConfig(value: unknown): DogerConfig {
  if (!isRecord(value)) {
    throw new DogerError("CONFIG_INVALID", "Configuration must be a JSON object.");
  }

  if (value.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new DogerError("CONFIG_INVALID", "Unsupported configuration schema version.");
  }

  if (typeof value.applicationUrl !== "string") {
    throw new DogerError("CONFIG_INVALID", "Application URL is required.");
  }

  const url = parseHttpsUrl(value.applicationUrl);
  const allowedHosts = normalizeAllowedHosts(value.allowedHosts);

  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new DogerError("CONFIG_INVALID", "Application host must be explicitly allowlisted.");
  }

  if (value.intervalMs !== REFRESH_INTERVAL_MS) {
    throw new DogerError("CONFIG_INVALID", "Refresh interval must be exactly eight hours.");
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    applicationUrl: url.toString(),
    allowedHosts,
    intervalMs: REFRESH_INTERVAL_MS,
  };
}
