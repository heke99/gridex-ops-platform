# GRIDEX OPS — contract-flow completion report

Date: 2026-07-27

## 1. Verified root causes

1. `canonical_internal_contract_offers_v` executed full readiness and the
   dynamic delete dependency graph for every list row. One row-level failure
   could abort the complete admin query.
2. The page initialized `offers=[]` and rendered the legitimate empty state
   even after a list exception.
3. Platform tenant resolution silently fell back to memberships/the first
   company when an explicit or missing `company_id` was not usable.
4. `super_admin`, `superadmin`, `platform_admin` and
   `platform_superadmin` were interpreted by duplicated, divergent role lists.
5. Tenant catalog inner relationships could suppress a broken assignment.
6. The website onboarding RPC treated facility and metering-point owners as
   customer candidates. The portal customer ID was not compared with the
   application’s legal identity.
7. Supply activation accepted queued/submitted/sent/waiting switch states, and
   assigned/mandatory starts could bypass the canonical activation command.
8. Monthly underlay generation skipped a billable supply period when no meter
   rows existed. Readiness discarded customer/contract identities before its
   overlap check and preferred the contract customer over the underlay customer.
9. Monthly automation used `billing_export_run_items`, while provider handling
   and portal invoices used `invoice_export_items`. No deterministic bridge
   guaranteed a `customer_invoices` row.
10. Provider-created invoice mirrors omitted canonical contract/export/period
    references and were created only after a later event.
11. Admin counter helpers returned `0` for SQL/RLS/network errors.

## 2. Implemented changes

- Replaced the final contract list view with a cheap `security_invoker` view.
  It retains compatibility columns as `null`, exposes `relation_status` and
  performs no readiness/delete RPC.
- Added lazy single-offer diagnostics, explicit list states and retry.
- Made platform company selection explicit and server-verified.
- Added central TypeScript and PostgreSQL role normalizers/predicates.
- Changed tenant assignment reads to left relationships with visible repair
  status.
- Added `gridex_upsert_internal_contract_offer_v2` to verify every returned
  canonical ID and tenant assignment in the creation transaction.
- Retained the canonical preview/commit deletion graph and commit-time recheck.
- Removed delivery-point customer candidates and added structured legal
  conflicts/manual review plus portal ID verification.
- Added quote references to application and customer contract rows, with
  same-tenant/version triggers.
- Added same-customer/same-contract database triggers and composite FKs for
  supply, underlay, export item and invoice.
- Restricted supply activation to confirmed/accepted/completed and routed
  alternative starts through the canonical activation service.
- Created blocked `missing_meter_values` underlays and persisted canonical
  customer contract identity.
- Made readiness compare exact company, customer, customer contract, metering
  point and period.
- Made `invoice_export_items` the canonical monthly path.
- Added `gridex_create_invoice_export_graph_v1`: one advisory-locked
  transaction reserves the run, canonical items and draft invoice mirrors.
- Made provider success/failure/webhooks update that same invoice idempotently,
  validating amount/currency and ignoring stale state regressions.
- Exposed contract/underlay/export identities through the customer portal.
- Added a tenant-scoped read-only chain tracer at
  `/admin/platform/contract-trace`.
- Updated OpenAPI and implementation/deployment/rollback documentation.
- Changed admin/company count fallbacks to visible “could not fetch” values.

## 3. Changed and added files

### Runtime/UI

- `app/admin/page.tsx`
- `app/admin/companies/[id]/page.tsx`
- `app/admin/contracts/actions.ts`
- `app/admin/contracts/page.tsx`
- `app/admin/platform/contract-trace/page.tsx` (new)
- `app/dashboard/page.tsx`
- `lib/admin/guards.ts`
- `lib/billing/billingReadiness.ts`
- `lib/billing/invoiceReadiness.ts`
- `lib/billing/monthlyAutomation.ts`
- `lib/billing/providerEventProcessor.ts`
- `lib/billing/underlayEngine.ts`
- `lib/contracts/canonical.ts`
- `lib/contracts/flowTrace.ts` (new)
- `lib/contracts/permissions.ts`
- `lib/customer-portal/apiData.ts`
- `lib/customers/matchingService.ts`
- `lib/ediel/flows/inboundBusinessStateMachine.ts`
- `lib/integrations/billing/invoiceExportCore.ts`
- `lib/rbac/roleKeys.ts`
- `lib/tenant/scope.ts`
- `lib/website/customerApplications.ts`

### Database, docs and release state

- `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql`
  (new)
- `scripts/migration-history-manifest.json`
- `docs/openapi/customer-portal-v1.json`
- `docs/openapi/website-integration-v1.json`
- `docs/contract-flow-integrity-2026-07-27.md` (new)
- `GRIDEX_OPS_DELIVERY_REPORT.md` (new)
- `.agent-memory/checkpoint.json`
- `.agent-memory/completed-work.md`
- `.agent-memory/current-state.md`
- `.agent-memory/current-task.md`
- `.agent-memory/handover.md`
- `.agent-memory/next-actions.md`
- `.agent-memory/open-blockers.md`
- `.agent-memory/session-log.md`
- `.agent-memory/verification-matrix.md`
- `.agent-memory/work-plan.md`

## 4. New migrations, in order

1. `20260727010000_contract_flow_integrity_completion.sql`

It must run after the existing final local migration
`20260726230000_contract_admin_api_alignment.sql`. Historical migrations were
not edited.

## 5. Retired parallel paths

- The contract main list no longer evaluates readiness/delete graphs.
- Monthly billing no longer calls `createBillingExportRun`,
  `queueReadyBillingExportRunItems` or `sendBillingExportRunToPartnerApi`.
  It calls the canonical invoice export core.
- Assigned/mandatory supply starts no longer create supply periods directly.
- Facility/metering-point ownership no longer participates in automatic legal
  customer selection.
- Provider events no longer create an unrelated invoice by provider customer
  number; they update the pre-reserved canonical invoice.

The old billing tables remain for historical data/compatibility but are not a
competing monthly runtime path.

## 6. Tenant and customer integrity

- UI, actions, RPCs and all follow-up reads use the same verified company ID.
- Invalid explicit tenants fail closed.
- Legal identifiers are tenant-scoped; delivery points are not customer keys.
- Conflicting/multiple candidates require manual review.
- Portal identity reuse requires tenant, active identity, customer type, legal
  identity and compatible e-mail.
- Triggers verify the same customer and customer contract through supply,
  underlay, export item and invoice.
- Portal invoice reads always filter both company and customer.

## 7. Unified invoice chain

`billing_underlays → invoice_export_runs/invoice_export_items →
customer_invoices(draft) → provider adapter → same customer_invoices row`.

The reservation RPC is transactional and idempotent. Provider webhook matching
uses the canonical export item plus provider/environment/GUID and validates
amount/currency. Duplicate or out-of-order events cannot create a second
invoice or regress the state.

## 8. Verification results

| Check | Result |
| --- | --- |
| Dependency install | PASS — 445 packages |
| App typecheck | PASS |
| Script typecheck | PASS |
| ESLint | PASS, zero errors |
| Production build | PASS |
| Migration history/checksums | PASS — 304 files, 209 version groups |
| API/OpenAPI/docs parity | PASS — 36 registry routes, 38 operations |
| Contract suite | PASS — 40/40 |
| Fixed-area suite | PASS — 18/18 |
| Focused identity/supply/billing suite | PARTIAL — 49/54 |
| Final selected contract/identity/billing rerun | PARTIAL — 82/87; same five legacy fixture failures |
| PostgreSQL migration apply/RLS runtime | BLOCKED |
| Provider signed sandbox round trip | BLOCKED |

The five focused failures are pre-existing readiness fixtures that omit exact
company/customer/customer-contract/meter identities. The new production rule
correctly blocks them. Tests were not edited and production code was not
weakened.

## 9. External blockers

- Uploaded ZIP has no `.git`; branch/commit/dirty provenance is unavailable.
- No local Supabase CLI, PostgreSQL/Docker or authorized production/staging DB.
- No Capway/Aptic sandbox credentials or signing secret.
- Deployed migration ledger/schema cache and live runtime parity are unknown.

## 10. Deploy order

1. Preserve DB backup and migration ledger.
2. Put automation/provider workers in pause.
3. Deploy runtime capable of the additive fields.
4. Apply migrations through
   `20260727010000_contract_flow_integrity_completion.sql`.
5. Refresh PostgREST schema cache.
6. Restart/deploy Next.js and workers.
7. Run the read-only SQL in
   `docs/contract-flow-integrity-2026-07-27.md`.
8. Run a two-tenant staging flow and provider sandbox flow.
9. Resume workers.

## 11. Local synchronization commands

Safe patch-file synchronization from the delivered archive:

```bash
delivery_zip="$HOME/Downloads/gridex-ops-platform-contract-flow-completion-2026-07-26.zip"
delivery_tmp="$(mktemp -d)"
unzip "$delivery_zip" -d "$delivery_tmp"

rsync -av --checksum --itemize-changes --dry-run \
  "$delivery_tmp/gridex-ops-platform-contract-flow-completion-2026-07-26/files/" \
  /Users/hekmath/Projects/gridex-ops-platform/

rsync -av --checksum --itemize-changes \
  "$delivery_tmp/gridex-ops-platform-contract-flow-completion-2026-07-26/files/" \
  /Users/hekmath/Projects/gridex-ops-platform/

cd /Users/hekmath/Projects/gridex-ops-platform
npm ci
npm run db:migrations:check
npm run typecheck
npm run lint -- --quiet
npm run api:docs
npm run build
```

Patch-only application:

```bash
delivery_zip="$HOME/Downloads/gridex-ops-platform-contract-flow-completion-2026-07-26.zip"
delivery_tmp="$(mktemp -d)"
unzip "$delivery_zip" -d "$delivery_tmp"
cd /Users/hekmath/Projects/gridex-ops-platform
patch --dry-run -p1 < "$delivery_tmp/gridex-ops-platform-contract-flow-completion-2026-07-26/gridex-ops-contract-flow.patch"
patch -p1 < "$delivery_tmp/gridex-ops-platform-contract-flow-completion-2026-07-26/gridex-ops-contract-flow.patch"
npm ci
npm run db:migrations:check
npm run typecheck
npm run lint -- --quiet
npm run api:docs
npm run build
```

Review the dry-run before synchronization or patch application. The archive
contains no environment files, dependencies, build output or Git metadata.

## 12. Post-deploy read-only SQL

See the exact parameterized queries in
`docs/contract-flow-integrity-2026-07-27.md`.

## 13. Rollback

Pause writes/workers, deploy the preceding runtime, preserve additive data and
restore only the exact prior function/view definitions named in the deployment
document. Drop new triggers/functions/indexes only by exact name. Do not use
broad `CASCADE`; do not drop additive columns until new invoice/quote rows have
been reconciled.
