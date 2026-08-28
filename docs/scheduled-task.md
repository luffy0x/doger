# Scheduled Task Setup

Doger uses a Codex Scheduled Task for recurrence; it does not install a daemon, cron entry, or `launchd` job.

## Preconditions

1. Complete local-only `doger init`.
2. If the values came from an immediately preceding visibly successful website refresh, type the exact local confirmation `ANCHOR`; otherwise leave initialization unanchored.
3. For an unanchored initialization, explicitly authorize and run one `doger refresh --json` after JD permits it.
4. Confirm that `doger status --json` reports `scheduleAnchored: true`.
5. Use `nextEligibleAt` as the first scheduled run time. It is exactly eight hours after the conservative manual-confirmation anchor or the first confirmed Doger success.

Do not create the task while `scheduleAnchored` is false. The computer must be on, Codex Desktop must be running, and this repository must remain available when the task is due.

## Durable prompt

Use this prompt for a task attached to the local `doger` project:

```text
Use $doger for this run. From the local doger project, execute `npm run --silent doger -- refresh --json` exactly once and report only the redacted JSON outcome. Do not inspect configuration, the operating-system credential store, temporary files, browser state, or raw response data. Do not construct curl commands and do not add retries. If the outcome is REAUTH_REQUIRED, RATE_LIMITED, TRANSIENT_FAILURE, or MANUAL_CHECK, report it with the safe next action defined by $doger. Never run init, reauth, or uninstall unattended.
```

Configure an eight-hour cadence beginning at `nextEligibleAt` and run it in the saved local project rather than a generated worktree. Doger's persisted due guard remains authoritative if a task is duplicated, delayed, or triggered early.

Review the first two scheduled results before treating the automation as stable. `REAUTH_REQUIRED` only notifies the user; Token replacement remains a separate explicit local action.

Codex Scheduled Tasks are managed in the desktop app, not the CLI. See the [official Scheduled Tasks documentation](https://learn.chatgpt.com/docs/automations).
