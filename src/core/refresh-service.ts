import { JD_REFRESH_ENDPOINT, parseConfig, validateRefreshEndpoint } from "./config.ts";
import { DogerError } from "./errors.ts";
import { REPORT_SCHEMA_VERSION } from "./report.ts";
import {
  dueDecision,
  parseRuntimeState,
  recordOutcome,
  recordSuccess,
  type RefreshOutcome,
  type RuntimeState,
} from "./state.ts";
import { executeRefresh, type RefreshClientOptions } from "../http/refresh-client.ts";
import { readJsonFile, writeJsonAtomic } from "../infra/json-store.ts";
import { hasInstallationMarker } from "../infra/installation.ts";
import { withProcessLock, type LockOptions } from "../infra/lock.ts";
import type { DogerPaths } from "../infra/paths.ts";
import type { TokenStore } from "../security/token-store.ts";
import { validateToken } from "../security/token-store.ts";

export interface RefreshReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly command: "refresh";
  readonly outcome: RefreshOutcome;
  readonly attempted: boolean;
  readonly attempts: 0 | 1;
  readonly completedAt: string;
  readonly nextEligibleAt: string | null;
  readonly reason: string;
  readonly retryAfterAt?: string;
}

export interface GuardedRefreshOptions {
  readonly tokenStore: TokenStore;
  readonly lock?: Omit<LockOptions, "now">;
  readonly now?: () => Date;
  readonly paths: DogerPaths;
  readonly refreshClient?: RefreshClientOptions;
}

async function requiredJson<T>(path: string, parser: (value: unknown) => T, label: string): Promise<T> {
  const value = await readJsonFile(path, parser);
  if (value === null) throw new DogerError("CONFIG_INVALID", `${label} is missing. Run doger init first.`);
  return value;
}

function blockedOutcome(state: RuntimeState): "REAUTH_REQUIRED" | "MANUAL_CHECK" | null {
  if (state.status === "reauth_required") return "REAUTH_REQUIRED";
  if (state.status === "manual_check") return "MANUAL_CHECK";
  return null;
}

function skippedReport(
  state: RuntimeState,
  completedAt: Date,
  outcome: "NOT_DUE" | "REAUTH_REQUIRED" | "MANUAL_CHECK",
  reason: string,
): RefreshReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    command: "refresh",
    outcome,
    attempted: false,
    attempts: 0,
    completedAt: completedAt.toISOString(),
    nextEligibleAt: state.nextEligibleAt,
    reason,
  };
}

export async function runGuardedRefresh(options: GuardedRefreshOptions): Promise<RefreshReport> {
  const now = options.now ?? (() => new Date());
  return await withProcessLock(
    options.paths.refreshLock,
    async () => {
      const startedAt = now();
      const config = await requiredJson(options.paths.config, parseConfig, "Configuration");
      const [installed, state] = await Promise.all([
        hasInstallationMarker(options.paths.installationMarker),
        requiredJson(options.paths.runtimeState, parseRuntimeState, "Runtime state"),
      ]);
      if (!installed) {
        throw new DogerError("CONFIG_INVALID", "Doger installation marker is missing. Run doger init first.");
      }

      const blocked = blockedOutcome(state);
      if (blocked !== null) return skippedReport(state, startedAt, blocked, "blocked_state");
      const due = dueDecision(state, startedAt);
      if (!due.due) return skippedReport(state, startedAt, "NOT_DUE", "local_schedule_guard");

      const curlOptions = options.refreshClient?.curl ?? {};
      validateRefreshEndpoint(curlOptions.endpoint ?? JD_REFRESH_ENDPOINT, {
        ...(curlOptions.allowLoopbackForTests === undefined
          ? {}
          : { allowLoopbackForTests: curlOptions.allowLoopbackForTests }),
      });

      const storedToken = await options.tokenStore.get();
      let token: string | null = null;
      try {
        token = storedToken === null ? null : validateToken(storedToken);
      } catch (error) {
        if (!(error instanceof DogerError) || error.code !== "TOKEN_INVALID") throw error;
      }
      if (token === null) {
        const nextState = recordOutcome(state, "REAUTH_REQUIRED", startedAt);
        await writeJsonAtomic(options.paths.runtimeState, nextState);
        return skippedReport(nextState, startedAt, "REAUTH_REQUIRED", "token_missing");
      }

      const result = await executeRefresh(config.deliveryRecordId, token, {
        ...options.refreshClient,
        now,
      });
      const completedAt = now();
      const nextState = result.classification.outcome === "SUCCESS"
        ? recordSuccess(state, completedAt)
        : recordOutcome(state, result.classification.outcome, completedAt, {
            ...(result.classification.retryAfterAt === undefined
              ? {}
              : { retryAfterAt: result.classification.retryAfterAt }),
          });
      await writeJsonAtomic(options.paths.runtimeState, nextState);
      return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        command: "refresh",
        outcome: result.classification.outcome,
        attempted: true,
        attempts: 1,
        completedAt: completedAt.toISOString(),
        nextEligibleAt: nextState.nextEligibleAt,
        reason: result.classification.reason,
        ...(result.classification.retryAfterAt === undefined
          ? {}
          : { retryAfterAt: result.classification.retryAfterAt }),
      };
    },
    { ...options.lock, now },
  );
}
