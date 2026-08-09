# Remediation handover

Status: **COMPLETE WITH EXTERNAL / CANONICAL-DATA GAPS**

Primary remediation PR: `#90` — merged
Follow-up Ediel consistency PR: `#92` — merged
Verified application SHA before this documentation-only finalization: `55ad4053c64ec78ae5fe111eecef572edbd352dd`

## What is complete

- Full audit remediation campaign merged to `main` without editing historical timestamp migrations.
- Production Vercel deployment `dpl_DdPGCM3epEPccQPGToBEaE15865c` for SHA `55ad4053c64ec78ae5fe111eecef572edbd352dd` passed Next.js compilation, TypeScript, page-data collection and 13/13 static generation and became `READY` on `app.gridex.se`.
- No error/fatal runtime logs were observed for that deployment during post-release verification.
- Supabase exact migration ledger versions `20260808214500`, `20260809110000` and `20260809114500` are applied and verified.
- OPS health SQLSTATE `42702` is resolved.
- Grid Owner direct-first actor resolution is live: 183 view rows, 183 distinct grid owners, zero duplicate rows; prior actor join ~1.09 s is reduced to ~26 ms at the actor stage and ~36.7 ms for the measured full count query.
- Ediel `renewal_available` recipient certificates are handled consistently by strict certificate resolution, route-contract guard and OPS health logic.
- Customer-document storage isolation, logging redaction, dependency hardening, customer-application module split and replay/provenance foundations from PR #90 are merged.

## Release-method caveat

The repository owner explicitly directed the release to proceed without GitHub Actions because hosted jobs are blocked before step 1 by an account billing/spending-limit condition. The red Actions statuses are not code/test evidence and must not be described as passing.

The last real destructive empty-database replay before that outage reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on `customer_invoice_lines.vat_rate`. The complete source-defined invoice-line family was subsequently restored and provenance-registered, but a post-fix empty-database replay was unavailable. Never claim that final replay passed.

## Remaining items are not safe code fixes

1. GitHub `main` remains unprotected; the installed connector cannot write protection/rulesets.
2. Supabase Leaked Password Protection remains disabled; the installed connector cannot write hosted Auth settings.
3. 35 platform grid owners, affecting 60 active grid areas, have no deterministic OPS-grid-owner counterpart. Exact actor/Ediel/owner-code matching returned zero candidates.
4. 2 active Ediel route profiles lack receiver Ediel ID and no fallback value exists in profile, communication-route or linked grid-owner data.
5. Recipient-certificate readiness still has onboarding gaps. The official `/api/cron/ediel/actor-readiness` path is secret-protected and can perform external certificate lookup; the available connector cannot access or bypass its secret. Do not invent certificate mappings.

If future work resumes, begin from these authoritative external-data/configuration gaps rather than reopening already remediated code findings.
