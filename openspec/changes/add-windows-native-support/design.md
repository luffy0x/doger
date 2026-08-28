## Context

The pinned `agent-browser` package includes a Windows x64 executable and explicitly falls back to it on Windows ARM64. `@napi-rs/keyring` ships Windows native bindings backed by Windows Credential Manager. Doger's platform gate and path selection, rather than its dependencies or deterministic refresh core, are the current blockers.

## Goals / Non-Goals

### Goals

- Preserve one CLI and one state format across macOS and Windows.
- Resolve only pinned, package-local browser executables.
- Use the native per-user credential store on each supported platform.
- Keep secrets encrypted on disk and absent from model-visible output.
- Make Windows local verification repeatable without claiming live JD or macOS acceptance.

### Non-Goals

- Supporting Linux or WSL as a Doger runtime.
- Adding a Windows service or Task Scheduler job.
- Introducing a platform-specific request or response path.

## Decisions

### 1. Keep one deterministic core

Only executable resolution, platform diagnostics, data-directory selection, and filesystem assertions vary by platform. Capture, classification, scheduling, locking, encryption, and curl execution remain shared.

### 2. Use the dependency's published Windows binary contract

Windows x64 resolves `agent-browser-win32-x64.exe`. Windows ARM64 follows agent-browser's own documented fallback and uses that x64 executable through Windows emulation. Unsupported platforms and architectures fail closed.

### 3. Use per-user Windows storage

Windows state defaults to `%LOCALAPPDATA%\\doger`, falling back to `%USERPROFILE%\\AppData\\Local\\doger`. The encrypted credential file remains separate from its key in Windows Credential Manager. POSIX mode-bit assertions remain mandatory on macOS but are not used as a Windows ACL proxy.

### 4. Preserve action-time confirmation

Synthetic tests, dependency probes, and browser startup checks may run unattended. A real JD initialization still pauses for the user to complete authentication and explicitly authorize exactly one refresh.

## Verification

- Red tests for Windows executable resolution, doctor support, LocalAppData selection, and missing credential values.
- `npm run check` on Windows.
- `doctor --json` reports Windows, Node, curl, and agent-browser healthy.
- A synthetic Windows Credential Manager set/get/delete round trip.
- A fresh allowlisted agent-browser open/close smoke test without stored browser state.
- A separately confirmed live JD initialization and refresh.
