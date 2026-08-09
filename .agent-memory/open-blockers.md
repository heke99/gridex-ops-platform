# Open blockers

Last updated: 2026-08-09T10:05:00Z

There are no known unresolved **code-remediation blockers** from the completed audit campaign. The items below are external configuration, authoritative masterdata/onboarding, or an explicitly accepted verification-evidence gap.

## 1. Empty-database replay evidence gap

The last real destructive clean replay reached `20260728170000_live_schema_code_canonical_sync.sql` and failed first on missing `customer_invoice_lines.vat_rate`. The complete source-defined invoice-line runtime family (`line_type`, `unit`, `vat_rate`, `sort_order`) was subsequently restored and checksum/provenance registered.

A post-fix full empty-database replay was unavailable because GitHub Actions hosted jobs are account/billing blocked and no isolated PostgreSQL/Supabase preview database exists. Production/default Supabase was not used destructively. This gap was explicitly accepted for the owner-authorized no-Actions release and must not be reported as a PASS.

## 2. Repository protection

GitHub reports `main` unprotected. The installed connector exposes no branch-protection/ruleset write action.

## 3. Supabase hosted Auth setting

Supabase Security Advisor reports Leaked Password Protection disabled. The installed connector exposes no hosted Auth/Management configuration write action.

## 4. Grid-owner canonical masterdata

60 active grid areas depend on 35 platform grid owners whose `ops_grid_owner_id` is null. Exact matching against OPS `grid_owners` by direct market actor, Ediel ID and owner code found zero candidates for all 35. Do not create guessed mappings.

## 5. Ediel route receiver identifiers

2 active route profiles lack `receiver_ediel_id`. No fallback exists in the profile counterparty ID, communication-route counterparty ID or linked grid-owner Ediel ID. Authoritative receiver IDs are required.

## 6. Ediel recipient-certificate onboarding

Health/readiness still reports recipient-certificate onboarding gaps. Candidate analysis includes absent and ambiguous cases, so bulk linking is unsafe. The system's official `/api/cron/ediel/actor-readiness` process is secret-protected and may perform external certificate lookup before route-profile readiness/auto-send evaluation. The available connector cannot access or bypass that secret.

## Completed release evidence

- PR #90 merged to `main` as `6c86e547131f50472def8893ce2861c6e06a7ba2`.
- PR #92 merged to `main` as `55ad4053c64ec78ae5fe111eecef572edbd352dd`.
- Vercel deployment `dpl_DdPGCM3epEPccQPGToBEaE15865c` for `55ad4053...` is READY on `app.gridex.se`; production compile, TypeScript, page-data and static-generation stages passed and no error/fatal runtime logs were observed at post-release check.
- Exact Supabase ledger versions `20260808214500`, `20260809110000`, `20260809114500` are present.
- `gridex_ops_health_checks_v3()` executes without SQLSTATE `42702`.
- Grid Owner view returns 183 rows / 183 distinct owners / zero duplicates after direct-first remediation.
- Ediel `renewal_available` certificate status is consistent across strict resolver, route contract and health logic.

Future work should address only the authoritative configuration/data gaps above unless new concrete runtime evidence reveals a new code defect.
