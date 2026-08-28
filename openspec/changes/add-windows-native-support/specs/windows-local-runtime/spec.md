## Purpose

Define Doger's supported native Windows runtime without weakening its local-only security and scheduling guarantees.

## ADDED Requirements

### Requirement: Native Windows runtime

The system SHALL support native execution on Windows 10/11 x64 and SHALL permit Windows ARM64 to use the pinned x64 agent-browser executable through operating-system emulation.

#### Scenario: Windows dependencies are installed
- **WHEN** `doger doctor` runs with Node.js 24, curl, and the pinned Windows agent-browser executable available
- **THEN** the platform and dependency checks SHALL pass
- **AND** configuration SHALL remain a warning until initialization succeeds

#### Scenario: An unsupported platform or architecture is used
- **WHEN** Doger cannot map the current platform and architecture to a pinned browser executable
- **THEN** it SHALL fail closed with a redacted dependency error

### Requirement: Case-insensitive browser environment isolation

The system SHALL remove inherited `AGENT_BROWSER_*` controls and `NODE_OPTIONS` from the browser subprocess environment without relying on environment-variable name casing.

#### Scenario: Windows supplies mixed-case control variables
- **WHEN** inherited environment variables contain mixed-case forms of agent-browser controls or Node injection options
- **THEN** Doger SHALL remove every case variant before launching the browser process
- **AND** it SHALL preserve unrelated environment entries required to launch the pinned executable

### Requirement: Per-user Windows storage

The system SHALL store Windows runtime files beneath the current user's LocalAppData directory unless `DOGER_DATA_DIR` explicitly overrides it.

#### Scenario: LocalAppData is available
- **WHEN** Doger resolves its default Windows data directory
- **THEN** it SHALL use `%LOCALAPPDATA%\\doger`

#### Scenario: LocalAppData is unavailable
- **WHEN** Doger resolves its default Windows data directory without `LOCALAPPDATA`
- **THEN** it SHALL fall back to `%USERPROFILE%\\AppData\\Local\\doger`

### Requirement: Platform-equivalent credential protection

The system SHALL encrypt captured credentials before writing them and SHALL keep the encryption key in the current user's Windows Credential Manager entry.

#### Scenario: A credential entry is absent
- **WHEN** the Windows keyring binding returns either supported missing-value representation
- **THEN** Doger SHALL treat the key as absent rather than as a storage failure

#### Scenario: Credentials are removed
- **WHEN** a synthetic credential-store round trip completes
- **THEN** the stored key SHALL be readable only through the keyring abstraction during the test
- **AND** the test entry SHALL be deleted afterward

### Requirement: Windows verification is not macOS acceptance

The system SHALL track native Windows verification and macOS hardware verification as separate evidence.

#### Scenario: Windows checks pass
- **WHEN** all Windows tests, build steps, and dependency probes pass
- **THEN** the project MAY report Windows local verification complete
- **AND** it SHALL NOT report macOS hardware validation or live JD validation complete
