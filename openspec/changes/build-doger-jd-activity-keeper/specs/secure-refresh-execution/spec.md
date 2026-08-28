## Purpose

Define deterministic curl execution, credential isolation, response classification, failure handling, and privacy requirements for `doger`.

## ADDED Requirements

### Requirement: Encrypted local credentials
The system SHALL encrypt captured authentication material at rest and keep its encryption key in the operating-system credential store.

#### Scenario: Credentials are persisted
- **WHEN** bootstrap or reauthentication produces validated credentials
- **THEN** the credential payload SHALL be encrypted before being written to disk
- **AND** the encryption key SHALL be stored through the macOS Keychain integration
- **AND** persisted files SHALL use owner-only permissions

### Requirement: Secret-free model context
The system SHALL prevent authentication material and sensitive request data from entering Codex context or user-visible reports.

#### Scenario: A command returns structured output
- **WHEN** Codex invokes `status`, `refresh`, or `doctor` with JSON output
- **THEN** the result SHALL contain only status codes, timestamps, revisions, and sanitized diagnostics
- **AND** it SHALL omit cookies, authorization values, CSRF values, request bodies, account identifiers, and raw responses

#### Scenario: A subprocess fails
- **WHEN** curl or agent-browser returns an error
- **THEN** stderr and exception details SHALL be redacted before persistence or display

### Requirement: Curl request isolation
Routine refreshes SHALL be executed by curl from a normalized recipe without placing sensitive values in process arguments.

#### Scenario: A due refresh is executed
- **WHEN** authentication is available and the refresh is due
- **THEN** sensitive curl configuration SHALL be provided through process stdin
- **AND** redirects SHALL NOT be followed to an unapproved host
- **AND** response capture SHALL be size-bounded

### Requirement: Approved host boundary
The system SHALL send refresh traffic only to hosts approved during interactive initialization.

#### Scenario: Recipe host differs from the allowlist
- **WHEN** a request recipe or redirect targets an unapproved host
- **THEN** execution SHALL stop before transmitting credentials
- **AND** it SHALL return `MANUAL_CHECK`

### Requirement: Evidence-based success
The system SHALL classify success using the response contract observed during initialization and SHALL NOT treat HTTP status alone as success.

#### Scenario: HTTP 200 contains a success marker
- **WHEN** the response status and captured success predicate both match
- **THEN** the system SHALL return `SUCCESS`
- **AND** it SHALL persist the success time and next eligible time

#### Scenario: HTTP 200 contains login HTML or an unknown body
- **WHEN** the response does not satisfy the success predicate
- **THEN** the system SHALL return `REAUTH_REQUIRED` or `MANUAL_CHECK` as appropriate
- **AND** it SHALL NOT advance the success timestamp

### Requirement: Bounded failure behavior
The system SHALL use bounded, outcome-specific retries.

#### Scenario: A transient connection or eligible server failure occurs
- **WHEN** execution returns a retryable network or 5xx result
- **THEN** the command MAY retry at most twice with bounded delay
- **AND** it SHALL return `TRANSIENT_FAILURE` if those attempts fail

#### Scenario: An ambiguous timeout occurs
- **WHEN** the client cannot determine whether JD accepted the refresh
- **THEN** the command SHALL NOT immediately repeat the request
- **AND** it SHALL return `MANUAL_CHECK`

#### Scenario: JD returns a rate limit
- **WHEN** the response status or captured contract indicates rate limiting
- **THEN** the command SHALL return `RATE_LIMITED`
- **AND** it SHALL honor an authoritative `Retry-After` or next-eligible value

### Requirement: Complete local cleanup
The system SHALL provide a documented way to remove all local credentials and runtime state.

#### Scenario: User uninstalls Doger
- **WHEN** the user confirms uninstall cleanup
- **THEN** the workflow SHALL remove the Codex scheduled task, encrypted credential payload, browser state, runtime state, and keychain entry
- **AND** it SHALL report which items were removed
