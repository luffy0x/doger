import { DogerError } from "../core/errors.ts";

export const RECIPE_SCHEMA_VERSION = 1 as const;
export type HttpMethod = "GET" | "POST";

export interface ResponsePredicate {
  readonly statusCodes: readonly number[];
  readonly bodyIncludesAny: readonly string[];
}

export interface ResponseContract {
  readonly success: ResponsePredicate;
  readonly notDue?: ResponsePredicate;
  readonly authBodyIncludesAny: readonly string[];
  readonly authLocationIncludesAny: readonly string[];
  readonly rateLimitBodyIncludesAny: readonly string[];
}

export interface RequestRecipe {
  readonly schemaVersion: typeof RECIPE_SCHEMA_VERSION;
  readonly endpoint: string;
  readonly method: HttpMethod;
  readonly allowedHosts: readonly string[];
  readonly headerNames: readonly string[];
  readonly includeCookie: boolean;
  readonly includeQuery: boolean;
  readonly includeBody: boolean;
  readonly response: ResponseContract;
}

export interface RecipeParseOptions {
  readonly allowHttpForLoopbackTests?: boolean;
}

const forbiddenHeaderNames = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "transfer-encoding",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new DogerError("RECIPE_INVALID", `${field} must be an array of non-empty strings.`);
  }
  return value as string[];
}

function parseStatusCodes(value: unknown, field: string): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => !Number.isInteger(item) || (item as number) < 100 || (item as number) > 599)
  ) {
    throw new DogerError("RECIPE_INVALID", `${field} must contain valid HTTP status codes.`);
  }
  return value as number[];
}

function parsePredicate(value: unknown, field: string, requireBodyEvidence: boolean): ResponsePredicate {
  if (!isRecord(value)) {
    throw new DogerError("RECIPE_INVALID", `${field} must be an object.`);
  }

  const bodyIncludesAny = parseStringArray(value.bodyIncludesAny, `${field}.bodyIncludesAny`);
  if (requireBodyEvidence && bodyIncludesAny.length === 0) {
    throw new DogerError("RECIPE_INVALID", "Success classification requires body evidence.");
  }

  return {
    statusCodes: parseStatusCodes(value.statusCodes, `${field}.statusCodes`),
    bodyIncludesAny,
  };
}

function parseHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized.includes("://") || normalized.includes("/") || normalized.includes("@")) {
    throw new DogerError("RECIPE_INVALID", "Allowed hosts must contain hostnames only.");
  }
  return normalized;
}

function isAllowedTestUrl(url: URL, options: RecipeParseOptions): boolean {
  return (
    options.allowHttpForLoopbackTests === true &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost")
  );
}

export function parseRequestRecipe(value: unknown, options: RecipeParseOptions = {}): RequestRecipe {
  if (!isRecord(value) || value.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    throw new DogerError("RECIPE_INVALID", "Request recipe has an unsupported schema.");
  }

  if (typeof value.endpoint !== "string") {
    throw new DogerError("RECIPE_INVALID", "Request endpoint is required.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch (error) {
    throw new DogerError("RECIPE_INVALID", "Request endpoint is invalid.", { cause: error });
  }

  if (endpoint.username !== "" || endpoint.password !== "" || endpoint.search !== "" || endpoint.hash !== "") {
    throw new DogerError("RECIPE_INVALID", "Request endpoint must not contain credentials, query, or fragment.");
  }

  if (endpoint.protocol !== "https:" && !isAllowedTestUrl(endpoint, options)) {
    throw new DogerError("RECIPE_INVALID", "Request endpoint must use HTTPS.");
  }

  if (value.method !== "GET" && value.method !== "POST") {
    throw new DogerError("RECIPE_INVALID", "Request method must be GET or POST.");
  }

  const allowedHosts = [...new Set(parseStringArray(value.allowedHosts, "allowedHosts").map(parseHost))];
  if (!allowedHosts.includes(endpoint.hostname.toLowerCase())) {
    throw new DogerError("RECIPE_INVALID", "Request endpoint host is not allowlisted.");
  }

  const headerNames = [...new Set(parseStringArray(value.headerNames, "headerNames").map((name) => name.toLowerCase()))];
  for (const name of headerNames) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || forbiddenHeaderNames.has(name)) {
      throw new DogerError("RECIPE_INVALID", `Request header ${name} is not allowed.`);
    }
  }

  if (
    typeof value.includeCookie !== "boolean" ||
    typeof value.includeQuery !== "boolean" ||
    typeof value.includeBody !== "boolean"
  ) {
    throw new DogerError("RECIPE_INVALID", "Request credential-source flags must be booleans.");
  }

  if (value.method === "GET" && value.includeBody) {
    throw new DogerError("RECIPE_INVALID", "GET request recipes cannot include a body.");
  }

  if (!isRecord(value.response)) {
    throw new DogerError("RECIPE_INVALID", "Response contract is required.");
  }

  const response: ResponseContract = {
    success: parsePredicate(value.response.success, "response.success", true),
    authBodyIncludesAny: parseStringArray(value.response.authBodyIncludesAny, "response.authBodyIncludesAny"),
    authLocationIncludesAny: parseStringArray(
      value.response.authLocationIncludesAny,
      "response.authLocationIncludesAny",
    ),
    rateLimitBodyIncludesAny: parseStringArray(
      value.response.rateLimitBodyIncludesAny,
      "response.rateLimitBodyIncludesAny",
    ),
    ...(value.response.notDue === undefined
      ? {}
      : { notDue: parsePredicate(value.response.notDue, "response.notDue", true) }),
  };

  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    endpoint: endpoint.toString(),
    method: value.method,
    allowedHosts,
    headerNames,
    includeCookie: value.includeCookie,
    includeQuery: value.includeQuery,
    includeBody: value.includeBody,
    response,
  };
}
