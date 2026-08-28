import assert from "node:assert/strict";
import test from "node:test";

import { classifyResponse, type CurlResponse } from "../src/http/classifier.ts";

function response(overrides: Partial<CurlResponse> = {}): CurlResponse {
  return {
    exitCode: 0,
    statusCode: 200,
    headers: {},
    body: '{"success":true,"body":{"success":true}}',
    responseTooLarge: false,
    ...overrides,
  };
}

test("requires both exact boolean success values", () => {
  assert.equal(classifyResponse(response()).outcome, "SUCCESS");
  for (const body of [
    '{"success":true,"body":{"success":false}}',
    '{"success":"true","body":{"success":true}}',
    '{"success":true,"body":{}}',
    "not-json",
  ]) {
    assert.equal(classifyResponse(response({ body })).outcome, "MANUAL_CHECK", body);
  }
});

test("classifies authentication, rate limiting, server failure, redirect, timeout, and size limits", () => {
  assert.equal(classifyResponse(response({ statusCode: 401 })).outcome, "REAUTH_REQUIRED");
  assert.equal(classifyResponse(response({ statusCode: 403 })).outcome, "REAUTH_REQUIRED");
  assert.equal(classifyResponse(response({ statusCode: 429 })).outcome, "RATE_LIMITED");
  assert.equal(classifyResponse(response({ statusCode: 503 })).outcome, "TRANSIENT_FAILURE");
  assert.equal(classifyResponse(response({ statusCode: 302 })).outcome, "MANUAL_CHECK");
  assert.equal(classifyResponse(response({ exitCode: 28, statusCode: null })).outcome, "MANUAL_CHECK");
  assert.equal(classifyResponse(response({ responseTooLarge: true })).outcome, "MANUAL_CHECK");
});

test("only pre-request connection failures are transient", () => {
  for (const exitCode of [5, 6, 7]) {
    assert.equal(classifyResponse(response({ exitCode, statusCode: null })).outcome, "TRANSIENT_FAILURE");
  }
  for (const exitCode of [18, 52, 55, 56]) {
    assert.equal(classifyResponse(response({ exitCode, statusCode: null })).outcome, "MANUAL_CHECK");
  }
});

test("parses Retry-After without exposing response content", () => {
  const result = classifyResponse(
    response({ statusCode: 429, headers: { "retry-after": ["120"] }, body: "synthetic-private-response" }),
    new Date("2026-08-28T00:00:00.000Z"),
  );
  assert.equal(result.retryAfterAt, "2026-08-28T00:02:00.000Z");
  assert.equal(JSON.stringify(result).includes("synthetic-private-response"), false);
});
