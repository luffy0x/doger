## Purpose

Define the interactive agent-browser workflow that establishes and repairs the authenticated JD refresh session without automating sensitive human-verification steps.

## ADDED Requirements

### Requirement: Interactive initial authentication
The system SHALL use agent-browser in an interactive session for initial authentication and request capture.

#### Scenario: Authentication requires user input
- **WHEN** JD requests a password, OTP, CAPTCHA, QR scan, or other account verification
- **THEN** the workflow SHALL pause for the user to complete that step
- **AND** it SHALL NOT read, solve, copy, or persist the verification secret

### Requirement: User-confirmed initial refresh
The system SHALL capture the refresh request around one refresh action that the user confirms at action time.

#### Scenario: User confirms the first refresh
- **WHEN** the target account and application record are visibly verified
- **AND** the user confirms the refresh action
- **THEN** the workflow SHALL perform or observe exactly one refresh action
- **AND** it SHALL record the first-success timestamp only after an authoritative success response

#### Scenario: User does not confirm
- **WHEN** the user declines or does not provide confirmation
- **THEN** the workflow SHALL stop without clicking the refresh control or creating a schedule

### Requirement: Request normalization
The capture workflow SHALL convert observed network traffic into a minimal request recipe and a separately protected credential payload.

#### Scenario: A unique refresh request is identified
- **WHEN** one fetch or XHR request correlates with the confirmed refresh action and response
- **THEN** the system SHALL store its non-sensitive shape as the active request recipe
- **AND** it SHALL encrypt all sensitive values before persistence
- **AND** it SHALL remove the raw capture

#### Scenario: The refresh request is ambiguous
- **WHEN** multiple candidate requests cannot be distinguished safely
- **THEN** initialization SHALL return `MANUAL_CHECK`
- **AND** it SHALL NOT guess or persist a recipe

### Requirement: Explicit reauthentication
Authentication recovery that requires browser interaction SHALL begin only after an explicit user invocation.

#### Scenario: Scheduled refresh detects expired authentication
- **WHEN** the curl response is classified as `REAUTH_REQUIRED`
- **THEN** the scheduled workflow SHALL stop and notify the user
- **AND** it SHALL NOT open agent-browser automatically

#### Scenario: User invokes reauthentication
- **WHEN** the user explicitly runs the reauthentication workflow
- **THEN** agent-browser SHALL restore the isolated session and open the configured application page
- **AND** the user SHALL handle any login or verification challenge
- **AND** newly captured credentials SHALL replace the prior credential revision only after validation

### Requirement: Fail closed on unsupported browser-bound requests
The system SHALL NOT attempt to bypass dynamic signing, browser fingerprint checks, CAPTCHA, or risk-control challenges.

#### Scenario: Curl replay requires unsupported dynamic proof
- **WHEN** capture or execution identifies a per-request signature or browser-bound proof that cannot be reproduced through an ordinary authenticated request
- **THEN** the system SHALL return `MANUAL_CHECK`
- **AND** it SHALL leave automated refreshing disabled
