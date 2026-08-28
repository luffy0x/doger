## Why

The fixed-token bootstrap requires the user to obtain the delivery-record ID and Cookie value from a successful manual refresh. The current `init` flow discards that success evidence, leaves Doger immediately due, and requires a second refresh before the schedule can be anchored. JD may reject that duplicate request until the server-side cooldown expires.

## What Changes

- Ask the user during interactive initialization whether the immediately preceding JD website refresh visibly succeeded.
- Require an explicit `ANCHOR` confirmation; any other response preserves the existing unanchored initialization behavior.
- When confirmed, use the local confirmation time as a conservative success anchor and derive the next eligibility exactly eight hours later.
- Return the redacted anchor timestamps from initialization so Codex can create the recurring task without another JD request.
- Keep initialization local-only and keep the Cookie value confined to the hidden prompt and native credential store.

## Capabilities

### Modified Capabilities

- `jd-token-configuration`: Initialization can record a user-confirmed manual refresh without contacting JD.
- `codex-scheduled-refresh`: A user-confirmed manual success can establish the first schedule anchor.

## Scope

### In scope

- Interactive `doger init --json`
- Explicit manual-success confirmation
- Conservative timestamping at confirmation time
- Redacted initialization/status reports
- Eight-hour due enforcement from the resulting anchor

### Out of scope

- Browser automation or network inspection
- Inferring whether the website refresh succeeded
- Accepting timestamps, tokens, or record IDs through command arguments
- Backdating the anchor to an unverified browser timestamp
- Automatically creating or mutating a Codex Scheduled Task

## Rollback

Revert the confirmation prompt and initialize all new installations with `createConfiguredState()`. Existing anchored runtime state remains valid because it uses the current schema and invariants.
