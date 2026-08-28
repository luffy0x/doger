import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIG_SCHEMA_VERSION,
  createConfig,
  JD_REFRESH_ENDPOINT,
  parseConfig,
  validateRefreshEndpoint,
} from "../src/core/config.ts";
import { DogerError } from "../src/core/errors.ts";

test("creates a schema-v2 configuration for one positive delivery record", () => {
  assert.deepEqual(createConfig("1234567"), {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    deliveryRecordId: 1_234_567,
  });
});

test("rejects invalid delivery record identifiers", () => {
  for (const value of ["", "0", "-1", "1.5", "1e3", "abc", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => createConfig(value),
      (error: unknown) => error instanceof DogerError && error.code === "CONFIG_INVALID",
      value,
    );
  }
});

test("rejects schema-v1 configuration with an explicit migration error", () => {
  assert.throws(
    () => parseConfig({ schemaVersion: 1, applicationUrl: "https://campus.jd.com/" }),
    (error: unknown) => error instanceof DogerError && error.code === "CONFIG_MIGRATION_REQUIRED",
  );
});

test("rejects extra configuration fields instead of preserving secret-like data", () => {
  const secret = "synthetic-private-token";
  assert.throws(
    () => parseConfig({ schemaVersion: 2, deliveryRecordId: 1, token: secret }),
    (error: unknown) => error instanceof DogerError && !String(error).includes(secret),
  );
});

test("the fixed endpoint is official JD HTTPS and test overrides are loopback-only", () => {
  assert.equal(validateRefreshEndpoint(JD_REFRESH_ENDPOINT), JD_REFRESH_ENDPOINT);
  assert.throws(() => validateRefreshEndpoint("https://example.com/api/wx/resume/refresh"));
  assert.throws(() => validateRefreshEndpoint("http://127.0.0.1:8080/refresh"));
  assert.equal(
    validateRefreshEndpoint("http://127.0.0.1:8080/refresh", { allowLoopbackForTests: true }),
    "http://127.0.0.1:8080/refresh",
  );
});
