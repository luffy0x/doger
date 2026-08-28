import type { CredentialBundle } from "../security/credential-store.ts";
import { classifyResponse, type Classification, type CurlResponse } from "./classifier.ts";
import { executeCurl, type CurlExecutorOptions } from "./curl-executor.ts";
import type { RequestRecipe } from "./recipe.ts";

export interface RefreshClientResult {
  readonly classification: Classification;
  readonly attempts: number;
}

export interface RefreshClientOptions {
  readonly execute?: (
    recipe: RequestRecipe,
    credentials: CredentialBundle,
    options: CurlExecutorOptions,
  ) => Promise<CurlResponse>;
  readonly curl?: CurlExecutorOptions;
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function executeRefresh(
  recipe: RequestRecipe,
  credentials: CredentialBundle,
  options: RefreshClientOptions = {},
): Promise<RefreshClientResult> {
  const execute = options.execute ?? executeCurl;
  const retryDelaysMs = options.retryDelaysMs ?? [2_000, 10_000];
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const response = await execute(recipe, credentials, options.curl ?? {});
    const classification = classifyResponse(response, recipe, now());

    if (classification.outcome !== "TRANSIENT_FAILURE" || attempt === retryDelaysMs.length) {
      return { classification, attempts: attempt + 1 };
    }

    await sleep(retryDelaysMs[attempt]!);
  }

  throw new Error("Unreachable refresh retry state.");
}
