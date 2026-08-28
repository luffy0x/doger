## Context

The product maintains the activity timestamp for one JD application record. The visible JD page exposes a “refresh activity” control, but the screenshot does not establish the underlying endpoint, authorization mechanism, response contract, or whether the request uses a replayable signature.

Codex Desktop scheduled tasks can run recurring work against a local project while the computer is on and the app is running. Repository skills provide durable instructions, while local scripts provide deterministic handling of authentication material and HTTP behavior. This split avoids both a resident process and direct exposure of credentials to the model.

## Goals / Non-Goals

**Goals:**

- Refresh one configured JD application no earlier than eight hours after the first confirmed successful execution and every eight hours thereafter
- Use curl for the routine path when the captured request is safely replayable
- Use agent-browser for initial capture and explicit reauthentication
- Keep all credentials local, encrypted, redacted, and outside Git
- Produce machine-readable outcomes that a Codex scheduled task can report safely
- Stop safely when the request contract or authentication state is uncertain

**Non-Goals:**

- Building a general recruiting-platform framework in the MVP
- Keeping Node.js, Chromium, or agent-browser running between schedules
- Running without Codex Desktop
- Circumventing CAPTCHA, risk controls, request signing, or service restrictions
- Guaranteeing execution while the machine is powered off or Codex Desktop is not running
- Supporting multiple accounts or application records

## Architecture

```text
Codex scheduled task (8-hour recurrence, anchored after bootstrap)
                              |
                              v
                 repository skill: $doger
                              |
                              v
                  deterministic doger CLI
                 /            |            \
                v             v             v
        runtime state   credential vault   curl executor
                |             |             |
                +-------------+-------------+
                              |
                              v
                    allowlisted JD endpoint

Authentication failure path:

scheduled run -> REAUTH_REQUIRED -> redacted Codex notification
                                         |
                              explicit user invocation
                                         |
                                         v
                                  agent-browser
                                         |
                           user handles login/CAPTCHA
                                         |
                                         v
                           update encrypted credentials
```

There is no cyclic runtime dependency: the scheduled task invokes the skill, the skill invokes the CLI, and the CLI returns a terminal outcome. Reauthentication is a separate, explicitly initiated workflow.

## Decisions

### 1. Codex owns scheduling; `doger` owns execution safety

A scheduled task in the existing Codex conversation invokes `$doger` every eight hours. Scheduling begins only after initial bootstrap returns a confirmed success, so the first success timestamp becomes the cadence anchor.

The scheduled prompt SHALL be durable and narrowly scoped: invoke the refresh command, report its redacted result, and request user attention only for terminal states. The model SHALL NOT construct curl commands, inspect credentials, or infer success from prose.

Because scheduled tasks are not a hard real-time service, a delayed run is acceptable. The CLI SHALL reject a refresh before the persisted eligibility timestamp, so replayed or duplicated scheduled runs cannot shorten the eight-hour interval.

### 2. Use a repository-scoped skill as the stable orchestration contract

The skill lives at `.agents/skills/doger/SKILL.md`, the documented repository location for Codex skills. It defines:

- when the scheduled task may run the refresh command
- which structured status fields are safe to report
- how to handle `REAUTH_REQUIRED`, `RATE_LIMITED`, and `MANUAL_CHECK`
- the prohibition on printing or directly inspecting secrets
- the explicit-user-action boundary for browser reauthentication

The skill is the public automation interface; implementation details remain in TypeScript.

### 3. Use TypeScript scripts rather than agent-generated shell commands

Node.js 24 is already available on the target machine. The project uses TypeScript compiled with `tsc` and exposes a `doger` CLI. Routine execution is deterministic and testable, while Codex only invokes a stable command and reads JSON output.

Runtime commands:

- `doger init <application-url>`: interactive bootstrap and first confirmed refresh
- `doger refresh --json`: guarded scheduled refresh
- `doger status --json`: redacted state inspection
- `doger reauth`: explicit interactive recovery
- `doger doctor --json`: dependency and configuration diagnostics
- `doger uninstall`: local cleanup instructions and safe task-removal handoff

### 4. Normalize captured traffic into a request recipe

During `init`, agent-browser records the network activity surrounding one user-confirmed press of the refresh control. The capture layer selects the relevant fetch/XHR request, then separates it into:

- public recipe data: method, approved host, path, non-sensitive header names, body shape, and response classifier
- secret material: cookies, authorization values, CSRF values, signed parameters, and identifiers classified as sensitive

Raw HAR data is processed in a restricted temporary location and removed after normalization. It is never included in fixtures or returned to Codex.

If the request includes a per-request signature, browser-bound proof, or a JavaScript challenge that cannot be reproduced without bypassing controls, the curl path is marked unsupported. The task SHALL stop with `MANUAL_CHECK`; it SHALL NOT implement signature forgery or stealth behavior.

### 5. Keep secrets outside model and process arguments

The credential payload is encrypted with AES-256-GCM. The data-encryption key is stored through the operating-system credential store using `@napi-rs/keyring`. Encrypted payloads and non-sensitive runtime state are stored under the user's local application-data directory with owner-only permissions.

The curl executor writes sensitive curl configuration to the child process over stdin. Secret values SHALL NOT appear in argv, environment diagnostics, stdout, stderr, error objects, telemetry, or persisted logs.

The agent-browser session is stored using its encrypted session-state support. The encryption key is supplied only to the child process environment and is never printed.

### 6. Use explicit, conservative result classification

Every refresh produces one of these outcomes:

| Outcome | Meaning | Action |
|---|---|---|
| `SUCCESS` | Response contains the captured positive success signal | Persist success and the next eligible timestamp |
| `NOT_DUE` | Server confirms the record is still inside its cooldown | Preserve or update eligibility only from authoritative server data |
| `REAUTH_REQUIRED` | 401/403, login redirect, login HTML, or captured auth-expiry marker | Stop and notify; do not open a browser unattended |
| `RATE_LIMITED` | 429 or captured rate-limit marker | Respect `Retry-After`; do not spin |
| `TRANSIENT_FAILURE` | DNS, connection, or eligible 5xx failure | Retry at most twice with bounded delay, then report failure |
| `MANUAL_CHECK` | Unknown response, request drift, ambiguous timeout, or unsupported signing | Stop without claiming success |

HTTP 200 alone is never sufficient evidence of success. An ambiguous timeout is not retried immediately because the remote action may already have succeeded.

### 7. Store a durable schedule guard

The runtime state contains:

- schema version
- lifecycle status
- first confirmed success timestamp
- last confirmed success timestamp
- next eligible timestamp
- last attempt timestamp and redacted outcome
- request recipe revision
- credential revision

Updates use write-to-temporary-file plus atomic rename. The first confirmed success timestamp never changes unless the user deletes all local state and initializes again.

### 8. Keep the MVP deliberately narrow

The MVP supports one macOS user, one JD account, and one application record. A single-target design keeps the authorization boundary clear and prevents accidental bulk activity. Cross-platform support and multiple targets require separate future OpenSpec changes.

## Scheduled Execution Sequence

```text
Codex Scheduler     $doger Skill      doger CLI       curl/JD
      |                   |               |              |
      |  eight-hour run   |               |              |
      |------------------>|               |              |
      |                   | refresh --json|              |
      |                   |-------------->|              |
      |                   |               | due guard    |
      |                   |               | request      |
      |                   |               |------------->|
      |                   |               |<-------------|
      |                   | redacted JSON |              |
      |                   |<--------------|              |
      |<------------------| report/notify |              |
```

## Reauthentication Sequence

```text
User            Codex/$doger       doger CLI       agent-browser
 |                    |                |                 |
 | invoke reauth      |                |                 |
 |------------------->| reauth         |                 |
 |                    |--------------->| open JD page    |
 |                    |                |---------------->|
 | complete login/CAPTCHA in browser   |                 |
 |------------------------------------------------------>|
 | confirm credential save             |                 |
 |------------------->|                | capture/encrypt |
 |                    |                |<----------------|
 |<-------------------| redacted result|                 |
```

## Local Data Layout

- Repository: source, tests, the `doger` skill, documentation, and non-secret mock fixtures
- Repository branding: `assets/doger-logo.svg`, reused by README and optional skill metadata without remote image dependencies
- User application-data directory: encrypted credential payload, encrypted agent-browser state, runtime state, and normalized request recipe
- Operating-system keychain: encryption key only
- Codex: scheduled-task definition and redacted run results only

No raw HAR, cookies, tokens, OTPs, passwords, or captured production responses are committed.

## Failure Handling

- If Codex Desktop or the computer is unavailable at the scheduled time, no attempt is made from a cloud service. The next invocation runs once and the due guard prevents duplicate requests.
- If curl is unavailable, `doctor` and scheduled execution return a configuration error without opening a browser.
- If agent-browser is unavailable, routine curl refresh remains usable; `init` and `reauth` report an actionable dependency error.
- If the external endpoint changes, the current recipe is retained for inspection but disabled until an explicit reauthentication or recapture succeeds.
- No retry loop is unbounded, and no failure path silently records success.

## Security and Policy Boundaries

- Domain allowlisting is mandatory and derived from the user-confirmed target and captured endpoint.
- The project does not solve CAPTCHA, spoof fingerprints, synthesize anti-bot signatures, or bypass service restrictions.
- The README SHALL state that users are responsible for complying with JD terms and using only their own account.
- The scheduled task receives only enough filesystem and network access to invoke the local CLI and reach the approved JD host.
- Full-access background execution is not a prerequisite.

## Test Strategy

- Unit tests use an injected clock to cover the eight-hour boundary without shortening the production interval.
- Response-classifier fixtures contain synthetic values only.
- Integration tests use a local mock HTTP server for success, cooldown, login HTML, 401, 403, 429, 5xx, malformed JSON, redirect, and timeout cases.
- Process tests assert that secrets are absent from argv, stdout, stderr, persisted state, and error messages.
- Scheduled-task tests verify duplicate invocation and delayed invocation behavior.
- Live acceptance requires one user-controlled bootstrap and one real curl refresh after the first eight-hour interval.

## Rollout Plan

1. Ship a manually invoked CLI with bootstrap, one-shot refresh, status, and security tests.
2. Add the repository skill and verify it can invoke the CLI without exposing secrets.
3. Create the eight-hour Codex scheduled task after a successful bootstrap and review its first two runs.

Each step remains usable if later work stops: step 1 is a manual local refresher, step 2 is an on-demand Codex workflow, and step 3 adds unattended scheduling.

## Risks / Trade-offs

**Risk: the request is not replayable with curl.**
This design assumes the refresh request can be reproduced from a finite credential and request recipe. If that assumption fails, `doger` stops with `MANUAL_CHECK`; a future change may define browser-per-run execution, but this change will not bypass signing or risk controls.

**Risk: scheduled execution is delayed.**
Codex scheduled tasks require the computer to be on and the desktop app running and do not provide a hard real-time SLA. The due guard prioritizes never refreshing early over exact execution time.

**Risk: local credential compromise.**
Encryption, keychain storage, owner-only permissions, redaction, and no telemetry reduce exposure. A compromised logged-in user account remains outside the project's threat model.

**Trade-off: Codex dependency.**
Using Codex removes the scheduler and daemon but means `doger` is not a standalone scheduler for users without Codex Desktop. This is intentional for the MVP.
