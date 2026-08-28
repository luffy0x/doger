import type { RefreshOutcome } from "../core/state.ts";

export interface CurlResponse {
  readonly exitCode: number;
  readonly statusCode: number | null;
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly body: string;
  readonly responseTooLarge: boolean;
}

export interface Classification {
  readonly outcome: Exclude<RefreshOutcome, "NOT_DUE">;
  readonly reason:
    | "success_contract"
    | "authentication_status"
    | "rate_limit_status"
    | "transient_transport"
    | "ambiguous_timeout"
    | "server_error"
    | "redirect_response"
    | "response_too_large"
    | "malformed_json"
    | "unknown_response";
  readonly retryAfterAt?: string;
}

const preRequestTransientCurlExitCodes = new Set([5, 6, 7]);

function firstHeader(response: CurlResponse, name: string): string | undefined {
  return response.headers[name.toLowerCase()]?.[0];
}

function parseRetryAfter(value: string | undefined, now: Date): string | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.getTime() + seconds * 1_000).toISOString();
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixedSuccessContract(body: string): "success" | "false" | "malformed" {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return "malformed";
  }
  if (!isRecord(parsed) || !isRecord(parsed.body)) return "false";
  return parsed.success === true && parsed.body.success === true ? "success" : "false";
}

export function classifyResponse(response: CurlResponse, now = new Date()): Classification {
  if (response.responseTooLarge) return { outcome: "MANUAL_CHECK", reason: "response_too_large" };
  if (response.exitCode === 28) return { outcome: "MANUAL_CHECK", reason: "ambiguous_timeout" };
  if (response.exitCode !== 0) {
    const transient = preRequestTransientCurlExitCodes.has(response.exitCode);
    return {
      outcome: transient ? "TRANSIENT_FAILURE" : "MANUAL_CHECK",
      reason: transient ? "transient_transport" : "unknown_response",
    };
  }
  if (response.statusCode === 401 || response.statusCode === 403) {
    return { outcome: "REAUTH_REQUIRED", reason: "authentication_status" };
  }
  if (response.statusCode === 429) {
    const retryAfterAt = parseRetryAfter(firstHeader(response, "retry-after"), now);
    return {
      outcome: "RATE_LIMITED",
      reason: "rate_limit_status",
      ...(retryAfterAt === undefined ? {} : { retryAfterAt }),
    };
  }
  if (response.statusCode !== null && response.statusCode >= 300 && response.statusCode < 400) {
    return { outcome: "MANUAL_CHECK", reason: "redirect_response" };
  }
  if (response.statusCode !== null && response.statusCode >= 500) {
    return { outcome: "TRANSIENT_FAILURE", reason: "server_error" };
  }
  if (response.statusCode === null || response.statusCode < 200 || response.statusCode >= 300) {
    return { outcome: "MANUAL_CHECK", reason: "unknown_response" };
  }

  const contract = fixedSuccessContract(response.body);
  if (contract === "success") return { outcome: "SUCCESS", reason: "success_contract" };
  return { outcome: "MANUAL_CHECK", reason: contract === "malformed" ? "malformed_json" : "unknown_response" };
}
