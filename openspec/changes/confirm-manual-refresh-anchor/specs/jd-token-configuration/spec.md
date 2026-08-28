## Purpose

Extend local token configuration with an explicit, secret-safe attestation for the manual website refresh that supplied the configuration values.

## MODIFIED Requirements

### Requirement: Local-only initialization

The system SHALL configure exactly one delivery-record ID and one JD Token without contacting JD, and SHALL optionally record a user-confirmed manual website success as a conservative schedule anchor.

#### Scenario: User initializes with a confirmed manual refresh

- **WHEN** the user explicitly runs `doger init` in an interactive terminal
- **AND** enters a valid delivery-record ID and token locally
- **AND** types the exact confirmation `ANCHOR` for an immediately preceding visibly successful JD website refresh
- **THEN** Doger SHALL store the delivery-record ID in protected per-user configuration
- **AND** it SHALL store the token directly in the current user's operating-system credential store
- **AND** it SHALL persist the confirmation time and the eligibility eight hours later without recording a Doger request attempt
- **AND** it SHALL NOT open a browser or send a network request

#### Scenario: User initializes without confirming a manual refresh

- **WHEN** the user enters any value other than the exact confirmation `ANCHOR`
- **THEN** Doger SHALL store the valid local configuration and token
- **AND** it SHALL preserve an unanchored ready state
- **AND** it SHALL NOT claim a manual or Doger refresh success

### Requirement: Secret-safe token input

The system SHALL accept tokens only through an echo-suppressed interactive terminal prompt and SHALL keep the subsequent non-secret confirmation separate.

#### Scenario: Initialization confirmation is requested

- **WHEN** a valid token has been read through the hidden prompt
- **THEN** Doger SHALL request the manual-success confirmation through a separate local terminal prompt
- **AND** it SHALL not repeat, derive, log, or return the token
- **AND** the confirmation SHALL contain no credential or delivery-record value
