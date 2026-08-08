# Current state

Last updated: 2026-08-08T19:56:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- PR: `#90`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

Large-file split is ordinary-CI proven through migration/provenance checks, API billing tenant regression, full repository typecheck, quote idempotency and targeted Vitest. All customer-application production modules created by the split are <=2500 lines. The final-contract regression follows the durable commit call in `customerApplicationProcess.ts`; runtime behavior and the assertion itself are unchanged.

Exact replay on `a0b5258644029743f87037a50afb790fd05c660a` proved the portal `user_email` prerequisite works and advanced inside `20260616223000_customer_portal_bundle_resolver_backfill.sql`, where the same canonical statement then required `customer_portal_accounts.is_active` and later reads `activated_at`, `verified_at` and `match_method`.

Current implementation restores only that source-defined portal-account field family (`user_email`, `is_active`, `activated_at`, `verified_at`, `match_method`) plus the empty-replay-safe email backfill from checksum-pinned pre-ledger source `20260525_debug_fix_batch_1b_schema_code_alignment.sql`, interleaved immediately before `20260616223000`. Artifact checksum and static migration provenance pass. No live Supabase write and no historical migration edit.

Next: exact-HEAD required CI. Continue only from an actual replay or required-check failure. Stop migration work immediately when full replay/fingerprint passes.
