
## 2026-07-28 – Live schema/code canonical synchronization and API contract 2026-07-30.1

- Added one fail-closed forward-only repair based on the exported production
  schema, active function definitions and live database lint.
- Repaired canonical publication energy/hash/type integrity, website onboarding,
  invoice export, signature recovery, terminal channel lifecycle and internal
  wrapper privileges.
- Website and customer portal OpenAPI, runtime constants, documentation and
  regression controls now report `2026-07-30.1`.

## 2026-07-27 – Contract security, production direction and API contract 2026-07-27.1

- Contract mutation RPCs are service-role only; admin server actions bind the authenticated actor and tenant before calling them.
- Audit rows now carry actor type, explicit system actor, request/correlation IDs, resource identity and before/after status.
- `energy_direction` and exact pricing/publication identities are immutable through quote, application and customer contract.
- Archived contracts are terminal; compatibility restore returns a structured failure and recommends a successor product.
- Company contract lists use true server-side pagination and direct diagnostics by tenant + contract ID.
- Website OpenAPI and developer documentation now model production pricing, canonical errors and `GET /api/v1/website/legal-bundle` at version `2026-07-27.1`.

# Changelog

Use this file after every Cursor task.

## 2026-07-26 — Canonical offer-reference, readiness and safe-delete repair

- Added append-only migration
  `20260727020000_contract_lifecycle_reference_readiness_repair.sql`.
- Removed the final runtime dependency on the nonexistent
  `public_contract_offers.canonical_offer_reference`; lifecycle and deletion
  functions now resolve the canonical external reference from
  `contract_publication_versions.offer_reference`, with metadata fallback only
  for legacy rows.
- Replaced generic publish SQLSTATE failures with structured readiness blockers
  carrying code, field and user-facing message. Already-published versions are
  idempotent, while terminal lifecycle states remain blocked.
- Reused one tenant-safe dependency graph for delete preview and delete commit;
  business references, removable system rows and restricting foreign keys are
  exposed separately.
- Corrected the admin readiness RPC argument to `p_contract_offer_id` and added
  lazy readiness/delete diagnostics to both `/admin/contracts?company_id=...`
  and `/admin/companies/<company-id>`. Permanent delete remains disabled until
  the preview explicitly permits it.
- Preserved authenticated actor IDs in safe-action error logs for both admin
  entry points.
- Verification: 305 migration files/checksums pass; contract lifecycle
  completion and repair regressions pass; all six changed TypeScript/TSX files
  pass syntax transpilation; public API/OpenAPI/version/examples/shared-component
  parity checks pass. Dependency installation, full typecheck, lint and build
  are blocked in this environment by package-registry HTTP 503. Database apply
  and live-row verification remain pending against an authorized staging DB.

## 2026-07-26 — Contract visibility, lifecycle security and API alignment

- Added append-only migration
  `20260726230000_contract_admin_api_alignment.sql`.
- Repaired the final tenant lifecycle definition's ambiguous `valid_to` and
  made tenant closure end paused as well as active sales channels.
- Revoked direct authenticated execution of the privileged contract deletion
  preview; admin runtime uses the tenant-authorized service path.
- Synchronized the PostgreSQL lifecycle test with the canonical rule that
  previously published offers are preserved after unpublish.
- Preserved `company_id` in company-to-contract navigation and revalidated
  company list/detail pages after every contract mutation.
- Split admin statistics into contract products, currently published offers
  and signed/customer contracts.
- Aligned market-price auth error codes across runtime documentation, OpenAPI
  and the external integration guide.
- Added capability guards so a non-ready resolver result cannot continue to
  pricing or quote on HTTP 200 alone.
- Verification: typecheck, 354/354 tests, API docs, 303 migration checks,
  lifecycle/delete regressions, contract-patch typecheck, lint (0 errors/125
  existing warnings) and production build pass.
- Database apply and transactional staging verification remain required.

## 2026-07-25 — Canonical P0/P1 lifecycle completion candidate

### Runtime and public API

- Split energy resolution into independent pricing, quote, facility lookup,
  switch creation and switch dispatch capabilities with stable blockers.
- Market-price and quote loading no longer depends on grid-owner/PRODAT
  automation readiness; exact selected/available spot resolution is exposed.
- Closed canonical resolver, market-price, quote and quote-validation requests;
  unknown fields fail with `unknown_field`.
- Added an explicit allowlisted website-application response. Internal pricing,
  publication, portal-identity and provider IDs are removed; allowed UUIDs are
  documented as opaque tenant-bound public resource IDs.
- Replaced canonical `can_start_switch` use with structured
  `supplier_switch.can_create_request` / `can_dispatch`; the old portal field is
  only a deprecated dispatch alias.
- Anonymous 401 integration requests no longer wait on a tenantless audit write.

### Billing, invoices, activation and events

- Invoice readiness now loads real company billing settings, active provider
  connection/environment, invoice profile/distribution, recipient/address,
  payment terms, OCR/reference policy and VAT evidence.
- Billable underlays lock a stable SHA-256 billing configuration snapshot.
- Portal invoice list/detail now expose only persisted `customer_invoices`;
  pricing previews and billing underlays are never presented as invoices.
- Hourly products require hourly spot rows and quarterly products require
  quarter-hour rows throughout preview and pricing source selection.
- Added authenticated `/api/cron/reconciliation/daily` and a test mapping all
  registered Vercel crons to authenticated route files.
- Added forward migration
  `20260725120000_billing_readiness_and_supply_activation_v1.sql` with immutable
  billing snapshot evidence and idempotent `activate_customer_supply_v1`.
  Confirmed inbound completion now commits supply period, switch, contract
  billing eligibility, application workflow/projection, one `supply.started`
  event and durable notification/webhook outboxes in one transaction.
- Canonical `invoice.paid` is emitted from provider reconciliation. Developer
  docs now distinguish active public, internal and planned event names.

### Contract and verification

- API/OpenAPI/docs version is `2026-07-27.1`.
- Added public-ID policy and synchronized tenant guides/developer examples.
- `npm run typecheck`: pass.
- `npm test -- --testTimeout=15000`: 53 files, 346 tests pass.
- `npm run api:docs`: all contract/parity/version/example/component checks pass.
- `npm run db:migrations:check`: 299 files, 204 version groups, checksums pass.
- `npm run lint`: 0 errors; 125 pre-existing warnings.
- `npm run build`: production build completed and generated `.next/BUILD_ID`.
- Database apply/rollback/replay/two-tenant verification remains pending because
  no Supabase CLI or authorized database is available in this environment.

## 2026-07-19 — Canonical customer flow hardening: customer numbers, billing readiness, POA scopes, regression repair

### Database (new forward migrations)

- `20260719120000_canonical_customer_number_assignment.sql`: BEFORE INSERT
  trigger assigns customer numbers from the canonical per-company generator
  (`gridex_next_customer_number`) for every intake channel, a BEFORE UPDATE
  guard makes assigned numbers permanent (`customer_number_is_permanent`,
  errcode 23514), backfill of existing numberless customers per company in
  created_at order, defensive recreation of the tenant-scoped unique index.
- `20260719121000_billing_underlay_energy_direction_upsert_repair.sql`:
  repairs `gridex_store_billing_underlay` — its 7-column ON CONFLICT arbiter
  stopped matching after `20260716090000` recreated the segment unique index
  with `energy_direction`, so every underlay store failed. The function now
  inserts `energy_direction`/`settlement_type` explicitly and uses the
  8-column arbiter (idempotent per segment + direction).
- `20260719122000_pin_search_path_ediel_consolidation_triggers.sql`: pins
  `search_path` on the two trigger functions created without a pin by the
  immutable `20260712110000` migration.

### Application

- Canonical customer numbers on ALL intake channels: admin intake
  (`createCustomerGraph`), external `/teckna-avtal` intake and Ediel inbound
  approval now assign the permanent Gridex customer number through
  `ensureCustomerNumberIfSupported` (schema-tolerant); `ensureCustomerNumber`
  re-reads the persisted number when a concurrent writer or the DB trigger
  wins the race (never reports an unused reservation).
- New `lib/billing/billingReadiness.ts`: pure, unit-tested
  `evaluateBillingReadinessCore` covering the fourteen billing-readiness
  criteria with structured codes, returning
  `{ billable, blockers, warnings, evidence }`.
  `evaluateBillingMonthInvoiceReadiness` now runs the shared account-level
  gate per contract — invoice export is blocked without invoice recipient,
  distribution channel (address/e-mail/same-as-site) or VAT settings.
- Supplier switch enforces the canonical authorization-scope chain: new
  `verifyAuthorizationScopeCoverage` (heals a missing chain idempotently from
  a signed POA, fail-closed on missing schema) is called from
  `checkSupplierSwitchReadiness` with structured blocker
  `authorization_scope_missing`.
- New canonical POA lifecycle derivation
  `derivePowerOfAttorneyLifecycleStatus` (missing / awaiting_signature /
  signed / valid / revoked / expired / replaced; fail-closed for accepted
  statuses without evidence), exposed as `poaLifecycleStatus` on the
  customer-card snapshot.
- `resolveCanonicalOutboundContext` requires an explicit environment — the
  deprecated silent `'test'` fallback was removed
  (`ediel_outbound_environment_required`).

### Verification

- New unit tests: `billing-readiness.test.ts`, `poa-lifecycle-status.test.ts`,
  `authorization-scope-coverage.test.ts`, `customer-numbers.test.ts`; switch
  readiness tests extended with scope-coverage blockers (229 tests green).
- Regression scripts repaired from 50 failing to 2: quote/format drift
  normalized (quote-agnostic read helpers), superseded policies rewritten to
  guard the current documented designs (claim-based energy-context merge,
  normalized-only underlay engine, DB-driven switch send-window policy,
  offer-bound legal versions, tab-driven lazy customer card, moved tgt*/agt
  test modules, renamed API scopes, Swedish-rewritten API docs).
- Remaining known-red checks: `ediel-certification-regression` and
  `ediel-completion-regression` both flag the same pending consolidation —
  the ACK decision engine still hardcodes AGT UE1/UE2 logic and imports
  `lib/ediel/testing/utiltsAckOverrides` instead of using the certification
  registry (`findCertificationCase`). This is an Ediel-domain refactor with
  approved-flow impact and needs its own task/override protocol.
- OPS hardening CI workflow is green again: the behavior regression asserted
  a removed app-level outbox claim fallback; it now asserts the RPC-only,
  fail-closed claim design.

## 2026-07-16 — Canonical contract publication, dynamic legal evidence and tenant snapshots

### Database and canonical commands

- Added `20260716140000_contract_legal_publication_single_source_completion.sql`.
- Added strict tenant legal-profile completeness, exact missing fields, backfill and legally relevant company-change review tracking.
- Added dynamic legal-module rules for private/business, quarterly price, automatic renewal, optional POA and production.
- Added atomic `gridex_publish_contract_version`: legal source resolution, pricing, legal evidence, contract version, publication, readiness and audit commit or roll back together.
- Added `gridex_remove_contract_offer`: row-locked safe delete with automatic archival when history exists.
- Added `gridex_remove_internal_contract_offer` and removed active direct internal offer update/delete paths plus the unused direct-save helper.
- Added tri-state canonical readiness with separate website display and application acceptance.
- Added immutable tenant legal/communication snapshots to customer contracts and locked legal-document provenance.

### Application

- Company-card contract save/publication uses the canonical publication RPC and structured Swedish blockers.
- Removed the old checked-in backup action file containing obsolete legacy writes.
- Company legal UI now consumes canonical readiness, treats no published contracts as information and shows review/verification timestamps.
- Agreement e-mail/PDF context prefers the signed contract's locked tenant snapshots; PDF names the tenant as contracting party.
- Platform legal templates store explicit origin, template key/version and tenant-customized metadata.

### Verification

- Added `gridex:contract-single-source-regression`.
- Updated contract/legal publication and website application regressions.
- Added architecture/deployment documentation in `docs/canonical-contract-publication-single-source-2026-07-16.md`.
- Added final verification evidence in `docs/verification-contract-single-source-2026-07-16.md`.

## 2026-06-29 — Continuation hardening: intake POA/errors, customer-type, manual comms, portal, docs

### Website customer application intake (`lib/website/customerApplications.ts`, route)

- New error stages `power_of_attorney`, `facility_lookup`, `email_dispatch`.
- Structured `powerOfAttorney` is now **required** when the resolved contract
  publishes a POA version (`power_of_attorney_required`) → `422 power_of_attorney_missing`.
  `consents.power_of_attorney=true` alone is no longer sufficient.
- Idempotent retry with a new `powerOfAttorney` over a prior result lacking one →
  `409 idempotent_application_missing_poa` (`action: retry_with_new_idempotency_key_or_repair`).
- Mid-pipeline failures (after the application row exists) now **update that row**
  to `partial`/`failed` with `error_stage`/`error_code`/`error_message` and
  `power_of_attorney_id = null` — no duplicate insert, no lingering false success.
- `repairWebsiteCustomerApplication(applicationId)` helper + admin/platform-guarded
  server action (`repairWebsiteApplicationPowerOfAttorneyAction`) to recreate a lost POA.
- Route now returns the standard nested error contract
  `{ error: { code, message, stage, field, request_id, action? } }` (legacy flat keys kept).
- Migration `20260629140000`: allow `partial` and `repaired` application statuses.

### Customer type canonicalization

- New `lib/customers/normalizeCustomerType.ts` (single source of alias mapping);
  website intake reuses it. Public-contracts filter, admin bulk import and external
  intake now map business/association aliases correctly.
- Migration `20260629150000`: normalize `customers.customer_type` and add CHECK
  (`private|business|association`).

### Manual grid-owner communication

- Missing facility id routes through the manual e-mail pipeline only; website intake
  no longer creates an Ediel grid-owner request or Z01-first automation in that case.
- `ensureGridOwnerInformationRequest` skips when an open manual request exists for
  the site (no parallel manual+Ediel rows).
- Permanent `manual_email_outbox` failures move the linked request to
  `needs_review`/`dispatch_status=failed` (request and outbox stay in sync).

### Customer portal API

- `GET /api/v1/customer/invoices/[id]` falls back to `invoice_export_items`/`pricing_runs`
  like the list endpoint; adds `invoice_not_found` code.
- Docs aligned (resolution order, full bundle sections, sub-endpoints, query params,
  complete JSON error-code catalog); granular scopes marked planned.

### Performance / docs

- Bounded `listUnresolvedOutboundRequests` and `listAllGridOwnerDataRequests`;
  added `loading.tsx` skeletons for `customers/[id]`, `messages`, `companies/[id]`.
- Rewrote `README.md`; updated external-website + ops-intake API docs.

### Verification

- `npm run typecheck` and `npm run build` green; targeted regressions updated/added.

## 2026-06-29 — Legal + power of attorney pipeline hardening (OPS source of truth)

### Changed/added files

- lib/website/customerApplications.ts (POA/legal schema mismatch hard-fail; tenant/publish version checks; customer-type normalization; legal_acceptances + POA document_url/text_version_id in response; site_id alias; new error codes)
- lib/website/publicContracts.ts (buildPublicLegalBlock with *_required/*_version_id/*_url; buildWebsiteLegalBundle; tenant slug on offers)
- lib/legal/publicLegalDocuments.ts (new — slug/type/version resolution, published-only loader, public URL builder)
- lib/legal/legalReadinessOverview.ts (new — superadmin per-tenant readiness + failed-application aggregation)
- lib/integrations/apiClientScopes.ts (website_legal.read)
- lib/operations/db.ts (savePowerOfAttorney accepts method/signer/scope_summary/accepted_at)
- app/api/v1/website/legal-bundle/route.ts (new)
- app/legal/[slug]/[type]/[versionId]/page.tsx (new public legal document page)
- app/admin/platform/legal-readiness/page.tsx (new superadmin overview) + lib/admin/navigation.ts
- components/admin/customers/CustomerLegalReadinessCard.tsx (per-POA status panel)
- components/admin/customers/document-card/UploadForm.tsx (manual PDF POA signer/date/scope)
- components/admin/legal/CopyPublicLegalLink.tsx (new)
- app/admin/customers/[id]/actions.ts, app/admin/customers/[id]/document-actions.ts (manual POA evidence)
- app/admin/companies/[id]/page.tsx (copy public legal link)
- supabase/migrations/20260629130000_legal_poa_hardening_indexes.sql (new)
- scripts/gridex-legal-poa-platform-hardening-regression.cjs (new) + package.json
- docs/legal-power-of-attorney-platform.md (new), docs/external-website-api-integration-guide.md

### What changed

- OPS is the single source of truth: public-contracts/legal-bundle expose required
  flags, version ids and public OPS-hosted legal URLs (incl. power of attorney).
- Required power of attorney / legal acceptances can no longer be silently skipped
  on DB schema mismatch — they fail with precise codes and never produce a
  "complete" customer without legal authorization.
- Public, published-only, tenant-isolated legal document pages at /legal/{slug}/…
- Manual PDF power of attorney intake captures signer/scope/date/method so it is
  usable for facility lookup and supplier switch.
- Superadmin legal readiness overview + failed-applications by error code/stage.
- Customer types normalized (company/foretag/consumer/… → private|business).

### Verification

- npm run build (green), tsc app typecheck (green), eslint of changed source (clean).
- gridex:legal-poa-platform-hardening-regression, gridex:website-api-power-of-attorney-regression,
  customer-application-review, batch-7-website-foundation, website-application-customer-number-chain,
  external-contract-intake, website-api-webhook regressions all pass.

### Remaining manual steps

- Apply migration 20260629130000 in Supabase.
- Optionally grant existing website API keys the new website_legal.read scope
  (legal-bundle also accepts website_contracts.read, so this is not required).

## 2026-06-15 — Multi-tenant branding & hardcoded-Gridex cleanup (review batch)

### Changed files

- lib/customer-portal/types.ts
- lib/customer-portal/db.ts
- app/portal/layout.tsx
- app/portal/page.tsx
- app/portal/forbrukning/page.tsx
- app/portal/fakturor/page.tsx
- app/portal/avtal/page.tsx
- app/portal/koppla-kund/page.tsx
- app/teckna-avtal/page.tsx
- lib/website/customerApplications.ts
- lib/ediel/security/outboundRecipientCertificate.ts
- lib/ediel/transport/index.ts

### What changed

- Customer portal (Mina sidor) now resolves the signed-in customer's tenant brand
  (name, portal name, support email, website, logo, colour) from `companies`/`branding`
  via a new defensive `resolveCustomerPortalBranding`, added to `CustomerPortalContext`.
  All portal pages now use the tenant brand instead of hardcoded "Gridex"/"gridex.se".
  When a portal account spans several companies the UI falls back to neutral copy.
- Removed the internal Ediel term "UTILTS E66/E30" and "driftdata" from customer-facing
  portal copy.
- Website application emails (`customerApplications.ts`) now source support email, sender
  name and portal URL from tenant config (`companies.branding`/`company_email_settings`
  + `getBaseAppUrl`) instead of hardcoded `kontakt@gridex.se` / `https://app.gridex.se/login`
  / "Gridex".
- Public `/teckna-avtal` page copy no longer leaks internal words ("tenant",
  "Ediel-liveflöden", "granskningsärende") to customers.
- Outbound recipient S/MIME guard no longer hardcodes Div3rsa/Gridex/Ediel ID 21660.
  The "own certificate selected as recipient" safeguard is now tenant-driven via the
  route profile's `own_ediel_id`/`sender_ediel_id`. The deterministic
  owner==receiver/usage/purpose/private-material guards are unchanged.

### Why

- Mina sidor and the website intake/email flows were not tenant-safe: every customer saw
  the "Gridex"/"gridex.se" brand regardless of which electricity company they belong to,
  and internal system words leaked into public UI. Hardcoded actor identities in the
  outbound certificate guard violated the tenant-configuration principle.

### Validation

- npm run typecheck (pass)
- npm run lint (no new errors; pre-existing .cjs require-import errors remain baseline)
- Ediel: routing-security, production-readiness, inbound-tenant-resolution (pass)
- Gridex launch: pricing-flow, launch-security, website-api-webhook, customer-intake,
  ui-db-mismatch, launch-smoke, platform-tenant-contracts-api-mail,
  customer-application-review, batch-m-ops-master, batch-7-website-foundation (pass)
- Manual: verify per-tenant portal branding in Supabase/Vercel with a non-Gridex company.

Template:

## YYYY-MM-DD — Task name

### Changed files

- path/to/file

### What changed

- Describe the change.

### Why

- Explain why this was needed.

### Validation

- npm run typecheck
- npm run build
- relevant tests/manual checks

### Regression risks

- List risks.

### Follow-up

- List unresolved items or "None".

## 2026-06-05 — Create AI context documentation

### Changed files

- CURSOR.md
- docs/ai-context/00_PROJECT_SNAPSHOT.md
- docs/ai-context/01_CURSOR_WORKFLOW.md
- docs/ai-context/02_ARCHITECTURE_MAP.md
- docs/ai-context/03_DATABASE_RLS_TENANT_RULES.md
- docs/ai-context/04_EDIEL_CORE_RULES.md
- docs/ai-context/05_PRODAT_RULES.md
- docs/ai-context/06_UTILTS_RULES.md
- docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md
- docs/ai-context/08_APPROVED_TEST_FLOWS.md
- docs/ai-context/09_UI_UX_RULES.md
- docs/ai-context/10_CHANGELOG.md
- docs/ai-context/11_CURRENT_TASK.md
- docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md
- docs/ai-context/13_OVERRIDE_PROTOCOL.md
- docs/ai-context/14_VALIDATION_CHECKLIST.md
- docs/ai-context/15_FILE_OWNERSHIP_MAP.md
- docs/ai-context/16_SECURITY_SECRETS_CERTIFICATES.md
- docs/ai-context/17_MAILBOX_POLLING_AND_DEDUPE.md
- docs/ai-context/18_SEND_READINESS_AND_ENVIRONMENTS.md
- docs/ai-context/19_DECISION_ENGINE_RULES.md
- docs/ai-context/20_DEBUGGING_PLAYBOOK.md
- docs/ai-context/21_UI_OPERATIONS_AND_BILLING_UNDERLAY.md
- docs/ai-context/22_BRP_ESETT_FILE_IMPORTS.md
- docs/ai-context/23_PLATFORM_BILLING_AND_USAGE_PRICING.md

### What changed

- Added the requested AI context/project memory documentation structure.
- Added root-level Cursor rules that point future work to the context files first.

### Why

- Future Cursor work should start from durable project context instead of scanning or rewriting the whole repository by default.

### Validation

- Verified git status/diff only includes documentation/context files.

### Regression risks

- None expected; documentation-only change.

### Follow-up

- Existing Ediel docs may be reviewed later for overlap and merged into the ai-context where useful.

## 2026-06-05 — Update AI context file ownership map

### Changed files

- docs/ai-context/15_FILE_OWNERSHIP_MAP.md
- docs/ai-context/10_CHANGELOG.md
- docs/ai-context/11_CURRENT_TASK.md
- docs/ai-context/00_PROJECT_SNAPSHOT.md

### What changed

- Replaced the generic file ownership map with a repo-specific map of actual Ediel, PRODAT, UTILTS, routing, inbound mail, billing/import, platform, RBAC and database areas.
- Added legacy Ediel docs that should be consolidated later without deleting the originals.
- Added known large files that must be handled carefully and not refactored casually.

### Why

- Future Cursor work should start from targeted file areas instead of scanning the whole repository.
- The repo contains large operational files and sensitive Ediel flows; narrow task scoping reduces regression risk.

### Validation

- Documentation-only update.
- No application code or migrations should be changed.
- App build is not required for this documentation-only change.

### Regression risks

- None expected; documentation-only.

### Follow-up

- Later consolidate `docs/ediel-elbolag-live-runbook.md` and `docs/ediel-operations-test-flow.md` into the relevant ai-context files.

## 2026-06-05 — Fix AGT E5/Z14 ACK send and APERAK decision

### Changed files

- `lib/ediel/sendContextConsistency.ts`
- `app/admin/ediel/system-tests/actions.ts`
- `lib/ediel/tgtRegistry.ts`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`

### What changed

- Updated send consistency so generated ACK messages are validated against their related inbound business family when linked to a test run.
- Added AGT DGI/Energitjänsteföretag E5/E6/E7 positive APERAK handling for valid inbound PRODAT permission responses.
- Cancelled stale non-reusable draft/prepared/queued ACKs before generating a new Systemtest ACK for the same source/test decision.
- Updated TGT/system-test step matching to prioritize `sent` messages over failed/draft candidates and newest candidates within each status rank.

### Why

- Inbound PRODAT Z14 was parsed correctly, but generated CONTRL was blocked because the send guard compared selected PRODAT family directly to generated CONTRL family.
- E5/Z14V could produce negative APERAK from stale/requested or over-aggressive permission validation even though the AGT E5 expected flow is positive CONTRL + positive APERAK for a valid inbound Z14V.
- Old draft/failed ACK rows could be selected by the test view and create false mismatch even after a newer correct message existed.

### Validation

- `npm install`
- `npm run typecheck` — passed
- `npm run ediel:rule-regression` — passed
- `npm run ediel:production-readiness-regression` — passed
- `npm run ediel:routing-security-regression` — passed
- `npm run ediel:inbound-tenant-resolution-regression` — passed
- `npm run build` — attempted twice; timed out during Next.js optimized production build in the sandbox before completion.

### Regression risks

- Low-to-medium: ACK send consistency now depends on `validation_report.sourceFamily`/related payload metadata for ACK messages. Existing ACK draft generation already stores `sourceFamily` and source IDs.
- AGT E5/E6/E7 positive APERAK override is scoped to test case code plus inbound PRODAT Z14/Z15 permission-response shape; it does not weaken generic production PRODAT validation.

### Follow-up

- Re-run `npm run build` locally/Vercel where build has enough time.
- Retest E5/Z14V end-to-end in Edielportalen: inbound Z14 parsed → positive CONTRL sent → positive APERAK sent.

## 2026-06-05 — Lock Systemtest ACK actions to expected chain

### Changed files

- `app/admin/ediel/system-tests/actions.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`

### What changed

- Added a backend guard that resolves the expected ACK outcome from the Systemtest definition before creating CONTRL/APERAK/UTILTS_ERR.
- The backend now follows the expected outbound ACK step for the test case instead of trusting a free manual UI outcome when a Systemtest definition exists.
- Non-reusable draft/prepared/queued ACKs with a different outcome than the current backend decision are no longer reused and are superseded/cancelled.
- The Systemtest case UI now renders only the ACK actions expected by the test chain instead of offering both positive and negative CONTRL/APERAK options.
- The UI copy now explains that backend/test-chain logic selects positive/negative; the user only triggers the recommended expected ACK.

### Why

- E5/Z14 could be approved manually when the user selected the expected response, but the system still allowed wrong manual selections.
- The system must understand the expected chain itself: inbound PRODAT Z14V in E5 should guide the UI/backend to positive CONTRL and positive APERAK.
- Old negative APERAK drafts should not remain current when the expected test-chain decision is positive.

### Validation

- `npm install`
- `npm run typecheck` — passed
- `npm run ediel:rule-regression` — passed
- `npm run ediel:production-readiness-regression` — passed
- `npm run ediel:routing-security-regression` — passed
- `npm run ediel:inbound-tenant-resolution-regression` — passed
- `npm run build` — attempted; timed out during Next.js optimized production build in the sandbox before completion.

### Regression risks

- Low: UI now hides manual positive/negative alternatives on Systemtest case pages and exposes only expected ACK actions. Advanced manual override flows, if needed, should be implemented separately with reason/audit.
- Low-to-medium: backend expected-outcome forcing applies when a Systemtest definition contains an expected outbound ACK outcome. This is intentional for Systemtest flows and avoids wrong UI-selected outcomes.

### Follow-up

- Re-run full production build locally/Vercel where build time is sufficient.
- Re-test E5/Z14V: inbound Z14 parsed → recommended positive CONTRL sent → recommended positive APERAK sent.
- If a future test needs manual override, add a separate superadmin/debug override with required reason and audit instead of free positive/negative buttons in the main test flow.

## 2026-06-05 — Build Ediel decision engine foundation

### Changed files

- `app/admin/ediel/system-tests/actions.ts`
- `lib/ediel/classify.ts`
- `lib/ediel/core/kernel.ts`
- `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- `lib/ediel/orchestrator.ts`
- `lib/ediel/rulebook/ruleProfileSelector.ts`
- `lib/ediel/statusUi.ts`
- `docs/ai-context/05_PRODAT_RULES.md`
- `docs/ai-context/06_UTILTS_RULES.md`
- `docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

### What changed

- Added the first generic Ediel classification/rule-profile foundation.
- Added broader classification for PRODAT, UTILTS, CONTRL, APERAK and UTILTS_ERR.
- Added PRODAT permission classification for Z13/Z14/Z15/Z18, including Z14V/Z14N/Z14VH handling.
- Added logic foundation so correct Z14N is treated as a valid business denial that can receive positive APERAK.
- Added rule-profile selector foundation for PRODAT, UTILTS and ACK families.
- Hardened ACK lifecycle/idempotency: correct sent ACK is success/already_sent, sent ACKs are not resent, wrong drafts can be superseded, opposite final ACK is blocked/manual review.
- Added tenant-safe business status mapping helper.
- Updated AI context docs with PRODAT, UTILTS, ACK, validation and known-risk rules.

### Why

- The system must not build one-off E5/E6/E7 or Z14 test patches.
- Ediel production logic must be based on payload, context, route, actor role, tenant and business state.
- TGT/AGT expected outcomes should verify engine decisions, not become production rules.
- Z14N is a valid business-denial message and must not automatically become negative APERAK.
- Final ACKs are operationally binding and must not be silently replaced with the opposite outcome.

### Validation

- Patch contents were generated as changed/added files only.
- Full build/typecheck could not be completed in the sandbox because dependencies are not installed in the extracted environment.
- Local validation required:
  - `npm install`
  - `npm run typecheck`
  - `npm run build`
  - Ediel regression scripts if available.

### Regression risks

- Medium: this is a foundation change touching ACK orchestration and classification. Run full Ediel regression before production sends.
- Medium: full PRODAT field-level validation still requires importing the Edielportal Excel rule file.
- Low-to-medium: tenant UI must be checked so technical statuses do not leak into the normal tenant workflow.

### Follow-up

- Import/version the PRODAT Excel field rules: `Uppgifter i PRODAT 26-A 16-B april 2026`.
- Add portal validation report parser.
- Add full regression cases for every PRODAT/UTILTS profile.
- Add/verify superadmin manual review queue for rule_conflict and blocked_final_ack_exists.

## 2026-06-05 — Build full Ediel decision node and regression coverage

### Changed files

- `lib/ediel/decisionEngine.ts`
- `lib/ediel/ackDecision.ts`
- `lib/ediel/prodat/prodatAperak.ts`
- `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- `scripts/ediel-rule-regression.cjs`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

### What changed

- Added a reusable `lib/ediel/decisionEngine.ts` decision node for PRODAT APERAK, UTILTS APERAK/UTILTS_ERR, portal validation feedback and ACK lifecycle decisions.
- Centralized the rules that correct Z14N is a valid business denial and must produce positive APERAK when payload/process is valid.
- Added explicit negative APERAK handling for invalid Z14 missing/invalid permission status, Z18 missing permission end reason, Z15 invalid status/reason, and portal A902 mismatch feedback.
- Added production-safe manual review behavior for Z14/Z15/Z18 where production cannot safely link the inbound message to a Z13/permission/process.
- Wired the generic ACK recommendation path to the new decision node, including manual-review blocking and UTILTS_ERR selection.
- Kept the legacy `decideProdatAperakOutcome()` API but routed it through the new decision node.
- Added regression checks for Z14N positive APERAK, invalid Z14 negative APERAK, Z18 missing end reason, production unlinked Z14 manual review, portal A902 mismatch and final ACK lifecycle behavior.

### Why

- The previous foundation selected rule profiles but still lacked one reusable decision node that all runtime paths could call.
- Test expected outcome must not be the production rule; it should only compare against the engine decision.
- Production must not silently choose positive or negative APERAK when an inbound permission message cannot be matched to the right business process.
- A sent final APERAK/CONTRL cannot be replaced by the opposite outcome.

### Validation

- `tsc --noEmit --pretty false` was attempted in sandbox.
- No TypeScript diagnostics were reported for the changed files when filtering for:
  - `lib/ediel/decisionEngine.ts`
  - `lib/ediel/ackDecision.ts`
  - `lib/ediel/prodat/prodatAperak.ts`
  - `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- Full typecheck still cannot complete cleanly in sandbox because dependencies/types are not installed (`next`, `react`, `@supabase/supabase-js`, Node types, etc.).
- `node scripts/ediel-rule-regression.cjs` was attempted but cannot run in sandbox without dependencies because the existing script imports modules that require `@supabase/supabase-js`.

### Regression risks

- Medium: generic ACK recommendations now block production Z14/Z15/Z18 without a safe process link. This is intentional for safety, but production flows must ensure related message/business match is populated before auto-ACK.
- Medium: Z18 now produces negative APERAK when end reason is missing. If any valid Ediel profile allows missing Z25 in a specific context, that context must be represented in the rule profile before auto-send.
- Low: legacy `decideProdatAperakOutcome()` cannot return `manual_review`; it maps manual review to a safe negative error for old callers.

### Follow-up

- Install dependencies and run:
  - `npm install`
  - `npm run typecheck`
  - `npm run ediel:rule-regression`
  - `npm run build`
- Import the official PRODAT Excel field matrix once available.
- Build full UI display for decision trace/manual review queue if not already complete in the target branch.

## 2026-06-05 — E6 backend-driven APERAK/UI alignment

### Changed files

- `app/admin/ediel/system-tests/actions.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `lib/ediel/tgtRegistry.ts`
- `lib/ediel/decisionEngine.ts`
- `lib/ediel/ack.ts`
- `scripts/ediel-rule-regression.cjs`
- `package.json`
- `docs/ai-context/05_PRODAT_RULES.md`
- `docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

### What changed

- Updated E6 AGT PRODAT Z14N test definition to expect backend-driven negative APERAK when `facility_not_identified` applies.
- Removed hardcoded positive/negative ACK wording from the Systemtest send button.
- Made Systemtest evaluation read backend/effective ACK outcome from the outbound ACK row before marking outcome mismatch.
- Added backend decision trace fields to `systemTestAckSend` validation report.
- Added generic non-production permission negative scenario handling for unlinked Z14/Z15/Z18 when expected negative and no safe business link exists.
- Fixed APERAK RFF+LI reference preference so raw inbound `RFF+LI` is preserved before falling back to row `transaction_reference`.
- Added `npm run ediel:regression` composite command.
- Added regression coverage for E6 negative APERAK with ERC 40 / FTX 105 and preserved RFF+LI.

### Why

- E6 was approved by Edielportalen with negative APERAK, while UI still showed positive expected outcome.
- UI must follow backend decisions and not drive APERAK outcome.
- Production safety requires opposite final ACK blocking and backend rule trace, not manual outcome buttons.

### Validation

- Run locally: `npm run typecheck`
- Run locally: `npm run ediel:regression`
- Run locally: `npm run build`

### Regression risks

- Existing UI may still show static test-step text for old runs until ACK rows contain `systemTestAckSend` decision metadata.
- Production unlinked Z14/Z15/Z18 remains manual review; do not auto-send negative APERAK in production without deterministic process validation.

### Follow-up

- Build full backend orchestrator/outbox tables and portal feedback import page from the master spec.

## 2026-06-05 — Backend automation foundation Batch 2/3

### Ändrat
- Lade till backend automation foundation ovanpå befintligt inbound-flow: `lib/ediel/orchestrator/edielProcessingPipeline.ts`, `inboundOrchestrator.ts`, `autoAckOrchestrator.ts` och outbox/SLA/portal-feedback-moduler.
- Inbound runtime sparar nu icke-blockerande automation trace/SLA/matchningsbeslut via `recordBackendAutomationPipelineTrace` utan att skapa dubbla ACK:ar.
- Lade till business matching-moduler för kund, mätpunkt, process och permission med confidence-modell `high/medium/low`.
- Lade till outbox lifecycle: create, process, send och supersede/blockering av motsatt final ACK.
- Lade till SLA timers: CONTRL/APERAK due + warning/critical/expired.
- Lade till portal-feedback parser och admin-sida `/admin/ediel/portal-feedback`.
- Lade till migration `20260605160000_ediel_backend_automation_foundation.sql` för `ediel_processing_runs`, `ediel_decision_traces`, `ediel_outbox`, `ediel_ack_lifecycle`, `ediel_process_links`, `ediel_match_candidates`, `ediel_portal_validation_feedback`, `ediel_sla_timers`, rule profile shells och kompatibilitetsvyer för `ediel_permissions`/`ediel_unresolved_messages`.
- Lade till regression `npm run ediel:automation-foundation-regression` och kopplade den till `npm run ediel:regression`.

### Varför
- Gridex ska gå från manuella superadmin-knappar till backend-driven Ediel-automation där UI visar beslut, inte styr beslut.
- Tenant, route, kund/anläggning/mätpunkt/process och ACK-lifecycle måste vara spårbara innan autoskick i produktion.

### Skyddar test/produktion
- E6-lärdomen: portal/UI-facit kan avvika; backend decision trace ska vara källa.
- Förhindrar positiv och negativ APERAK för samma inbound/transaktion via lifecycle guard.
- Förhindrar tenant-läckage genom att osäker tenant/business match blir manual review och trace, inte autoskick.

### Verifiering
- `npm run ediel:automation-foundation-regression`
- `npm run typecheck`
- `npm run build`
- `npm run ediel:regression`

### Kvarstående risker
- Full automatisk send-policy ska aktiveras stegvis efter att migrationen är körd och verkliga route/certifikat/tenant-data är verifierad.
- Field matrix import och full UI för decision traces/outbox är foundation-ready men inte komplett byggt i denna batch.

## 2026-06-12 — OPS-E/F facility queue and customer card

- Added `/admin/facility-requests` as a tenant-safe facility work queue for missing facility ID, metering point, verified grid owner, price area and fullmakt blockers.
- Added `CustomerFacilityWorkflowCard` to the customer card so operators see missing facility data and next action without reading technical rows.
- Added `lib/facility/workQueue.ts` with RPC-backed read model and safe fallback reads.
- Added migration `20260612183000_ops_e_f_facility_work_queue_customer_cards.sql` for `gridex_facility_work_queue_v` and `gridex_get_facility_work_queue`.
- Added API and AI context documentation for website intake, public contracts, customer events and facility workflow.

## 2026-06-12 — OPS-J..N governance, audit, cleanup and documentation

- Pricing/admin agreement governance is platform-admin-only.
- Added platform usage events for action/statistics billing.
- Added safer customer-card actions for testdata marking, archiving and protected hard delete.
- Added platform data cleanup workflow for test customers.
- Updated developer documentation to use public-contracts and contract offer/version identifiers.

## 2026-07-14 — Contract publication reference integrity hotfix

- Fixed publication readiness so selected `price_plan_id` and `price_plan_version_id` are validated together with the exact price book reference line.
- Prevented reuse of a stale price book after changing price plan/version.
- Blocked draft/inactive price plans and price versions from generating published price books.
- Added cleanup when legal bundle items or price book lines fail, avoiding orphan canonical records.
- Changed legal bundle schema failures from fail-open to explicit blockers.
- Required one active website API client to carry both `website_contracts.read` and `website_applications.write`.
- Added database-level canonical readiness checks for tenant legal profile, exact tenant/plan/version/book mapping and API scopes.
- Normalized `spot` to variable-monthly legal rules, made customer type `both` include consumer and business requirements, and prevented mandatory legal modules from being removed by partial payloads.
- Replaced hidden empty-list UI fallbacks with visible database error diagnostics on the tenant contract controls.
- Added migration `20260714223000_contract_publication_reference_integrity_hardening.sql` and expanded the canonical contract regression.
