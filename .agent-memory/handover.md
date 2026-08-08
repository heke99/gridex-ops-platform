# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `7d7911d39fbedb05d9adad04e794d10d2a848b0d`

Verified: verify/provenance/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

Replay has moved beyond all prior prerequisite families. Current exact failure is `20260612123000...:593`, where `public.customer_blockers` is missing. Source `20260526_batch_3a_3b_customer_intake_blockers_documents.sql` and live dev agree on the base workflow relation.

Current implementation restores only that source relation, checks, three indexes and service-role RLS. It seeds no blockers/documents/customer data and does not mutate live Supabase.

Next: push, read exact-HEAD CI, remediate the next first SQL error until replay + fingerprint pass; then verify all same-HEAD gates, mark REM-002 VERIFIED, perform final campaign rescan, resolve remaining audit findings, and merge only when the entire release gate is green.
