import { parseConfig, type DogerConfig } from "./config.ts";
import { DogerError } from "./errors.ts";
import {
  dueDecision,
  parseRuntimeState,
  recordOutcome,
  recordSuccess,
  type RefreshOutcome,
  type RuntimeState,
} from "./state.ts";
import { executeRefresh, type RefreshClientOptions } from "../http/refresh-client.ts";
import { parseRequestRecipe, type RequestRecipe } from "../http/recipe.ts";
import { readJsonFile, writeJsonAtomic } from "../infra/json-store.ts";
import { withProcessLock, type LockOptions } from "../infra/lock.ts";
import type { DogerPaths } from "../infra/paths.ts";
import { EncryptedCredentialStore } from "../security/credential-store.ts";
import type { KeyProvider } from "../security/key-provider.ts";

export interface RefreshReport {
  readonly schemaVersion: 1;
  readonly command: "refresh";
  readonly outcome: RefreshOutcome;
  readonly attempted: boolean;
  readonly attempts: number;
  readonly completedAt: string;
  readonly nextEligibleAt: string | null;
  readonly reason: string;
  readonly retryAfterAt?: string;
}

export interface GuardedRefreshOptions {
  readonly keyProvider: KeyProvider;
  readonly lock?: Omit<LockOptions, "now">;
  readonly now?: () => Date;
  readonly paths: DogerPaths;
  readonly refreshClient?: RefreshClientOptions;
}

async function requiredJson<T>(path: string, parser: (value: unknown) => T, label: string): Promise<T> {
  const value = await readJsonFile(path, parser);
  if (value === null) {
    throw new DogerError("CONFIG_INVALID", `${label} is missing. Run doger init first.`);
  }
  return value;
}

function hostBoundaryApproved(config: DogerConfig, recipe: RequestRecipe): boolean {
  return recipe.allowedHosts.every((host) => config.allowedHosts.includes(host));
}

function blockedOutcome(state: RuntimeState): RefreshOutcome | null {
  if (state.status === "reauth_required") {
    return "REAUTH_REQUIRED";
  }
  if (state.status === "manual_check") {
    return "MANUAL_CHECK";
  }
  return null;
}

export async function runGuardedRefresh(options: GuardedRefreshOptions): Promise<RefreshReport> {
  const now = options.now ?? (() => new Date());

  return await withProcessLock(
    options.paths.refreshLock,
    async () => {
      const completedAt = now();
      const [config, recipe, state] = await Promise.all([
        requiredJson(options.paths.config, parseConfig, "Configuration"),
        requiredJson(options.paths.recipe, parseRequestRecipe, "Request recipe"),
        requiredJson(options.paths.runtimeState, parseRuntimeState, "Runtime state"),
      ]);
      if (!hostBoundaryApproved(config, recipe)) {
        const nextState = recordOutcome(state, "MANUAL_CHECK", completedAt);
        await writeJsonAtomic(options.paths.runtimeState, nextState);
        return {
          schemaVersion: 1,
          command: "refresh",
          outcome: "MANUAL_CHECK",
          attempted: false,
          attempts: 0,
          completedAt: completedAt.toISOString(),
          nextEligibleAt: nextState.nextEligibleAt,
          reason: "host_not_approved",
        };
      }

      const blocked = blockedOutcome(state);
      if (blocked !== null) {
        return {
          schemaVersion: 1,
          command: "refresh",
          outcome: blocked,
          attempted: false,
          attempts: 0,
          completedAt: completedAt.toISOString(),
          nextEligibleAt: state.nextEligibleAt,
          reason: "blocked_state",
        };
      }

      const due = dueDecision(state, completedAt);
      if (!due.due) {
        return {
          schemaVersion: 1,
          command: "refresh",
          outcome: "NOT_DUE",
          attempted: false,
          attempts: 0,
          completedAt: completedAt.toISOString(),
          nextEligibleAt: due.nextEligibleAt,
          reason: "local_schedule_guard",
        };
      }

      const credentials = await new EncryptedCredentialStore(options.paths.credentials, options.keyProvider).load();
      if (credentials === null) {
        throw new DogerError("CREDENTIALS_MISSING", "Encrypted credentials are missing. Run doger reauth.");
      }

      const result = await executeRefresh(recipe, credentials, {
        ...options.refreshClient,
        now,
      });
      const persistedAt = now();
      const nextState =
        result.classification.outcome === "SUCCESS"
          ? recordSuccess(state, persistedAt)
          : recordOutcome(state, result.classification.outcome, persistedAt, {
              ...(result.classification.retryAfterAt === undefined
                ? {}
                : { retryAfterAt: result.classification.retryAfterAt }),
            });
      await writeJsonAtomic(options.paths.runtimeState, nextState);

      return {
        schemaVersion: 1,
        command: "refresh",
        outcome: result.classification.outcome,
        attempted: true,
        attempts: result.attempts,
        completedAt: persistedAt.toISOString(),
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
