import { classifyResponse, type Classification, type CurlResponse } from "./classifier.ts";
import { executeCurl, type CurlExecutorOptions } from "./curl-executor.ts";

export interface RefreshClientResult {
  readonly classification: Classification;
  readonly attempts: 1;
}

export interface RefreshClientOptions {
  readonly execute?: (
    deliveryRecordId: number,
    token: string,
    options: CurlExecutorOptions,
  ) => Promise<CurlResponse>;
  readonly curl?: CurlExecutorOptions;
  readonly now?: () => Date;
}

export async function executeRefresh(
  deliveryRecordId: number,
  token: string,
  options: RefreshClientOptions = {},
): Promise<RefreshClientResult> {
  const response = await (options.execute ?? executeCurl)(deliveryRecordId, token, options.curl ?? {});
  return { classification: classifyResponse(response, (options.now ?? (() => new Date()))()), attempts: 1 };
}
