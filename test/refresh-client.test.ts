import assert from "node:assert/strict";
import test from "node:test";

import type { CurlResponse } from "../src/http/classifier.ts";
import { executeRefresh } from "../src/http/refresh-client.ts";

test("starts exactly one curl attempt even for a transient failure", async () => {
  let attempts = 0;
  const response: CurlResponse = {
    exitCode: 7,
    statusCode: null,
    headers: {},
    body: "",
    responseTooLarge: false,
  };

  const result = await executeRefresh(123, "session=synthetic-token", {
    execute: async () => {
      attempts += 1;
      return response;
    },
  });

  assert.equal(result.classification.outcome, "TRANSIENT_FAILURE");
  assert.equal(result.attempts, 1);
  assert.equal(attempts, 1);
});
