import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyResponse } from "../src/http/classifier.ts";
import { executeCurl, renderCurlConfig } from "../src/http/curl-executor.ts";
import { parseRequestRecipe } from "../src/http/recipe.ts";
import type { CredentialBundle } from "../src/security/credential-store.ts";

const credentials: CredentialBundle = {
  version: 1,
  capturedAt: "2026-08-28T01:02:03.000Z",
  cookieHeader: "session=synthetic-secret-cookie",
  query: "signature=synthetic-secret-signature",
  requestBody: "{\"target\":\"synthetic-secret-target\"}",
  headers: {
    "content-type": "application/json",
    "x-csrf-token": "synthetic-secret-csrf",
  },
};

test("executes a captured request against a local mock without putting secrets in argv", async (context) => {
  const requests: Array<{ url: string; cookie: string | undefined; csrf: string | undefined; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        url: request.url ?? "",
        cookie: request.headers.cookie,
        csrf: request.headers["x-csrf-token"] as string | undefined,
        body,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"code":"synthetic_success"}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }

  const recipe = parseRequestRecipe(
    {
      schemaVersion: 1,
      endpoint: `http://127.0.0.1:${address.port}/activity/refresh`,
      method: "POST",
      allowedHosts: ["127.0.0.1"],
      headerNames: ["content-type", "x-csrf-token"],
      includeCookie: true,
      includeQuery: true,
      includeBody: true,
      response: {
        success: { statusCodes: [200], bodyIncludesAny: ["synthetic_success"] },
        notDue: { statusCodes: [409], bodyIncludesAny: ["synthetic_not_due"] },
        authBodyIncludesAny: ["synthetic_login_required"],
        authLocationIncludesAny: ["/login"],
        rateLimitBodyIncludesAny: ["synthetic_rate_limited"],
      },
    },
    { allowHttpForLoopbackTests: true },
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "doger-curl-test-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const response = await executeCurl(recipe, credentials, {
    allowHttpForLoopbackTests: true,
    temporaryRoot,
    environment: { ...process.env, NO_PROXY: "127.0.0.1" },
  });

  assert.equal(classifyResponse(response, recipe).outcome, "SUCCESS");
  assert.deepEqual(requests, [
    {
      url: "/activity/refresh?signature=synthetic-secret-signature",
      cookie: "session=synthetic-secret-cookie",
      csrf: "synthetic-secret-csrf",
      body: '{"target":"synthetic-secret-target"}',
    },
  ]);

  const config = renderCurlConfig(recipe, credentials, "/private/body", "/private/headers");
  assert.match(config, /synthetic-secret-cookie/);
  assert.deepEqual(["--config", "-"].filter((argument) => argument.includes("synthetic-secret")), []);
});

test("ignores user curl configuration that could trace credentials", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200).end("synthetic_success");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "doger-curl-config-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const tracePath = join(temporaryRoot, "curl-trace.log");
  await writeFile(join(temporaryRoot, ".curlrc"), `trace-ascii = "${tracePath}"\n`, "utf8");
  const recipe = parseRequestRecipe(
    {
      schemaVersion: 1,
      endpoint: `http://127.0.0.1:${address.port}/success`,
      method: "GET",
      allowedHosts: ["127.0.0.1"],
      headerNames: [],
      includeCookie: true,
      includeQuery: false,
      includeBody: false,
      response: {
        success: { statusCodes: [200], bodyIncludesAny: ["synthetic_success"] },
        authBodyIncludesAny: [],
        authLocationIncludesAny: [],
        rateLimitBodyIncludesAny: [],
      },
    },
    { allowHttpForLoopbackTests: true },
  );

  await executeCurl(recipe, credentials, {
    allowHttpForLoopbackTests: true,
    temporaryRoot,
    environment: { ...process.env, CURL_HOME: temporaryRoot, HOME: temporaryRoot, NO_PROXY: "127.0.0.1" },
  });

  await assert.rejects(access(tracePath), { code: "ENOENT" });
});

test("classifies all HTTP outcomes through the real curl boundary", async (context) => {
  const server = createServer((request, response) => {
    const path = request.url?.split("?", 1)[0];
    if (path === "/success") {
      response.writeHead(200).end("synthetic_success");
    } else if (path === "/not-due") {
      response.writeHead(409).end("synthetic_not_due");
    } else if (path === "/reauth") {
      response.writeHead(401).end("unauthorized");
    } else if (path === "/login") {
      response.writeHead(302, { location: "/login-form" }).end();
    } else if (path === "/rate") {
      response.writeHead(429, { "retry-after": "120" }).end("rate limited");
    } else if (path === "/transient") {
      response.writeHead(503).end("unavailable");
    } else {
      response.writeHead(200).end("unknown");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "doger-curl-outcomes-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const expected = new Map([
    ["success", "SUCCESS"],
    ["not-due", "NOT_DUE"],
    ["reauth", "REAUTH_REQUIRED"],
    ["login", "REAUTH_REQUIRED"],
    ["rate", "RATE_LIMITED"],
    ["transient", "TRANSIENT_FAILURE"],
    ["unknown", "MANUAL_CHECK"],
  ] as const);

  for (const [path, outcome] of expected) {
    const recipe = parseRequestRecipe(
      {
        schemaVersion: 1,
        endpoint: `http://127.0.0.1:${address.port}/${path}`,
        method: "GET",
        allowedHosts: ["127.0.0.1"],
        headerNames: [],
        includeCookie: false,
        includeQuery: false,
        includeBody: false,
        response: {
          success: { statusCodes: [200], bodyIncludesAny: ["synthetic_success"] },
          notDue: { statusCodes: [409], bodyIncludesAny: ["synthetic_not_due"] },
          authBodyIncludesAny: ["synthetic_login_required"],
          authLocationIncludesAny: ["/login-form"],
          rateLimitBodyIncludesAny: ["synthetic_rate_limited"],
        },
      },
      { allowHttpForLoopbackTests: true },
    );
    const result = await executeCurl(recipe, { version: 1, capturedAt: credentials.capturedAt, headers: {} }, {
      allowHttpForLoopbackTests: true,
      temporaryRoot,
      environment: { ...process.env, NO_PROXY: "127.0.0.1" },
    });

    assert.equal(classifyResponse(result, recipe).outcome, outcome, path);
  }
});
