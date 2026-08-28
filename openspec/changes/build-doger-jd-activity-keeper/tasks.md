## 1. Project Foundation

- [x] 1.1 Initialize the npm package as `doger` with the description `doger, a jd-activity-keeper`
- [x] 1.2 Configure Node.js 24, strict TypeScript compilation, package scripts, and a CLI binary named `doger`
- [x] 1.3 Add `.gitignore` rules that exclude local state, encrypted credentials, browser sessions, HAR files, logs, and temporary captures
- [x] 1.4 Add MIT `LICENSE`, `README.md`, and `SECURITY.md`
- [x] 1.5 Pin `agent-browser` and `@napi-rs/keyring` in the package lockfile
- [ ] 1.6 Display `assets/doger-logo.svg` in README and reuse it for Doger skill metadata where supported

## 2. Configuration and Runtime State

- [x] 2.1 Define and validate the single-account, single-application configuration schema
- [x] 2.2 Implement the persisted runtime state with first success, last success, next eligible time, last attempt, outcome, recipe revision, and credential revision
- [x] 2.3 Implement owner-only file permissions and atomic state replacement
- [x] 2.4 Implement an injected clock for deterministic eight-hour boundary tests
- [x] 2.5 Reject duplicate or early refresh execution without making a network request

## 3. Credential Storage

- [x] 3.1 Implement AES-256-GCM encryption for the credential payload
- [x] 3.2 Store and retrieve the encryption key through `@napi-rs/keyring`
- [ ] 3.3 Ensure credentials never enter CLI arguments, JSON status output, logs, error messages, or test snapshots
- [ ] 3.4 Add redaction and secret-leak regression tests
- [x] 3.5 Implement explicit local credential deletion for uninstall and reinitialization

## 4. Curl Refresh Executor

- [x] 4.1 Define the normalized request-recipe schema with an explicit JD host allowlist
- [x] 4.2 Execute curl with sensitive configuration passed through stdin
- [x] 4.3 Apply bounded connection, request, response-size, and redirect behavior
- [x] 4.4 Implement `SUCCESS`, `NOT_DUE`, `REAUTH_REQUIRED`, `RATE_LIMITED`, `TRANSIENT_FAILURE`, and `MANUAL_CHECK` classification
- [x] 4.5 Retry eligible transient failures at most twice and never immediately retry ambiguous timeouts
- [x] 4.6 Add mock-server integration tests for every response class

## 5. Agent-Browser Bootstrap and Recovery

- [ ] 5.1 Implement `doger init <application-url>` using a fresh, isolated, allowlisted agent-browser session
- [ ] 5.2 Require user handling for login, OTP, CAPTCHA, and the initial refresh confirmation
- [ ] 5.3 Capture and normalize the refresh request without persisting raw HAR content
- [ ] 5.4 Store the first confirmed success as the immutable schedule anchor
- [ ] 5.5 Implement `doger reauth` as an explicitly invoked interactive workflow
- [ ] 5.6 Ensure unattended execution returns `REAUTH_REQUIRED` without opening a browser
- [ ] 5.7 Reject unsupported dynamic signing, browser-bound proof, and risk-control challenges with `MANUAL_CHECK`

## 6. CLI and Structured Output

- [ ] 6.1 Implement `init`, `refresh`, `status`, `reauth`, `doctor`, and `uninstall` commands
- [ ] 6.2 Define stable redacted JSON output for Codex consumption
- [ ] 6.3 Define distinct exit codes for success, not due, reauthentication, rate limiting, transient failure, manual check, and configuration failure
- [ ] 6.4 Add command-level tests for invalid configuration, missing dependencies, duplicate invocation, and all terminal outcomes

## 7. Codex Skill

- [ ] 7.1 Add `.agents/skills/doger/SKILL.md` with precise trigger conditions and safe command usage
- [ ] 7.2 Instruct the skill to invoke deterministic commands rather than reconstructing requests itself
- [ ] 7.3 Instruct the skill to report only redacted fields and never inspect credential files
- [ ] 7.4 Define explicit handling for reauthentication, CAPTCHA, rate limiting, and manual-check states
- [ ] 7.5 Verify Codex discovers and explicitly invokes `$doger` from the repository

## 8. Scheduled Task Integration

- [ ] 8.1 Define a durable scheduled-task prompt that explicitly invokes `$doger`
- [ ] 8.2 Create the recurring task only after the first confirmed successful refresh
- [ ] 8.3 Anchor the eight-hour recurrence to that first successful execution time
- [ ] 8.4 Configure the task to run in the local `doger` project and report failures to the current Codex task
- [ ] 8.5 Verify duplicated scheduled runs cannot refresh before the persisted eligibility timestamp
- [ ] 8.6 Review the first two scheduled run results before treating automation as stable

## 9. Documentation and Release Safety

- [ ] 9.1 Document installation, initialization, scheduled-task setup, status inspection, reauthentication, and uninstall workflows
- [ ] 9.2 Document that the computer and Codex Desktop must be running for local scheduled execution
- [ ] 9.3 Document the single-account/single-application scope and eight-hour minimum interval
- [ ] 9.4 Document JD terms-of-service responsibility and the prohibition on CAPTCHA or risk-control bypass
- [ ] 9.5 Add sanitized troubleshooting examples without real endpoints, identifiers, tokens, cookies, or response bodies
- [ ] 9.6 Run strict OpenSpec validation and the complete project test suite before release
