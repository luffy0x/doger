## Context

The verified JD request is narrower than the original discovery-oriented design. A successful curl invocation demonstrates that the refresh can be represented by a fixed official endpoint, a long-lived user token, a delivery-record ID in a JSON body, and a structured success response. The token is expected to remain reusable across the eight-hour interval; if it expires, the user can replace it explicitly.

The previous design used agent-browser to discover a request, split the capture into a generic recipe and encrypted credential bundle, and infer a response predicate. That flexibility is unnecessary for a single known JD operation and creates extra failure modes around ambiguous capture, browser binaries, credential-envelope persistence, and recipe drift.

## Goals / Non-Goals

### Goals

- Make the runtime path equivalent to loading one token and record ID, issuing one fixed curl request, and recording a strict outcome.
- Keep tokens out of process arguments, shell history, logs, files, model context, and Git.
- Preserve the exact eight-hour guard, concurrency lock, atomic state updates, and first-success schedule anchor.
- Keep Windows and macOS behavior equivalent through the existing keyring abstraction.
- Reduce dependencies, modules, state fields, and failure modes.

### Non-Goals

- Automating how the user obtains a JD token.
- Supporting unknown JD endpoints or multiple request shapes.
- Recovering or converting an existing captured credential bundle.
- Refreshing multiple accounts or delivery records.
- Bypassing token expiry, dynamic signing, CAPTCHA, device verification, or platform risk controls.

## Architecture

```text
Interactive configuration:

User obtains authorized token in browser
                |
                v
        doger init / reauth
          |             |
          v             v
 protected config   OS credential store
 (deliveryRecordId)      (token)

Scheduled execution:

Codex scheduled task -> $doger skill -> doger refresh --json
                                              |
                                    process lock + due guard
                                              |
                              config + OS credential store
                                              |
                                     fixed JD curl adapter
                                              |
                                   approved HTTPS JD endpoint
                                              |
                                    fixed result classifier
                                              |
                                 atomic state + redacted JSON
```

The dependency flow is one-way. Codex invokes the CLI, the CLI invokes deterministic services, the fixed adapter invokes curl, and the CLI returns a terminal redacted result. No component calls back into Codex, and no browser process participates.

## Decisions

### 1. Separate local configuration from the first remote refresh

`doger init` is a local-only operation. It validates a positive decimal delivery-record ID, accepts the token through an echo-suppressed terminal prompt, stores both values in their designated local stores, and creates an unanchored runtime state. It does not contact JD.

Initialization writes the Doger ownership marker before any credential or configuration state. If initialization is interrupted, confirmed uninstall may therefore remove only files proven to belong to Doger. Without a valid ownership marker, uninstall may clean Doger's fixed native credential entries but must preserve same-named filesystem entries.

The first explicit `doger refresh` is immediately eligible because no success anchor exists. A confirmed success writes the immutable `firstSuccessAt`, `lastSuccessAt`, and `nextEligibleAt` timestamps. The Codex scheduled task is created only after that success.

### 2. Store the token directly in the native credential store

The token is the only authentication secret required by the fixed contract, so an encrypted credential file and a separate encryption key add no useful security boundary. `@napi-rs/keyring` stores the token itself under the `doger` service in macOS Keychain or Windows Credential Manager.

The delivery-record ID is not an authentication credential, but it is user-specific. It is stored in the protected per-user configuration file and omitted from stdout, stderr, status reports, fixtures, and Codex messages.

### 3. Compile the JD request contract into one adapter

The adapter owns the verified official HTTPS endpoint, POST method, `Cookie` authentication header, required non-sensitive headers, and JSON body field `deliveryRecordId`. The user-provided Token is the complete Cookie request-header value. The endpoint and eight-hour interval are implementation constants rather than user-editable configuration.

The adapter accepts only a parsed positive delivery-record ID and token. It supplies the complete curl configuration through stdin with `curl --disable --config -`, disables redirects, applies finite connection and total timeouts, bounds response headers and body, and deletes temporary response files after classification.

### 4. Use a fixed, conservative classifier

A response is `SUCCESS` only when all of the following are true:

- curl completed without a transport error;
- the HTTP response is successful;
- the response body is valid JSON;
- top-level `success` is exactly `true`;
- `body` is an object whose `success` field is exactly `true`.

The response notice text is neither required nor returned. HTTP 401 or 403 yields `REAUTH_REQUIRED`; HTTP 429 yields `RATE_LIMITED`; connection establishment failures and 5xx responses yield `TRANSIENT_FAILURE`; timeouts, malformed JSON, unexpected redirects, response-size violations, and every other response yield `MANUAL_CHECK`. HTTP 200 by itself is never success.

### 5. Execute exactly one curl attempt per invocation

Automatic retries are removed. This makes every CLI invocation correspond to at most one remote mutation and eliminates the need to prove whether a failed POST reached JD before retrying it. A later Codex schedule or explicit user action may invoke the CLI again, but the due guard and blocking outcomes remain authoritative.

### 6. Keep a minimal durable state machine

The protected config schema contains only `schemaVersion` and `deliveryRecordId`. The runtime state keeps lifecycle status, first and last confirmed success timestamps, next eligibility, last attempt timestamp, and last redacted outcome. Recipe and credential revisions are removed.

The process lock remains mandatory. An invocation before `nextEligibleAt` returns `NOT_DUE` without reading the token or starting curl. `REAUTH_REQUIRED` blocks unattended execution until explicit `reauth`. `MANUAL_CHECK` blocks unattended execution because the remote result or request contract is uncertain.

### 7. Keep token replacement local and explicit

`doger reauth` is renamed in behavior, not necessarily in command spelling: it prompts for a replacement token with terminal echo disabled and updates the existing keyring entry. It does not open a browser and does not contact JD. After token replacement, the next eligible explicit or scheduled refresh validates the token through the fixed endpoint.

### 8. Reject schema version 1 instead of migrating secrets

This is a pre-1.0 breaking change. A version 1 installation contains a browser-derived credential bundle rather than a user-asserted long-lived token, so automatic conversion would silently assume the wrong authentication contract. Doger reports an actionable configuration error and requires confirmed uninstall followed by the new `init`.

## Command Contract

| Command | Network effect | Secret handling | Result |
|---|---|---|---|
| `doger init` | None | Hidden token prompt; direct keyring write | Configured but not yet schedule-anchored |
| `doger refresh --json` | At most one fixed JD request when due | Token loaded from keyring and sent through curl stdin | Redacted terminal outcome |
| `doger reauth` | None | Hidden replacement-token prompt | Token replaced; no claimed refresh success |
| `doger status --json` | None | Does not load or return the token | Redacted state and timestamps |
| `doger doctor --json` | Local dependency probes only | Verifies keyring availability without returning entries | Redacted health report |
| `doger uninstall` | None after the Codex task is removed | Deletes the Doger keyring token | Removal report for known local state |

## Scheduled Refresh Sequence

```text
Codex Scheduler     $doger Skill      Doger CLI       Keyring        curl/JD
      |                   |               |              |              |
      | eight-hour run    |               |              |              |
      |------------------>| refresh --json|              |              |
      |                   |-------------->| lock + due   |              |
      |                   |               | read token   |              |
      |                   |               |------------->|              |
      |                   |               |<-------------|              |
      |                   |               | one request through stdin   |
      |                   |               |---------------------------->|
      |                   |               |<----------------------------|
      |                   |               | classify + atomic state      |
      |                   | redacted JSON |              |              |
      |                   |<--------------|              |              |
      |<------------------| report/notify |              |              |
```

## Token Replacement Sequence

```text
User                   Doger CLI                  OS credential store
 |                         |                               |
 | run reauth              |                               |
 |------------------------>| hidden token prompt           |
 | provide token locally   |                               |
 |------------------------>| replace entry                 |
 |                         |------------------------------>|
 |<------------------------| redacted local result         |
```

## Verification

- Unit tests validate delivery-record IDs, state transitions, due boundaries, and fixed response classification.
- Mock HTTP tests cover confirmed success, false success, 401, 403, 429, 5xx, malformed JSON, oversized responses, redirect, connection failure, and timeout.
- Process tests prove the token is absent from argv, environment diagnostics, stdout, stderr, persisted JSON, temporary-file residue, and thrown errors.
- Keyring tests perform synthetic set/get/delete round trips on Windows and macOS without exposing values.
- CLI tests prove `init` and `reauth` require an interactive hidden prompt, perform no network call, and never echo the token.
- Manual Windows acceptance configures a synthetic token first, then uses the authorized real token for one explicitly requested refresh and verifies the eight-hour guard.
- macOS hardware acceptance remains a separate release gate.

## Risks / Trade-offs

**Token lifetime.** The design assumes the verified token remains reusable for at least the scheduling interval. If JD expires it, the fixed request returns `REAUTH_REQUIRED` and the user replaces it locally. If JD changes to per-request signatures, unattended curl refresh is no longer supported.

**Manual token acquisition.** Removing browser automation makes Doger smaller and more deterministic, but the user must obtain the token from an authenticated browser session without pasting it into Codex. Documentation must show a local-only workflow and must never request screenshots or command output containing the token.

**Fixed endpoint drift.** A JD endpoint or response-schema change requires a reviewed code and specification update. Doger intentionally returns `MANUAL_CHECK` rather than rediscovering traffic automatically.

**No automatic retry.** A transient failure may defer refresh until a later invocation. This is preferred over risking a duplicate remote mutation after an uncertain POST.
