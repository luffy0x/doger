#!/usr/bin/env node

import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";

import type { InteractiveCaptureSession } from "./core/lifecycle-service.ts";
import {
  initializeDoger,
  readStatus,
  reauthenticateDoger,
  uninstallLocalData,
  type InteractiveCapturePrompts,
  type LifecycleOptions,
  type LifecycleReport,
  type StatusReport,
  type UninstallReport,
} from "./core/lifecycle-service.ts";
import { runDoctor, type DoctorOptions, type DoctorReport } from "./core/doctor-service.ts";
import { DogerError, type DogerErrorCode } from "./core/errors.ts";
import { runGuardedRefresh, type GuardedRefreshOptions, type RefreshReport } from "./core/refresh-service.ts";
import type { RefreshOutcome } from "./core/state.ts";
import { resolveDogerPaths, type DogerPaths } from "./infra/paths.ts";
import { KeyringKeyProvider, type KeyProvider } from "./security/key-provider.ts";

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

export interface CliPrompts extends InteractiveCapturePrompts {
  confirmUninstall(): Promise<boolean>;
}

export interface CliServices {
  readonly doctor: (options: DoctorOptions) => Promise<DoctorReport>;
  readonly initialize: (applicationUrl: string, options: LifecycleOptions) => Promise<LifecycleReport>;
  readonly reauthenticate: (options: LifecycleOptions) => Promise<LifecycleReport>;
  readonly refresh: (options: GuardedRefreshOptions) => Promise<RefreshReport>;
  readonly status: (paths: DogerPaths) => Promise<StatusReport>;
  readonly uninstall: (paths: DogerPaths, keyProvider: KeyProvider) => Promise<UninstallReport>;
}

export interface CliDependencies {
  readonly browserFactory?: (applicationUrl: string) => InteractiveCaptureSession;
  readonly keyProvider?: KeyProvider;
  readonly now?: () => Date;
  readonly paths?: DogerPaths;
  readonly prompts?: CliPrompts;
  readonly services?: Partial<CliServices>;
  readonly stderr?: WritableOutput;
  readonly stdout?: WritableOutput;
}

interface ErrorReport {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly outcome: "CONFIGURATION_FAILURE" | "MANUAL_CHECK" | "REAUTH_REQUIRED" | "TRANSIENT_FAILURE";
  readonly error: {
    readonly code: DogerErrorCode | "INTERNAL_ERROR";
    readonly message: string;
  };
}

interface TerminalPrompts {
  readonly prompts: CliPrompts;
  close(): void;
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
    "  init <application-url>  Interactive first authentication and capture",
    "  refresh [--json]        Run one guarded refresh when due",
    "  status [--json]         Show redacted local state",
    "  reauth [--json]         Explicit interactive authentication recovery",
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
    BROWSER_EXECUTION_FAILED: "The interactive browser command failed.",
    BROWSER_OUTPUT_INVALID: "The interactive browser returned invalid capture data.",
    CAPTURE_AMBIGUOUS: "Doger could not identify exactly one refresh request.",
    CAPTURE_UNSUPPORTED: "The captured request cannot be replayed safely.",
    CONFIG_INVALID: "Doger configuration is missing or invalid.",
    CREDENTIALS_INVALID: "Stored credentials are invalid.",
    CREDENTIALS_MISSING: "Authentication is missing or expired; run doger reauth.",
    CURL_EXECUTION_FAILED: "The local curl process failed.",
    DEPENDENCY_MISSING: "A required local dependency is unavailable.",
    INTERNAL_ERROR: "Doger encountered an unexpected local error.",
    RECIPE_INVALID: "The stored request recipe is invalid.",
    STATE_INVALID: "The stored runtime state is invalid.",
    STORAGE_ERROR: "Doger could not access its protected local data.",
  };
  return { code, message: messages[code] };
}

function errorOutcome(code: DogerErrorCode | "INTERNAL_ERROR"): ErrorReport["outcome"] {
  if (code === "CAPTURE_AMBIGUOUS" || code === "CAPTURE_UNSUPPORTED" || code === "BROWSER_OUTPUT_INVALID") {
    return "MANUAL_CHECK";
  }
  if (code === "CREDENTIALS_MISSING" || code === "CREDENTIALS_INVALID") {
    return "REAUTH_REQUIRED";
  }
  if (code === "ALREADY_RUNNING" || code === "CURL_EXECUTION_FAILED") {
    return "TRANSIENT_FAILURE";
  }
  return "CONFIGURATION_FAILURE";
}

function errorExitCode(outcome: ErrorReport["outcome"]): number {
  if (outcome === "MANUAL_CHECK") {
    return EXIT_CODES.MANUAL_CHECK;
  }
  if (outcome === "REAUTH_REQUIRED") {
    return EXIT_CODES.REAUTH_REQUIRED;
  }
  if (outcome === "TRANSIENT_FAILURE") {
    return EXIT_CODES.TRANSIENT_FAILURE;
  }
  return EXIT_CODES.CONFIGURATION_FAILURE;
}

function createTerminalPrompts(): TerminalPrompts {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new DogerError("CONFIG_INVALID", "Interactive commands require a terminal.");
  }

  const readline: ReadlineInterface = createInterface({ input: process.stdin, output: process.stderr });
  return {
    prompts: {
      async waitForLogin() {
        await readline.question(
          "Complete JD login and any verification in the browser. Navigate to the target application, then press Enter here. ",
        );
      },
      async confirmRefresh() {
        const answer = await readline.question(
          "Type REFRESH to authorize exactly one activity refresh for capture, or press Enter to cancel: ",
        );
        return answer.trim() === "REFRESH";
      },
      async waitForRefresh() {
        await readline.question(
          "Click the refresh control exactly once, wait for visible success, then press Enter here. ",
        );
      },
      async confirmUninstall() {
        const answer = await readline.question(
          "Type UNINSTALL to remove Doger's known local state and credentials, or press Enter to cancel: ",
        );
        return answer.trim() === "UNINSTALL";
      },
    },
    close() {
      readline.close();
    },
  };
}

async function withPrompts<T>(dependencies: CliDependencies, action: (prompts: CliPrompts) => Promise<T>): Promise<T> {
  if (dependencies.prompts !== undefined) {
    return await action(dependencies.prompts);
  }

  const terminal = createTerminalPrompts();
  try {
    return await action(terminal.prompts);
  } finally {
    terminal.close();
  }
}

function parseArguments(argv: readonly string[]): { command: string; json: boolean; positional: readonly string[] } {
  const json = argv.includes("--json");
  const filtered = argv.filter((argument) => argument !== "--json");
  return { command: filtered[0] ?? "help", json, positional: filtered.slice(1) };
}

function requireNoArguments(positional: readonly string[]): void {
  if (positional.length !== 0) {
    throw new DogerError("CONFIG_INVALID", "This command does not accept positional arguments.");
  }
}

export async function run(argv: readonly string[], dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const { command, json, positional } = parseArguments(argv);
  const paths = dependencies.paths ?? resolveDogerPaths();
  const keyProvider = dependencies.keyProvider ?? new KeyringKeyProvider();
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
      const report = await services.refresh({
        paths,
        keyProvider,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      });
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
      if (positional.length !== 1) {
        throw new DogerError("CONFIG_INVALID", "init requires exactly one application URL.");
      }
      const report = await withPrompts(dependencies, async (prompts) =>
        await services.initialize(positional[0]!, {
          paths,
          keyProvider,
          prompts,
          ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
          ...(dependencies.browserFactory === undefined ? {} : { browserFactory: dependencies.browserFactory }),
        }),
      );
      writeReport(stdout, report, json);
      return EXIT_CODES.SUCCESS;
    }
    if (command === "reauth") {
      requireNoArguments(positional);
      const report = await withPrompts(dependencies, async (prompts) =>
        await services.reauthenticate({
          paths,
          keyProvider,
          prompts,
          ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
          ...(dependencies.browserFactory === undefined ? {} : { browserFactory: dependencies.browserFactory }),
        }),
      );
      writeReport(stdout, report, json);
      return EXIT_CODES.SUCCESS;
    }
    if (command === "uninstall") {
      requireNoArguments(positional);
      const report = await withPrompts(dependencies, async (prompts) => {
        if (!(await prompts.confirmUninstall())) {
          return { schemaVersion: 1, command: "uninstall", outcome: "CANCELLED" } as const;
        }
        return await services.uninstall(paths, keyProvider);
      });
      writeReport(stdout, report, json);
      return EXIT_CODES.SUCCESS;
    }

    throw new DogerError("CONFIG_INVALID", "Unknown command.");
  } catch (error) {
    const code = error instanceof DogerError ? error.code : "INTERNAL_ERROR";
    const outcome = errorOutcome(code);
    const report: ErrorReport = {
      schemaVersion: 1,
      command: ["init", "refresh", "status", "reauth", "doctor", "uninstall"].includes(command)
        ? command
        : "unknown",
      outcome,
      error: publicError(code),
    };
    writeReport(json ? stdout : stderr, report, json);
    if (!json) {
      stderr.write(`${helpText()}\n`);
    }
    return errorExitCode(outcome);
  }
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href;

if (isEntrypoint) {
  process.exitCode = await run(process.argv.slice(2));
}
