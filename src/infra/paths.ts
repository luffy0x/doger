import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface DogerPaths {
  readonly root: string;
  readonly config: string;
  readonly runtimeState: string;
  readonly installationMarker: string;
  readonly refreshLock: string;
}

export interface PathOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
}

export function resolveDataDirectory(options: PathOptions = {}): string {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const override = env.DOGER_DATA_DIR?.trim();
  if (override !== undefined && override !== "") return isAbsolute(override) ? override : resolve(override);
  if (platform === "darwin") return join(homeDirectory, "Library", "Application Support", "doger");
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    return join(localAppData === undefined || localAppData === "" ? join(homeDirectory, "AppData", "Local") : localAppData, "doger");
  }
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  return join(xdgStateHome === undefined || xdgStateHome === "" ? join(homeDirectory, ".local", "state") : xdgStateHome, "doger");
}

export function resolveDogerPaths(options: PathOptions = {}): DogerPaths {
  const root = resolveDataDirectory(options);
  return {
    root,
    config: join(root, "config.json"),
    runtimeState: join(root, "runtime.json"),
    installationMarker: join(root, "installation.json"),
    refreshLock: join(root, "refresh.lock"),
  };
}
