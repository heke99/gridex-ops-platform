# Tenantservice side track: checkpoint

Status: #425 MERGED (squash `d548e23`). Follow-up in progress. Last updated 2026-10-01 ~20:40 UTC.

Separate from the Ediel checkpoint (`checkpoint.json`). Do not overwrite that file.

## Where things stand
- **Branch:** `claude/bold-edison-vgwx65`.
- **Draft PR:** heke99/gridex-ops-platform#425, watched.
- **Evidence:**
  - `quality/tenantservice/P0-inventory-and-findings.md` (findings register F1–F16);
  - `quality/tenantservice/P7-P8-threat-model-and-rollout.md` (threat model, ASVS, rollout, rollback).
- **User decisions (2026-10-01):**
  - Continue the plan.
  - Merge to main **when everything is done and CI is green**.
  - Fix red CI.
  - Always keep agent memory up to date.
- **Merging to main = production deploy** (`vercel-production-deploy.yml`).
  - Behaviour changes are behind flags whose defaults equal current production behaviour: `GRIDEX_PORTAL_IDENTITY_ENFORCEMENT=report`, `GRIDEX_INVOICE_DELIVERY_RESOLVER=legacy`.
  - Never flip these flags without a separate explicit decision from the user.

## Merged to main this session
- **#427:** next 16.3.8, nodemailer 10, imapflow 2, ip-address 10.7.2 (security). `ecc19a2`.
- **#428:** F16, support cases no longer trigger operational stops. `3a1d351`. Read-only check: `gridex-ops-dev` had 0 affected support cases. The production DB is not reachable from this session.

## Open PRs
- None besides #425. **#429 merged** (`a94557c`, Ediel native run-relative calendar); main merged into #425 at `4cd6d74`.

## Done on #425 (verified locally: vitest 396 files / 6303 tests, typecheck, lint, api:docs, build)
| Item | Commit(s) |
|---|---|
| P0 inventory | `6fddd8a` |
| P1a read-only resolver + binding (behind flag) | `6fddd8a`, `b2caf84` |
| P1b no reactivation / F5 | `a4dbb0a` |
| P2a shared contact rules | `140387a` |
| P3 shared invoice delivery (behind flag) | `75132a1`, `b2caf84` |
| P4a support conversation | `17a56ea` |
| P5a navigation + case view | `b146cb7` |
| tenantDb | `9a2f98d` |
| P6 contract 2026-10-01.1 | `0223b9f` |
| P5b customer card header/groups | `0267af5` |
| P6 reference client | `b08fdb9` |
| F9 unique idempotency migration | `19b9251` |
| P7/P8 docs | `d2e45b9` |
| P2b migration `20261001210000_customer_contact_change_transaction.sql` (RPC `gridex_customer_contact_change_v1`; repairs `customers.invoice_email` replay drift; staff authorized via `gridex_actor_has_company_permission(...,'masterdata.write')`) | `19b8c7f`, `5a708ce`, `71c56c7` |
| P2b adapters: OPS `profile-actions.part-1.ts` + API `profile-update/route.ts` call `lib/customer-service/contactChangeTransaction.ts` | `fc1e60e` + types commit |

## Next actions (in order)
1. Types regenerated from clean replay artifact (sha f256db9b…) and committed with adapters. Wait for #425 CI fully green.
2. Behaviour note: OPS profile save now requires `masterdata.write` in the DB (before: only operate-company; UI already hid the edit for others). Audit rows now hold only changed fields.
3. **P1c:** needs a user decision (tenant identity provider). Open item.
4. When everything is green: mark #425 ready, squash-merge, verify the Vercel production deploy of the merge SHA.

## Do not touch
- #310.
- Ediel branches and the Ediel memory files.
- Production data.
- The rollout flags.

## Lesson (2026-10-01)
- A migration that changes schema needs BOTH generated files from the CI clean-replay artifact: `supabase/database.types.ts` (+ sha in `scripts/supabase-types-manifest.json`) AND `supabase/schema.sql` + `supabase/schema.fingerprint.json` (from `rem002-schema-snapshot/`). Pushed `763aae2`. Never hand-edit either.

## After merge (2026-10-01 ~21:00 UTC)
- #425 squash-merged as `d548e23`; Vercel production deploy run 36925343909 started.
- **Migrations are NOT applied by the deploy.** Production DB has neither `20261001200000` nor `20261001210000` until someone applies them with explicit user permission.
- Follow-up PR: `applyCustomerContactChange` falls back to the previous sequential path when the RPC is missing (PGRST202/42883), so OPS/API profile saves keep working before the migration. Remove the fallback once all environments have the migration.
- Next: user decision on applying migrations to production; P1c needs an identity-provider decision.

## Production migration status (2026-10-01 ~21:15 UTC)
- #430 merged (`8f4c33c`): RPC-missing fallback is live, profile saves are safe without the migration.
- User said "kör det" to applying migrations. NOT applied, because:
  - Production Supabase project is not identifiable (Vercel `NEXT_PUBLIC_SUPABASE_URL` is a sensitive env; not decrypted).
  - `gridex-ops-dev` (only full-schema project) is at `20260904222450`; main has many later migrations (e.g. Ediel 2026-09-23/24). Applying 20261001200000/20261001210000 would skip them out of order.
- Needed from user: which project is production, and whether the whole pending migration backlog should be applied in order (coordinate with the Ediel track).

## T10 per-customer support quotas (2026-10-01 ~22:15 UTC)
- `SUPPORT_CUSTOMER_QUOTAS` in `lib/customer-service/supportConversation.ts`: 10 new customer cases/24 h, 30 customer messages/h; `429 support_quota_exceeded` (contract already declares 429; no new OpenAPI release). Idempotent replays bypass the case quota. `tenantSelect` gained optional count/head options.
- Production migration queue: files 1–24 + 26 applied; drift repair added 5 canonical columns (permissions.category, roles.updated_at, customer_contacts.created_by/updated_by, customer_sites.annual_production_kwh); resume from file 25 strictly sequentially (in progress via subagent, user approves each Supabase call).

## Production migration queue COMPLETE (2026-10-02 ~07:00 UTC)
- Project `piidsfebjqjmnepdpnas` (gridex-ops-dev) IS production (user-confirmed).
- All 61 pending repo migrations (20260921171346 … 20261001210000) applied; ledger count 341. All 21 previously-missing public functions present; F9 index and customers.invoice_email present.
- Deviations to know: (1) drift repair `schema_drift_repair_canonical_columns_20261001` added permissions.category, roles.updated_at, customer_contacts.created_by/updated_by, customer_sites.annual_production_kwh; (2) files 42–44 applied in equivalent form (identical function bodies; `ALTER COLUMN scope_point SET EXPRESSION` instead of DROP/ADD COLUMN, because the Supabase MCP times out on DROP COLUMN; table had 0 rows, identical index already present); (3) file 26 applied before 25; (4) ledger versions are apply timestamps, not file versions — reconcile with `supabase migration repair` before any `db push`.
- Files 45–61 verified byte-identical (md5) with repo files.
- Open: node-forge GHSA-86w9-cpqp-85rv (no fixed release) blocks `security:audit-production` on every PR — user decision pending (documented exception vs replace library). Quotas raised to 50/day + 150/h in PR #432. P1c (provider-agnostic OIDC/JWT end-customer proof) proposed, awaiting go.

## P1c built (2026-10-02 ~07:20 UTC), on branch claude/bold-edison-vgwx65 / PR #432
- Migration `20261002080000_tenant_customer_identity_providers.sql`: tables tenant_customer_identity_providers (public key material only; private JWK rejected by CHECK) + tenant_customer_assertion_replays (jti). RLS on, service_role only, classified 'tenant'. Types/schema snapshot must come from the CI clean-replay artifact.
- `lib/customer-portal/customerAssertion.ts`: node:crypto JWS verify (RS256/PS256/ES256; none/HS* rejected), iss/aud/exp/nbf/≤15 min lifetime, sub = linked portal user id, jti replay, OIDC JWKS fetch (https, no redirect, 3 s, 64 KB, 10 min cache). Gate per tenant: no provider → unchanged; 'report' logs `customer_assertion_would_reject`; 'enforce' → 403. Missing table (42P01/PGRST205) → treated as no provider (deploy-safe before migration).
- OPS page `/admin/customer-login` (Inställningar → Kundinloggning): choose provider vs own login; OIDC discovery with SSRF guard (`lib/customer-portal/identityProviderSetup.ts`); own login = key pair generated in the browser, only public JWK sent; Testa; Logga bara/Kräv verifierad kund; remove. Actions bound to expected_company_id, company-admin permission, audited.
- Production: migration 20261002080000 NOT yet applied to piidsfebjqjmnepdpnas; apply after merge (no DROP, safe).

## #432 MERGED (2026-10-02 ~07:40 UTC, squash `2f7b8df`)
- Contents: P1c (customer assertion verification + OPS Kundinloggning, per-tenant iss/aud), support quotas 50/day + 150/h, node-forge audit exception (expires 2026-11-01) + S/MIME round-trip test.
- Production: migration `tenant_customer_identity_providers` applied to piidsfebjqjmnepdpnas (md5 matches repo file). No tenant has a provider yet → behaviour unchanged.
- Ediel `ediel-document-reference-native` passed in the last two clean replays (was red earlier on 07:00–07:05 runs); no fix applied, treat as intermittent and watch.
- Open: node-forge upgrade before 2026-11-01; ledger reconciliation (`supabase migration repair`) before any `db push`; attachments with quarantine; perf baseline.

## Attachments step A (2026-10-02 ~08:35 UTC)
- Migration `20261002100000_support_case_attachments.sql`: private bucket support-case-attachments (pdf/png/jpeg, 10 MB), table customer_case_attachments (quarantined→released/rejected, composite case/company/customer FK, RLS service-only).
- `lib/customer-service/supportAttachments.ts`: magic-byte type detection, active-PDF rejection (hex-escaped names decoded), filename sanitizing, SHA-256 re-verified on download, 20/day/customer quota. Content inspection, NOT antivirus (seam: inspectAttachment).
- OPS: case detail lists attachments + upload (≤4 MB because server action body limit is 5 MB) + download route with nosniff/CSP sandbox/attachment disposition.
- Step B (open): customer support API endpoints for attachments = new OpenAPI release.
- Then: perf baseline, then ledger reconciliation (user order).

## PR #433 in CI (2026-10-02 ~09:15 UTC)
- Added on top of step A: perf baseline (`quality/tenantservice/perf-baseline-2026-10-02.md`), ledger reconciliation (`quality/tenantservice/migration-ledger-reconciliation-2026-10-02.md`), regenerated types/schema snapshot from clean replay.
- DECISION: no `supabase migration repair` — docs/migration-provenance.md forbids manual ledger writes. Never run `supabase db push` against production; apply file by file and verify.
- Fix from CI: tenant invariant F-8/F-10 → attachment unique keys are now (company_id, public_reference) and (company_id, storage_path). Migration edited in place (never applied anywhere); checksum updated.
- Ediel `ediel-document-reference-native` root cause (likely): app clock vs DB clock skew made startedAt < attempt.recorded_at → observe rejected → 1 attempt / 0 outcomes. Fix: `alignObservationToAttempt` in lib/ediel/sources/documentReferenceCapture.ts (+ unit test). If it still fails, investigate further.
- Next: merge #433 when green → apply 20261002100000 in production (verify md5/RLS/grants) → reset branch from main → attachments step B (customer API + OpenAPI release 2026-10-02.1) → profile public-contracts.

## #434–#437 MERGED; F12 + P3 live (2026-10-02 ~afternoon UTC)
- #434 attachments API (contract 2026-10-02.1), #435 public-contracts timings, #436 parallel reads + contract 2026-10-02.2 + F13, #437 F12 identity change (customer approval by e-mail link + PDF, takeover of binding contract requires new customer to accept contract + terms) + P3 billing profile revisions.
- Production: migrations customer_identity_change_requests + customer_billing_profile_revisions applied. Verified: RLS on, 0 anon/authenticated grants, 5 triggers, backfill 4/4 customers at revision 1, ledger 345.
- Next: P5b customer card restructure (fixed header + action menu, tabs Översikt/Uppgifter/Avtal & anläggningar/Fakturor/Ärenden & historik). Scheduled timings analysis 2026-10-03 (trig_019oygjwmFvjcbFofRRYwn13). node-forge before 2026-11-01.

## Invoice provider per tenant + flags (2026-10-02 ~13:30 UTC), #439 MERGED (dc7d950)
- Migration tenant_invoice_provider_selection applied in prod (ledger 346): invoice_provider_catalog (capway_aptic selectable, nordfin listed/not selectable), RPCs gridex_select_invoice_provider_v1 / gridex_set_invoice_dispatch_enabled_v1 (audited; switch blocked while runs draft/processing; enable needs connection ready/active), companies.billing_provider_environment now in migrations.
- lib/billing/providers/registry.ts: no default provider/env; dispatch requires enabled + run provider/env match.
- Vercel prod+preview: GRIDEX_INVOICE_DELIVERY_RESOLVER=shared, GRIDEX_PORTAL_IDENTITY_ENFORCEMENT=enforce (user approved 2026-10-02).
- User decisions 2026-10-02: Nordfin NOT built now (stays listed, would be a tenant option later). Capway runs in TEST only. Add file-based invoicing: tenant downloads a file the invoice provider imports.

## Independent Gridex Web integration dependency (2026-10-02 ~17:45 UTC), unpublished candidate

- Isolated branch `fix/portal-identity-contract-2026-10-02` from origin/main `e98cef3aeefd0c564a4436e2e409bb0a5262c866` (remote rechecked unchanged). No Ediel checkpoint/branch, existing PR, rollout flag or production migration/data modified.
- Four executable-confirmed defects corrected: conflicting supplied portal/auth IDs; report-mode reads creating links; first-strong/silently truncated sync candidate matching; caller UUID wrongly used as public customer reference causing a response-safety 500 after linking (including related profile/bundle/sync/event paths).
- Report-mode read fallback remains available without writes; strict support routes and controlled link mode retain existing enforcement. Saturated/nonunique factor matching fails closed before identity writes. Public customer reference uses verified company + resolved OPS customer, while `external_customer_id` stays available separately.
- Local verification: 103 affected/adjacent unit tests + 31 quality functional tests, app/tests TypeScript, scoped lint, full `api:docs`, two sync error scripts, tenant service-role ratchet and diff check pass. Final 103+31 targeted rerun also passes on supported Node22.23.3. Full/native/exact-head CI and root review pending. Root authorized a local checkpoint commit; no push before root review.
- Evidence: `quality/tenantservice/portal-identity-contract-fixes-2026-10-02.md`. Next: root review, then separate OPS PR/exact-head CI; do not merge active masterplan work as part of this candidate.
