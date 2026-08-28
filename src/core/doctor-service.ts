import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";

import { resolveAgentBrowserExecutable } from "../browser/agent-browser.ts";
import type { DogerPaths } from "../infra/paths.ts";
import { readStatus } from "./lifecycle-service.ts";

export type DoctorCheckStatus = "ok" | "warning" | "error";

export interface DoctorCheck {
  readonly name: "platform" | "node" | "curl" | "agent-browser" | "configuration";
  readonly status: DoctorCheckStatus;
  readonly code: string;
}

export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly command: "doctor";
  readonly healthy: boolean;
  readonly checks: readonly DoctorCheck[];
}

export interface DoctorOptions {
  readonly paths: DogerPaths;
  readonly platform?: NodeJS.Platform;
  readonly nodeVersion?: string;
  readonly probeCurl?: () => Promise<boolean>;
  readonly probeAgentBrowser?: () => Promise<boolean>;
}

async function probeProcess(executable: string, args: readonly string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(executable, [...args], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }
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

async function defaultAgentBrowserProbe(): Promise<boolean> {
  try {
    const executable = resolveAgentBrowserExecutable();
    await access(executable, constants.X_OK);
    return await probeProcess(executable, ["--version"]);
  } catch {
    return false;
  }
}

function check(name: DoctorCheck["name"], ok: boolean, codes: readonly [string, string]): DoctorCheck {
  return { name, status: ok ? "ok" : "error", code: ok ? codes[0] : codes[1] };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".", 1)[0]);
  const status = await readStatus(options.paths);
  const checks: DoctorCheck[] = [
    check("platform", platform === "darwin", ["macos_supported", "unsupported_platform"]),
    check("node", Number.isInteger(nodeMajor) && nodeMajor >= 24, ["node_supported", "node_too_old"]),
    check("curl", await (options.probeCurl ?? (() => probeProcess("curl", ["--version"])))(), [
      "curl_available",
      "curl_missing",
    ]),
    check("agent-browser", await (options.probeAgentBrowser ?? defaultAgentBrowserProbe)(), [
      "agent_browser_available",
      "agent_browser_missing",
    ]),
    {
      name: "configuration",
      status: status.initialized ? "ok" : "warning",
      code: status.initialized ? "initialized" : "not_initialized",
    },
  ];

  return {
    schemaVersion: 1,
    command: "doctor",
    healthy: checks.every((item) => item.status !== "error"),
    checks,
  };
}
