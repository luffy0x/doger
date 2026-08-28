import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DogerError } from "../core/errors.ts";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const INTERACTIVE_OPEN_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const SESSION_IDLE_TIMEOUT = "15m";
const POST_EXIT_OUTPUT_TIMEOUT_MS = 500;

export const JD_BROWSER_DOMAIN_PATTERNS = ["jd.com", "*.jd.com", "360buyimg.com", "*.360buyimg.com"] as const;

export interface AgentBrowserCommand {
  readonly args: readonly string[];
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export interface AgentBrowserCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type AgentBrowserCommandRunner = (command: AgentBrowserCommand) => Promise<AgentBrowserCommandResult>;

export interface AgentBrowserSessionOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly runner?: AgentBrowserCommandRunner;
  readonly sessionName?: string;
}

export interface AgentBrowserExecutableOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
}

function officialJdHostname(hostname: string): boolean {
  return hostname === "jd.com" || hostname.endsWith(".jd.com");
}

export function browserDomainPatterns(applicationUrl: string): readonly string[] {
  let url: URL;
  try {
    url = new URL(applicationUrl);
  } catch {
    throw new DogerError("CONFIG_INVALID", "Application URL is invalid.");
  }

  if (url.protocol !== "https:" || !officialJdHostname(url.hostname.toLowerCase())) {
    throw new DogerError("CONFIG_INVALID", "Interactive authentication requires an official JD HTTPS URL.");
  }

  return JD_BROWSER_DOMAIN_PATTERNS;
}

export function sanitizeAgentBrowserEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(environment)) {
    const normalizedName = name.toUpperCase();
    if (normalizedName.startsWith("AGENT_BROWSER_") || normalizedName === "NODE_OPTIONS") {
      continue;
    }
    sanitized[name] = value;
  }

  sanitized.NO_COLOR = "1";
  return sanitized;
}

export function resolveAgentBrowserExecutable(options: AgentBrowserExecutableOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const launcher = fileURLToPath(import.meta.resolve("agent-browser/bin/agent-browser.js"));
  const binaryDirectory = dirname(launcher);

  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return join(binaryDirectory, `agent-browser-darwin-${arch}`);
  }
  if (platform === "win32" && (arch === "arm64" || arch === "x64")) {
    return join(binaryDirectory, "agent-browser-win32-x64.exe");
  }

  throw new DogerError(
    "DEPENDENCY_MISSING",
    "Doger supports agent-browser on macOS arm64/x64 and Windows arm64/x64 only.",
  );
}

function collectOutput(
  stream: NodeJS.ReadableStream,
  chunks: Buffer[],
  state: { bytes: number },
  maxOutputBytes: number,
  onOverflow: () => void,
  onData: () => void = () => undefined,
): void {
  stream.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    state.bytes += buffer.length;
    if (state.bytes > maxOutputBytes) {
      onOverflow();
      return;
    }
    chunks.push(buffer);
    onData();
  });
}

export async function runBrowserProcess(
  executable: string,
  command: AgentBrowserCommand,
): Promise<AgentBrowserCommandResult> {
  return await new Promise<AgentBrowserCommandResult>((resolve, reject) => {
    const child = spawn(executable, [...command.args], {
      env: { ...command.environment },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const outputState = { bytes: 0 };
    let settled = false;
    let childExited = false;
    let exitCode = 1;
    let stdoutEnded = false;
    let stderrEnded = false;
    let postExitTimer: NodeJS.Timeout | undefined;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (postExitTimer !== undefined) {
        clearTimeout(postExitTimer);
      }
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    };

    const stdoutContainsCompleteJson = (): boolean => {
      try {
        JSON.parse(Buffer.concat(stdoutChunks).toString("utf8"));
        return true;
      } catch {
        return false;
      }
    };

    const finishAfterExitWhenComplete = (): void => {
      if (!childExited || settled) {
        return;
      }
      if ((stdoutEnded && stderrEnded) || stdoutContainsCompleteJson()) {
        finish();
        return;
      }
      if (postExitTimer === undefined) {
        postExitTimer = setTimeout(finish, POST_EXIT_OUTPUT_TIMEOUT_MS);
        postExitTimer.unref();
      }
    };

    const fail = (error: DogerError): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (postExitTimer !== undefined) {
        clearTimeout(postExitTimer);
      }
      child.kill("SIGTERM");
      reject(error);
    };

    const timer = setTimeout(() => {
      fail(new DogerError("BROWSER_EXECUTION_FAILED", "agent-browser command timed out."));
    }, command.timeoutMs);
    timer.unref();

    collectOutput(
      child.stdout,
      stdoutChunks,
      outputState,
      command.maxOutputBytes,
      () => {
        fail(new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser output exceeded the safe size limit."));
      },
      finishAfterExitWhenComplete,
    );
    collectOutput(child.stderr, stderrChunks, outputState, command.maxOutputBytes, () => {
      fail(new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser output exceeded the safe size limit."));
    });
    child.stdout.once("end", () => {
      stdoutEnded = true;
      finishAfterExitWhenComplete();
    });
    child.stderr.once("end", () => {
      stderrEnded = true;
      finishAfterExitWhenComplete();
    });

    child.once("error", () => {
      fail(new DogerError("DEPENDENCY_MISSING", "Unable to start the bundled agent-browser executable."));
    });
    child.once("exit", (code) => {
      childExited = true;
      exitCode = code ?? 1;
      finishAfterExitWhenComplete();
    });
  });
}

export const runAgentBrowserCommand: AgentBrowserCommandRunner = async (command) => {
  return await runBrowserProcess(resolveAgentBrowserExecutable(), command);
};

function parseJsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser returned invalid structured output.");
  }
}

function assertSuccessfulOutput(stdout: string): void {
  const payload = parseJsonOutput(stdout);
  if (typeof payload !== "object" || payload === null || !("success" in payload) || payload.success !== true) {
    throw new DogerError("BROWSER_EXECUTION_FAILED", "agent-browser reported an unsuccessful command.");
  }
}

function validateRequestId(requestId: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser returned an invalid request identifier.");
  }
  return requestId;
}

export class AgentBrowserSession {
  readonly #allowedDomains: readonly string[];
  readonly #environment: NodeJS.ProcessEnv;
  readonly #runner: AgentBrowserCommandRunner;
  readonly #sessionName: string;
  #closed = false;
  #opened = false;

  constructor(applicationUrl: string, options: AgentBrowserSessionOptions = {}) {
    this.#allowedDomains = browserDomainPatterns(applicationUrl);
    this.#environment = sanitizeAgentBrowserEnvironment(options.environment ?? process.env);
    this.#runner = options.runner ?? runAgentBrowserCommand;
    this.#sessionName = options.sessionName ?? `doger-${randomUUID()}`;
  }

  get sessionName(): string {
    return this.#sessionName;
  }

  async open(applicationUrl: string): Promise<void> {
    if (this.#opened || this.#closed) {
      throw new DogerError("BROWSER_EXECUTION_FAILED", "An interactive browser session cannot be reused.");
    }

    this.#opened = true;
    await this.#execute(["open", applicationUrl], INTERACTIVE_OPEN_TIMEOUT_MS);
  }

  async clearNetworkRequests(): Promise<void> {
    this.#assertOpen();
    await this.#execute(["network", "requests", "--clear"]);
  }

  async listNetworkRequests(): Promise<unknown> {
    this.#assertOpen();
    return parseJsonOutput((await this.#execute(["network", "requests", "--type", "xhr,fetch"])).stdout);
  }

  async getNetworkRequest(requestId: string): Promise<unknown> {
    this.#assertOpen();
    return parseJsonOutput((await this.#execute(["network", "request", validateRequestId(requestId)])).stdout);
  }

  async getCookies(): Promise<unknown> {
    this.#assertOpen();
    return parseJsonOutput((await this.#execute(["cookies", "get"])).stdout);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#opened) {
      await this.#execute(["close", "--all"]);
    }
  }

  #assertOpen(): void {
    if (!this.#opened || this.#closed) {
      throw new DogerError("BROWSER_EXECUTION_FAILED", "The interactive browser session is not open.");
    }
  }

  async #execute(
    args: readonly string[],
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<AgentBrowserCommandResult> {
    const result = await this.#runner({
      args: [
        "--session",
        this.#sessionName,
        "--namespace",
        "doger",
        "--allowed-domains",
        this.#allowedDomains.join(","),
        "--headed",
        "--idle-timeout",
        SESSION_IDLE_TIMEOUT,
        "--pin-tab",
        "--max-output",
        String(MAX_COMMAND_OUTPUT_BYTES),
        "--json",
        ...args,
      ],
      environment: this.#environment,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
      timeoutMs,
    });

    if (result.exitCode !== 0) {
      throw new DogerError("BROWSER_EXECUTION_FAILED", `agent-browser command failed with exit code ${result.exitCode}.`);
    }
    assertSuccessfulOutput(result.stdout);
    return result;
  }
}
