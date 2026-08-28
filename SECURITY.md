# Security Policy

## Supported Versions

Doger is pre-release software. Only the current `main` branch receives security fixes until the first tagged release.

## Reporting a Vulnerability

Do not include JD Cookies, Tokens, passwords, OTPs, delivery-record IDs, raw HAR files, request headers, or production response bodies in a public issue. Use GitHub's private security advisory flow and synthetic local-Mock reproductions whenever possible.

## Token Handling

Doger treats the complete Cookie request-header value used by the verified refresh request as the authentication Token.

- `init` and `reauth` accept it only through an echo-suppressed interactive terminal prompt.
- The Token is stored directly in macOS Keychain or Windows Credential Manager through `@napi-rs/keyring`.
- No encrypted credential file, exported browser state, or separate encryption key is written.
- Routine refreshes pass the Token to `curl --disable --config -` through stdin, never argv or environment variables.
- Curl response files are private temporary files and are removed after bounded parsing.
- CLI JSON, errors, status, tests, documentation, and Git omit the Token, delivery-record ID, request data, and raw JD response.

On macOS, persisted JSON uses owner-only POSIX permissions. On Windows, data is stored under the current user's LocalAppData directory and protected by the user-profile ACL. The threat model does not include a compromised logged-in user or administrator account.

The repository `$doger` Skill and Scheduled Task consume only redacted CLI JSON. They must not inspect local configuration, the operating-system credential store, temporary response data, or browser state and must not reconstruct curl commands.

Initialization writes a Doger ownership marker before creating configuration or credential state. Uninstall removes known files only when that marker is valid; without it, same-named filesystem entries are preserved while Doger's fixed native credential entries may still be cleaned.

If the Token may have been exposed, stop scheduled execution, sign out of the affected JD session, obtain a replacement locally, and run `doger reauth`.

## Network and Scope Boundaries

Doger sends only one fixed POST to `https://campus.jd.com/api/wx/resume/refresh`, does not follow redirects, and does not retry automatically. It requires the exact verified two-level JSON success signal before advancing state.

Doger does not automate login or token acquisition and does not bypass CAPTCHA, device verification, dynamic signing, browser fingerprint checks, or platform risk controls. Users are responsible for using only accounts they are authorized to use and complying with applicable platform terms.
