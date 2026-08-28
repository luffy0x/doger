import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DogerError } from "../core/errors.ts";
import type { CredentialBundle } from "../security/credential-store.ts";
import type { CurlResponse } from "./classifier.ts";
import { parseRequestRecipe, type RecipeParseOptions, type RequestRecipe } from "./recipe.ts";

const MAX_RESPONSE_BYTES = 1_048_576;

export interface CurlExecutorOptions extends RecipeParseOptions {
  readonly curlPath?: string;
  readonly temporaryRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

function quoteCurlConfig(value: string): string {
  if (value.includes("\0")) {
    throw new DogerError("RECIPE_INVALID", "Curl configuration values cannot contain NUL bytes.");
  }

  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")}"`;
}

function validateHeaderValue(value: string): void {
  if (value.includes("\r") || value.includes("\n") || value.includes("\0")) {
    throw new DogerError("CREDENTIALS_INVALID", "Captured header values contain forbidden control characters.");
  }
}

function buildRequestUrl(recipe: RequestRecipe, credentials: CredentialBundle): string {
  const url = new URL(recipe.endpoint);
  if (recipe.includeQuery) {
    if (credentials.query === undefined) {
      throw new DogerError("CREDENTIALS_MISSING", "Captured request query is missing.");
    }
    url.search = credentials.query.startsWith("?") ? credentials.query : `?${credentials.query}`;
  }
  return url.toString();
}

export function renderCurlConfig(
  recipe: RequestRecipe,
  credentials: CredentialBundle,
  bodyPath: string,
  headersPath: string,
): string {
  const lines = [
    "silent",
    "show-error",
    `request = ${quoteCurlConfig(recipe.method)}`,
    `url = ${quoteCurlConfig(buildRequestUrl(recipe, credentials))}`,
    "connect-timeout = 10",
    "max-time = 30",
    "max-redirs = 0",
    `max-filesize = ${MAX_RESPONSE_BYTES}`,
    `output = ${quoteCurlConfig(bodyPath)}`,
    `dump-header = ${quoteCurlConfig(headersPath)}`,
    `write-out = ${quoteCurlConfig("%{http_code}")}`,
  ];

  const capturedHeaders = new Map(
    Object.entries(credentials.headers).map(([name, value]) => [name.toLowerCase(), value] as const),
  );
  for (const name of recipe.headerNames) {
    const value = capturedHeaders.get(name);
    if (value === undefined) {
      throw new DogerError("CREDENTIALS_MISSING", `Captured value for required header ${name} is missing.`);
    }
    validateHeaderValue(value);
    lines.push(`header = ${quoteCurlConfig(`${name}: ${value}`)}`);
  }

  if (recipe.includeCookie) {
    if (credentials.cookieHeader === undefined) {
      throw new DogerError("CREDENTIALS_MISSING", "Captured cookie header is missing.");
    }
    validateHeaderValue(credentials.cookieHeader);
    lines.push(`cookie = ${quoteCurlConfig(credentials.cookieHeader)}`);
  }

  if (recipe.includeBody) {
    if (credentials.requestBody === undefined) {
      throw new DogerError("CREDENTIALS_MISSING", "Captured request body is missing.");
    }
    lines.push(`data-binary = ${quoteCurlConfig(credentials.requestBody)}`);
  }

  return `${lines.join("\n")}\n`;
}

function parseHeaders(raw: string): Readonly<Record<string, readonly string[]>> {
  const headers: Record<string, string[]> = {};
  for (const line of raw.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0 || line.startsWith("HTTP/")) {
      continue;
    }
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
  recipeInput: RequestRecipe,
  credentials: CredentialBundle,
  options: CurlExecutorOptions = {},
): Promise<CurlResponse> {
  const recipe = parseRequestRecipe(recipeInput, options);
  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "doger-curl-"));
  const bodyPath = join(directory, "body");
  const headersPath = join(directory, "headers");
  await createPrivateFile(bodyPath);
  await createPrivateFile(headersPath);

  try {
    const config = renderCurlConfig(recipe, credentials, bodyPath, headersPath);
    const result = await new Promise<{ readonly exitCode: number; readonly stdout: string }>((resolve, reject) => {
      const child = spawn(options.curlPath ?? "curl", ["--disable", "--config", "-"], {
        env: options.environment ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = `${stdout}${chunk}`.slice(-32);
      });
      child.stderr.on("data", () => undefined);
      child.once("error", (error) => {
        reject(new DogerError("CURL_EXECUTION_FAILED", "Unable to start curl.", { cause: error }));
      });
      child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
      child.stdin.end(config);
    });

    const [body, rawHeaders] = await Promise.all([readFile(bodyPath, "utf8"), readFile(headersPath, "utf8")]);
    const statusCode = /^\d{3}$/u.test(result.stdout.trim()) ? Number(result.stdout.trim()) : null;

    return {
      exitCode: result.exitCode,
      statusCode,
      headers: parseHeaders(rawHeaders),
      body,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
