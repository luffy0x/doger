import { access, rmdir, unlink } from "node:fs/promises";

import { AgentBrowserSession } from "../browser/agent-browser.ts";
import { captureRefreshRequest, type CaptureBrowserSession, type NormalizedCapture } from "../browser/capture.ts";
import { readJsonFile, writeJsonAtomic } from "../infra/json-store.ts";
import { withProcessLock } from "../infra/lock.ts";
import type { DogerPaths } from "../infra/paths.ts";
import { EncryptedCredentialStore } from "../security/credential-store.ts";
import type { KeyProvider } from "../security/key-provider.ts";
import { createConfig, parseConfig, type DogerConfig } from "./config.ts";
import { DogerError } from "./errors.ts";
import {
  createInitialState,
  parseRuntimeState,
  recordOutcome,
  recordSuccess,
  withRevisions,
  type RuntimeState,
} from "./state.ts";

export interface InteractiveCaptureSession extends CaptureBrowserSession {
  clearNetworkRequests(): Promise<void>;
  close(): Promise<void>;
  open(applicationUrl: string): Promise<void>;
}

export interface InteractiveCapturePrompts {
  waitForLogin(): Promise<void>;
  confirmRefresh(): Promise<boolean>;
  waitForRefresh(): Promise<void>;
}

export interface LifecycleOptions {
  readonly browserFactory?: (applicationUrl: string) => InteractiveCaptureSession;
  readonly keyProvider: KeyProvider;
  readonly now?: () => Date;
  readonly paths: DogerPaths;
  readonly prompts: InteractiveCapturePrompts;
}

export interface LifecycleReport {
  readonly schemaVersion: 1;
  readonly command: "init" | "reauth";
  readonly outcome: "SUCCESS" | "CANCELLED";
  readonly firstSuccessAt?: string;
  readonly nextEligibleAt?: string;
  readonly recipeRevision?: number;
  readonly credentialRevision?: number;
}

export interface StatusReport {
  readonly schemaVersion: 1;
  readonly command: "status";
  readonly initialized: boolean;
  readonly status: RuntimeState["status"];
  readonly firstSuccessAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly nextEligibleAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastOutcome: RuntimeState["lastOutcome"];
  readonly recipeRevision: number;
  readonly credentialRevision: number;
  readonly files: {
    readonly config: boolean;
    readonly recipe: boolean;
    readonly credentials: boolean;
  };
}

export interface UninstallReport {
  readonly schemaVersion: 1;
  readonly command: "uninstall";
  readonly outcome: "SUCCESS";
  readonly removed: {
    readonly config: boolean;
    readonly recipe: boolean;
    readonly runtimeState: boolean;
    readonly credentials: boolean;
    readonly keychainEntry: boolean;
    readonly refreshLock: boolean;
  };
  readonly scheduledTaskRequiresCodexRemoval: true;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw new DogerError("STORAGE_ERROR", "Unable to inspect Doger local data.");
  }
}

async function unlinkKnown(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw new DogerError("STORAGE_ERROR", "Unable to remove Doger local data.");
  }
}

function approveRecipeHosts(config: DogerConfig, capture: NormalizedCapture): DogerConfig {
  return parseConfig({
    ...config,
    allowedHosts: [...new Set([...config.allowedHosts, ...capture.recipe.allowedHosts])],
  });
}

async function runInteractiveCapture(
  config: DogerConfig,
  options: LifecycleOptions,
): Promise<{ readonly capture: NormalizedCapture; readonly capturedAt: Date } | null> {
  const session = (options.browserFactory ?? ((url) => new AgentBrowserSession(url)))(config.applicationUrl);
  let captured: { readonly capture: NormalizedCapture; readonly capturedAt: Date } | null = null;

  try {
    await session.open(config.applicationUrl);
    await options.prompts.waitForLogin();
    await session.clearNetworkRequests();
    if (!(await options.prompts.confirmRefresh())) {
      return null;
    }
    await options.prompts.waitForRefresh();
    const capturedAt = (options.now ?? (() => new Date()))();
    captured = { capture: await captureRefreshRequest(session, capturedAt), capturedAt };
  } finally {
    await session.close();
  }

  return captured;
}

async function persistCapture(
  config: DogerConfig,
  baseState: RuntimeState,
  capture: NormalizedCapture,
  capturedAt: Date,
  options: LifecycleOptions,
): Promise<RuntimeState> {
  const nextConfig = approveRecipeHosts(config, capture);
  const gateState = recordOutcome(baseState, "MANUAL_CHECK", capturedAt);
  const nextState = withRevisions(recordSuccess(baseState, capturedAt), {
    recipeRevision: baseState.recipeRevision + 1,
    credentialRevision: baseState.credentialRevision + 1,
  });

  await writeJsonAtomic(options.paths.runtimeState, gateState);
  await writeJsonAtomic(options.paths.config, nextConfig);
  await writeJsonAtomic(options.paths.recipe, capture.recipe);
  await new EncryptedCredentialStore(options.paths.credentials, options.keyProvider).save(capture.credentials);
  await writeJsonAtomic(options.paths.runtimeState, nextState);
  return nextState;
}

function successReport(command: "init" | "reauth", state: RuntimeState): LifecycleReport {
  if (state.firstSuccessAt === null || state.nextEligibleAt === null) {
    throw new DogerError("STATE_INVALID", "Successful initialization did not produce a schedule anchor.");
  }
  return {
    schemaVersion: 1,
    command,
    outcome: "SUCCESS",
    firstSuccessAt: state.firstSuccessAt,
    nextEligibleAt: state.nextEligibleAt,
    recipeRevision: state.recipeRevision,
    credentialRevision: state.credentialRevision,
  };
}

export async function initializeDoger(applicationUrl: string, options: LifecycleOptions): Promise<LifecycleReport> {
  return await withProcessLock(options.paths.refreshLock, async () => {
    const existing = await readJsonFile(options.paths.config, parseConfig);
    if (existing !== null) {
      throw new DogerError("CONFIG_INVALID", "Doger is already initialized. Use doger reauth or uninstall first.");
    }

    const config = createConfig(applicationUrl);
    const result = await runInteractiveCapture(config, options);
    if (result === null) {
      return { schemaVersion: 1, command: "init", outcome: "CANCELLED" };
    }
    const state = await persistCapture(config, createInitialState(), result.capture, result.capturedAt, options);
    return successReport("init", state);
  });
}

export async function reauthenticateDoger(options: LifecycleOptions): Promise<LifecycleReport> {
  return await withProcessLock(options.paths.refreshLock, async () => {
    const [config, state] = await Promise.all([
      readJsonFile(options.paths.config, parseConfig),
      readJsonFile(options.paths.runtimeState, parseRuntimeState),
    ]);
    if (config === null || state === null || state.firstSuccessAt === null) {
      throw new DogerError("CONFIG_INVALID", "Doger is not initialized. Run doger init first.");
    }

    const result = await runInteractiveCapture(config, options);
    if (result === null) {
      return { schemaVersion: 1, command: "reauth", outcome: "CANCELLED" };
    }
    const nextState = await persistCapture(config, state, result.capture, result.capturedAt, options);
    return successReport("reauth", nextState);
  });
}

export async function readStatus(paths: DogerPaths): Promise<StatusReport> {
  const [state, config, recipe, credentials] = await Promise.all([
    readJsonFile(paths.runtimeState, parseRuntimeState),
    fileExists(paths.config),
    fileExists(paths.recipe),
    fileExists(paths.credentials),
  ]);
  const current = state ?? createInitialState();

  return {
    schemaVersion: 1,
    command: "status",
    initialized: current.firstSuccessAt !== null && config && recipe && credentials,
    status: current.status,
    firstSuccessAt: current.firstSuccessAt,
    lastSuccessAt: current.lastSuccessAt,
    nextEligibleAt: current.nextEligibleAt,
    lastAttemptAt: current.lastAttemptAt,
    lastOutcome: current.lastOutcome,
    recipeRevision: current.recipeRevision,
    credentialRevision: current.credentialRevision,
    files: { config, recipe, credentials },
  };
}

export async function uninstallLocalData(paths: DogerPaths, keyProvider: KeyProvider): Promise<UninstallReport> {
  const report = await withProcessLock(paths.refreshLock, async () => {
    const credentials = await fileExists(paths.credentials);
    const keychainEntry = (await keyProvider.get()) !== null;
    await new EncryptedCredentialStore(paths.credentials, keyProvider).delete();
    const [config, recipe, runtimeState] = await Promise.all([
      unlinkKnown(paths.config),
      unlinkKnown(paths.recipe),
      unlinkKnown(paths.runtimeState),
    ]);

    return {
      schemaVersion: 1,
      command: "uninstall",
      outcome: "SUCCESS",
      removed: { config, recipe, runtimeState, credentials, keychainEntry, refreshLock: true },
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
