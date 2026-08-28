import assert from "node:assert/strict";
import test from "node:test";

import { DogerError } from "../src/core/errors.ts";
import { parseRequestRecipe } from "../src/http/recipe.ts";

const validRecipe = {
  schemaVersion: 1,
  endpoint: "https://api.jd.com/activity/refresh",
  method: "POST",
  allowedHosts: ["api.jd.com"],
  headerNames: ["content-type", "x-csrf-token"],
  includeCookie: true,
  includeQuery: true,
  includeBody: true,
  response: {
    success: { statusCodes: [200], bodyIncludesAny: ["synthetic_success"] },
    notDue: { statusCodes: [200, 409], bodyIncludesAny: ["synthetic_not_due"] },
    authBodyIncludesAny: ["synthetic_login_required"],
    authLocationIncludesAny: ["/login"],
    rateLimitBodyIncludesAny: ["synthetic_rate_limited"],
  },
} as const;

test("accepts a constrained HTTPS request recipe", () => {
  assert.deepEqual(parseRequestRecipe(validRecipe), validRecipe);
});

test("rejects endpoints carrying query data outside encrypted credentials", () => {
  assert.throws(
    () => parseRequestRecipe({ ...validRecipe, endpoint: "https://api.jd.com/activity/refresh?token=secret" }),
    (error: unknown) => error instanceof DogerError && error.code === "RECIPE_INVALID",
  );
});

test("rejects status-only success classification", () => {
  assert.throws(() =>
    parseRequestRecipe({
      ...validRecipe,
      response: { ...validRecipe.response, success: { statusCodes: [200], bodyIncludesAny: [] } },
    }),
  );
});

test("accepts structured JSON evidence and rejects invalid predicate paths", () => {
  assert.doesNotThrow(() =>
    parseRequestRecipe({
      ...validRecipe,
      response: {
        ...validRecipe.response,
        success: { statusCodes: [200], bodyIncludesAny: [], jsonEqualsAny: [{ path: ["code"], equals: 0 }] },
      },
    }),
  );
  assert.throws(() =>
    parseRequestRecipe({
      ...validRecipe,
      response: {
        ...validRecipe.response,
        success: { statusCodes: [200], bodyIncludesAny: [], jsonEqualsAny: [{ path: [], equals: 0 }] },
      },
    }),
  );
});

test("rejects unsafe captured headers", () => {
  assert.throws(() => parseRequestRecipe({ ...validRecipe, headerNames: ["content-length"] }));
});

test("rejects non-JD request hosts outside the explicit loopback test mode", () => {
  assert.throws(() =>
    parseRequestRecipe({
      ...validRecipe,
      endpoint: "https://example.com/activity/refresh",
      allowedHosts: ["example.com"],
    }),
  );
});
