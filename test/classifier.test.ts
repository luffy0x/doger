import assert from "node:assert/strict";
import test from "node:test";

import { classifyResponse, type CurlResponse } from "../src/http/classifier.ts";
import { parseRequestRecipe } from "../src/http/recipe.ts";

const recipe = parseRequestRecipe({
  schemaVersion: 1,
  endpoint: "https://api.jd.com/activity/refresh",
  method: "POST",
  allowedHosts: ["api.jd.com"],
  headerNames: ["content-type"],
  includeCookie: true,
  includeQuery: false,
  includeBody: true,
  response: {
    success: { statusCodes: [200], bodyIncludesAny: ["synthetic_success"] },
    notDue: { statusCodes: [200, 409], bodyIncludesAny: ["synthetic_not_due"] },
    authBodyIncludesAny: ["synthetic_login_required"],
    authLocationIncludesAny: ["/login"],
    rateLimitBodyIncludesAny: ["synthetic_rate_limited"],
  },
});

function response(overrides: Partial<CurlResponse>): CurlResponse {
  return { exitCode: 0, statusCode: 200, headers: {}, body: "", ...overrides };
}

test("requires captured body evidence for success", () => {
  assert.equal(classifyResponse(response({ body: "synthetic_success" }), recipe).outcome, "SUCCESS");
  assert.equal(classifyResponse(response({ body: "{}" }), recipe).outcome, "MANUAL_CHECK");
});

test("matches structured JSON success evidence without relying on formatting", () => {
  const structuredRecipe = parseRequestRecipe({
    ...recipe,
    response: {
      ...recipe.response,
      success: {
        statusCodes: [200],
        bodyIncludesAny: [],
        jsonEqualsAny: [{ path: ["result", "code"], equals: 0 }],
      },
    },
  });

  assert.equal(classifyResponse(response({ body: '{ "result": { "code": 0 } }' }), structuredRecipe).outcome, "SUCCESS");
  assert.equal(classifyResponse(response({ body: '{"result":{"code":1}}' }), structuredRecipe).outcome, "MANUAL_CHECK");
});

test("classifies authentication expiry before generic responses", () => {
  assert.equal(classifyResponse(response({ statusCode: 401 }), recipe).outcome, "REAUTH_REQUIRED");
  assert.equal(
    classifyResponse(response({ statusCode: 302, headers: { location: ["https://api.jd.com/login"] } }), recipe)
      .outcome,
    "REAUTH_REQUIRED",
  );
  assert.equal(classifyResponse(response({ body: "synthetic_login_required" }), recipe).outcome, "REAUTH_REQUIRED");
});

test("classifies cooldown, rate limit, server error, and timeout", () => {
  assert.equal(classifyResponse(response({ body: "synthetic_not_due" }), recipe).outcome, "NOT_DUE");
  assert.equal(classifyResponse(response({ statusCode: 429 }), recipe).outcome, "RATE_LIMITED");
  assert.equal(classifyResponse(response({ statusCode: 503 }), recipe).outcome, "TRANSIENT_FAILURE");
  assert.equal(classifyResponse(response({ exitCode: 28, statusCode: null }), recipe).outcome, "MANUAL_CHECK");
});

test("does not retry transport failures that may occur after request delivery", () => {
  for (const exitCode of [18, 52, 55, 56]) {
    assert.equal(classifyResponse(response({ exitCode, statusCode: null }), recipe).outcome, "MANUAL_CHECK");
  }
  for (const exitCode of [5, 6, 7]) {
    assert.equal(classifyResponse(response({ exitCode, statusCode: null }), recipe).outcome, "TRANSIENT_FAILURE");
  }
});

test("parses Retry-After without exposing the response body", () => {
  const now = new Date("2026-08-28T00:00:00.000Z");
  const result = classifyResponse(response({ statusCode: 429, headers: { "retry-after": ["120"] } }), recipe, now);

  assert.equal(result.retryAfterAt, "2026-08-28T00:02:00.000Z");
});
