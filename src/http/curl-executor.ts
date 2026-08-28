import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createConfig, JD_REFRESH_ENDPOINT, validateRefreshEndpoint } from "../core/config.ts";
import { DogerError } from "../core/errors.ts";
import { validateToken } from "../security/token-store.ts";
import type { CurlResponse } from "./classifier.ts";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_RESPONSE_HEADER_BYTES = 131_072;
const RESPONSE_TOO_LARGE_EXIT_CODE = 63;
export const CURL_ARGUMENTS = ["--disable", "--config", "-"] as const;

export interface CurlExecutorOptions {
  readonly curlPath?: string;
  readonly temporaryRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly maxTimeSeconds?: number;
  readonly endpoint?: string;
  readonly allowLoopbackForTests?: boolean;
}

function requestTimeoutSeconds(value: number | undefined): number {
  const timeout = value ?? 30;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30) {
    throw new DogerError("CONFIG_INVALID", "Curl timeout must be greater than zero and at most 30 seconds.");
  }
  return timeout;
}

function quoteCurlConfig(value: string): string {
  if (value.includes("\0")) throw new DogerError("CONFIG_INVALID", "Curl configuration contains invalid data.");
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")}"`;
}

export function renderCurlConfig(
  deliveryRecordId: number,
  token: string,
  bodyPath: string,
  headersPath: string,
  maxTimeSeconds = 30,
  endpoint = JD_REFRESH_ENDPOINT,
  allowLoopbackForTests = false,
): string {
  const config = createConfig(deliveryRecordId);
  const validatedToken = validateToken(token);
  const url = validateRefreshEndpoint(endpoint, { allowLoopbackForTests });
  const protocol = new URL(url).protocol === "https:" ? "=https" : "=http";
  const requestBody = JSON.stringify({ deliveryRecordId: config.deliveryRecordId });
  return `${[
    "silent",
    "show-error",
    "request = \"POST\"",
    `url = ${quoteCurlConfig(url)}`,
    `proto = ${quoteCurlConfig(protocol)}`,
    `proto-redir = ${quoteCurlConfig("-all")}`,
    "connect-timeout = 10",
    `max-time = ${requestTimeoutSeconds(maxTimeSeconds)}`,
    "max-redirs = 0",
    `max-filesize = ${MAX_RESPONSE_BYTES}`,
    `output = ${quoteCurlConfig(bodyPath)}`,
    `dump-header = ${quoteCurlConfig(headersPath)}`,
    `write-out = ${quoteCurlConfig("%{http_code}")}`,
    `header = ${quoteCurlConfig("Content-Type: application/json")}`,
    `header = ${quoteCurlConfig("X-Requested-With: XMLHttpRequest")}`,
    `header = ${quoteCurlConfig("Origin: https://campus.jd.com")}`,
    `header = ${quoteCurlConfig("Referer: https://campus.jd.com/")}`,
    `header = ${quoteCurlConfig(`Cookie: ${validatedToken}`)}`,
    `data-raw = ${quoteCurlConfig(requestBody)}`,
  ].join("\n")}\n`;
}

function parseHeaders(raw: string): Readonly<Record<string, readonly string[]>> {
  const headers: Record<string, string[]> = {};
  for (const line of raw.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0 || line.startsWith("HTTP/")) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    (headers[name] ??= []).push(value);
  }
  return headers;
}

async function createPrivateFile(path: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  await handle.close();
}

export async function executeCurl(
  deliveryRecordId: number,
  token: string,
  options: CurlExecutorOptions = {},
): Promise<CurlResponse> {
  const endpoint = options.endpoint ?? JD_REFRESH_ENDPOINT;
  validateRefreshEndpoint(endpoint, {
    ...(options.allowLoopbackForTests === undefined
      ? {}
      : { allowLoopbackForTests: options.allowLoopbackForTests }),
  });
  validateToken(token);
  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "doger-curl-"));
  const bodyPath = join(directory, "body");
  const headersPath = join(directory, "headers");
  await createPrivateFile(bodyPath);
  await createPrivateFile(headersPath);

  try {
    const config = renderCurlConfig(
      deliveryRecordId,
      token,
      bodyPath,
      headersPath,
      requestTimeoutSeconds(options.maxTimeSeconds),
      endpoint,
      options.allowLoopbackForTests,
    );
    const result = await new Promise<{ readonly exitCode: number; readonly stdout: string }>((resolve, reject) => {
      const child = spawn(options.curlPath ?? "curl", [...CURL_ARGUMENTS], {
        env: options.environment ?? process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-32); });
      child.stderr.on("data", () => undefined);
      child.once("error", () => reject(new DogerError("CURL_EXECUTION_FAILED", "Unable to start curl.")));
      child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
      child.stdin.end(config);
    });

    const [bodyInfo, headerInfo] = await Promise.all([stat(bodyPath), stat(headersPath)]);
    const responseTooLarge =
      result.exitCode === RESPONSE_TOO_LARGE_EXIT_CODE ||
      bodyInfo.size > MAX_RESPONSE_BYTES ||
      headerInfo.size > MAX_RESPONSE_HEADER_BYTES;
    if (responseTooLarge) {
      return { exitCode: result.exitCode, statusCode: null, headers: {}, body: "", responseTooLarge: true };
    }
    const [body, rawHeaders] = await Promise.all([readFile(bodyPath, "utf8"), readFile(headersPath, "utf8")]);
    const statusCode = /^\d{3}$/u.test(result.stdout.trim()) ? Number(result.stdout.trim()) : null;
    return { exitCode: result.exitCode, statusCode, headers: parseHeaders(rawHeaders), body, responseTooLarge: false };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
