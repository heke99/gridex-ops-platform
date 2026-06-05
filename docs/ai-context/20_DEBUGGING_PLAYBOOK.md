# Debugging Playbook

## General debugging flow

1. Read CURRENT_TASK.md.
2. Identify the failing flow.
3. Find the smallest set of likely files.
4. Inspect logs/events/payload before changing code.
5. Confirm source of truth.
6. Fix root cause, not only symptom.
7. Add diagnostics if the error would otherwise be hard to understand.
8. Validate.
9. Update changelog/context.

## Ediel send blocked

Check:

- generated message type
- inbound related message
- selected test suite
- selected message family
- route profile
- sender/receiver/subaddress
- encryption requirement
- send readiness guard
- event log reason

Do not bypass guard unless it is proven wrong.

## Inbound encrypted message fails

Check:

- message is actually encrypted
- CMS recipientInfo
- route/certificate mapping
- tenant actor settings
- private certificate availability
- decryption error
- EDIFACT parse after decryption
- unresolved/manual review handling

## Import/billing mismatch

Check:

- tenant/company scope
- period
- file source
- parser
- row validation
- metering point matching
- duplicate detection
- finalized export state
- audit events
