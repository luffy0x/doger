import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyResponse } from "../src/http/classifier.ts";
import { CURL_ARGUMENTS, executeCurl, renderCurlConfig } from "../src/http/curl-executor.ts";

const TOKEN = "session=synthetic-token-value";

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }
  return address.port;
}

test("executes the fixed request through stdin and removes response files", async (context) => {
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        cookie: request.headers.cookie,
        contentType: request.headers["content-type"],
        requestedWith: request.headers["x-requested-with"],
        body,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"success":true,"body":{"success":true,"noticeMsg":"private"}}');
    });
  });
  const port = await listen(server);
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "doger-fixed-curl-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const result = await executeCurl(1_234_567, TOKEN, {
    endpoint: `http://127.0.0.1:${port}/api/wx/resume/refresh`,
    allowLoopbackForTests: true,
    temporaryRoot,
    environment: { ...process.env, NO_PROXY: "127.0.0.1" },
  });

  assert.equal(classifyResponse(result).outcome, "SUCCESS");
  assert.deepEqual(requests, [{
    method: "POST",
    url: "/api/wx/resume/refresh",
    cookie: TOKEN,
    contentType: "application/json",
    requestedWith: "XMLHttpRequest",
    body: '{"deliveryRecordId":1234567}',
  }]);
  assert.equal(CURL_ARGUMENTS.some((argument) => argument.includes(TOKEN)), false);
  assert.deepEqual(await readdir(temporaryRoot), []);

  const config = renderCurlConfig(1_234_567, TOKEN, "/private/body", "/private/headers");
  assert.match(config, /header = "Cookie: session=synthetic-token-value"/);
});

test("ignores ambient curl configuration that could trace the token", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200).end('{"success":true,"body":{"success":true}}');
  });
  const port = await listen(server);
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "doger-curl-config-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const tracePath = join(temporaryRoot, "curl-trace.log");
  await writeFile(join(temporaryRoot, ".curlrc"), `trace-ascii = "${tracePath}"\n`, "utf8");

  await executeCurl(1, TOKEN, {
    endpoint: `http://127.0.0.1:${port}/api/wx/resume/refresh`,
    allowLoopbackForTests: true,
    temporaryRoot,
    environment: { ...process.env, CURL_HOME: temporaryRoot, HOME: temporaryRoot, NO_PROXY: "127.0.0.1" },
  });
  await assert.rejects(access(tracePath), { code: "ENOENT" });
});

test("does not follow redirects", async (context) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(302, { location: "/unexpected" }).end();
  });
  const port = await listen(server);
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

  const result = await executeCurl(1, TOKEN, {
    endpoint: `http://127.0.0.1:${port}/api/wx/resume/refresh`,
    allowLoopbackForTests: true,
    environment: { ...process.env, NO_PROXY: "127.0.0.1" },
  });
  assert.equal(result.statusCode, 302);
  assert.equal(classifyResponse(result).outcome, "MANUAL_CHECK");
  assert.equal(requests, 1);
});

test("classifies a real timeout and an oversized response conservatively", async (context) => {
  const timeoutServer = createServer(() => undefined);
  const timeoutPort = await listen(timeoutServer);
  context.after(() => new Promise<void>((resolve, reject) => timeoutServer.close((error) => (error ? reject(error) : resolve()))));
  const timedOut = await executeCurl(1, TOKEN, {
    endpoint: `http://127.0.0.1:${timeoutPort}/api/wx/resume/refresh`,
    allowLoopbackForTests: true,
    maxTimeSeconds: 0.05,
    environment: { ...process.env, NO_PROXY: "127.0.0.1" },
  });
  assert.equal(timedOut.exitCode, 28);
  assert.equal(classifyResponse(timedOut).outcome, "MANUAL_CHECK");

  const largeServer = createServer((_request, response) => {
    response.writeHead(200).end("x".repeat(1_048_577));
  });
  const largePort = await listen(largeServer);
  context.after(() => new Promise<void>((resolve, reject) => largeServer.close((error) => (error ? reject(error) : resolve()))));
  const oversized = await executeCurl(1, TOKEN, {
    endpoint: `http://127.0.0.1:${largePort}/api/wx/resume/refresh`,
    allowLoopbackForTests: true,
    environment: { ...process.env, NO_PROXY: "127.0.0.1" },
  });
  assert.equal(oversized.responseTooLarge, true);
  assert.equal(oversized.body, "");
});

test("classifies fixed-contract HTTP failures through the real curl boundary", async (context) => {
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    if (path.endsWith("/reauth")) response.writeHead(401).end("private");
    else if (path.endsWith("/forbidden")) response.writeHead(403).end("private");
    else if (path.endsWith("/rate")) response.writeHead(429, { "retry-after": "120" }).end("private");
    else if (path.endsWith("/server")) response.writeHead(503).end("private");
    else if (path.endsWith("/false")) response.writeHead(200).end('{"success":true,"body":{"success":false}}');
    else response.writeHead(200).end("not-json");
  });
  const port = await listen(server);
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const expected = new Map([
    ["reauth", "REAUTH_REQUIRED"],
    ["forbidden", "REAUTH_REQUIRED"],
    ["rate", "RATE_LIMITED"],
    ["server", "TRANSIENT_FAILURE"],
    ["false", "MANUAL_CHECK"],
    ["malformed", "MANUAL_CHECK"],
  ] as const);
  for (const [path, outcome] of expected) {
    const result = await executeCurl(1, TOKEN, {
      endpoint: `http://127.0.0.1:${port}/${path}`,
      allowLoopbackForTests: true,
      environment: { ...process.env, NO_PROXY: "127.0.0.1" },
    });
    assert.equal(classifyResponse(result).outcome, outcome, path);
  }
});

test("classifies a real connection failure as transient", async () => {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const result = await executeCurl(1, TOKEN, {
    endpoint: `http://127.0.0.1:${port}/closed`,
    allowLoopbackForTests: true,
    environment: { ...process.env, NO_PROXY: "127.0.0.1" },
  });
  assert.equal(result.exitCode, 7);
  assert.equal(classifyResponse(result).outcome, "TRANSIENT_FAILURE");
});

test("rejects token control characters before starting curl", async () => {
  await assert.rejects(executeCurl(1, "session=value\r\ninjected: yes"));
});
