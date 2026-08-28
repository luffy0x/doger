## Why

A user-verified curl request has established the narrow contract Doger actually needs: one long-lived authentication token, one delivery-record ID, one fixed official JD refresh request, and a structured response whose top-level and business-level `success` fields both indicate success. The existing agent-browser capture and generic request-recipe architecture solves a broader discovery problem that this product no longer has. It also caused the real Windows acceptance attempt to stop at ambiguous request selection before reaching the already-known curl path.

Doger should therefore become a fixed JD adapter. Initialization stores the user-supplied record ID and token locally, routine execution constructs one known curl request, and Codex continues to provide only scheduling and redacted reporting.

## What Changes

### 1. Replace browser capture with local token configuration

- `doger init` prompts locally for one delivery-record ID and one long-lived JD token.
- Token input is hidden and is never accepted through command arguments, environment variables, JSON output, or Codex context.
- Initialization writes local configuration only and does not contact JD.
- `doger reauth` becomes a local token-replacement command and does not open a browser or issue a refresh request.

### 2. Store the token directly in the operating-system credential store

- Store the JD token directly in macOS Keychain or Windows Credential Manager through the existing keyring dependency.
- Remove the generated encryption key, AES-encrypted credential file, captured cookies, captured headers, query payload, and request-recipe revisions.
- Keep the delivery-record ID in a protected per-user configuration file and omit it from command output.

### 3. Use one fixed JD refresh adapter

- Define the verified official HTTPS endpoint, HTTP method, `Cookie` authentication header, static non-sensitive headers, and JSON body shape in deterministic TypeScript.
- Insert only the configured delivery-record ID and stored token at runtime.
- Pass the token to curl through stdin by using `--config -`; never place it in argv.
- Execute one curl process per invocation and do not automatically retry.

### 4. Use a fixed response contract

- Return `SUCCESS` only when the response is valid JSON with both top-level `success === true` and `body.success === true`.
- Classify authentication expiry, rate limiting, transport failure, server failure, timeout, malformed JSON, and unknown responses conservatively.
- Preserve the process lock, first-success schedule anchor, and eight-hour due guard.

### 5. Remove generic browser and recipe infrastructure

- Remove the `agent-browser` runtime dependency and browser executable diagnostics.
- Remove browser session orchestration, network capture, candidate selection, request normalization, generic recipe parsing, and encrypted credential-file handling.
- Keep the repository skill, Codex scheduled task, redacted CLI results, local atomic state, lock, and safe uninstall flow.

## Capabilities

### New Capabilities

- `jd-token-configuration`: Local single-target configuration, hidden token input, direct operating-system credential storage, and explicit token replacement.

### Modified Capabilities

- `secure-refresh-execution`: Replace captured recipes and encrypted credential files with one fixed JD adapter and a directly stored keyring token.
- `codex-scheduled-refresh`: Anchor scheduling to the first explicit `refresh` success after local initialization rather than a browser-assisted bootstrap.
- `windows-local-runtime`: Remove agent-browser from the Windows runtime and store the token itself in Windows Credential Manager.

### Removed Capabilities

- `jd-session-bootstrap`: Interactive browser authentication, request capture, request normalization, and browser-based reauthentication are no longer part of Doger.

## Scope

### In scope

- Windows 10/11 and macOS
- One JD account, one long-lived token, and one delivery-record ID
- One fixed official JD refresh endpoint and request contract
- Local hidden token entry and operating-system credential storage
- One curl attempt per invocation
- Exact eight-hour minimum interval from confirmed success
- Codex scheduled execution with redacted JSON results

### Out of scope

- Automatic browser login, browser control, or network capture
- Discovering endpoints, request headers, bodies, or response contracts at runtime
- Token extraction, token renewal, CAPTCHA solving, or risk-control bypass
- Dynamic signatures or per-request browser-bound proof
- Multiple accounts or delivery records
- Linux or WSL
- A daemon, operating-system scheduler, cloud service, database, UI, or telemetry

## Impact

This is a breaking pre-1.0 architecture change affecting more than eight files. It removes the browser, capture, recipe, encryption-envelope, and credential-bundle modules and their tests; simplifies the CLI, lifecycle, refresh, diagnostics, paths, keyring, curl, classifier, and state modules; removes `agent-browser` from package dependencies; and updates the repository skill and documentation.

Local schema version 1 installations are not migrated because a captured credential bundle is not equivalent to the new explicit token contract. Users must remove the prior local installation and run the new `init`. The current Windows acceptance machine has no persisted Doger configuration or credentials, so this migration does not discard an initialized local target there.

## Security

The simplification does not permit tokens in CLI arguments, environment variables, logs, fixtures, repository files, model context, or raw error output. The token is stored only in the current user's operating-system credential store and is streamed to curl through stdin. The fixed endpoint must use HTTPS on an official JD host, redirects remain disabled, response capture remains bounded, and raw response bodies are not persisted or reported.

## Rollback

Before a live refresh, rollback is a normal Git revert plus deletion of any new local configuration and keyring token. After a live refresh, the repository and local state can still be reverted, but the refresh already accepted by JD cannot be undone. The Codex scheduled task must be paused or deleted before removing local state.
