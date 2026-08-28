import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DogerError } from "../core/errors.ts";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const SESSION_IDLE_TIMEOUT = "15m";

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
    if (name.startsWith("AGENT_BROWSER_") || name === "NODE_OPTIONS") {
      continue;
    }
    sanitized[name] = value;
  }

  sanitized.NO_COLOR = "1";
  return sanitized;
}

export function resolveAgentBrowserExecutable(): string {
  if (process.platform !== "darwin" || (process.arch !== "arm64" && process.arch !== "x64")) {
    throw new DogerError("DEPENDENCY_MISSING", "Doger currently supports agent-browser on macOS only.");
  }

  const launcher = fileURLToPath(import.meta.resolve("agent-browser/bin/agent-browser.js"));
  return join(dirname(launcher), `agent-browser-darwin-${process.arch}`);
}

function collectOutput(
  stream: NodeJS.ReadableStream,
  chunks: Buffer[],
  state: { bytes: number },
  maxOutputBytes: number,
  onOverflow: () => void,
): void {
  stream.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    state.bytes += buffer.length;
    if (state.bytes > maxOutputBytes) {
      onOverflow();
      return;
    }
    chunks.push(buffer);
  });
}

export const runAgentBrowserCommand: AgentBrowserCommandRunner = async (command) => {
  const executable = resolveAgentBrowserExecutable();

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

    const fail = (error: DogerError): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      reject(error);
    };

    const timer = setTimeout(() => {
      fail(new DogerError("BROWSER_EXECUTION_FAILED", "agent-browser command timed out."));
    }, command.timeoutMs);
    timer.unref();

    collectOutput(child.stdout, stdoutChunks, outputState, command.maxOutputBytes, () => {
      fail(new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser output exceeded the safe size limit."));
    });
    collectOutput(child.stderr, stderrChunks, outputState, command.maxOutputBytes, () => {
      fail(new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser output exceeded the safe size limit."));
    });

    child.once("error", () => {
      fail(new DogerError("DEPENDENCY_MISSING", "Unable to start the bundled agent-browser executable."));
    });
    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
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
    await this.#execute(["open", applicationUrl]);
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

  async #execute(args: readonly string[]): Promise<AgentBrowserCommandResult> {
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
      timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    });

    if (result.exitCode !== 0) {
      throw new DogerError("BROWSER_EXECUTION_FAILED", `agent-browser command failed with exit code ${result.exitCode}.`);
    }
    assertSuccessfulOutput(result.stdout);
    return result;
  }
}
