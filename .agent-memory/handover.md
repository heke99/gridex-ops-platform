# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `8e678aaee387ffb15bc68072e48dc141e8947090`

## Verified state

- `verify`: PASS.
- migration integrity/provenance regression: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.
- NanoID remains resolved at `3.3.17`.
- `GRIDEX-REM-002` is not VERIFIED.

## Replay progress

The pricing-component prerequisite fix is confirmed by CI to move replay beyond `20260609100000`.

Current exact failure from the `8e678a...` CI artifact:

- migration: `20260609183000_batch_8_admin_operations_website_email_webhooks.sql`
- line: 67
- relation: `public.communication_logs`
- error: `column "customer_number" does not exist`

The skipped checksum-pinned source `20260609162000_batch_7_website_integration_foundation.sql` defines the missing 7D communication-log columns and source customer-number index. Live dev confirms them. The older `20260531213000` migration supplies only the base communication log table.

## Current implementation

`supabase/bootstrap/20260609_communication_log_trace_foundation.sql` restores only the five source-defined 7D trace columns and `communication_logs_customer_number_idx`. It is interleaved after `20260609143000` and before `20260609183000`; running it as pre-history foundation would be incorrect because the base relation would not yet exist.

No historical migration or live DB state is changed.

## Next deterministic action

1. Push the current work-unit commit.
2. Read PR #90 CI for the exact new HEAD.
3. On replay failure, download the new artifact and use its first SQL failure as the next finding.
4. Repeat until clean replay passes.
5. Verify `verify`, provenance, security and replay on the same final HEAD.
6. Only then mark `GRIDEX-REM-002` VERIFIED and continue immediately to database/code full consistency.
