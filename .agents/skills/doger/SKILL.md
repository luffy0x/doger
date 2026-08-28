---
name: doger
description: Safely inspect or refresh one configured JD application with the deterministic Doger CLI. Use for Doger status checks, scheduled eight-hour refresh runs, explicit initialization or token replacement, and local cleanup; do not use it to obtain credentials, automate CAPTCHA, or bypass JD risk controls.
---

# Doger

Run commands from the repository root. Treat CLI JSON as the only supported integration surface.

## Routine workflow

- For an unattended or scheduled run, execute exactly once: `npm run --silent doger -- refresh --json`.
- For a read-only check, execute: `npm run --silent doger -- status --json`.
- Report only fields returned by those JSON commands. Never inspect or print `config.json`, native credential-store entries, temporary files, browser state, or raw HTTP responses.
- Never reconstruct the request, invoke curl directly, or add retry loops. The CLI owns due checks, locking, its single fixed request, classification, and persistence.

Handle outcomes as follows:

- `SUCCESS`: report `completedAt` and `nextEligibleAt`.
- `NOT_DUE`: report `nextEligibleAt`; do not retry.
- `REAUTH_REQUIRED`: ask the user to explicitly request `doger reauth`; never request or accept the Token in chat.
- `RATE_LIMITED`: report `retryAfterAt` when present; do not retry.
- `TRANSIENT_FAILURE`: report the outcome once; a later scheduled run may try again.
- `MANUAL_CHECK`: stop unattended execution and explain that Doger rejected an ambiguous or changed response contract.

For a successful `init`, report `scheduleAnchored`, `firstSuccessAt`, and `nextEligibleAt`. Create or enable a recurring task only when `scheduleAnchored` is `true`.

## Interactive commands

Run `npm run --silent doger -- init --json`, `npm run --silent doger -- reauth --json`, or `npm run --silent doger -- uninstall --json` only after the user explicitly requests that action and while an interactive terminal is attached.

For `init`, the user personally enters the delivery-record ID and complete Cookie request-header value at local prompts. If those values came from an immediately preceding visibly successful website refresh, the user may type the exact non-secret confirmation `ANCHOR`; any other response keeps initialization unanchored. For `reauth`, the user enters only the replacement Cookie value. The Token prompt is hidden. Never ask the user to paste either sensitive value into Codex, a command argument, an environment variable, a screenshot, an issue, a log, or Git.

`init` and `reauth` are local-only and do not contact JD. Confirmed initialization uses the later local confirmation time as a conservative anchor; it does not claim that Doger sent a request. A live `refresh` is a remote account action and requires explicit action-time user authorization unless it is the already-authorized recurring Scheduled Task. Never automate login, browser inspection, OTP, CAPTCHA, token extraction, dynamic signing, or risk-control bypass.
