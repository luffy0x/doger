import assert from "node:assert/strict";
import test from "node:test";

import { REFRESH_INTERVAL_MS } from "../src/core/config.ts";
import {
  createInitialState,
  dueDecision,
  parseRuntimeState,
  recordOutcome,
  recordSuccess,
} from "../src/core/state.ts";

test("first success becomes an immutable schedule anchor", () => {
  const first = new Date("2026-08-28T01:02:03.000Z");
  const second = new Date(first.getTime() + REFRESH_INTERVAL_MS);
  const initial = createInitialState();
  const afterFirst = recordSuccess(initial, first);
  const afterSecond = recordSuccess(afterFirst, second);

  assert.equal(afterSecond.firstSuccessAt, first.toISOString());
  assert.equal(afterSecond.lastSuccessAt, second.toISOString());
  assert.equal(afterSecond.nextEligibleAt, new Date(second.getTime() + REFRESH_INTERVAL_MS).toISOString());
});

test("does not become due before the exact eight-hour boundary", () => {
  const success = new Date("2026-08-28T01:02:03.000Z");
  const state = recordSuccess(createInitialState(), success);

  assert.equal(dueDecision(state, new Date(success.getTime() + REFRESH_INTERVAL_MS - 1)).due, false);
  assert.equal(dueDecision(state, new Date(success.getTime() + REFRESH_INTERVAL_MS)).due, true);
});

test("authentication and manual-check outcomes block scheduled execution", () => {
  const now = new Date("2026-08-28T01:02:03.000Z");
  const ready = recordSuccess(createInitialState(), new Date(now.getTime() - REFRESH_INTERVAL_MS));

  assert.equal(dueDecision(recordOutcome(ready, "REAUTH_REQUIRED", now), now).reason, "blocked");
  assert.equal(dueDecision(recordOutcome(ready, "MANUAL_CHECK", now), now).reason, "blocked");
});

test("rejects inconsistent persisted success timestamps", () => {
  const initial = createInitialState();

  assert.throws(() => parseRuntimeState({ ...initial, lastSuccessAt: "2026-08-28T01:02:03.000Z" }));
});

test("rejects persisted eligibility earlier than eight hours after success", () => {
  const state = recordSuccess(createInitialState(), new Date("2026-08-28T01:02:03.000Z"));

  assert.throws(() =>
    parseRuntimeState({
      ...state,
      nextEligibleAt: new Date(Date.parse(state.lastSuccessAt!) + REFRESH_INTERVAL_MS - 1).toISOString(),
    }),
  );
});
