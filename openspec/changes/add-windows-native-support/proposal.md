## Why

Doger's deterministic core already runs on Windows, and its pinned browser and credential-store dependencies publish Windows-native binaries. The project currently blocks that supported dependency path in its own platform checks, uses a Unix data-directory fallback, and treats POSIX mode bits as portable. Native Windows support lets the current machine exercise the full local workflow before macOS hardware acceptance without weakening the existing security contract.

## What Changes

- Recognize Windows x64 and Windows ARM64-through-x64-emulation as supported agent-browser targets.
- Store Windows runtime data beneath the current user's LocalAppData directory.
- Use Windows Credential Manager through the existing keyring abstraction.
- Make filesystem verification platform-aware while keeping encrypted credentials and per-user storage mandatory.
- Report Windows as supported in `doctor` and document the remaining live-JD and macOS acceptance gates.

## Capabilities

### New Capabilities

- `windows-local-runtime`: Native Windows installation, storage, dependency probing, browser execution, and CLI verification.

### Modified Capabilities

- `secure-refresh-execution`: Generalize the operating-system credential-store and persisted-file requirements from macOS-only behavior to equivalent macOS and Windows controls.

## Scope

### In scope

- Windows 10/11 x64
- Windows ARM64 through the published x64 agent-browser binary
- Native PowerShell/Codex execution
- Windows Credential Manager and per-user LocalAppData storage
- Synthetic and local Mock verification before any live JD action

### Out of scope

- WSL and Linux runtime support
- Weakening host allowlists, response evidence, redaction, or the eight-hour guard
- Unattended login, CAPTCHA solving, or risk-control bypass
- Treating Windows verification as macOS hardware verification

## Rollback

Revert the Windows platform resolver, doctor support, and LocalAppData path selection. Existing macOS paths, state schemas, recipes, and encrypted credential formats remain unchanged.
