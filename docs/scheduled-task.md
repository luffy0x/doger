# Scheduled Task Setup

Doger uses a Codex Scheduled Task for recurrence; it does not install a daemon, cron entry, or `launchd` job.

## Preconditions

1. Complete `doger init` and confirm one successful refresh.
2. Run `npm run --silent doger -- status --json` and confirm `initialized` is `true`.
3. Use `nextEligibleAt` as the first scheduled run time. This is exactly eight hours after the immutable first-success anchor.

Do not create the task before initialization succeeds. For local scheduled execution, the computer must be on, Codex Desktop must be running, and this repository must remain available.

## Durable prompt

Use this prompt verbatim for a task scheduled inside the current Codex task and attached to the local `doger` project:

```text
Use $doger for this run. From the local doger project, execute `npm run --silent doger -- refresh --json` exactly once and report only the redacted JSON outcome. Do not inspect configuration, recipe, credential, Keychain, browser, or raw response data. Do not construct curl commands and do not add retries. If the outcome is REAUTH_REQUIRED, RATE_LIMITED, TRANSIENT_FAILURE, or MANUAL_CHECK, report it with the safe next action defined by $doger. Never run init, reauth, uninstall, or agent-browser unattended.
```

Configure the task to repeat every eight hours, beginning at `nextEligibleAt`, and run it in the local project rather than a generated worktree. Doger's persisted due guard remains authoritative if a task is duplicated, delayed, or triggered early.

After creation, run the prompt once manually and review the first two scheduled results before treating the automation as stable. A `REAUTH_REQUIRED` result only notifies the user; reauthentication remains a separate explicit action.

Codex Scheduled Tasks are managed in the desktop app, not the CLI. See the [official Scheduled Tasks documentation](https://learn.chatgpt.com/docs/automations).
