# Security Policy

## Supported Versions

Doger is pre-release software. Only the current `main` branch receives security fixes until the first tagged release.

## Reporting a Vulnerability

Do not include JD cookies, authorization headers, CSRF values, passwords, OTPs, raw HAR files, or production response bodies in a public issue.

Report a vulnerability through GitHub's private security advisory flow for this repository. Include reproduction steps using synthetic credentials and a local mock server whenever possible.

## Credential Handling

Doger is designed to keep authentication material outside model context, process arguments, logs, fixtures, and Git. Credentials are encrypted locally, and the encryption key is stored in the operating-system credential store.

If credentials may have been exposed, stop scheduled execution, remove Doger's local state, sign out of the affected JD sessions, and authenticate again.

## Scope Boundaries

Doger does not bypass CAPTCHA, device verification, dynamic signing, browser fingerprint checks, or platform risk controls. Users are responsible for using only their own account and complying with applicable platform terms.
