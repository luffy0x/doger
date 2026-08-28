<p align="center">
  <img src="assets/doger-logo.svg" width="160" alt="Doger logo">
</p>

<h1 align="center">doger</h1>

<p align="center">a jd-activity-keeper</p>

> [!IMPORTANT]
> Doger is under active development. The current repository contains the approved OpenSpec and the initial CLI foundation; it is not ready for live JD authentication or scheduled refreshes.

## What Doger Is

Doger is a macOS-first, local-only Codex automation for maintaining the activity timestamp of one JD application record. Codex owns the eight-hour schedule, deterministic TypeScript code performs routine refreshes through curl, and agent-browser is reserved for interactive bootstrap and explicit reauthentication.

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
runtime     keychain      curl
state       secrets       executor
                            |
                            v
                      allowlisted JD host
```

No Doger daemon, launchd job, hosted backend, database, telemetry, or OpenAI API key is required.

## Safety Boundaries

- One JD account and one application record in the MVP.
- Never refresh before the persisted eight-hour eligibility time.
- Never solve CAPTCHA or bypass signing, fingerprint, or risk-control checks.
- Never expose cookies, authorization values, CSRF values, request bodies, or raw responses to Codex, logs, fixtures, or Git.
- Authentication expiry stops unattended execution and requires explicit user reauthentication.

## Development

Requirements:

- macOS
- Node.js 24 or newer
- curl

Install and verify:

```bash
npm install
npm run check
```

The implementation plan is tracked in `openspec/changes/build-doger-jd-activity-keeper/`.

## Status

The OpenSpec proposal, design, requirements, and tasks are complete and strictly validated. Implementation proceeds in independently verified Conventional Commits.

## License

MIT
