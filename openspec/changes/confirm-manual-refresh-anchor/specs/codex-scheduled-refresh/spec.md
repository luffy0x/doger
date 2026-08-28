## Purpose

Allow a user-confirmed successful website refresh to establish the first conservative schedule anchor during local initialization.

## MODIFIED Requirements

### Requirement: First-success schedule anchor

The recurring schedule SHALL be anchored to either a user-confirmed successful JD website refresh during initialization or the first confirmed successful fixed-token Doger refresh.

#### Scenario: User confirms the immediately preceding website refresh

- **WHEN** `doger init` has accepted the delivery-record ID and hidden token
- **AND** the user types the exact local confirmation `ANCHOR` to attest that the immediately preceding JD website refresh visibly succeeded
- **THEN** Doger SHALL use the confirmation time as the immutable first-success anchor
- **AND** it SHALL set the next eligibility to exactly eight hours after that confirmation time
- **AND** it SHALL NOT contact JD
- **AND** the recurring Codex task MAY be created from the returned `nextEligibleAt`

#### Scenario: User does not confirm a website success

- **WHEN** the user does not enter the exact `ANCHOR` confirmation during initialization
- **THEN** Doger SHALL complete local initialization without a success anchor
- **AND** it SHALL NOT claim a remote attempt or success
- **AND** the first explicit Doger refresh SHALL remain immediately eligible

#### Scenario: First explicit Doger refresh succeeds without a manual anchor

- **WHEN** an unanchored installation explicitly invokes `doger refresh`
- **AND** the fixed response contract confirms success
- **THEN** Doger SHALL persist that completion time as the immutable first-success anchor
- **AND** the recurring Codex task MAY be created with an eight-hour cadence derived from that anchor

#### Scenario: Anchored initialization is followed by an early invocation

- **WHEN** a refresh is invoked before the manual anchor's `nextEligibleAt`
- **THEN** Doger SHALL return `NOT_DUE`
- **AND** it SHALL NOT load the token or start curl

### Requirement: No resident project process

The project SHALL rely on the Codex scheduled task for recurrence and SHALL NOT install a resident daemon, operating-system schedule, browser process, or hosted scheduler.

#### Scenario: Initialization establishes an anchor

- **WHEN** confirmed initialization returns `scheduleAnchored: true`
- **THEN** Doger SHALL exit after writing local state
- **AND** Codex SHALL remain responsible for creating the separate recurring task
