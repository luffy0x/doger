import { DogerError } from "../core/errors.ts";
import { parseRequestRecipe, type JsonFieldPredicate, type RequestRecipe } from "../http/recipe.ts";
import { parseCredentialBundle, type CredentialBundle } from "../security/credential-store.ts";

const ignoredRequestHeaders = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "transfer-encoding",
]);
const dynamicProofName = /(?:^|[-_])(h5st|nonce|sign|signature|timestamp|ts)(?:$|[-_])/iu;
const safeSuccessStrings = new Set(["ok", "success", "true", "操作成功", "刷新成功", "更新成功"]);
const preferredSuccessFields = new Set(["code", "success", "status", "resultcode", "message", "msg"]);

interface CapturedRequestSummary {
  readonly method: "GET" | "POST";
  readonly requestId: string;
  readonly status: number;
  readonly url: string;
}

interface CapturedRequestDetail extends CapturedRequestSummary {
  readonly headers: Readonly<Record<string, string>>;
  readonly postData?: string;
  readonly responseBody: string;
}

interface CapturedCookie {
  readonly domain: string;
  readonly name: string;
  readonly path: string;
  readonly secure: boolean;
  readonly value: string;
}

export interface NormalizedCapture {
  readonly credentials: CredentialBundle;
  readonly recipe: RequestRecipe;
}

export interface CaptureBrowserSession {
  getCookies(): Promise<unknown>;
  getNetworkRequest(requestId: string): Promise<unknown>;
  listNetworkRequests(): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envelopeData(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser returned an invalid capture envelope.");
  }
  return payload.data;
}

function isOfficialJdUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "jd.com" || host.endsWith(".jd.com"));
  } catch {
    return false;
  }
}

function parseMethod(value: unknown): "GET" | "POST" {
  if (value !== "GET" && value !== "POST") {
    throw new DogerError("CAPTURE_UNSUPPORTED", "The captured refresh request uses an unsupported method.");
  }
  return value;
}

function parseSummary(value: unknown): CapturedRequestSummary | null {
  if (!isRecord(value) || typeof value.url !== "string" || !isOfficialJdUrl(value.url)) {
    return null;
  }
  if (
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9._:-]+$/.test(value.requestId) ||
    !Number.isInteger(value.status) ||
    (value.status as number) < 200 ||
    (value.status as number) >= 300 ||
    (value.method !== "GET" && value.method !== "POST")
  ) {
    return null;
  }

  return {
    method: value.method,
    requestId: value.requestId,
    status: value.status as number,
    url: value.url,
  };
}

export function selectRefreshRequestId(payload: unknown): string {
  const data = envelopeData(payload);
  if (!Array.isArray(data.requests)) {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser request capture is malformed.");
  }

  const candidates = data.requests.map(parseSummary).filter((item) => item !== null);
  if (candidates.length !== 1) {
    throw new DogerError(
      "CAPTURE_AMBIGUOUS",
      "Exactly one successful JD fetch/XHR request must follow the confirmed refresh action.",
    );
  }
  const candidate = candidates[0];
  if (candidate === undefined) {
    throw new DogerError("CAPTURE_AMBIGUOUS", "No refresh request was captured.");
  }
  return candidate.requestId;
}

function parseHeaders(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "Captured request headers are malformed.");
  }

  const headers: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new DogerError("BROWSER_OUTPUT_INVALID", "Captured request headers are malformed.");
    }
    headers[name.toLowerCase()] = item;
  }
  return headers;
}

function parseDetail(payload: unknown): CapturedRequestDetail {
  const data = envelopeData(payload);
  const summary = parseSummary(data);
  if (summary === null || typeof data.responseBody !== "string") {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "Captured request detail is malformed.");
  }
  if (data.postData !== undefined && typeof data.postData !== "string") {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "Captured request body is malformed.");
  }

  return {
    ...summary,
    headers: parseHeaders(data.headers),
    responseBody: data.responseBody,
    ...(data.postData === undefined ? {} : { postData: data.postData }),
  };
}

function parseCookies(payload: unknown): readonly CapturedCookie[] {
  const data = envelopeData(payload);
  if (!Array.isArray(data.cookies)) {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "Captured browser cookies are malformed.");
  }

  return data.cookies.map((cookie) => {
    if (
      !isRecord(cookie) ||
      typeof cookie.domain !== "string" ||
      typeof cookie.name !== "string" ||
      typeof cookie.path !== "string" ||
      typeof cookie.secure !== "boolean" ||
      typeof cookie.value !== "string"
    ) {
      throw new DogerError("BROWSER_OUTPUT_INVALID", "Captured browser cookies are malformed.");
    }
    if (/[;\r\n\0]/u.test(cookie.name) || /[;\r\n\0]/u.test(cookie.value)) {
      throw new DogerError("CAPTURE_UNSUPPORTED", "Captured cookies contain unsafe characters.");
    }
    return {
      domain: cookie.domain.toLowerCase(),
      name: cookie.name,
      path: cookie.path,
      secure: cookie.secure,
      value: cookie.value,
    };
  });
}

function domainMatches(host: string, cookieDomain: string): boolean {
  const domain = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  return host === domain || host.endsWith(`.${domain}`);
}

function cookieHeader(cookies: readonly CapturedCookie[], url: URL): string | undefined {
  const matching = cookies
    .filter(
      (cookie) =>
        domainMatches(url.hostname.toLowerCase(), cookie.domain) &&
        url.pathname.startsWith(cookie.path) &&
        (!cookie.secure || url.protocol === "https:"),
    )
    .sort((left, right) => right.path.length - left.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`);

  return matching.length === 0 ? undefined : matching.join("; ");
}

function assertStaticEndpointPath(pathname: string): void {
  for (const rawSegment of pathname.split("/").filter(Boolean)) {
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      throw new DogerError("CAPTURE_UNSUPPORTED", "The captured endpoint path is not safely replayable.");
    }

    if (
      /^\d{6,}$/u.test(segment) ||
      /^[0-9a-f]{16,}$/iu.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment) ||
      (segment.length >= 24 && /^[A-Za-z0-9_-]+$/u.test(segment))
    ) {
      throw new DogerError("CAPTURE_UNSUPPORTED", "The captured endpoint contains a sensitive dynamic path.");
    }
  }
}

function assertNoDynamicProof(url: URL, headers: Readonly<Record<string, string>>, body: string | undefined): void {
  for (const key of url.searchParams.keys()) {
    if (dynamicProofName.test(key)) {
      throw new DogerError("CAPTURE_UNSUPPORTED", "The captured request requires an unsupported dynamic proof.");
    }
  }
  for (const key of Object.keys(headers)) {
    if (dynamicProofName.test(key)) {
      throw new DogerError("CAPTURE_UNSUPPORTED", "The captured request requires an unsupported dynamic proof.");
    }
  }
  if (body !== undefined) {
    try {
      const parsed = JSON.parse(body) as unknown;
      const stack: unknown[] = [parsed];
      while (stack.length > 0) {
        const current = stack.pop();
        if (Array.isArray(current)) {
          stack.push(...current);
          continue;
        }
        if (!isRecord(current)) {
          continue;
        }
        for (const [key, value] of Object.entries(current)) {
          if (dynamicProofName.test(key)) {
            throw new DogerError("CAPTURE_UNSUPPORTED", "The captured request requires an unsupported dynamic proof.");
          }
          if (isRecord(value)) {
            stack.push(value);
          }
        }
      }
    } catch (error) {
      if (error instanceof DogerError) {
        throw error;
      }
    }

    if (headers["content-type"]?.toLowerCase().includes("application/x-www-form-urlencoded")) {
      for (const key of new URLSearchParams(body).keys()) {
        if (dynamicProofName.test(key)) {
          throw new DogerError("CAPTURE_UNSUPPORTED", "The captured request requires an unsupported dynamic proof.");
        }
      }
    }
  }
}

function safeJsonScalar(field: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return field === "success" && value;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && Math.abs(value) <= 10_000;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    safeSuccessStrings.has(normalized) ||
    ((field === "code" || field === "status" || field === "resultcode") && /^-?\d{1,5}$/u.test(normalized))
  );
}

function successPredicate(responseBody: string): JsonFieldPredicate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody) as unknown;
  } catch {
    throw new DogerError("CAPTURE_UNSUPPORTED", "The success response has no safe structured evidence.");
  }

  const pending: Array<{ readonly path: readonly string[]; readonly value: unknown }> = [{ path: [], value: parsed }];
  while (pending.length > 0) {
    const item = pending.shift();
    if (item === undefined || item.path.length >= 4 || !isRecord(item.value)) {
      continue;
    }
    for (const [field, value] of Object.entries(item.value)) {
      const path = [...item.path, field];
      if (preferredSuccessFields.has(field.toLowerCase()) && safeJsonScalar(field.toLowerCase(), value)) {
        return { path, equals: value as string | number | boolean };
      }
      if (isRecord(value)) {
        pending.push({ path, value });
      }
    }
  }

  throw new DogerError("CAPTURE_UNSUPPORTED", "The success response has no safe structured evidence.");
}

function replayHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (ignoredRequestHeaders.has(name) || name.startsWith("sec-")) {
      continue;
    }
    if (/[\r\n\0]/u.test(value)) {
      throw new DogerError("CAPTURE_UNSUPPORTED", "Captured request headers contain unsafe characters.");
    }
    result[name] = value;
  }
  return result;
}

export function normalizeCapturedRequest(
  detailPayload: unknown,
  cookiePayload: unknown,
  capturedAt: Date,
): NormalizedCapture {
  const detail = parseDetail(detailPayload);
  const url = new URL(detail.url);
  assertStaticEndpointPath(url.pathname);
  assertNoDynamicProof(url, detail.headers, detail.postData);

  const headers = replayHeaders(detail.headers);
  const capturedCookieHeader = cookieHeader(parseCookies(cookiePayload), url);
  const responseEvidence = successPredicate(detail.responseBody);
  const endpoint = new URL(url.toString());
  endpoint.search = "";
  endpoint.hash = "";

  const recipe = parseRequestRecipe({
    schemaVersion: 1,
    endpoint: endpoint.toString(),
    method: parseMethod(detail.method),
    allowedHosts: [url.hostname.toLowerCase()],
    headerNames: Object.keys(headers).sort(),
    includeCookie: capturedCookieHeader !== undefined,
    includeQuery: url.search !== "",
    includeBody: detail.method === "POST" && detail.postData !== undefined,
    response: {
      success: { statusCodes: [detail.status], bodyIncludesAny: [], jsonEqualsAny: [responseEvidence] },
      authBodyIncludesAny: ["login", "未登录", "请登录"],
      authLocationIncludesAny: ["/login", "passport.jd.com"],
      rateLimitBodyIncludesAny: ["too many requests", "rate limit", "操作频繁", "请求频繁"],
    },
  });
  const credentials = parseCredentialBundle({
    version: 1,
    capturedAt: capturedAt.toISOString(),
    headers,
    ...(capturedCookieHeader === undefined ? {} : { cookieHeader: capturedCookieHeader }),
    ...(url.search === "" ? {} : { query: url.search.slice(1) }),
    ...(detail.method !== "POST" || detail.postData === undefined ? {} : { requestBody: detail.postData }),
  });

  return { recipe, credentials };
}

export async function captureRefreshRequest(
  session: CaptureBrowserSession,
  capturedAt = new Date(),
): Promise<NormalizedCapture> {
  const requestId = selectRefreshRequestId(await session.listNetworkRequests());
  const [detail, cookies] = await Promise.all([session.getNetworkRequest(requestId), session.getCookies()]);
  if (parseDetail(detail).requestId !== requestId) {
    throw new DogerError("BROWSER_OUTPUT_INVALID", "agent-browser returned mismatched request detail.");
  }
  return normalizeCapturedRequest(detail, cookies, capturedAt);
}
