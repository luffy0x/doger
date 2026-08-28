## Purpose

Replace captured request execution with one fixed, token-authenticated JD refresh operation while preserving secret isolation and conservative outcomes.

## ADDED Requirements

### Requirement: Direct token credential storage

The system SHALL store the long-lived JD Token, represented by the complete Cookie request-header value, directly in the current user's operating-system credential store.

#### Scenario: Token is stored

- **WHEN** local initialization or reauthentication accepts a token
- **THEN** Doger SHALL write the token to macOS Keychain or Windows Credential Manager through the keyring abstraction
- **AND** it SHALL NOT write the token or a decryptable token payload to the filesystem

## REMOVED Requirements

### Requirement: Encrypted local credentials

**Reason**: The only authentication secret is the token, which can be stored directly in the operating-system credential store without an encrypted credential file or separate encryption key.

**Migration**: Version 1 installations must use confirmed uninstall and the new `init`; captured credential bundles are not converted.

## MODIFIED Requirements

### Requirement: Secret-free model context

The system SHALL prevent the token, delivery-record ID, and raw JD response data from entering Codex context or user-visible reports.

#### Scenario: A command returns structured output

- **WHEN** Codex invokes `status`, `refresh`, or `doctor` with JSON output
- **THEN** the result SHALL contain only outcome codes, timestamps, and sanitized diagnostics
- **AND** it SHALL omit the token, delivery-record ID, request headers, request body, and raw response

#### Scenario: A subprocess fails

- **WHEN** curl returns an error
- **THEN** stderr and exception details SHALL be redacted before persistence or display
- **AND** the token SHALL not appear in process arguments or environment diagnostics

### Requirement: Curl request isolation

Routine refreshes SHALL execute one fixed JD request through curl without placing the token in process arguments.

#### Scenario: A due refresh is executed

- **WHEN** a configured target is due and a token is available
- **THEN** Doger SHALL construct the fixed HTTPS request from implementation constants and the configured delivery-record ID
- **AND** it SHALL place the stored Token only in the fixed `Cookie` request header
- **AND** it SHALL provide the token and curl configuration through process stdin
- **AND** it SHALL disable redirects and ambient curl configuration
- **AND** it SHALL bound response headers, body size, connection time, and total time

### Requirement: Approved host boundary

The system SHALL send refresh traffic only to the fixed implementation-owned HTTPS endpoint on an official JD host.

#### Scenario: The fixed endpoint is invalid

- **WHEN** the configured implementation endpoint is not HTTPS or its hostname is not `jd.com` or a subdomain of `jd.com`
- **THEN** execution SHALL stop before reading or transmitting the token
- **AND** it SHALL return a redacted configuration failure

#### Scenario: JD redirects the request

- **WHEN** the fixed endpoint returns a redirect
- **THEN** curl SHALL not follow it
- **AND** Doger SHALL return `MANUAL_CHECK`

### Requirement: Evidence-based success

The system SHALL classify success only from the fixed verified JSON contract and SHALL NOT treat HTTP status or response prose alone as success.

#### Scenario: JD confirms refresh success

- **WHEN** curl completes successfully with an HTTP success status
- **AND** the response is valid JSON with top-level `success` exactly `true`
- **AND** `body.success` is exactly `true`
- **THEN** Doger SHALL return `SUCCESS`
- **AND** it SHALL persist the completion time and the next eligible time

#### Scenario: HTTP success lacks the fixed business signal

- **WHEN** the HTTP response is successful but either required boolean is absent or is not exactly `true`
- **THEN** Doger SHALL return `MANUAL_CHECK`
- **AND** it SHALL not advance the confirmed-success timestamp

### Requirement: Bounded failure behavior

The system SHALL start at most one curl process and issue at most one logical refresh request per CLI invocation.

#### Scenario: A connection or server failure occurs

- **WHEN** curl reports a connection-establishment failure or JD returns a 5xx response
- **THEN** Doger SHALL return `TRANSIENT_FAILURE`
- **AND** it SHALL not retry automatically

#### Scenario: An ambiguous timeout occurs

- **WHEN** curl times out after the request may have been delivered
- **THEN** Doger SHALL return `MANUAL_CHECK`
- **AND** it SHALL not repeat the request

#### Scenario: JD returns a rate limit

- **WHEN** JD returns HTTP 429
- **THEN** Doger SHALL return `RATE_LIMITED`
- **AND** it SHALL preserve an authoritative `Retry-After` value when present
- **AND** it SHALL not retry automatically

#### Scenario: JD rejects authentication

- **WHEN** JD returns HTTP 401 or 403
- **THEN** Doger SHALL return `REAUTH_REQUIRED`
- **AND** it SHALL not prompt for or replace a token unattended

### Requirement: Complete local cleanup

The system SHALL provide a documented way to remove the configured target, runtime state, and token.

#### Scenario: User uninstalls Doger

- **WHEN** the user confirms uninstall cleanup after pausing or deleting the Codex scheduled task
- **THEN** Doger SHALL remove its known configuration, runtime state, lock, installation marker, and operating-system credential entry
- **AND** it SHALL preserve unknown files
- **AND** it SHALL report only which known item types were removed

#### Scenario: Cleanup encounters an interrupted initialization

- **WHEN** initialization was interrupted after Doger wrote its ownership marker
- **THEN** confirmed uninstall SHALL remove the partial known state and operating-system credential entry
- **AND** if no valid ownership marker exists, uninstall SHALL preserve same-named filesystem entries
