# Handover

PHASE-38 is locally verified but not applied. Release remains NO-GO.

The repaired evidence migration is `20260802013000_ediel_test_evidence_v2.sql`; the new transactional website projection is `20260802160000_website_application_committed_canonical_event.sql`. Both parse and compile against `gridex-ops-dev` inside transactions that were explicitly rolled back. Post-checks confirmed neither object remained.

Local proof under Node `v22.22.0`: clean `npm ci`; app/script/test typechecks; 62 Vitest files and 417 tests; migration integrity for 336 files/240 version groups; hardening regressions; zero high/critical production vulnerabilities; full Next.js 16.2.12 build. ESLint has 0 errors and 126 classified unused-variable warnings.

Database facts: A–C objects exist but their versions are absent from the remote ledger; D objects are absent. Of 232 legacy test runs, 153 have null `company_id` and none of those 153 has a deterministic customer/actor-profile tenant resolution. Do not guess ownership and do not mark A–C applied until exact definitions match.

Continue in this order:

1. Compare installed A–C functions/tables/views/policies with migration definitions and save the diff.
2. Repair only exact-matching A–C ledger rows.
3. Preview the migration plan; apply D–F and `20260802160000` in isolated staging.
4. Review quarantine, validate only clean constraints and run DB/RLS regressions with real fixtures/JWT contexts.
5. Repeat clean Node 22 gates, deployment smoke tests and cross-repository parity checks.

Never use a fallback tenant, client-supplied evidence/result/role, production messages as test evidence, or an unreviewed global `supabase db push`.

