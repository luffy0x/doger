## Why

JD application activity can be refreshed only on an eight-hour cadence, and relying on a person to remember every refresh is unreliable. A continuously running daemon would solve the timing problem but would add unnecessary lifecycle, resource, and installation complexity for a workflow that already runs inside Codex Desktop.

`doger` should instead be a local-first Codex-native automation: a scheduled task invokes a narrowly scoped skill every eight hours, deterministic local code performs the refresh with curl, and agent-browser is used only for the initial authenticated capture or an explicit user-requested reauthentication.

## What Changes

### 1. Add the `doger` repository and Codex skill

- Create a TypeScript/Node.js project named `doger`.
- Present the project in README as **doger, a jd-activity-keeper**.
- Use the provided `assets/doger-logo.svg` as the canonical project logo.
- Add a repository-scoped Codex skill at `.agents/skills/doger/SKILL.md`.
- Make the skill invoke deterministic local commands and consume only redacted structured results.

### 2. Add interactive first-run bootstrap

- Open the configured JD application page with agent-browser in an interactive browser.
- Require the user to complete login, OTP, and CAPTCHA steps themselves.
- Capture the refresh request around one user-confirmed refresh action.
- Normalize the captured request into a reusable request recipe.
- Store credentials outside the repository and record the first confirmed successful refresh as the schedule anchor.

### 3. Add eight-hour Codex scheduling

- Create a recurring task only after bootstrap has produced a confirmed successful refresh.
- Anchor the recurrence to that first successful execution time.
- Run once every eight hours, with no resident `doger` process and no launchd job.
- Use persisted runtime state to prevent an early or duplicate refresh if a scheduled run is replayed.

### 4. Add deterministic curl refresh execution

- Reconstruct the captured request without placing secrets in command arguments.
- Restrict outbound requests to the captured and approved JD hosts.
- Classify response content as success, not due, authentication expired, rate limited, transient failure, or unknown.
- Update the next eligible time only after confirmed success or an authoritative server-provided next-eligible time.

### 5. Add explicit authentication recovery

- An unattended scheduled run that detects expired authentication SHALL stop and report `REAUTH_REQUIRED`.
- It SHALL NOT automatically open a browser or attempt interactive login.
- After the user explicitly invokes reauthentication, Codex may use agent-browser to refresh the local session and request credentials.
- CAPTCHA and account-verification steps remain manual.

### 6. Add local credential and privacy protections

- Encrypt the captured credential bundle at rest.
- Store its encryption key in the operating-system keychain.
- Prevent cookies, authorization values, request bodies containing identifiers, and raw HAR files from appearing in model context, logs, fixtures, or Git history.
- Add a documented uninstall path that removes the scheduled task, encrypted state, and keychain entry.

## Capabilities

### New Capabilities

- `codex-scheduled-refresh`: Eight-hour, first-run-anchored refresh orchestration through a Codex scheduled task and repository skill.
- `jd-session-bootstrap`: Interactive agent-browser bootstrap and explicit user-driven reauthentication.
- `secure-refresh-execution`: Allowlisted curl execution, response classification, secret isolation, and redacted reporting.

### Modified Capabilities

None. This is a greenfield project.

## Scope

### In scope

- macOS
- One JD account
- One application record
- One eight-hour recurring schedule
- Local-only encrypted credentials and state
- Codex Desktop as the scheduler and operator surface

### Out of scope

- A resident daemon, launchd scheduler, cron job, or hosted backend
- Multi-account or bulk application refresh
- Refresh intervals shorter than eight hours
- CAPTCHA solving, anti-bot bypass, stealth automation, or risk-control circumvention
- Automatic interactive login during unattended runs
- Web UI, mobile UI, analytics, or telemetry
- Guaranteed hard real-time execution

## Impact

- New project runtime and CLI under `src/`
- New repository skill under `.agents/skills/doger/`
- New local encrypted state under the user's application-data directory
- One Codex recurring task created after successful bootstrap
- New dependencies: Node.js 24, curl, `agent-browser`, and an OS-keychain binding
- README, security documentation, unit tests, integration tests, and mock fixtures
- Canonical branding asset at `assets/doger-logo.svg`

No database, cloud service, OpenAI API key, or continuously running project process is introduced.

## Rollback

Rollback consists of pausing/deleting the Codex scheduled task, deleting `doger`'s local encrypted state, and deleting its keychain entry. Repository files can then be removed independently. A refresh already accepted by JD is an external side effect and cannot be undone.
