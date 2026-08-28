## 1. Native platform support

- [x] 1.1 Resolve the pinned Windows agent-browser executable for x64 and ARM64 fallback
- [x] 1.2 Report Windows as a supported platform from `doctor`
- [x] 1.3 Store default Windows data beneath the current user's LocalAppData directory
- [x] 1.4 Treat both native missing-credential representations as an absent credential
- [x] 1.5 Strip inherited browser controls and Node injection variables case-insensitively

## 2. Verification

- [x] 2.1 Add Windows platform, path, and credential regression tests
- [x] 2.2 Run the complete typecheck, test, and build suite on Windows
- [x] 2.3 Verify the Windows Credential Manager with a synthetic set/get/delete round trip
- [x] 2.4 Verify `doctor --json` reports healthy Windows dependencies
- [x] 2.5 Run a fresh allowlisted agent-browser open/close smoke test on Windows
  - Verified by the fresh real `init` session: the allowlisted browser opened for user interaction and the awaited `finally` close completed before the original redacted capture error returned.

## 3. Documentation and acceptance

- [x] 3.1 Document Windows requirements, storage, credential handling, and WSL exclusion
- [ ] 3.2 Run one user-confirmed real JD initialization and refresh on Windows
  - 2026-08-28: one user-confirmed refresh attempt failed closed as `MANUAL_CHECK` / `CAPTURE_AMBIGUOUS`; no recipe or credentials were persisted, and no retry was attempted.
  - Review rejected generic response-success fields as insufficient to identify the authorized refresh request; safe action-scoped correlation remains unresolved.
  - Treat the remote action as potentially successful; do not retry before 2026-08-28 23:28 CST, eight hours after the conservative post-action observation.
- [ ] 3.3 Create and observe the scheduled task only after confirmed success
- [ ] 3.4 Complete separate macOS hardware acceptance later
