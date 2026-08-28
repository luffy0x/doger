<p align="center">
  <img src="assets/doger-logo.svg" width="160" alt="Doger logo">
</p>

<h1 align="center">doger</h1>

<p align="center">a jd-activity-keeper</p>

> [!IMPORTANT]
> Doger is under active development. The fixed request path is covered by unit and local Mock HTTP tests on Windows. A live JD refresh and macOS hardware acceptance remain separate, explicitly authorized checks.

## What Doger Is

Doger is a local-only Windows and macOS Codex automation for maintaining the activity timestamp of one JD campus application record. Codex owns the eight-hour schedule; deterministic TypeScript code executes at most one fixed curl request per invocation.

```text
Codex scheduled task -> $doger -> Doger CLI
                                    |
                    process lock + eight-hour guard
                                    |
               config + OS credential store (Cookie token)
                                    |
             POST https://campus.jd.com/api/wx/resume/refresh
                                    |
                strict success && body.success classifier
                                    |
                     atomic redacted runtime state
```

There is no Doger daemon, platform scheduler, hosted backend, database, browser automation, network capture, or OpenAI API key.

## Safety Boundaries

- One JD account and one delivery record.
- A user-confirmed successful website refresh can establish a conservative anchor during `init`; otherwise the first explicit Doger refresh is immediately eligible.
- Every anchored success enforces an exact eight-hour minimum before another request can start.
- The fixed endpoint is HTTPS on `campus.jd.com`; redirects are not followed.
- Each invocation starts at most one curl request and never retries a POST automatically.
- The Token is stored directly in macOS Keychain or Windows Credential Manager and is passed to curl only through stdin.
- The Token, delivery-record ID, request body, request headers, and raw JD response are omitted from CLI reports.
- Doger never obtains credentials, opens a browser, solves CAPTCHA, or bypasses signing, device verification, or risk controls.

## Install

Requirements: Windows 10/11 x64 or ARM64, or macOS arm64/x64; Node.js 24 or newer; curl; and Codex Desktop. Linux and WSL are not supported runtimes.

```bash
git clone https://github.com/luffy0x/doger.git
cd doger
npm install
npm run check
npm run --silent doger -- doctor --json
```

## Obtain the two local values

Use only your own authenticated session on [JD Campus](https://campus.jd.com/). In the browser's developer tools, observe your own successful `POST /api/wx/resume/refresh` request and identify:

- the positive numeric `deliveryRecordId` from its JSON body;
- the complete Cookie request-header value used as the authentication Token.

Keep both values local. Never paste them into Codex, a chat, a shell command, an environment variable, a screenshot, an issue, a log, or Git. Doger does not read the browser profile or capture network traffic.

## Initialize

Run the interactive command without arguments:

```bash
npm run --silent doger -- init --json
```

Doger prompts for the delivery-record ID, accepts the Cookie Token through an echo-suppressed prompt, and then asks whether the immediately preceding website refresh visibly succeeded. Type the exact word `ANCHOR` only when it did. Doger records the confirmation time as a conservative anchor, so the next eligible run cannot occur earlier than eight hours after the real website refresh. Any other response keeps initialization unanchored and leaves the first explicit Doger refresh immediately eligible.

`init` only writes local configuration, the native credential-store entry, and optional local timing state. It never contacts JD. Its JSON report includes `scheduleAnchored`, `firstSuccessAt`, and `nextEligibleAt`, but never includes the Token or delivery-record ID.

Version 1 browser-capture installations are not migrated. Run confirmed `uninstall`, then initialize again.

An installation created by the earlier version 2 flow remains valid but unanchored. Either wait until JD permits the next refresh and run `refresh --json` once, or run confirmed `uninstall` and initialize again if you need to attest the prior successful website refresh through the new prompt.

## Operate

Inspect redacted state:

```bash
npm run --silent doger -- status --json
```

After explicit authorization, attempt one guarded refresh:

```bash
npm run --silent doger -- refresh --json
```

`SUCCESS` requires HTTP success plus JSON values `success === true` and `body.success === true`. On an unanchored installation, the first Doger success becomes the immutable schedule anchor. Other terminal outcomes are `NOT_DUE`, `REAUTH_REQUIRED`, `RATE_LIMITED`, `TRANSIENT_FAILURE`, and `MANUAL_CHECK`.

Replace an expired Token locally:

```bash
npm run --silent doger -- reauth --json
```

`reauth` only replaces the native credential-store entry. It does not open a browser or contact JD. It clears `REAUTH_REQUIRED`; it does not clear `MANUAL_CHECK`, because that state may indicate endpoint or response-contract drift.

## Schedule with Codex

Create the recurring task only after confirmed `init` or an explicit `refresh` leaves `status --json` with `scheduleAnchored: true`. Use `nextEligibleAt` as the first run and repeat every eight hours. See [docs/scheduled-task.md](docs/scheduled-task.md).

The computer must be on, Codex Desktop must be running, and this project must remain available. Early or duplicate invocations are stopped by the local lock and eligibility guard.

## Uninstall

Pause or delete the Codex Scheduled Task first, then run:

```bash
npm run --silent doger -- uninstall --json
```

Type `UNINSTALL` when prompted. Doger removes its known configuration, runtime state, legacy v1 files, and native Token entry while preserving unknown files.

## Troubleshooting

- `CONFIGURATION_FAILURE`: run `doctor --json`; schema v1 requires confirmed uninstall and reinitialization.
- `REAUTH_REQUIRED`: explicitly run `reauth --json`; do not pass the Token as an argument.
- `RATE_LIMITED`: wait until `retryAfterAt`; do not add a retry loop.
- `TRANSIENT_FAILURE`: let a later scheduled invocation try once again.
- `MANUAL_CHECK`: stop unattended execution and review whether the fixed endpoint or response contract changed without exposing raw data.

When reporting a problem, use synthetic values and a local Mock server. Never attach raw HAR, Cookies, request headers, identifiers, or production responses.

## Development status

The manual-refresh anchor fix is tracked in [`openspec/changes/confirm-manual-refresh-anchor/`](openspec/changes/confirm-manual-refresh-anchor/). Local verification is:

```bash
npm run check
npx --yes @fission-ai/openspec@1.11.0 validate --all --strict
npm pack --dry-run
```

Live JD execution, recurring-task observation, and macOS hardware validation are deliberately outside the automated test suite.

## License

MIT
