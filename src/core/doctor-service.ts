import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { DogerPaths } from "../infra/paths.ts";
import { KeyringTokenStore, type TokenStore } from "../security/token-store.ts";
import { readStatus } from "./lifecycle-service.ts";
import { REPORT_SCHEMA_VERSION } from "./report.ts";

export type DoctorCheckStatus = "ok" | "warning" | "error";

export interface DoctorCheck {
  readonly name: "platform" | "node" | "curl" | "credential-store" | "configuration";
  readonly status: DoctorCheckStatus;
  readonly code: string;
}

export interface DoctorReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly command: "doctor";
  readonly healthy: boolean;
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorOptions {
  readonly paths: DogerPaths;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly nodeVersion?: string;
  readonly probeCurl?: () => Promise<boolean>;
  readonly probeCredentialStore?: () => Promise<boolean>;
}

async function probeProcess(executable: string, args: readonly string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(executable, [...args], { shell: false, stdio: "ignore", windowsHide: true });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false);
    }, 5_000);
    timer.unref();
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

export async function probeCredentialStore(store: TokenStore, value: string): Promise<boolean> {
  let valid = false;
  let cleaned = false;
  try {
    await store.set(value);
    valid = (await store.get()) === value;
  } catch {
    valid = false;
  }
  try {
    await store.delete();
    cleaned = true;
  } catch {
    cleaned = false;
  }
  return valid && cleaned;
}

async function defaultCredentialStoreProbe(): Promise<boolean> {
  const id = randomUUID();
  const value = `doger-synthetic-probe-${id}`;
  const store = new KeyringTokenStore("doger-doctor", id);
  return await probeCredentialStore(store, value);
}

function check(name: DoctorCheck["name"], ok: boolean, codes: readonly [string, string]): DoctorCheck {
  return { name, status: ok ? "ok" : "error", code: ok ? codes[0] : codes[1] };
}

function platformCheck(platform: NodeJS.Platform, arch: NodeJS.Architecture): DoctorCheck {
  if ((platform === "darwin" || platform === "win32") && (arch === "x64" || arch === "arm64")) {
    return { name: "platform", status: "ok", code: platform === "darwin" ? "macos_supported" : "windows_supported" };
  }
  return { name: "platform", status: "error", code: "unsupported_platform_architecture" };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".", 1)[0]);
  let configuration: DoctorCheck;
  try {
    const status = await readStatus(options.paths);
    configuration = {
      name: "configuration",
      status: status.initialized ? "ok" : "warning",
      code: status.initialized ? "initialized" : "not_initialized",
    };
  } catch {
    configuration = { name: "configuration", status: "error", code: "configuration_invalid" };
  }
  const checks: DoctorCheck[] = [
    platformCheck(platform, arch),
    check("node", Number.isInteger(nodeMajor) && nodeMajor >= 24, ["node_supported", "node_too_old"]),
    check("curl", await (options.probeCurl ?? (() => probeProcess("curl", ["--version"])))(), [
      "curl_available", "curl_missing",
    ]),
    check("credential-store", await (options.probeCredentialStore ?? defaultCredentialStoreProbe)(), [
      "credential_store_available", "credential_store_unavailable",
    ]),
    configuration,
  ];
  return { schemaVersion: REPORT_SCHEMA_VERSION, command: "doctor", healthy: checks.every((item) => item.status !== "error"), checks };
}
