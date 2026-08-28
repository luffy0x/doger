import assert from "node:assert/strict";
import test from "node:test";

import { REFRESH_INTERVAL_MS } from "../src/core/config.ts";
import {
  createConfiguredState,
  dueDecision,
  parseRuntimeState,
  recordOutcome,
  recordSuccess,
  recordTokenReplacement,
} from "../src/core/state.ts";

test("a configured target is immediately due before its first success", () => {
  const state = createConfiguredState();
  assert.deepEqual(dueDecision(state, new Date("2026-08-28T00:00:00.000Z")), {
    due: true,
    nextEligibleAt: null,
    reason: "due",
  });
});

test("first success is immutable and the exact eight-hour boundary is due", () => {
  const first = new Date("2026-08-28T01:02:03.000Z");
  const second = new Date(first.getTime() + REFRESH_INTERVAL_MS);
  const afterFirst = recordSuccess(createConfiguredState(), first);
  const afterSecond = recordSuccess(afterFirst, second);

  assert.equal(afterSecond.firstSuccessAt, first.toISOString());
  assert.equal(afterSecond.lastSuccessAt, second.toISOString());
  assert.equal(dueDecision(afterFirst, new Date(second.getTime() - 1)).due, false);
  assert.equal(dueDecision(afterFirst, second).due, true);
});

test("authentication and manual-check outcomes block unattended execution", () => {
  const now = new Date("2026-08-28T01:02:03.000Z");
  const ready = createConfiguredState();

  assert.equal(dueDecision(recordOutcome(ready, "REAUTH_REQUIRED", now), now).reason, "blocked");
  assert.equal(dueDecision(recordOutcome(ready, "MANUAL_CHECK", now), now).reason, "blocked");
});

test("a first-attempt rate limit may set eligibility before a success anchor", () => {
  const now = new Date("2026-08-28T01:02:03.000Z");
  const retryAfterAt = new Date(now.getTime() + 120_000).toISOString();
  const state = recordOutcome(createConfiguredState(), "RATE_LIMITED", now, { retryAfterAt });

  assert.equal(parseRuntimeState(state).nextEligibleAt, retryAfterAt);
  assert.equal(dueDecision(state, now).reason, "not_due");
});

test("an expired pre-anchor rate-limit gate is cleared after a later non-success outcome", () => {
  const first = new Date("2026-08-28T01:00:00.000Z");
  const retryAfterAt = new Date(first.getTime() + 1_000).toISOString();
  const rateLimited = recordOutcome(createConfiguredState(), "RATE_LIMITED", first, { retryAfterAt });
  const transient = recordOutcome(rateLimited, "TRANSIENT_FAILURE", new Date(Date.parse(retryAfterAt) + 1));
  assert.equal(transient.nextEligibleAt, null);
  assert.deepEqual(parseRuntimeState(transient), transient);
});

test("token replacement clears only reauthentication blocking", () => {
  const now = new Date("2026-08-28T01:02:03.000Z");
  const ready = createConfiguredState();

  assert.equal(recordTokenReplacement(recordOutcome(ready, "REAUTH_REQUIRED", now)).status, "ready");
  assert.equal(recordTokenReplacement(recordOutcome(ready, "MANUAL_CHECK", now)).status, "manual_check");
});

test("rejects legacy and inconsistent persisted runtime state", () => {
  const state = recordSuccess(createConfiguredState(), new Date("2026-08-28T01:02:03.000Z"));
  assert.throws(() => parseRuntimeState({ ...state, schemaVersion: 1 }));
  assert.throws(() => parseRuntimeState({ ...state, recipeRevision: 1 }));
  assert.throws(() => parseRuntimeState({ ...state, firstSuccessAt: null }));
  assert.throws(() =>
    parseRuntimeState({
      ...state,
      nextEligibleAt: new Date(Date.parse(state.lastSuccessAt!) + REFRESH_INTERVAL_MS - 1).toISOString(),
    }),
  );
});
