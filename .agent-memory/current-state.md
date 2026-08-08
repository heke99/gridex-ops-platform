# Current state

Last updated: 2026-08-08T20:01:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- PR: `#90`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

Large-file split is ordinary-CI proven through migration/provenance checks, API billing tenant regression, full repository typecheck, quote idempotency and targeted Vitest. All customer-application production modules created by the split are <=2500 lines. The final-contract regression follows the durable commit call in `customerApplicationProcess.ts`; runtime behavior and the assertion itself are unchanged.

Exact replay on `2f365f7d186e9a26c21ad9fbe7174181af69cb72` proved the complete portal-account prerequisite family works and advanced through `20260616223000`, `20260616234500`, `20260617120000` and `20260617170000`. The next first SQL failure was `20260617183000_portal_documents_mail_onboarding_batch.sql`, where `powers_of_attorney.customer_contract_id` was missing.

Current implementation restores only that source-defined runtime column from checksum-pinned pre-ledger source `20260528_debug_post_repair_schema_guardrails.sql`, interleaved immediately before `20260617183000`. Artifact checksum and static migration provenance pass. No live Supabase write and no historical migration edit.

Next: exact-HEAD required CI. Continue only from an actual replay or required-check failure. Stop migration work immediately when full replay/fingerprint passes.
