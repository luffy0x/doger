## Purpose

Remove the browser-assisted bootstrap capability superseded by local token configuration.

## REMOVED Requirements

### Requirement: Interactive initial authentication

**Reason**: Doger no longer controls a browser. The user provides the already-authorized long-lived token through a hidden local prompt.

**Migration**: Remove agent-browser bootstrap and use `doger init` to configure the delivery-record ID and token locally.

### Requirement: User-confirmed initial refresh

**Reason**: Initialization becomes local-only, and the first explicit `doger refresh` establishes the success anchor.

**Migration**: Run `doger init`, then invoke `doger refresh` once explicitly; create the schedule only after confirmed success.

### Requirement: Request normalization

**Reason**: The endpoint, method, authentication header, body shape, and response contract are fixed and verified.

**Migration**: Replace captured recipes and credential bundles with the deterministic fixed JD adapter.

### Requirement: Explicit reauthentication

**Reason**: Reauthentication no longer requires browser interaction and only replaces the stored token.

**Migration**: Use the hidden local `doger reauth` prompt to replace the keyring token.

### Requirement: Ephemeral allowlisted browser sessions

**Reason**: Doger no longer starts or controls browser sessions.

**Migration**: Remove the browser runtime, session options, network allowlist, and browser-state handling.

### Requirement: Fail closed on unsupported browser-bound requests

**Reason**: Doger supports only the verified fixed token request and does not attempt browser-bound execution.

**Migration**: Return `MANUAL_CHECK` when the fixed endpoint or response contract changes; do not add dynamic signing or browser emulation.
