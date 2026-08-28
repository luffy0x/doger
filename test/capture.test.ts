import assert from "node:assert/strict";
import test from "node:test";

import {
  captureRefreshRequest,
  normalizeCapturedRequest,
  selectRefreshRequestId,
  type CaptureBrowserSession,
} from "../src/browser/capture.ts";
import { DogerError } from "../src/core/errors.ts";

const SECRET_COOKIE = "synthetic-secret-cookie";
const SECRET_CSRF = "synthetic-secret-csrf";
const SECRET_QUERY = "synthetic-secret-application";
const SECRET_BODY = "synthetic-secret-target";

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "123.4",
    method: "POST",
    url: `https://api.jd.com/activity/refresh?application=${SECRET_QUERY}`,
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": SECRET_CSRF,
      "sec-ch-ua": "synthetic-browser-proof",
      "User-Agent": "synthetic-user-agent",
    },
    postData: JSON.stringify({ target: SECRET_BODY }),
    responseBody: JSON.stringify({ code: 0, success: true, message: "刷新成功" }),
    ...overrides,
  };
}

function detailPayload(overrides: Record<string, unknown> = {}): unknown {
  return { success: true, data: request(overrides), error: null };
}

function cookiePayload(): unknown {
  return {
    success: true,
    data: {
      cookies: [
        {
          domain: ".jd.com",
          name: "session",
          path: "/",
          secure: true,
          value: SECRET_COOKIE,
        },
        {
          domain: "example.com",
          name: "unrelated",
          path: "/",
          secure: true,
          value: "synthetic-unrelated-cookie",
        },
      ],
    },
    error: null,
  };
}

function cookiePayloadWithScope(path: string, domain = ".jd.com"): unknown {
  return {
    success: true,
    data: {
      cookies: [{ domain, name: "session", path, secure: true, value: SECRET_COOKIE }],
    },
    error: null,
  };
}

test("selects exactly one successful official JD request", () => {
  assert.equal(
    selectRefreshRequestId({
      success: true,
      data: {
        requests: [
          request(),
          request({ requestId: "ignored", url: "https://example.com/track", status: 200 }),
          request({ requestId: "failed", status: 500 }),
        ],
      },
      error: null,
    }),
    "123.4",
  );
});

test("fails closed when the refresh request is ambiguous", () => {
  const payload = {
    success: true,
    data: { requests: [request(), request({ requestId: "123.5" })] },
    error: null,
  };

  assert.throws(
    () => selectRefreshRequestId(payload),
    (error: unknown) => error instanceof DogerError && error.code === "CAPTURE_AMBIGUOUS",
  );
});

test("normalizes capture into a public recipe and protected credentials", () => {
  const capturedAt = new Date("2026-08-28T01:02:03.000Z");
  const capture = normalizeCapturedRequest(detailPayload(), cookiePayload(), capturedAt);

  assert.deepEqual(capture.recipe, {
    schemaVersion: 1,
    endpoint: "https://api.jd.com/activity/refresh",
    method: "POST",
    allowedHosts: ["api.jd.com"],
    headerNames: ["content-type", "user-agent", "x-csrf-token"],
    includeCookie: true,
    includeQuery: true,
    includeBody: true,
    response: {
      success: {
        statusCodes: [200],
        bodyIncludesAny: [],
        jsonEqualsAny: [{ path: ["code"], equals: 0 }],
      },
      authBodyIncludesAny: ["login", "未登录", "请登录"],
      authLocationIncludesAny: ["/login", "passport.jd.com"],
      rateLimitBodyIncludesAny: ["too many requests", "rate limit", "操作频繁", "请求频繁"],
    },
  });
  assert.deepEqual(capture.credentials, {
    version: 1,
    capturedAt: capturedAt.toISOString(),
    cookieHeader: `session=${SECRET_COOKIE}`,
    query: `application=${SECRET_QUERY}`,
    requestBody: JSON.stringify({ target: SECRET_BODY }),
    headers: {
      "content-type": "application/json",
      "x-csrf-token": SECRET_CSRF,
      "user-agent": "synthetic-user-agent",
    },
  });

  const publicRecipe = JSON.stringify(capture.recipe);
  for (const secret of [SECRET_COOKIE, SECRET_CSRF, SECRET_QUERY, SECRET_BODY]) {
    assert.equal(publicRecipe.includes(secret), false);
  }
  assert.equal(publicRecipe.includes("synthetic-browser-proof"), false);
});

test("does not send a cookie across a non-boundary path prefix", () => {
  const capture = normalizeCapturedRequest(
    detailPayload({ url: "https://api.jd.com/foobar?application=synthetic" }),
    cookiePayloadWithScope("/foo"),
    new Date("2026-08-28T01:02:03.000Z"),
  );

  assert.equal(capture.recipe.includeCookie, false);
  assert.equal(capture.credentials.cookieHeader, undefined);
});

test("does not widen a host-only cookie to a subdomain", () => {
  const capture = normalizeCapturedRequest(
    detailPayload({ url: "https://api.campus.jd.com/activity/refresh?application=synthetic" }),
    cookiePayloadWithScope("/", "campus.jd.com"),
    new Date("2026-08-28T01:02:03.000Z"),
  );

  assert.equal(capture.recipe.includeCookie, false);
  assert.equal(capture.credentials.cookieHeader, undefined);
});

test("includes a domain cookie for an eligible subdomain", () => {
  const capture = normalizeCapturedRequest(
    detailPayload({ url: "https://api.campus.jd.com/activity/refresh?application=synthetic" }),
    cookiePayloadWithScope("/", ".campus.jd.com"),
    new Date("2026-08-28T01:02:03.000Z"),
  );

  assert.equal(capture.credentials.cookieHeader, `session=${SECRET_COOKIE}`);
});

test("rejects dynamic signing and sensitive endpoint paths without exposing values", () => {
  for (const detail of [
    detailPayload({ url: "https://api.jd.com/activity/refresh?h5st=synthetic-dynamic-proof" }),
    detailPayload({ url: "https://api.jd.com/activity/1234567890123456" }),
  ]) {
    assert.throws(
      () => normalizeCapturedRequest(detail, cookiePayload(), new Date()),
      (error: unknown) =>
        error instanceof DogerError &&
        error.code === "CAPTURE_UNSUPPORTED" &&
        !error.message.includes("synthetic-dynamic-proof") &&
        !error.message.includes("1234567890123456"),
    );
  }
});

test("rejects responses without a safe authoritative success signal", () => {
  assert.throws(
    () =>
      normalizeCapturedRequest(
        detailPayload({ responseBody: JSON.stringify({ message: "welcome synthetic-user" }) }),
        cookiePayload(),
        new Date(),
      ),
    (error: unknown) => error instanceof DogerError && error.code === "CAPTURE_UNSUPPORTED",
  );
});

test("accepts a bounded numeric string as structured success evidence", () => {
  const capture = normalizeCapturedRequest(
    detailPayload({ responseBody: JSON.stringify({ result: { resultCode: "0" } }) }),
    cookiePayload(),
    new Date("2026-08-28T01:02:03.000Z"),
  );

  assert.deepEqual(capture.recipe.response.success.jsonEqualsAny, [
    { path: ["result", "resultCode"], equals: "0" },
  ]);
});

test("captures request details and cookies without returning raw browser payloads", async () => {
  const seen: string[] = [];
  const session: CaptureBrowserSession = {
    async listNetworkRequests() {
      seen.push("list");
      return { success: true, data: { requests: [request()] }, error: null };
    },
    async getNetworkRequest(requestId) {
      seen.push(`detail:${requestId}`);
      return detailPayload();
    },
    async getCookies() {
      seen.push("cookies");
      return cookiePayload();
    },
  };

  const capture = await captureRefreshRequest(session, new Date("2026-08-28T01:02:03.000Z"));
  assert.deepEqual(seen, ["list", "detail:123.4", "cookies"]);
  assert.equal(capture.recipe.endpoint, "https://api.jd.com/activity/refresh");
});

test("rejects mismatched request detail identifiers", async () => {
  const session: CaptureBrowserSession = {
    async listNetworkRequests() {
      return { success: true, data: { requests: [request()] }, error: null };
    },
    async getNetworkRequest() {
      return detailPayload({ requestId: "different.1" });
    },
    async getCookies() {
      return cookiePayload();
    },
  };

  await assert.rejects(
    captureRefreshRequest(session),
    (error: unknown) => error instanceof DogerError && error.code === "BROWSER_OUTPUT_INVALID",
  );
});
