## Context

The user must perform a successful website refresh to discover the fixed request's delivery-record ID and Cookie value. Treating initialization as unrelated to that success creates a bootstrap gap: an immediate Doger refresh can be rejected by JD's cooldown, while no schedule anchor exists.

## Goals / Non-Goals

### Goals

- Let the user explicitly attest that the manual website refresh used for configuration visibly succeeded.
- Establish the first anchor without a duplicate remote request.
- Use a timestamp that cannot schedule earlier than the attested website refresh.
- Preserve an unanchored path when the user cannot make that attestation.
- Preserve all token-redaction and local-only initialization guarantees.

### Non-Goals

- Verifying the manual refresh through browser automation or a JD request.
- Accepting a user-supplied success timestamp.
- Migrating or rewriting existing unanchored installations automatically.
- Creating the Codex Scheduled Task inside the Doger CLI.

## Decisions

### 1. Make manual-success confirmation explicit and optional

After reading the delivery-record ID and hidden Cookie value, `init` asks the user to type the exact word `ANCHOR` only if the immediately preceding website refresh visibly succeeded. Any other input completes initialization without an anchor, preserving the safe fallback for tokens obtained by another authorized route.

### 2. Anchor at confirmation time

The CLI records its injected or system clock only after confirmation. Because confirmation occurs after the manual website success, using confirmation time is conservative: the next eligible refresh is never earlier than eight hours after the actual website refresh. Doger does not accept a timestamp from the user.

### 3. Distinguish a manual anchor from a Doger request attempt

The anchored state sets `firstSuccessAt` and `lastSuccessAt` to the confirmation time and `nextEligibleAt` to exactly eight hours later. It leaves `lastAttemptAt` and `lastOutcome` null because initialization did not issue a JD request. Existing state invariants already permit this representation, and the first later Doger success updates the attempt and outcome fields normally while preserving `firstSuccessAt`.

### 4. Return scheduling data without sensitive fields

Initialization returns `scheduleAnchored`, `firstSuccessAt`, and `nextEligibleAt`. It never returns the delivery-record ID, Cookie value, or manual confirmation input. Reauthentication returns the same timestamp fields from existing state for a stable lifecycle report shape.

## Initialization Sequence

```text
User                  Doger CLI              OS credential store       Local state
 |                        |                           |                     |
 | init                   |                           |                     |
 |----------------------->| prompt ID + hidden token |                     |
 | local values           |                           |                     |
 |----------------------->| prompt ANCHOR confirmation                     |
 | ANCHOR / other         |                           |                     |
 |----------------------->| persist token             |                     |
 |                        |-------------------------->|                     |
 |                        | persist config + anchored or unanchored state   |
 |                        |------------------------------------------------>|
 | redacted result        |                           |                     |
 |<-----------------------|                           |                     |
```

## Failure Handling

- Missing TTY, invalid record ID, invalid token, or storage failure retains the existing rollback behavior.
- A missing or incorrect confirmation does not fail initialization; it produces an unanchored ready state.
- No failure path sends a JD request or exposes the Cookie value.

## Verification

- State tests prove a manual anchor is conservative, immediately not due, and due at the exact eight-hour boundary.
- Lifecycle tests cover confirmed and unconfirmed initialization, injected time, persistence, rollback, and redaction.
- CLI tests prove the literal confirmation prompt is local, no secret-bearing argument is accepted, and reports contain only redacted timestamps.
- Existing refresh, platform, keyring, lock, classifier, and security tests remain green.
