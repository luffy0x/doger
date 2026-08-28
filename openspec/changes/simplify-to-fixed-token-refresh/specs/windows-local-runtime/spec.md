## Purpose

Remove browser-runtime requirements from native Windows support and store the long-lived token directly in Windows Credential Manager.

## REMOVED Requirements

### Requirement: Case-insensitive browser environment isolation

**Reason**: Doger no longer launches agent-browser or any Node-based browser subprocess.

**Migration**: Remove agent-browser environment filtering together with the browser runtime.

## MODIFIED Requirements

### Requirement: Native Windows runtime

The system SHALL support native execution on Windows 10/11 x64 and ARM64 with Node.js, curl, and Windows Credential Manager.

#### Scenario: Windows dependencies are installed

- **WHEN** `doger doctor` runs with Node.js 24, curl, and the keyring binding available
- **THEN** the platform and dependency checks SHALL pass
- **AND** configuration SHALL remain a warning until `doger init` succeeds

#### Scenario: Windows is unsupported

- **WHEN** Doger runs on a Windows version or architecture outside the supported native contract
- **THEN** it SHALL fail closed with a redacted dependency error

### Requirement: Platform-equivalent credential protection

The system SHALL store the JD token itself in the current user's Windows Credential Manager entry and SHALL not persist a token payload on disk.

#### Scenario: A token entry is absent

- **WHEN** the Windows keyring binding returns either supported missing-value representation
- **THEN** Doger SHALL treat the token as absent rather than as a storage failure

#### Scenario: A synthetic token round trip completes

- **WHEN** Windows verification writes, reads, replaces, and deletes a synthetic token through the keyring abstraction
- **THEN** the token SHALL be returned only to the deterministic test process
- **AND** the test entry SHALL be deleted afterward
