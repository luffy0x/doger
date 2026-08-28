import { access, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { readJsonFile, writeJsonAtomic } from "../infra/json-store.ts";
import { hasInstallationMarker, writeInstallationMarker } from "../infra/installation.ts";
import { withProcessLock } from "../infra/lock.ts";
import type { DogerPaths } from "../infra/paths.ts";
import { KeyringTokenStore, validateToken, type TokenStore } from "../security/token-store.ts";
import { createConfig, parseConfig } from "./config.ts";
import { DogerError } from "./errors.ts";
import { REPORT_SCHEMA_VERSION } from "./report.ts";
import {
  createConfiguredState,
  createInitialState,
  parseRuntimeState,
  recordTokenReplacement,
  type RuntimeState,
} from "./state.ts";

export interface ConfigurationPrompts {
  readDeliveryRecordId(): Promise<string>;
  readToken(): Promise<string>;
}

export interface LifecycleOptions {
  readonly paths: DogerPaths;
  readonly prompts: ConfigurationPrompts;
  readonly tokenStore: TokenStore;
}

export interface LifecycleReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly command: "init" | "reauth";
  readonly outcome: "SUCCESS";
  readonly scheduleAnchored: boolean;
}

export interface StatusReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly command: "status";
  readonly initialized: boolean;
  readonly scheduleAnchored: boolean;
  readonly status: RuntimeState["status"];
  readonly firstSuccessAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly nextEligibleAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastOutcome: RuntimeState["lastOutcome"];
  readonly files: {
    readonly config: boolean;
    readonly runtimeState: boolean;
    readonly installationMarker: boolean;
  };
}

export interface UninstallReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly command: "uninstall";
  readonly outcome: "SUCCESS";
  readonly removed: {
    readonly config: boolean;
    readonly runtimeState: boolean;
    readonly token: boolean;
    readonly legacyCredentialKey: boolean;
    readonly legacyData: boolean;
    readonly installationMarker: boolean;
    readonly refreshLock: boolean;
  };
  readonly scheduledTaskRequiresCodexRemoval: true;
}

function legacyPaths(paths: DogerPaths): readonly string[] {
  return [join(paths.root, "recipe.json"), join(paths.root, "credentials.enc")];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new DogerError("STORAGE_ERROR", "Unable to inspect Doger local data.");
  }
}

async function unlinkKnown(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new DogerError("STORAGE_ERROR", "Unable to remove Doger local data.");
  }
}

async function rollbackInitialization(paths: DogerPaths, tokenStore: TokenStore): Promise<void> {
  const cleanup = await Promise.allSettled([
    unlinkKnown(paths.config),
    unlinkKnown(paths.runtimeState),
    tokenStore.delete(),
  ]);
  if (cleanup.every((result) => result.status === "fulfilled")) {
    await unlinkKnown(paths.installationMarker).catch(() => undefined);
  }
}

export async function initializeDoger(options: LifecycleOptions): Promise<LifecycleReport> {
  return await withProcessLock(options.paths.refreshLock, async () => {
    const knownState = await Promise.all([
      hasInstallationMarker(options.paths.installationMarker),
      fileExists(options.paths.config),
      fileExists(options.paths.runtimeState),
      ...legacyPaths(options.paths).map(fileExists),
    ]);
    const tokenExists = (await options.tokenStore.get()) !== null;
    if (knownState.some(Boolean) || tokenExists) {
      throw new DogerError("CONFIG_INVALID", "Doger local data already exists. Run doger uninstall first.");
    }

    const config = createConfig(await options.prompts.readDeliveryRecordId());
    const token = validateToken(await options.prompts.readToken());
    try {
      await writeInstallationMarker(options.paths.installationMarker);
      await options.tokenStore.set(token);
      await writeJsonAtomic(options.paths.config, config);
      await writeJsonAtomic(options.paths.runtimeState, createConfiguredState());
    } catch (error) {
      await rollbackInitialization(options.paths, options.tokenStore);
      throw error;
    }
    return { schemaVersion: REPORT_SCHEMA_VERSION, command: "init", outcome: "SUCCESS", scheduleAnchored: false };
  });
}

export async function reauthenticateDoger(options: LifecycleOptions): Promise<LifecycleReport> {
  return await withProcessLock(options.paths.refreshLock, async () => {
    const config = await readJsonFile(options.paths.config, parseConfig);
    const [installed, state, previousToken] = await Promise.all([
      hasInstallationMarker(options.paths.installationMarker),
      readJsonFile(options.paths.runtimeState, parseRuntimeState),
      options.tokenStore.get(),
    ]);
    if (!installed || config === null || state === null || state.status === "uninitialized") {
      throw new DogerError("CONFIG_INVALID", "Doger is not initialized. Run doger init first.");
    }

    const token = validateToken(await options.prompts.readToken());
    try {
      await options.tokenStore.set(token);
      const nextState = recordTokenReplacement(state);
      if (nextState !== state) await writeJsonAtomic(options.paths.runtimeState, nextState);
      return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        command: "reauth",
        outcome: "SUCCESS",
        scheduleAnchored: nextState.firstSuccessAt !== null,
      };
    } catch (error) {
      if (previousToken === null) await options.tokenStore.delete().catch(() => undefined);
      else await options.tokenStore.set(previousToken).catch(() => undefined);
      throw error;
    }
  });
}

export async function readStatus(paths: DogerPaths): Promise<StatusReport> {
  const configPresent = await readJsonFile(paths.config, parseConfig);
  const [state, installationMarker] = await Promise.all([
    readJsonFile(paths.runtimeState, parseRuntimeState),
    hasInstallationMarker(paths.installationMarker),
  ]);
  const current = state ?? createInitialState();
  const hasConfig = configPresent !== null;
  const initialized = installationMarker && hasConfig && state !== null && state.status !== "uninitialized";
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    command: "status",
    initialized,
    scheduleAnchored: initialized && current.firstSuccessAt !== null,
    status: current.status,
    firstSuccessAt: current.firstSuccessAt,
    lastSuccessAt: current.lastSuccessAt,
    nextEligibleAt: current.nextEligibleAt,
    lastAttemptAt: current.lastAttemptAt,
    lastOutcome: current.lastOutcome,
    files: { config: hasConfig, runtimeState: state !== null, installationMarker },
  };
}

export async function uninstallLocalData(
  paths: DogerPaths,
  tokenStore: TokenStore,
  legacyKeyStore: TokenStore = new KeyringTokenStore("doger", "credential-encryption-key"),
): Promise<UninstallReport> {
  const report = await withProcessLock(paths.refreshLock, async () => {
    const [installed, token, legacyKeyStoreValue] = await Promise.all([
      hasInstallationMarker(paths.installationMarker),
      tokenStore.get(),
      legacyKeyStore.get(),
    ]);
    if (!installed) {
      if (token !== null) await tokenStore.delete();
      if (legacyKeyStoreValue !== null) await legacyKeyStore.delete();
      return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        command: "uninstall",
        outcome: "SUCCESS",
        removed: {
          config: false,
          runtimeState: false,
          token: token !== null,
          legacyCredentialKey: legacyKeyStoreValue !== null,
          legacyData: false,
          installationMarker: false,
          refreshLock: false,
        },
        scheduledTaskRequiresCodexRemoval: true,
      } as const;
    }

    if (token !== null) await tokenStore.delete();
    if (legacyKeyStoreValue !== null) await legacyKeyStore.delete();
    const removedConfig = await unlinkKnown(paths.config);
    const removedRuntimeState = await unlinkKnown(paths.runtimeState);
    let removedLegacyData = false;
    for (const path of legacyPaths(paths)) {
      removedLegacyData = (await unlinkKnown(path)) || removedLegacyData;
    }
    const removedMarker = await unlinkKnown(paths.installationMarker);
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      command: "uninstall",
      outcome: "SUCCESS",
      removed: {
        config: removedConfig,
        runtimeState: removedRuntimeState,
        token: token !== null,
        legacyCredentialKey: legacyKeyStoreValue !== null,
        legacyData: removedLegacyData,
        installationMarker: removedMarker,
        refreshLock: true,
      },
      scheduledTaskRequiresCodexRemoval: true,
    } as const;
  });
  await rmdir(paths.root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
      throw new DogerError("STORAGE_ERROR", "Unable to remove the empty Doger data directory.");
    }
  });
  return report;
}
