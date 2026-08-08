# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `02e0dca29584fd6854e117f03043382b9a709f77`

Verified: verify/provenance/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

Current failure: `20260612123000...:593` cannot resolve `public.customer_info_requests`. This is part of the remaining schema-only family in checksum-pinned pre-ledger `20260520_batch_3_4_onboarding_pricing_billing_engine.sql`, whose full source is excluded because narrower derived artifacts already substitute it.

Current implementation adds one comprehensive source-bound auxiliary bootstrap for info requests/events, authorization scopes, metering permission sites, billing export tables, source metadata extensions, indexes and service-role RLS. No business rows or live database state are changed.

Next: push, inspect exact-HEAD CI, continue from first replay error until replay + schema fingerprint pass; then verify all same-HEAD gates, mark REM-002 VERIFIED, run final campaign rescan, close remaining findings, and merge only when the complete release gate is green.
