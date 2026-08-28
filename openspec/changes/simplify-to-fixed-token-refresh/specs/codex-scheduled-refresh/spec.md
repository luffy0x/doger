## Purpose

Update schedule anchoring for local token configuration followed by an explicit first refresh.

## MODIFIED Requirements

### Requirement: First-success schedule anchor

The recurring schedule SHALL be anchored to the first confirmed successful fixed-token refresh, not to local initialization.

#### Scenario: Local initialization succeeds

- **WHEN** `doger init` stores a delivery-record ID and token without contacting JD
- **THEN** the system SHALL remain unanchored
- **AND** it SHALL NOT create or activate the recurring Codex task

#### Scenario: First explicit refresh succeeds

- **WHEN** the user explicitly invokes `doger refresh` after initialization
- **AND** the fixed response contract confirms success
- **THEN** Doger SHALL persist that completion time as the immutable first-success anchor
- **AND** the recurring Codex task MAY be created with an eight-hour cadence derived from that anchor

#### Scenario: First explicit refresh is not confirmed successful

- **WHEN** the first refresh returns any outcome other than `SUCCESS`
- **THEN** the system SHALL NOT create or activate the recurring task

### Requirement: No resident project process

The project SHALL rely on the Codex scheduled task for recurrence and SHALL NOT install a resident daemon, operating-system schedule, browser process, or hosted scheduler.

#### Scenario: Scheduled run completes

- **WHEN** the refresh command reaches a terminal outcome
- **THEN** the Doger CLI and curl process started for that run SHALL exit
- **AND** no Doger-controlled browser process SHALL exist
