## Purpose

Define how `doger` uses a Codex scheduled task and repository skill to refresh one JD application on an eight-hour cadence without a resident project process.

## ADDED Requirements

### Requirement: Repository-scoped Doger skill
The project SHALL provide a repository-scoped Codex skill named `doger` that invokes deterministic local commands and consumes only redacted structured output.

#### Scenario: Codex invokes the scheduled workflow
- **WHEN** the recurring task starts
- **THEN** it SHALL explicitly invoke the `doger` skill
- **AND** the skill SHALL invoke the deterministic refresh command
- **AND** the model SHALL NOT construct the refresh request itself

### Requirement: First-success schedule anchor
The recurring schedule SHALL be anchored to the timestamp of the first confirmed successful refresh.

#### Scenario: Bootstrap succeeds
- **WHEN** the initial browser-assisted refresh is confirmed successful
- **THEN** the system SHALL persist that timestamp as the immutable first-success anchor
- **AND** the recurring Codex task SHALL be created with an eight-hour cadence derived from that anchor

#### Scenario: Bootstrap does not confirm success
- **WHEN** initialization ends without an authoritative success signal
- **THEN** the system SHALL NOT create or activate the recurring task

### Requirement: Eight-hour minimum interval
The system SHALL prevent refresh requests from being sent before the persisted next-eligible timestamp.

#### Scenario: Scheduled invocation is early or duplicated
- **WHEN** a scheduled invocation occurs less than eight hours after the last confirmed success
- **THEN** the command SHALL return `NOT_DUE`
- **AND** it SHALL NOT send a refresh request

#### Scenario: Scheduled invocation is due
- **WHEN** a scheduled invocation occurs at or after the next-eligible timestamp
- **THEN** the command SHALL attempt at most one logical refresh operation

### Requirement: No resident project process
The project SHALL rely on the Codex scheduled task for recurrence and SHALL NOT install a resident daemon, launchd schedule, cron entry, or hosted scheduler.

#### Scenario: Scheduled run completes
- **WHEN** the refresh command reaches a terminal outcome
- **THEN** all `doger`, curl, and agent-browser child processes started for that run SHALL exit

### Requirement: Delayed execution safety
The system SHALL tolerate delayed or missed scheduled-task execution without issuing a burst of catch-up refresh requests.

#### Scenario: Codex Desktop was unavailable
- **WHEN** the next invocation occurs after one or more expected schedule times were missed
- **THEN** the command SHALL perform no more than one due refresh
- **AND** it SHALL calculate future eligibility from the confirmed outcome rather than replaying each missed interval

### Requirement: Single target scope
The MVP SHALL manage exactly one JD account and one application record.

#### Scenario: A second target is configured
- **WHEN** configuration already contains an active application target
- **AND** the user attempts to add a different target without reinitializing
- **THEN** the command SHALL reject the change with an actionable message

### Requirement: Redacted scheduled reporting
Every scheduled run SHALL return a concise, redacted outcome suitable for display in Codex.

#### Scenario: Refresh succeeds
- **WHEN** a refresh is confirmed successful
- **THEN** the report SHALL include status, completion time, and next eligible time
- **AND** it SHALL omit request headers, cookies, tokens, request bodies, and raw responses

#### Scenario: User attention is required
- **WHEN** the outcome is `REAUTH_REQUIRED` or `MANUAL_CHECK`
- **THEN** the scheduled task SHALL notify the user with the safe next command
- **AND** it SHALL NOT attempt interactive recovery unattended
