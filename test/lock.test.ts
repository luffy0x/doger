import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DogerError } from "../src/core/errors.ts";
import { withProcessLock } from "../src/infra/lock.ts";

test("prevents concurrent refresh execution", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "refresh.lock");
  let releaseFirst: (() => void) | undefined;
  let markAcquired: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    markAcquired = resolve;
  });

  const first = withProcessLock(path, async () => {
    markAcquired?.();
    return gate;
  });
  await acquired;

  await assert.rejects(
    withProcessLock(path, async () => undefined),
    (error: unknown) => error instanceof DogerError && error.code === "ALREADY_RUNNING",
  );

  releaseFirst?.();
  await first;
});

test("reclaims a stale lock owned by a dead process", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "refresh.lock");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ pid: 999_999, acquiredAt: "2026-08-28T00:00:00.000Z", token: "stale" }),
    { mode: 0o600 },
  );

  const value = await withProcessLock(path, async () => "recovered", {
    now: () => new Date("2026-08-28T01:00:00.000Z"),
    isProcessAlive: () => false,
  });

  assert.equal(value, "recovered");
});

test("does not reclaim a fresh lock before its record is complete", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "refresh.lock");
  await writeFile(path, "", { mode: 0o600 });
  let ran = false;

  await assert.rejects(
    withProcessLock(
      path,
      async () => {
        ran = true;
      },
      { now: () => new Date(), staleAfterMs: 60_000 },
    ),
    (error: unknown) => error instanceof DogerError && error.code === "ALREADY_RUNNING",
  );
  assert.equal(ran, false);
});

test("does not automatically reclaim an invalid lock even when it is old", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "doger-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "refresh.lock");
  const staleAt = new Date("2026-08-28T00:00:00.000Z");
  await writeFile(path, "", { mode: 0o600 });
  await utimes(path, staleAt, staleAt);

  let ran = false;
  await assert.rejects(
    withProcessLock(
      path,
      async () => {
        ran = true;
      },
      {
        now: () => new Date("2026-08-28T01:00:00.000Z"),
        staleAfterMs: 60_000,
      },
    ),
    (error: unknown) => error instanceof DogerError && error.code === "ALREADY_RUNNING",
  );

  assert.equal(ran, false);
});
