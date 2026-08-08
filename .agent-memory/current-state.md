# Current state

Last updated: 2026-08-08T16:15:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- PR: `#90`
- Last verified code HEAD before this DB prerequisite: `ed3d746cfdc4489920bc56e3686d92affedcc8d3`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

Large-file blocker is structurally fixed: `lib/website/customerApplications.ts` was split into bounded domain modules, all generated files are <=2500 lines, temporary split tooling was removed, and full repository `npm run typecheck` passed with the permanent 4096 MB compiler budget aligned with the existing build budget.

Latest clean replay on `0527a632d323b908d10719cd7d07f84488e50e51` advanced through Batch M, O6, `20260615203000` and `20260615214500`, then failed in `20260615230000_tenant_legal_defaults_live_test_intake_tracking.sql` because `companies.primary_contact_email` was absent. The same canonical view also reads `companies.support_email`.

Current implementation restores exactly those two source-defined fields from checksum-tracked pre-ledger sources: `20260519_final_saas_hardening.sql` and idempotent `20260520_batch_6e_rbac_tenant_stats_whitelabel.sql`. No live Supabase write and no historical migration edit.

Next: run exact-HEAD OPS hardening; continue only from the next actual clean-replay failure. On full replay/fingerprint success, mark REM-002 VERIFIED and stop migration archaeology.
