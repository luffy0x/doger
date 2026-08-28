import type { RefreshOutcome } from "../core/state.ts";
import type { JsonFieldPredicate, RequestRecipe, ResponsePredicate } from "./recipe.ts";

export interface CurlResponse {
  readonly exitCode: number;
  readonly statusCode: number | null;
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly body: string;
}

export interface Classification {
  readonly outcome: RefreshOutcome;
  readonly reason:
    | "success_contract"
    | "not_due_contract"
    | "authentication_status"
    | "authentication_marker"
    | "authentication_redirect"
    | "rate_limit_status"
    | "rate_limit_marker"
    | "transient_transport"
    | "ambiguous_timeout"
    | "server_error"
    | "unknown_response";
  readonly retryAfterAt?: string;
}

const preRequestTransientCurlExitCodes = new Set([5, 6, 7]);

function bodyMatches(body: string, markers: readonly string[]): boolean {
  const normalizedBody = body.toLowerCase();
  return markers.some((marker) => normalizedBody.includes(marker.toLowerCase()));
}

function jsonFieldMatches(value: unknown, predicate: JsonFieldPredicate): boolean {
  let current = value;
  for (const field of predicate.path) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || !Object.hasOwn(current, field)) {
      return false;
    }
    current = (current as Record<string, unknown>)[field];
  }
  return current === predicate.equals;
}

function jsonMatches(body: string, predicates: readonly JsonFieldPredicate[]): boolean {
  if (predicates.length === 0) {
    return false;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    return predicates.some((predicate) => jsonFieldMatches(parsed, predicate));
  } catch {
    return false;
  }
}

function predicateMatches(response: CurlResponse, predicate: ResponsePredicate): boolean {
  return (
    response.statusCode !== null &&
    predicate.statusCodes.includes(response.statusCode) &&
    (bodyMatches(response.body, predicate.bodyIncludesAny) || jsonMatches(response.body, predicate.jsonEqualsAny ?? []))
  );
}

function firstHeader(response: CurlResponse, name: string): string | undefined {
  return response.headers[name.toLowerCase()]?.[0];
}

function retryAfterAt(value: string | undefined, now: Date): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.getTime() + seconds * 1_000).toISOString();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

export function classifyResponse(response: CurlResponse, recipe: RequestRecipe, now = new Date()): Classification {
  if (response.exitCode === 28) {
    return { outcome: "MANUAL_CHECK", reason: "ambiguous_timeout" };
  }

  if (response.exitCode !== 0) {
    return {
      outcome: preRequestTransientCurlExitCodes.has(response.exitCode) ? "TRANSIENT_FAILURE" : "MANUAL_CHECK",
      reason: preRequestTransientCurlExitCodes.has(response.exitCode) ? "transient_transport" : "unknown_response",
    };
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    return { outcome: "REAUTH_REQUIRED", reason: "authentication_status" };
  }

  const location = firstHeader(response, "location");
  if (
    response.statusCode !== null &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    location !== undefined &&
    recipe.response.authLocationIncludesAny.some((marker) => location.toLowerCase().includes(marker.toLowerCase()))
  ) {
    return { outcome: "REAUTH_REQUIRED", reason: "authentication_redirect" };
  }

  if (bodyMatches(response.body, recipe.response.authBodyIncludesAny)) {
    return { outcome: "REAUTH_REQUIRED", reason: "authentication_marker" };
  }

  if (response.statusCode === 429) {
    const retryAt = retryAfterAt(firstHeader(response, "retry-after"), now);
    return {
      outcome: "RATE_LIMITED",
      reason: "rate_limit_status",
      ...(retryAt === undefined ? {} : { retryAfterAt: retryAt }),
    };
  }

  if (bodyMatches(response.body, recipe.response.rateLimitBodyIncludesAny)) {
    return { outcome: "RATE_LIMITED", reason: "rate_limit_marker" };
  }

  if (predicateMatches(response, recipe.response.success)) {
    return { outcome: "SUCCESS", reason: "success_contract" };
  }

  if (recipe.response.notDue !== undefined && predicateMatches(response, recipe.response.notDue)) {
    return { outcome: "NOT_DUE", reason: "not_due_contract" };
  }

  if (response.statusCode !== null && response.statusCode >= 500) {
    return { outcome: "TRANSIENT_FAILURE", reason: "server_error" };
  }

  return { outcome: "MANUAL_CHECK", reason: "unknown_response" };
}
