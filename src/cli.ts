#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { runDoctor, type DoctorOptions, type DoctorReport } from "./core/doctor-service.ts";
import { DogerError, type DogerErrorCode } from "./core/errors.ts";
import {
  initializeDoger,
  readStatus,
  reauthenticateDoger,
  uninstallLocalData,
  type ConfigurationPrompts,
  type LifecycleOptions,
  type LifecycleReport,
  type StatusReport,
  type UninstallReport,
} from "./core/lifecycle-service.ts";
import { runGuardedRefresh, type GuardedRefreshOptions, type RefreshReport } from "./core/refresh-service.ts";
import { REPORT_SCHEMA_VERSION } from "./core/report.ts";
import type { RefreshOutcome } from "./core/state.ts";
import { resolveDogerPaths, type DogerPaths } from "./infra/paths.ts";
import { KeyringTokenStore, type TokenStore } from "./security/token-store.ts";

export const VERSION = "0.1.0";

export const EXIT_CODES = {
  SUCCESS: 0,
  NOT_DUE: 10,
  REAUTH_REQUIRED: 20,
  RATE_LIMITED: 21,
  TRANSIENT_FAILURE: 22,
  MANUAL_CHECK: 23,
  CONFIGURATION_FAILURE: 64,
} as const;

interface WritableOutput {
  write(chunk: string): unknown;
}

export interface HiddenInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setEncoding(encoding: BufferEncoding): unknown;
  setRawMode(value: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
}

export interface CliPrompts extends ConfigurationPrompts {
  confirmUninstall(): Promise<boolean>;
}

export interface CliServices {
  readonly doctor: (options: DoctorOptions) => Promise<DoctorReport>;
  readonly initialize: (options: LifecycleOptions) => Promise<LifecycleReport>;
  readonly reauthenticate: (options: LifecycleOptions) => Promise<LifecycleReport>;
  readonly refresh: (options: GuardedRefreshOptions) => Promise<RefreshReport>;
  readonly status: (paths: DogerPaths) => Promise<StatusReport>;
  readonly uninstall: (paths: DogerPaths, tokenStore: TokenStore) => Promise<UninstallReport>;
}

export interface CliDependencies {
  readonly tokenStore?: TokenStore;
  readonly now?: () => Date;
  readonly paths?: DogerPaths;
  readonly prompts?: CliPrompts;
  readonly services?: Partial<CliServices>;
  readonly stderr?: WritableOutput;
  readonly stdout?: WritableOutput;
}

interface ErrorReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly command: string;
  readonly outcome: "CONFIGURATION_FAILURE" | "REAUTH_REQUIRED" | "TRANSIENT_FAILURE";
  readonly error: { readonly code: DogerErrorCode | "INTERNAL_ERROR"; readonly message: string };
}

const defaultServices: CliServices = {
  doctor: runDoctor,
  initialize: initializeDoger,
  reauthenticate: reauthenticateDoger,
  refresh: runGuardedRefresh,
  status: readStatus,
  uninstall: uninstallLocalData,
};

export function helpText(): string {
  return [
    "doger, a jd-activity-keeper",
    "",
    "Usage: doger <command> [options]",
    "",
    "Commands:",
    "  init                    Configure locally and optionally anchor a confirmed manual refresh",
    "  refresh [--json]        Run one guarded refresh when due",
    "  status [--json]         Show redacted local state",
    "  reauth [--json]         Replace the token locally",
    "  doctor [--json]         Check local dependencies and configuration",
    "  uninstall [--json]      Confirm and remove known local Doger data",
    "  help                    Show this help message",
    "  version                 Show the installed version",
  ].join("\n");
}

export function exitCodeForOutcome(outcome: RefreshOutcome): number {
  return EXIT_CODES[outcome];
}

function writeReport(output: WritableOutput, report: unknown, json: boolean): void {
  if (json) {
    output.write(`${JSON.stringify(report)}\n`);
    return;
  }
  if (typeof report === "object" && report !== null && "outcome" in report) {
    const outcome = (report as { readonly outcome: unknown }).outcome;
    if ("error" in report) {
      const error = (report as ErrorReport).error;
      output.write(`doger: ${String(outcome)} (${error.code}): ${error.message}\n`);
    } else {
      output.write(`doger: ${String(outcome)}\n`);
    }
    return;
  }
  output.write("doger: OK\n");
}

function publicError(code: DogerErrorCode | "INTERNAL_ERROR"): ErrorReport["error"] {
  const messages: Record<DogerErrorCode | "INTERNAL_ERROR", string> = {
    ALREADY_RUNNING: "Another Doger operation is already running.",
    CONFIG_INVALID: "Doger configuration is missing or invalid.",
    CONFIG_MIGRATION_REQUIRED: "Remove the version 1 installation with doger uninstall, then run doger init.",
    CURL_EXECUTION_FAILED: "The local curl process failed.",
    DEPENDENCY_MISSING: "A required local dependency is unavailable.",
    INTERNAL_ERROR: "Doger encountered an unexpected local error.",
    STATE_INVALID: "The stored runtime state is invalid.",
    STORAGE_ERROR: "Doger could not access its protected local data.",
    TOKEN_INVALID: "The supplied token is invalid.",
    TOKEN_MISSING: "Authentication is missing or expired; run doger reauth.",
  };
  return { code, message: messages[code] };
}

function errorOutcome(code: DogerErrorCode | "INTERNAL_ERROR"): ErrorReport["outcome"] {
  if (code === "TOKEN_MISSING" || code === "TOKEN_INVALID") return "REAUTH_REQUIRED";
  if (code === "ALREADY_RUNNING" || code === "CURL_EXECUTION_FAILED") return "TRANSIENT_FAILURE";
  return "CONFIGURATION_FAILURE";
}

export async function readHiddenInput(
  input: HiddenInput,
  output: WritableOutput,
  prompt: string,
): Promise<string> {
  if (input.isTTY !== true) throw new DogerError("CONFIG_INVALID", "Interactive commands require a terminal.");
  output.write(prompt);
  const wasRaw = input.isRaw === true;
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (result?: string, error?: Error): void => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error === undefined) resolve(result ?? "");
      else reject(error);
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(undefined, new DogerError("CONFIG_INVALID", "Interactive input was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\b" || character === "\u007f") {
          value = Array.from(value).slice(0, -1).join("");
        } else {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}

function createTerminalPrompts(): CliPrompts {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new DogerError("CONFIG_INVALID", "Interactive commands require a terminal.");
  }
  const ask = async (prompt: string): Promise<string> => {
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    try { return await readline.question(prompt); }
    finally { readline.close(); }
  };
  return {
    readDeliveryRecordId: () => ask("JD delivery record ID: "),
    readToken: () => readHiddenInput(process.stdin, process.stderr, "JD authentication Cookie value: "),
    async confirmManualRefresh() {
      const confirmation = await ask(
        "Type ANCHOR only if the immediately preceding JD website refresh visibly succeeded, or press Enter to continue unanchored: ",
      );
      return confirmation.trim() === "ANCHOR";
    },
    async confirmUninstall() {
      return (await ask("Type UNINSTALL to remove Doger's known local state and token: ")).trim() === "UNINSTALL";
    },
  };
}

async function withPrompts<T>(dependencies: CliDependencies, action: (prompts: CliPrompts) => Promise<T>): Promise<T> {
  return await action(dependencies.prompts ?? createTerminalPrompts());
}

function parseArguments(argv: readonly string[]): { command: string; json: boolean; positional: readonly string[] } {
  const json = argv.includes("--json");
  const filtered = argv.filter((argument) => argument !== "--json");
  return { command: filtered[0] ?? "help", json, positional: filtered.slice(1) };
}

function requireNoArguments(positional: readonly string[]): void {
  if (positional.length !== 0) throw new DogerError("CONFIG_INVALID", "This command does not accept positional arguments.");
}

export async function run(argv: readonly string[], dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const { command, json, positional } = parseArguments(argv);
  const paths = dependencies.paths ?? resolveDogerPaths();
  const tokenStore = dependencies.tokenStore ?? new KeyringTokenStore();
  const services = { ...defaultServices, ...dependencies.services };
  try {
    if (command === "help" || command === "--help" || command === "-h") {
      stdout.write(`${helpText()}\n`);
      return EXIT_CODES.SUCCESS;
    }
    if (command === "version" || command === "--version" || command === "-v") {
      stdout.write(`${VERSION}\n`);
      return EXIT_CODES.SUCCESS;
    }
    if (positional.some((argument) => argument.startsWith("-"))) {
      throw new DogerError("CONFIG_INVALID", "Unknown command option.");
    }
    if (command === "refresh") {
      requireNoArguments(positional);
      const report = await services.refresh({ paths, tokenStore, ...(dependencies.now === undefined ? {} : { now: dependencies.now }) });
      writeReport(stdout, report, json);
      return exitCodeForOutcome(report.outcome);
    }
    if (command === "status") {
      requireNoArguments(positional);
      writeReport(stdout, await services.status(paths), json);
      return EXIT_CODES.SUCCESS;
    }
    if (command === "doctor") {
      requireNoArguments(positional);
      const report = await services.doctor({ paths });
      writeReport(stdout, report, json);
      return report.healthy ? EXIT_CODES.SUCCESS : EXIT_CODES.CONFIGURATION_FAILURE;
    }
    if (command === "init") {
      requireNoArguments(positional);
      const report = await withPrompts(dependencies, (prompts) => services.initialize({
        paths,
        tokenStore,
        prompts,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      }));
      writeReport(stdout, report, json);
      return EXIT_CODES.SUCCESS;
    }
    if (command === "reauth") {
      requireNoArguments(positional);
      const report = await withPrompts(dependencies, (prompts) => services.reauthenticate({ paths, tokenStore, prompts }));
      writeReport(stdout, report, json);
      return EXIT_CODES.SUCCESS;
    }
    if (command === "uninstall") {
      requireNoArguments(positional);
      const report = await withPrompts(dependencies, async (prompts) => {
        if (!(await prompts.confirmUninstall())) {
          return { schemaVersion: REPORT_SCHEMA_VERSION, command: "uninstall", outcome: "CANCELLED" } as const;
        }
        return await services.uninstall(paths, tokenStore);
      });
      writeReport(stdout, report, json);
      return EXIT_CODES.SUCCESS;
    }
    throw new DogerError("CONFIG_INVALID", "Unknown command.");
  } catch (error) {
    const code = error instanceof DogerError ? error.code : "INTERNAL_ERROR";
    const outcome = errorOutcome(code);
    const report: ErrorReport = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      command: ["init", "refresh", "status", "reauth", "doctor", "uninstall"].includes(command) ? command : "unknown",
      outcome,
      error: publicError(code),
    };
    writeReport(json ? stdout : stderr, report, json);
    if (!json) stderr.write(`${helpText()}\n`);
    return errorOutcome(code) === "REAUTH_REQUIRED"
      ? EXIT_CODES.REAUTH_REQUIRED
      : outcome === "TRANSIENT_FAILURE" ? EXIT_CODES.TRANSIENT_FAILURE : EXIT_CODES.CONFIGURATION_FAILURE;
  }
}

function isDirectExecution(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath); }
  catch { return false; }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
