import { REFRESH_INTERVAL_MS } from "./config.ts";
import { DogerError } from "./errors.ts";

export const STATE_SCHEMA_VERSION = 2 as const;

export type LifecycleStatus = "uninitialized" | "ready" | "reauth_required" | "manual_check";
export type RefreshOutcome =
  | "SUCCESS"
  | "NOT_DUE"
  | "REAUTH_REQUIRED"
  | "RATE_LIMITED"
  | "TRANSIENT_FAILURE"
  | "MANUAL_CHECK";

export interface RuntimeState {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly status: LifecycleStatus;
  readonly firstSuccessAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly nextEligibleAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastOutcome: RefreshOutcome | null;
}

export interface DueDecision {
  readonly due: boolean;
  readonly nextEligibleAt: string | null;
  readonly reason: "due" | "not_due" | "uninitialized" | "blocked";
}

const lifecycleStatuses = new Set<LifecycleStatus>(["uninitialized", "ready", "reauth_required", "manual_check"]);
const refreshOutcomes = new Set<RefreshOutcome>([
  "SUCCESS", "NOT_DUE", "REAUTH_REQUIRED", "RATE_LIMITED", "TRANSIENT_FAILURE", "MANUAL_CHECK",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNullableTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new DogerError("STATE_INVALID", `${field} must be a valid ISO timestamp or null.`);
  }
  return new Date(value).toISOString();
}

export function createInitialState(): RuntimeState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    status: "uninitialized",
    firstSuccessAt: null,
    lastSuccessAt: null,
    nextEligibleAt: null,
    lastAttemptAt: null,
    lastOutcome: null,
  };
}

export function createConfiguredState(): RuntimeState {
  return { ...createInitialState(), status: "ready" };
}

export function parseRuntimeState(value: unknown): RuntimeState {
  if (!isRecord(value) || value.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new DogerError("STATE_INVALID", "Unsupported runtime-state schema.");
  }
  const allowedKeys = new Set([
    "schemaVersion", "status", "firstSuccessAt", "lastSuccessAt", "nextEligibleAt", "lastAttemptAt", "lastOutcome",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new DogerError("STATE_INVALID", "Runtime state contains unsupported fields.");
  }
  if (typeof value.status !== "string" || !lifecycleStatuses.has(value.status as LifecycleStatus)) {
    throw new DogerError("STATE_INVALID", "Runtime state contains an invalid lifecycle status.");
  }
  if (
    value.lastOutcome !== null &&
    (typeof value.lastOutcome !== "string" || !refreshOutcomes.has(value.lastOutcome as RefreshOutcome))
  ) {
    throw new DogerError("STATE_INVALID", "Runtime state contains an invalid refresh outcome.");
  }

  const state: RuntimeState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    status: value.status as LifecycleStatus,
    firstSuccessAt: parseNullableTimestamp(value.firstSuccessAt, "firstSuccessAt"),
    lastSuccessAt: parseNullableTimestamp(value.lastSuccessAt, "lastSuccessAt"),
    nextEligibleAt: parseNullableTimestamp(value.nextEligibleAt, "nextEligibleAt"),
    lastAttemptAt: parseNullableTimestamp(value.lastAttemptAt, "lastAttemptAt"),
    lastOutcome: value.lastOutcome as RefreshOutcome | null,
  };

  const hasSuccessAnchor = state.firstSuccessAt !== null || state.lastSuccessAt !== null;
  if (hasSuccessAnchor &&
      (state.firstSuccessAt === null || state.lastSuccessAt === null || state.nextEligibleAt === null)) {
    throw new DogerError("STATE_INVALID", "Successful refresh timestamps must be complete.");
  }
  if (state.firstSuccessAt !== null && state.lastSuccessAt !== null && state.nextEligibleAt !== null) {
    if (Date.parse(state.lastSuccessAt) < Date.parse(state.firstSuccessAt)) {
      throw new DogerError("STATE_INVALID", "Last success cannot precede the first-success anchor.");
    }
    if (Date.parse(state.nextEligibleAt) - Date.parse(state.lastSuccessAt) < REFRESH_INTERVAL_MS) {
      throw new DogerError("STATE_INVALID", "Next eligibility cannot be earlier than eight hours after success.");
    }
  }
  if (state.firstSuccessAt === null && state.nextEligibleAt !== null) {
    if (state.lastAttemptAt === null || Date.parse(state.nextEligibleAt) < Date.parse(state.lastAttemptAt)) {
      throw new DogerError("STATE_INVALID", "Pre-anchor eligibility requires a valid attempt timestamp.");
    }
  }
  if (state.status === "uninitialized" && (hasSuccessAnchor || state.nextEligibleAt !== null || state.lastAttemptAt !== null)) {
    throw new DogerError("STATE_INVALID", "Uninitialized state cannot contain refresh timestamps.");
  }
  return state;
}

export function dueDecision(state: RuntimeState, now: Date): DueDecision {
  if (state.status === "uninitialized") {
    return { due: false, nextEligibleAt: null, reason: "uninitialized" };
  }
  if (state.status === "reauth_required" || state.status === "manual_check") {
    return { due: false, nextEligibleAt: state.nextEligibleAt, reason: "blocked" };
  }
  if (state.nextEligibleAt === null) {
    return { due: true, nextEligibleAt: null, reason: "due" };
  }
  if (now.getTime() < Date.parse(state.nextEligibleAt)) {
    return { due: false, nextEligibleAt: state.nextEligibleAt, reason: "not_due" };
  }
  return { due: true, nextEligibleAt: state.nextEligibleAt, reason: "due" };
}

export function recordSuccess(state: RuntimeState, occurredAt: Date): RuntimeState {
  const timestamp = occurredAt.toISOString();
  return {
    ...state,
    status: "ready",
    firstSuccessAt: state.firstSuccessAt ?? timestamp,
    lastSuccessAt: timestamp,
    nextEligibleAt: new Date(occurredAt.getTime() + REFRESH_INTERVAL_MS).toISOString(),
    lastAttemptAt: timestamp,
    lastOutcome: "SUCCESS",
  };
}

export function recordOutcome(
  state: RuntimeState,
  outcome: Exclude<RefreshOutcome, "SUCCESS" | "NOT_DUE">,
  occurredAt: Date,
  options: { readonly retryAfterAt?: string } = {},
): RuntimeState {
  const status: LifecycleStatus =
    outcome === "REAUTH_REQUIRED" ? "reauth_required" : outcome === "MANUAL_CHECK" ? "manual_check" : state.status;
  let nextEligibleAt = state.nextEligibleAt;
  if (
    state.firstSuccessAt === null &&
    nextEligibleAt !== null &&
    Date.parse(nextEligibleAt) < occurredAt.getTime()
  ) {
    nextEligibleAt = null;
  }
  if (outcome === "RATE_LIMITED" && options.retryAfterAt !== undefined) {
    const retryAfter = Date.parse(options.retryAfterAt);
    if (!Number.isNaN(retryAfter) && retryAfter > occurredAt.getTime()) {
      nextEligibleAt = new Date(Math.max(retryAfter, nextEligibleAt === null ? 0 : Date.parse(nextEligibleAt))).toISOString();
    }
  }
  return { ...state, status, nextEligibleAt, lastAttemptAt: occurredAt.toISOString(), lastOutcome: outcome };
}

export function recordTokenReplacement(state: RuntimeState): RuntimeState {
  return state.status === "reauth_required" ? { ...state, status: "ready" } : state;
}
