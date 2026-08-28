# Security Policy

## Supported Versions

Doger is pre-release software. Only the current `main` branch receives security fixes until the first tagged release.

## Reporting a Vulnerability

Do not include JD cookies, authorization headers, CSRF values, passwords, OTPs, raw HAR files, or production response bodies in a public issue.

Report a vulnerability through GitHub's private security advisory flow for this repository. Include reproduction steps using synthetic credentials and a local mock server whenever possible.

## Credential Handling

Doger is designed to keep authentication material outside model context, process arguments, logs, fixtures, and Git. Credentials are encrypted locally, and the encryption key is stored in macOS Keychain or Windows Credential Manager.

On macOS, persisted files use owner-only POSIX permissions. On Windows, Doger stores them beneath the current user's LocalAppData directory and relies on the user-profile ACL together with encrypted credential contents. The threat model does not include a compromised logged-in user or an administrator account.

Routine refreshes pass sensitive curl configuration through stdin and disable ambient user curl configuration files. This prevents options from `.curlrc` from tracing credentials or changing the guarded request.

Interactive authentication uses a fresh allowlisted agent-browser session. Browser restore, profile reuse, state replay, auto-connect, and CDP attachment are deliberately disabled because they are incompatible with agent-browser's domain-containment guarantee. Inherited `AGENT_BROWSER_*` and `NODE_OPTIONS` variables are stripped case-insensitively before launch so Windows environment-key semantics cannot bypass that boundary. The browser session is closed after capture and is not persisted.

The repository `$doger` Skill and Scheduled Task must consume only the CLI's redacted JSON. They must not inspect local configuration, request recipe, encrypted credential, browser, operating-system credential store, or raw response data.

If credentials may have been exposed, stop scheduled execution, remove Doger's local state, sign out of the affected JD sessions, and authenticate again.

## Scope Boundaries

Doger does not bypass CAPTCHA, device verification, dynamic signing, browser fingerprint checks, or platform risk controls. Users are responsible for using only their own account and complying with applicable platform terms.
