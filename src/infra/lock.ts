import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { DogerError } from "../core/errors.ts";

interface LockRecord {
  readonly pid: number;
  readonly acquiredAt: string;
  readonly token: string;
}

export interface LockOptions {
  readonly now?: () => Date;
  readonly pid?: number;
  readonly staleAfterMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1_000;

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(path: string): Promise<LockRecord | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<LockRecord>;
    if (
      !Number.isSafeInteger(value.pid) ||
      (value.pid as number) <= 0 ||
      typeof value.acquiredAt !== "string" ||
      !Number.isFinite(Date.parse(value.acquiredAt)) ||
      typeof value.token !== "string" ||
      value.token === ""
    ) {
      return null;
    }
    return value as LockRecord;
  } catch {
    return null;
  }
}

async function lockModifiedAt(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function removeIfOwned(path: string, token: string): Promise<void> {
  const current = await readLock(path);
  if (current?.token !== token) {
    return;
  }

  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export async function withProcessLock<T>(
  path: string,
  action: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const now = options.now ?? (() => new Date());
  const pid = options.pid ?? process.pid;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const token = randomUUID();

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        const record: LockRecord = { pid, acquiredAt: now().toISOString(), token };
        await handle.writeFile(JSON.stringify(record), "utf8");
      } finally {
        await handle.close();
      }

      try {
        return await action();
      } finally {
        await removeIfOwned(path, token);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const existing = await readLock(path);
      const acquiredAt = existing === null ? await lockModifiedAt(path) : Date.parse(existing.acquiredAt);
      if (acquiredAt === null) {
        continue;
      }
      const isStale = now().getTime() - acquiredAt >= staleAfterMs;
      const processIsAlive = existing !== null && isProcessAlive(existing.pid);

      if (attempt === 0 && isStale && !processIsAlive) {
        await unlink(path).catch(() => undefined);
        continue;
      }

      throw new DogerError("ALREADY_RUNNING", "Another Doger refresh is already running.");
    }
  }

  throw new DogerError("ALREADY_RUNNING", "Another Doger refresh is already running.");
}
