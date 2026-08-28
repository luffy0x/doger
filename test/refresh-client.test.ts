import assert from "node:assert/strict";
import test from "node:test";

import type { CurlResponse } from "../src/http/classifier.ts";
import { executeRefresh } from "../src/http/refresh-client.ts";
import { parseRequestRecipe } from "../src/http/recipe.ts";
import type { CredentialBundle } from "../src/security/credential-store.ts";

const recipe = parseRequestRecipe({
  schemaVersion: 1,
  endpoint: "https://api.jd.com/activity/refresh",
  method: "POST",
  allowedHosts: ["api.jd.com"],
  headerNames: [],
  includeCookie: false,
  includeQuery: false,
  includeBody: false,
  response: {
    success: { statusCodes: [200], bodyIncludesAny: ["synthetic_success"] },
    authBodyIncludesAny: [],
    authLocationIncludesAny: [],
    rateLimitBodyIncludesAny: [],
  },
});

const credentials: CredentialBundle = {
  version: 1,
  capturedAt: "2026-08-28T01:02:03.000Z",
  headers: {},
};

function response(overrides: Partial<CurlResponse>): CurlResponse {
  return { exitCode: 0, statusCode: 200, headers: {}, body: "", ...overrides };
}

test("retries transient failures at most twice and returns success", async () => {
  const responses = [
    response({ statusCode: 503 }),
    response({ exitCode: 7, statusCode: null }),
    response({ body: "synthetic_success" }),
  ];
  const delays: number[] = [];

  const result = await executeRefresh(recipe, credentials, {
    execute: async () => responses.shift()!,
    retryDelaysMs: [10, 20],
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  assert.equal(result.classification.outcome, "SUCCESS");
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("does not retry an ambiguous timeout", async () => {
  let attempts = 0;

  const result = await executeRefresh(recipe, credentials, {
    execute: async () => {
      attempts += 1;
      return response({ exitCode: 28, statusCode: null });
    },
    sleep: async () => undefined,
  });

  assert.equal(result.classification.outcome, "MANUAL_CHECK");
  assert.equal(result.attempts, 1);
  assert.equal(attempts, 1);
});
