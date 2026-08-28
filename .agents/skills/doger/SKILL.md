---
name: doger
description: Safely inspect or refresh one configured JD application with the deterministic Doger CLI. Use for Doger status checks, scheduled eight-hour refresh runs, explicit initialization or reauthentication, and local cleanup; do not use it to automate CAPTCHA or bypass JD risk controls.
---

# Doger

Run commands from the repository root. Treat CLI JSON as the only supported integration surface.

## Routine workflow

- For an unattended or scheduled run, execute exactly once:
  `npm run --silent doger -- refresh --json`
- For a read-only check, execute:
  `npm run --silent doger -- status --json`
- Report only fields returned by these JSON commands. Never inspect or print `config.json`, `recipe.json`, `credentials.enc`, Keychain entries, browser network output, or raw HTTP responses.
- Never reconstruct the request, invoke curl directly, or add retry loops. The CLI owns due checks, locking, bounded retries, request execution, and persistence.

Handle outcomes as follows:

- `SUCCESS`: report `completedAt` and `nextEligibleAt`.
- `NOT_DUE`: report `nextEligibleAt`; do not retry.
- `REAUTH_REQUIRED`: ask the user to explicitly request `doger reauth`; do not open a browser in an unattended run.
- `RATE_LIMITED`: report `retryAfterAt` when present; do not retry.
- `TRANSIENT_FAILURE`: report the outcome once; the CLI has already applied its bounded retry policy.
- `MANUAL_CHECK`: stop and explain that Doger refused an ambiguous or unsupported flow.

## Interactive commands

Run `npm run --silent doger -- init <application-url> --json`, `npm run --silent doger -- reauth --json`, or `npm run --silent doger -- uninstall --json` only after the user explicitly requests that action. Keep the command attached to an interactive terminal. The user must personally complete login, QR/OTP/CAPTCHA, confirm the one refresh action, and click the refresh control. Never read or transcribe those values.

Initialization and reauthentication may reject dynamic signing, browser-bound proof, ambiguous traffic, or risk-control challenges. Preserve that result; do not weaken the checks or attempt a bypass.
