import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { DogerError } from "../core/errors.ts";

export type Parser<T> = (value: unknown) => T;

export async function readJsonFile<T>(path: string, parser: Parser<T>): Promise<T | null> {
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new DogerError("STORAGE_ERROR", `Unable to read ${path}.`, { cause: error });
  }

  try {
    return parser(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof DogerError) {
      throw error;
    }
    throw new DogerError("STORAGE_ERROR", `Unable to parse ${path}.`, { cause: error });
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new DogerError("STORAGE_ERROR", `Unable to write ${path}.`, { cause: error });
  }
}
