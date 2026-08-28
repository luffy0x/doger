## Purpose

Define local configuration and explicit token replacement for one fixed JD delivery record without browser automation or network capture.

## ADDED Requirements

### Requirement: Local-only initialization

The system SHALL configure exactly one delivery-record ID and one JD Token, represented by the complete Cookie request-header value used by the verified refresh request, without contacting JD.

#### Scenario: User initializes Doger

- **WHEN** the user explicitly runs `doger init` in an interactive terminal
- **THEN** Doger SHALL prompt locally for a positive decimal delivery-record ID and a token
- **AND** it SHALL store the delivery-record ID in protected per-user configuration
- **AND** it SHALL store the token directly in the current user's operating-system credential store
- **AND** it SHALL NOT open a browser or send a network request

#### Scenario: Configuration already exists

- **WHEN** the user runs `doger init` while any Doger installation state already exists
- **THEN** initialization SHALL fail without replacing the configured target or token
- **AND** it SHALL direct the user to confirmed uninstall before configuring a different target

### Requirement: Secret-safe token input

The system SHALL accept tokens only through an echo-suppressed interactive terminal prompt.

#### Scenario: Token is entered

- **WHEN** `init` or `reauth` requests a token
- **THEN** the terminal SHALL not echo the token
- **AND** Doger SHALL not accept the token from command arguments, environment variables, files, or Codex messages
- **AND** Doger SHALL not include the token in stdout, stderr, errors, logs, or structured output

#### Scenario: Interactive input is unavailable

- **WHEN** `init` or `reauth` is invoked without an interactive terminal
- **THEN** the command SHALL fail with a redacted configuration error
- **AND** it SHALL NOT modify configuration or the credential store

### Requirement: Direct operating-system token storage

The system SHALL store the JD token itself in macOS Keychain or Windows Credential Manager through the keyring abstraction.

#### Scenario: Token is persisted

- **WHEN** initialization or token replacement succeeds
- **THEN** the token SHALL exist only in the current user's Doger credential-store entry
- **AND** Doger SHALL NOT write an encrypted token payload or separate encryption key to the filesystem

#### Scenario: Token is absent

- **WHEN** a refresh requires a token and the credential-store entry is absent
- **THEN** Doger SHALL return `REAUTH_REQUIRED`
- **AND** it SHALL NOT start curl

### Requirement: Explicit local token replacement

The system SHALL replace an expired or revoked token only after an explicit interactive `reauth` invocation.

#### Scenario: User replaces the token

- **WHEN** the user runs `doger reauth` and enters a replacement token
- **THEN** Doger SHALL atomically replace the existing credential-store entry
- **AND** it SHALL NOT open a browser or contact JD
- **AND** it SHALL return only a redacted local result

#### Scenario: Scheduled refresh requires authentication

- **WHEN** a scheduled refresh returns `REAUTH_REQUIRED`
- **THEN** the scheduled workflow SHALL stop and notify the user
- **AND** it SHALL NOT prompt for a token or attempt reauthentication unattended

### Requirement: User-controlled token acquisition

The system SHALL leave token acquisition to the authorized user and SHALL not automate browser authentication.

#### Scenario: User needs a token

- **WHEN** no usable token is available
- **THEN** documentation SHALL direct the user to obtain it locally from their own authenticated JD browser session
- **AND** documentation SHALL prohibit pasting it into Codex, screenshots, shell commands, issues, logs, or Git
- **AND** Doger SHALL NOT read passwords, OTPs, CAPTCHA answers, browser profiles, or browser network logs
