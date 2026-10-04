# Tenantservice side track: checkpoint

## Separate staff API workstream — 2026-10-03

User requires staff-only `support123.gridex.se` and API-only OPS staff Auth,
customer/support data. OPS source baseline2c8e283e; Ediel memory is unchanged.
Standalone staff2026-10-03.1 raw SHA
cf524f691b2ebd37ef8dfcc4b898c55fc74a99c930a59089235adbfda2752d71;
legacy .4 unchanged. All8 forward migrations are checksum-registered; first4
published bytes remain immutable. Real native deadlock, clean-replay policy gap,
Website-only machine auth and current-client commit authority are corrected.
Final local OPS443 files/6707 tests and app/test/script TypeScript, API/RBAC,
performance/service-role gates pass. All8 actual selected SQL/machine core pass
single-connection PG17.5 diagnostic. Source322f9c7 actual PG17.6 passes20
concurrency programs (run37162609294/job111318986161). PG16 fixture now strips
only four unsupported PG17 MAINTAIN table ACL tokens; final rerun pending.
Authentic all8 capture11288273001/run37162609263/job111318986144 imported
exact types/schema/fingerprint; manifest binds observed ZIP/checkout/tree hashes.
Types64584abb..., schema cba8c513..., fingerprint9c3acdc5...; local migration
checks/new-schema SQL diagnostics pass. Full replay later parity stages pending.

Web PR43 f640d29028199006623ac3e3888170e0fbe1b90e tree4f8ce40d88a5e2f2ba69fb7d6533e52f9c7b2786:
quality37161878576, OpenAPI37161878579, native16/17 37161878583 all SUCCESS.
Previewdpl_8EQuim2JX1S5K8dZAdN6mNhVvBnv READY. Fixed all-path NextAction
host bypass, with compiled actual14-path denials plus main/asset controls.
Provider/two-company authenticated production is not established by these gates.

Evidence: quality/tenantservice/staff-api-verification-2026-10-03.md.
Next: publish final OPS corrections and authentic capture import; run
native16.15/17.6/full replay and qualify exact head; then
coordinate secure keys/settings/migrations/cutover and real provider/Storage/RBAC.
OPS dashboard access remains unavailable to the logged-in Web Supabase account.
No production activation is claimed. Preserve every non-staff checkpoint section.

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

## #440 MERGED (2026-10-02 ~14:15 UTC, d110808): invoice file export + Capway test hardening
- Migration invoice_file_export applied in prod (ledger 347): catalog file_export selectable; invoice_export_files (append-only, RLS, service-role read); invoice_export_items.export_file_id; gridex_create_invoice_export_file_v1 (all-or-nothing claim, items + customer_invoices sent, audit).
- lib/billing/invoiceFileExport.ts (CSV/XLSX/JSON from stored rows), OPS Fakturor section + /admin/billing/invoice-files/[id], docs/ops-invoice-providers-and-file-export.md.
- Fixes: prepare uses selected provider; retry cron parks configuration_error per item; test center pre-checks Capway/test/enabled.
- Plan status: API/UI build complete. Remaining: timings analysis 2026-10-03 (scheduled), node-forge before 2026-11-01, browser verification (needs user), Capway prod creds (user, when going live).

## Independent Gridex Web integration dependency (2026-10-02 ~17:45 UTC), unpublished candidate

- Isolated branch `fix/portal-identity-contract-2026-10-02` from origin/main `e98cef3aeefd0c564a4436e2e409bb0a5262c866` (remote rechecked unchanged). No Ediel checkpoint/branch, existing PR, rollout flag or production migration/data modified.
- Four executable-confirmed defects corrected: conflicting supplied portal/auth IDs; report-mode reads creating links; first-strong/silently truncated sync candidate matching; caller UUID wrongly used as public customer reference causing a response-safety 500 after linking (including related profile/bundle/sync/event paths).
- Report-mode read fallback remains available without writes; strict support routes and controlled link mode retain existing enforcement. Saturated/nonunique factor matching fails closed before identity writes. Public customer reference uses verified company + resolved OPS customer, while `external_customer_id` stays available separately.
- Local verification: 103 affected/adjacent unit tests + 31 quality functional tests, app/tests TypeScript, scoped lint, full `api:docs`, two sync error scripts, tenant service-role ratchet and diff check pass. Final 103+31 targeted rerun also passes on supported Node22.23.3. Full/native/exact-head CI and root review pending. Root authorized a local checkpoint commit; no push before root review.
- Evidence: `quality/tenantservice/portal-identity-contract-fixes-2026-10-02.md`. Next: root review, then separate OPS PR/exact-head CI; do not merge active masterplan work as part of this candidate.

## Independent Web identity PR #454 rebase (2026-10-02 ~20:30 UTC)

- Root published draft PR #454. Rebased its one owned local identity commit onto fetched main `d8a5a111c02c1805b0be4a03284ecd178b40c947`; no text conflicts and range-diff confirms the same patch. Upstream atomic billing import/invoice purchase/customer merge changes preserved unchanged.
- Fresh Node 22.23.3 checks pass: 103/103 affected/adjacent tests, 31/31 quality functional tests, app/test TypeScript, scoped lint, seven API docs checks, both customer sync error scripts, service-role ratchet (2,337 vs 2,353), diff check. No full/native/production verification or git push claimed.
- Separate inherited merge lifecycle gap reported to root: active portal links stay on merged sources while sites/contracts/cases move to primary; resolver still accepts the company-bound source and matching does not exclude merged candidates. Previous merge omitted the same tables. No identity patch scope expansion or tenant predicate weakening.
- Next: root publishes the prepared tree to existing draft PR #454 and verifies required CI; support schema .3 and merge lifecycle work stay separate. Evidence updated in `quality/tenantservice/portal-identity-contract-fixes-2026-10-02.md`.


## 2026-10-02 — .4 support schema correction after live .3

- Main `d9dda64a19e5733e0324600ce072c36b38c716c7` published PR457's attachment-header `.3`; direct live manifest/immutable fetches matched its exact normalized bytes and digests.
- Preserve all `.2`/`.3` archives, routes and fixtures plus the `.3` prep script. Original PR456 branch is unchanged; replacement branch `fix/support-schema-combined-2026-10-02.4` advances closed Detail/manifest fixes to `.4`.
- Minimum supported integration remains actual live `.3`; `.4` is backward-compatible relative to `.3`. `.2` is historical, not newly advertised as supported. Binary header correction is retained, blank request IDs receive UUIDs, and historical document/catalog headers use each document's version.
- Node22.23.3: 12 affected suites/66 tests, quality31, app/test TypeScript, scoped TS lint/generator syntax, api:docs/compatibility/release/runtime-parity, mechanical, multitenant flow and diff checks passed.
- Evidence: `quality/tenantservice/support-detail-schema-release-2026-10-02.4.md`. No `.4` deployment, prod DB/flags/scopes/secrets/domain activation is claimed.

## Current-main `.4` publication candidate (2026-10-02)

- Cherry-picked unchanged correction onto main `61fc46fe` in isolated branch `fix/support-closed-schema-release-2026-10-02.4`; preserves #459 memory/#460 metering test and published immutable `.3`. Fresh direct live manifest has that same build SHA and `.3` release/minimum. Support detail and actual manifest still fail their closed `.3` schemas; replacement is necessary.
- Fresh Node22.23.3: nine affected suites58/58; app/test TypeScript; api:docs, compatibility, immutable release verification and runtime/OpenAPI parity pass. Diff clean. Full exact-head CI remains pending after new draft publication; no merge/deploy/production DDL.
- Separately published PR458 cleanup correction head `71f36b2b9261243b0debedb9f12188b6cb0414d9` fast-forwards parent356211e4 with exact local treee3a97a1137c6646a24ab705b8349921f887b9daa. It fixes only immutable legal-fixture cleanup and records native proof; its new CI remains pending. Root owns integration/release and superseding old PR456 after replacement is linked.

## Current-main identity and .4 integration (2026-10-02)

- PR454 merged from exact head `0351df42a908ff6b939c7f9f3e624b42ff571bee` as main `766fdd423344ef1c93938372d212cc234ec24b28`. Its exact-head OPS/native/quality/build, browser and full E2E checks pass; latest-main-before-merge identity composition additionally passed 71 affected tests and app/test TypeScript. Historical pending status above is SUPERSEDED.
- PR461 original head `01e91fe10393567a1d65cf45e9986efef5d7d874` passed every applicable exact-head workflow, including full native replay/types/tenant invariants/parity. Integrating actual main766fdd42 requires only retaining both append-only checkpoint histories; all API source and immutable .4 bytes merge unchanged. Fresh composition checks and new-head CI remain required after publication.
- PR456 is closed unmerged at 2026-10-02T20:21:08Z; its original head `f73b57277a6f916c978f0826a216e77ff0bc1d8f` is preserved. Replacement PR461 is linked. No production release or mutation is claimed.

- Fresh resolved main766fdd42 + .4 composition on Node22.23.3 passes82 tests/11 affected suites, application/test TypeScript, api:docs, compatibility, immutable release verification, runtime/OpenAPI parity and diff checks. .2/.3/.4 archives are unchanged. New-head exact CI remains required.

## Customer merge portal/support lifecycle (2026-10-02, source candidate)
- Isolated candidate rebased onto `c1fdf06c6735d193a9bb2529811b0f3339ac1360`; #455 invoice migrations and generated artifacts preserved; lifecycle migration renamed to avoid its 224000 version collision. No live OPS DDL. Migration `20261002230000_customer_merge_portal_lifecycle.sql` keeps verified same-company mappings/history and support/site composite owners coherent while preserving subject/provider/status/role. Ambiguous subjects, uniqueness collisions, signed contracts, and cross-company merges fail closed. Rebased again onto d9dda64a (#457, .3 API headers/release); no new DDL.
- Resolver and sync follow merged aliases only for verified existing bindings. Canonical customer number comes from the surviving customer. Late child writes and atomic/fallback contact changes cannot mutate an archived source; concurrent UPDATE returns a controlled conflict instead of deadlocking.
- Native PostgreSQL 16 fixture: 54 canonical affected public tables, 213 actual FKs; exact contract state-machine guard added after full-replay correctly rejected incomplete signed seed. Fixture now proves rejection plus valid locked-draft owner immutability; old merge and contact bugs reproduced, new lifecycle and three two-session concurrency cases passed. Focused source tests 107/107; both typechecks, scoped lint, docs/error contracts, migration gates, and ratchet passed.
- Proof and remaining exact-head clean-replay/artifact requirements: `quality/tenantservice/customer-merge-portal-lifecycle-2026-10-02.md`. Import `gridex-rem-002-clean-replay` canonical schema/types before merge, and compose separately published identity PR #454 in a disposable validation worktree.

- PR #458 first replay run37054206156/headbe8433/tree53bf8fd succeeded fullreset but stopped at the invalid signed fixture. Authentic initial schema snapshot imported from artifact11248021302 (ZIP119e7430…, canonical fingerprinte1703980…); no type file present, so type provenance stays #455 until corrected replay. Final exact-head replay and composed identity/schema proof remain required.

## PR #458 exact-head cleanup repair (2026-10-02)

- Remote head `356211e42114e51a3d2b069758eb81fe3e13931b`: tenant/browser/full E2E pass; OPS run37055739561 clean-replay job110999881821 passes lifecycle SQL and concurrency assertions, then fails on cleanup's company deletion cascading into immutable published legal text. Artifact11248208239 stops before typegen and is not complete replay evidence.
- Isolated repair branch `fix/portal-merge-ci-cleanup-2026-10-02` starts at that exact head. Retain the synthetic company/published onboarding documents until disposable database teardown; clean mutable concurrency rows/actor only and print success after cleanup. No SQL guard, migration or production change.
- Native actual-PG16 RED reproduces the exact immutable cascade with canonical legal seeding/trigger definitions. Corrected Node22.23.3 fixture passes all three races and cleanup; customer fixture count is zero and published synthetic versions remain protected. Syntax/diff pass. Full exact-head Supabase replay/type/schema acceptance still pending.
- Latest fetched/live main `61fc46fe` remains API `.3`. Direct current schemas still reject support `messages` and actual release-manifest metadata; unpublished `.4` replacement is required, preserving immutable `.3`. See `quality/tenantservice/web-ops-dependency-review-2026-10-02.md`. Root owns publication/merge/deployment decisions.

## PR #458 case-owner fixture precision after cleanup (2026-10-02)

- Cleanup published as exact head `71f36b2b`/tree `e3a97a11`; tenant/browser/full E2E and OPS verify/quality pass. Replay `37059428456` passes the cleanup and all 382 native source-owner tests, then fails the old uniform case-owner SQLSTATE expectation at `ediel-case-view-native.test.ts:239`. Artifact `11249644668` stops before typegen.
- Actual PG16 reproduces the old RED and revised GREEN: two customer/tenant mismatches fail the new earlier guard with `23514 customer_portal_customer_not_found_for_tenant`; a coherent B owner targeting case A still fails `customer_case_events_case_owner_fk` with `23503`. Exact guard code/message and third FK expectation retained separately; all existing no-state/event-change checks remain. Root authorized the bounded fixture correction; no production SQL/RLS/grant/schema change.
- Replacement `.4` draft PR #461 is published and mergeable at `01e91fe1`/tree `ae72906d`/parent `61fc46fe`; old PR #456 is closed unmerged with its original head preserved. Frozen `.4` head unchanged while CI runs. New exact-head #458 full replay/type/schema acceptance remains required after this fixture publication.

## Final OPS Web dependencies and lifecycle composition (2026-10-02)

- Status: IN_PROGRESS. PR454 is merged as766fdd42; PR456 is closed unmerged preserving its head; PR461 head5977 passed every applicable exact workflow and root merged it as472d703e7580fdaa49374f4d7aa202da74751057. Actual main includes PR462 tenant/company fail-closed patchb9764ffc. Earlier pending dependency status is SUPERSEDED.
- PR458 headf65f3fbc passed every applicable workflow, including full native replay/types/tenant/parity/schema acceptance in OPS37060952835. Authentic artifact11250727412 (ZIPd39f650b…) types/schema/fingerprint are byte-identical to committed captures and reimported unchanged. Structured manifest records actual checkout8841add6/tree8bc61df8, headf65 and complete capture rather than retaining the historical #455 provenance. No generated artifact was hand edited.
- Final composed candidate preserves identity uniqueness/read-only guards, merge alias/stale-write guards, .4 closed schemas and immutable .2/.3/.4 bytes, plus all PR462 admin-scope changes. Resolved only additive sync helpers/imports and append-only checkpoint history. Fresh Node22:151/151 tests in19 suites, app/test/script TypeScript, scoped lint, API docs/compatibility/release/runtime parity, migration integrity, tenant ratchet, generated-type provenance and diff checks pass.
- Actual main472d703e tree is verified equal to prepareda88ede5e. Next action: publish final composition/provenance as fast-forward to existing PR458 and require every applicable new-head CI gate before root reviews/merges. Deployment/live .4/Web sync belong to root; production migration ledger/order remains a coordinated separate release step. No production mutation is performed here. Evidence: quality/tenantservice/web-ops-dependency-review-2026-10-02.md.


## Lifecycle exact-error boundaries and controlled production order (2026-10-02)

- Actual OPS main remains `472d703e7580fdaa49374f4d7aa202da74751057`; PR454 and replacement PR461 are merged, and `.4` is live on the verified OPS production deployment. Obsolete PR456 remains closed unmerged with its original commits preserved. Root owns Web publication and activation.
- Baseline PR458 head `b08c77e60f4bc0a1c42de2e10ad3fb984b1a808d`, tree `388ab34a9f5447d6217ae574f99bc7891aaf7c7d`, passed every applicable exact-head workflow, including full native replay382 and authentic artifact11251911802. Its actual CI checkout12a5b560 has the exact same tree and generated artifacts remain byte-identical. A subsequent public error-boundary review supersedes b08 as the final app candidate.
- Runtime RED/GREEN proves exact SQLSTATE23514/customer_merged_write_conflict must map at the real resolver/context result, both mounted website event routes, customer-bound shared idempotency writes and website application stages/cached-source resume. The bounded correction preserves established error envelopes, authorization, unrelated constraints/permission handling and all SQL/signatures/schema/archive bytes. Fresh80 focused tests pass; earlier affected/adjacent200 tests pass. Independent review reran47 focused and independently proved33 real partner dispatch/claim tests, with no remaining public REST guard escape.
- Read-only OPS production evidence identifies Supabase link `link_6aa08570afb48191a4eb728ab8e93c81`, project `piidsfebjqjmnepdpnas` / gridex-ops-dev, PG17.6.1.084. Ledger366 contains direct prerequisites under MCP timestamps; only inspected tenantservice230000 is pending. Live-only227000 has NULL SQL and is explicitly excluded from any full production parity claim.
- Independent nativePG17.6 shows active INSERT ON CONFLICT waits and succeeds; only direct child owner UPDATE can conservatively reject during parent lock contention and then succeeds on retry. The case-status/merge40P01 interleaving exists under both the old FK baseline and new guard, with atomic rollback. No lock/guard change is needed. SQL file SHA remains836c083fad0f231a145cf4117527057a20bdc2f73d094c3fbaa53fbab525a4c9.
- Root selects qualified app merge/production READY first, then one exact reviewed230000 apply on the verified project, followed by read-only catalog assertions. No production DDL/business mutation was performed by this agent. The before snapshot and postapply assertions are frozen with native positive proof plus8 rejected catalog faults; see `quality/tenantservice/customer-merge-production-boundary-2026-10-02.md` and its companion files.
- Exact next action: publish this application-only correction plus durable receipts as a non-force fast-forward to existing draft PR458 from expected b08, then require fresh exact new-head CI (verify/quality/build/clean replay/tenant/browser/full E2E) before root merges. **Those new-head CI/deployment/catalog gates are pending at publication.** Do not claim production lifecycle completion before both app READY and applied-DDL assertions pass. Ediel checkpoint/current-task/handover and PR310 are untouched.


## New-main463 composition capture (2026-10-02)

- Before correction publication, actual main advanced to `889a2378411f826026336a593e3fde1ba8ba7258` (merged PR463). It contributes227000, new authentic schema/types/provenance and bounded UI/data-quality changes. All concurrent source/history is preserved. Only migration manifest, types provenance and fingerprint conflicted; application correction had no source conflict.
- Preserve both immutable227000/230000 entries. Generated type bytes and full canonical schema/fingerprint are the authentic latest-main capture (types272c9783…, fingerprint8cfd07b3…), explicitly historical until combined replay. No canonical section hash is manually synthesized or check bypassed. Combined-capture pending metadata is truthful.
- Root reran the exact read-only OPS production preflight after main463 deployed READY (`dpl_9hPQwbGu8unuE24M5QXxpZTjcg8Q`): the complete target catalog still matches the frozen before JSON (ledger366, old RPC bodies/ACL/security,14 immediate/nondeferrable validated FKs, unchanged signed guard, guard/230000 absent). The planned single file remains SHA836c083f….
- Next: publish main889a composition/error correction to existing PR458 from expected b08, run real clean replay and import the genuine combined artifact byte-for-byte. Its historical fingerprint comparison is expected to fail until capture import; never call that first capture run green. Then publish only verified generated capture/provenance and require all applicable new exact-head CI before app-first merge/READY and controlled DDL. No production DDL performed here.

## Authentic combined capture and main464 preservation (2026-10-02)

- PR458 published head `53080e7d74b5a44e275c8aed7eb19a506a290084`, tree `332590e25bf9058b39d24280c6cbc7912e9c14b7`, preserves parents b08 and main889a. Verify, quality/build, tenant, browser and full E2E pass. Native run37068613316/job111042463333 passes lifecycle/concurrency,382 ownership tests, native case/browser/recheck, type generation, tenant invariants and every injected drift class; it correctly fails ONLY comparison to the historical main canonical baseline. This capture run is not an all-green final gate.
- Genuine artifact11254046371 ZIP SHA256 `16daef10057ba44aef6a491879a70df4574be2fd3cf256311b891a8bdae5ec15` has actual checkout `a6a085ee440ee90c53c7bff65d57f2536b5278fa`, whose tree exactly matches53080. Import schema.sql/fingerprint/types byte-for-byte; actual combined fingerprint is `cc62d4a7c0c099fe0cac3dff838388f59c605f82639c0d55f8381a7ba0765da7`, schema SHA256c172f345…, and types272c9783… remain unchanged. No generated section hashes, SQL, immutable archives or frozen pre/post assertions were edited.
- Actual main advanced to `79d03223a33ecd400ee7440b8f6d579e9a8ea25a` (PR464 UI labels/customer names/company pickers). Its complete UI/history delta is preserved with no conflict and no migration, schema, type-generator or replay-input changes. Thus the53080 schema capture remains authentic for identical database inputs. Fresh composed83 focused/UI tests and app TypeScript pass.
- Next: publish this genuine capture/provenance plus latest-main composition as a non-force fast-forward from expected53080. **Every applicable final published-head CI gate remains pending at publication.** Root qualifies that exact head, then app-first production READY/alias, one frozen230000 migration and read-only postapply assertions. No production DDL or business mutation performed by this agent; no unresolved review thread or code finding remains.

- Final pre-publication ref check found newer main `276b9e6155ef2cd83b5d75a61283fc4d99d9f184` (PR465 navigation/Swedish wording). Preserve its full UI/history delta without conflict; database/replay and affected API inputs still have zero diff. Genuine53080 capture is unchanged and final exact-head CI remains pending.
