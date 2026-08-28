## 1. Specification

- [x] 1.1 Define explicit manual-success confirmation and conservative confirmation-time anchoring
- [x] 1.2 Preserve an unanchored initialization path and local-only secret handling
- [x] 1.3 Define redacted initialization output and early-run due behavior

## 2. State and lifecycle

- [ ] 2.1 Add a state transition for a user-confirmed manual success without recording a Doger request attempt
- [ ] 2.2 Extend initialization prompts, time injection, persistence, rollback, and lifecycle reports
- [ ] 2.3 Preserve existing unanchored and first-Doger-success behavior

## 3. CLI and documentation

- [ ] 3.1 Add the exact local `ANCHOR` prompt and document its conservative timing semantics
- [ ] 3.2 Update README, scheduled-task instructions, security guidance, and `$doger`
- [ ] 3.3 Document the migration path for installations initialized before this change

## 4. Verification

- [ ] 4.1 Add state, lifecycle, CLI, redaction, and exact eight-hour boundary tests
- [ ] 4.2 Run `npm run check`, strict OpenSpec validation, package inspection, and `npm audit`
- [ ] 4.3 Verify anchored and unanchored CLI initialization through synthetic local stores without contacting JD
