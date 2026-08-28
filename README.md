<p align="center">
  <img src="assets/doger-logo.svg" width="160" alt="Doger logo">
</p>

<h1 align="center">doger</h1>

<p align="center">a jd-activity-keeper</p>

> [!IMPORTANT]
> Doger is under active development. The local workflow is covered by unit and Mock HTTP integration tests on Windows, but it has not yet been validated against a live JD account or on macOS hardware. Review the capture before relying on it.

## What Doger Is

Doger is a Windows-and-macOS, local-only Codex automation for maintaining the activity timestamp of one JD application record. Codex owns the eight-hour schedule, deterministic TypeScript code performs routine refreshes through curl, and agent-browser is reserved for interactive bootstrap and explicit reauthentication.

## Architecture

```text
Codex scheduled task
        |
        v
repository $doger skill
        |
        v
deterministic Doger CLI
   |           |           |
runtime    OS credential  curl
state         store       executor
                            |
                            v
                      allowlisted JD host
```

No Doger daemon, platform scheduler, hosted backend, database, telemetry, or OpenAI API key is required.

The browser is started only for an explicit `init` or `reauth` command and is closed after capture. Routine scheduled runs start the CLI and curl, then exit, so Doger does not keep Node.js, Chromium, CPU, or GPU resources resident between runs.

## Safety Boundaries

- One JD account and one application record in the MVP.
- Never refresh before the persisted eight-hour eligibility time.
- Never solve CAPTCHA or bypass signing, fingerprint, or risk-control checks.
- Never expose cookies, authorization values, CSRF values, request bodies, or raw responses to Codex, logs, fixtures, or Git.
- Authentication expiry stops unattended execution and requires explicit user reauthentication.
- Authentication comes from the user's normal JD website login session. Doger does not request a separate JD API credential and does not bypass login or verification controls.

## Install

Requirements: Windows 10/11 x64 or ARM64, or macOS arm64/x64; Node.js 24 or newer; curl; Codex Desktop; Chrome; and a JD account you are authorized to use. Windows ARM64 uses the published x64 agent-browser binary through Windows emulation. WSL is not a supported Doger runtime.

```bash
git clone https://github.com/luffy0x/doger.git
cd doger
npm install
npm run check
npm run --silent doger -- doctor --json
```

## Initialize

Initialization is interactive and performs one real refresh only after explicit confirmation:

```bash
npm run --silent doger -- init 'https://<official-jd-host>/<application-page>' --json
```

In the isolated browser window, complete login, QR/OTP/CAPTCHA, and navigation yourself. Return to the terminal when prompted, type `REFRESH` to authorize one capture, click the visible refresh control exactly once, confirm visible success, and return to the terminal. Doger then stores:

- non-sensitive request shape and response evidence in platform-protected per-user local files;
- cookies, authorization/CSRF values, query data, and request bodies in an AES-256-GCM encrypted credential file;
- the encryption key in macOS Keychain or Windows Credential Manager;
- the confirmed success time as the immutable schedule anchor.

If the request uses unsupported dynamic signing, browser-bound proof, ambiguous traffic, or risk control, initialization stops with `MANUAL_CHECK`.

## Operate

Inspect redacted state:

```bash
npm run --silent doger -- status --json
```

Attempt one guarded refresh:

```bash
npm run --silent doger -- refresh --json
```

The command does not contact JD before `nextEligibleAt`. It uses a process lock, sends credentials to curl through stdin, applies bounded retries, and emits one of `SUCCESS`, `NOT_DUE`, `REAUTH_REQUIRED`, `RATE_LIMITED`, `TRANSIENT_FAILURE`, or `MANUAL_CHECK`.

If authentication expires, request reauthentication explicitly:

```bash
npm run --silent doger -- reauth --json
```

Reauthentication opens a fresh allowlisted browser and requires the user to complete login and authorize one refresh again. Scheduled execution never opens a browser by itself.

## Schedule with Codex

Only create the recurring task after `init` returns `SUCCESS`. Use `nextEligibleAt` for its first run and repeat every eight hours. The repository Skill is `$doger`; the durable prompt and setup checklist are in [docs/scheduled-task.md](docs/scheduled-task.md).

The computer must be on, Codex Desktop must be running, and the local project must remain available when the task is due. Delayed or duplicate invocations are safe: the persisted eligibility guard permits at most one due refresh and never performs catch-up bursts.

## Uninstall

First pause or delete the Scheduled Task in Codex Desktop. Then remove Doger's known local files and operating-system credential entry:

```bash
npm run --silent doger -- uninstall --json
```

Type `UNINSTALL` when prompted. Unknown files in the data directory are preserved.

## Troubleshooting

- `CONFIGURATION_FAILURE`: run `doctor --json`; if configuration is partial, uninstall and initialize again.
- `REAUTH_REQUIRED`: explicitly run `reauth --json`; never paste a Cookie or Token into chat or a shell argument.
- `RATE_LIMITED`: wait for `retryAfterAt`; do not create an extra retry loop.
- `TRANSIENT_FAILURE`: let the next scheduled run handle it; the CLI already made its bounded retries.
- `MANUAL_CHECK`: inspect the visible workflow without printing browser captures or response bodies. Doger intentionally rejects ambiguous traffic and unsupported signing or risk-control behavior.

When reporting a problem, use synthetic values and a local Mock server. Never attach raw HAR, cookies, request headers, tokens, account identifiers, or production response bodies.

## Scope and responsibility

The MVP supports one Windows or macOS user, one JD account, and one application record, with an exact eight-hour minimum interval measured from confirmed success. Linux/WSL runtime support, multi-account operation, cloud execution, resident scheduling, CAPTCHA solving, fingerprint evasion, and risk-control bypass are out of scope.

Users are responsible for complying with JD's terms, policies, and account rules and for operating only accounts they are authorized to use.

## Development

Run the complete local verification suite:

```bash
npm install
npm run check
```

The original implementation plan is tracked in [`openspec/changes/build-doger-jd-activity-keeper/`](openspec/changes/build-doger-jd-activity-keeper/). Native Windows support is tracked in [`openspec/changes/add-windows-native-support/`](openspec/changes/add-windows-native-support/).

## Status

The OpenSpec proposal, design, and requirements are strictly validated. Windows type checking, tests, build, dependency probes, agent-browser resolution, and Windows Credential Manager round trips have been locally verified. Real JD initialization, live refresh, Scheduled Task creation, and macOS hardware validation require separate action-time confirmation and are not performed by the test suite.

## License

MIT
