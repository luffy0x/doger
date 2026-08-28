import assert from "node:assert/strict";
import test from "node:test";

import { createConfig, parseConfig, REFRESH_INTERVAL_MS } from "../src/core/config.ts";
import { DogerError } from "../src/core/errors.ts";

test("creates an eight-hour single-target configuration", () => {
  const config = createConfig("https://campus.jd.com/application/123");

  assert.equal(config.intervalMs, REFRESH_INTERVAL_MS);
  assert.deepEqual(config.allowedHosts, ["campus.jd.com"]);
});

test("rejects credentials embedded in the application URL", () => {
  assert.throws(
    () => createConfig("https://user:secret@campus.jd.com/application/123"),
    (error: unknown) => error instanceof DogerError && error.code === "CONFIG_INVALID",
  );
});

test("rejects non-JD and lookalike application hosts", () => {
  assert.throws(() => createConfig("https://example.com/application/123"));
  assert.throws(() => createConfig("https://jd.com.example.net/application/123"));
});

test("rejects intervals shorter or longer than eight hours", () => {
  const config = createConfig("https://campus.jd.com/application/123");

  assert.throws(
    () => parseConfig({ ...config, intervalMs: REFRESH_INTERVAL_MS - 1 }),
    (error: unknown) => error instanceof DogerError && error.code === "CONFIG_INVALID",
  );
});

test("requires the application host in the allowlist", () => {
  const config = createConfig("https://campus.jd.com/application/123");

  assert.throws(
    () => parseConfig({ ...config, allowedHosts: ["api.jd.com"] }),
    (error: unknown) => error instanceof DogerError && error.code === "CONFIG_INVALID",
  );
});

test("rejects non-JD hosts added to the configuration allowlist", () => {
  const config = createConfig("https://campus.jd.com/application/123");
  assert.throws(() => parseConfig({ ...config, allowedHosts: ["campus.jd.com", "example.com"] }));
});
