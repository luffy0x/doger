## MODIFIED Requirements

### Requirement: Encrypted local credentials
The system SHALL encrypt captured authentication material at rest and keep its encryption key in the operating-system credential store.

#### Scenario: Credentials are persisted
- **WHEN** bootstrap or reauthentication produces validated credentials
- **THEN** the credential payload SHALL be encrypted before being written to disk
- **AND** the encryption key SHALL be stored through macOS Keychain or Windows Credential Manager
- **AND** persisted files SHALL use owner-only POSIX permissions on macOS or the current user's per-profile storage ACL on Windows
