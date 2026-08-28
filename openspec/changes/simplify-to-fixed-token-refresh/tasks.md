## 1. Approved contract and migration boundary

- [x] 1.1 Record the verified fixed curl contract without storing real tokens, delivery-record IDs, or raw responses
- [x] 1.2 Define manual token provisioning, local-only initialization, direct keyring storage, and first-refresh scheduling semantics
- [x] 1.3 Add a schema-version-2 compatibility error that directs version 1 installations through confirmed uninstall and reinitialization

## 2. Token configuration

- [x] 2.1 Replace the encryption-key provider with a direct string token store backed by `@napi-rs/keyring`
- [x] 2.2 Make `doger init` prompt for and validate one delivery-record ID and one echo-suppressed token without contacting JD
- [x] 2.3 Make `doger reauth` replace the token locally without opening a browser or contacting JD
- [x] 2.4 Ensure `status`, errors, fixtures, and process output never contain the token or delivery-record ID

## 3. Fixed refresh execution

- [x] 3.1 Add one fixed JD refresh adapter with the verified HTTPS endpoint, method, authentication header, static headers, and `deliveryRecordId` JSON body
- [x] 3.2 Stream the token to `curl --disable --config -`, disable redirects, bound time and response size, and remove temporary files
- [x] 3.3 Replace captured response predicates with the fixed two-level boolean success contract
- [x] 3.4 Remove automatic retries so each CLI invocation starts at most one curl request

## 4. State and scheduling

- [x] 4.1 Reduce configuration and runtime schemas to the single target, timestamps, lifecycle status, and redacted outcome
- [x] 4.2 Treat the first explicit refresh as immediately due and persist its confirmed success as the immutable schedule anchor
- [x] 4.3 Preserve the process lock, exact eight-hour minimum, early-invocation `NOT_DUE`, and blocked authentication/manual-check states
- [x] 4.4 Keep the Codex task disabled until the first refresh returns confirmed `SUCCESS`

## 5. Remove discovery infrastructure

- [x] 5.1 Remove agent-browser, browser session orchestration, network capture, and associated diagnostics
- [x] 5.2 Remove generic request recipes, credential bundles, encryption envelopes, revisions, and associated paths
- [x] 5.3 Remove obsolete dependencies, source files, tests, and package contents without weakening remaining redaction checks

## 6. Verification

- [x] 6.1 Add unit coverage for hidden token input, keyring absence/replacement, delivery-record validation, state parsing, and due decisions
- [x] 6.2 Add Mock HTTP coverage for success, false success, authentication expiry, rate limiting, 5xx, redirect, malformed JSON, oversized response, connection failure, and timeout
- [x] 6.3 Prove through process tests that tokens are absent from argv, environment diagnostics, stdout, stderr, persisted JSON, temporary residue, and errors
- [x] 6.4 Run `npm run check`, strict OpenSpec validation, package dry-run inspection, Windows doctor, and a synthetic Windows keyring round trip
- [ ] 6.5 After explicit action-time authorization, complete one Windows real refresh, verify the immediate second call is `NOT_DUE`, and only then create the scheduled task
- [ ] 6.6 Observe the first two scheduled runs and complete separate macOS hardware acceptance before declaring the automation stable

## 7. Documentation and release

- [x] 7.1 Update README, SECURITY, `$doger`, scheduled-task instructions, help text, and examples for manual token provisioning and the fixed adapter
- [x] 7.2 Document that tokens must never be pasted into Codex, command arguments, environment variables, screenshots, issues, logs, or Git
- [x] 7.3 Document version 1 cleanup, token replacement, endpoint-drift handling, Windows/macOS support, and Linux/WSL exclusion
