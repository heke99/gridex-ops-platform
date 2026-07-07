# Gridex Ops Platform — Intake → Facility → Z01 → EDIEL → Communication → Supplier Switch Pipeline Audit

Date: 2026-07-07
Scope: customer intake (website/manual/PDF) → facility request → customer info/Z01 → EDIEL intent/outbox → communication/email → supplier switch.
Status: Batch 1 (audit only). No code changes in this document. All findings verified against source and migrations.

---

## 1. Architecture map (as implemented today)

### 1.1 Intake entry points

| Entry point | Path | Converges on orchestrator? |
|---|---|---|
| Website API | `app/api/v1/website/customer-applications/route.ts` → `processWebsiteCustomerApplication` (`lib/website/customerApplications.ts`) | Yes — `processWebsiteApplicationIntake` when facility missing + POA sendable; guards Z01 enqueue on `facilityMissing` (L3797–3827) |
| Admin manual intake | `app/admin/customers/actions.ts` → `createCustomerGraph` | Yes — `processManualCustomerIntake` / `processPdfCustomerIntake` (identical wrappers) |
| PDF/bulk import | `recordDocumentAiExtractionForImport`, `lib/documents/documentParsingPipeline.ts` | Staged (`document_ai_extractions`), orchestrator only after `createCustomerGraph` |
| Customer card "Begär uppgifter" | `app/admin/customers/[id]/actions.ts` → `startAutomaticOnboardingAction` | **No** — goes straight to `enqueueCustomerDataRequestAutomation` (Z01 worker) with **no facility guard** |
| Profile update API | `app/api/v1/customer/profile-update/route.ts` | **No** — same worker path |
| Portal tenant sync | `lib/customer-portal/tenantSync.ts` (~L713) | **No** — same worker path, no facility guard |
| External contract intake | `lib/external-contracts/intake.ts` | Deliberately manual-review only |

### 1.2 Z01 / customer_masterdata pipeline

```
customer_info_requests (lib/onboarding/infoRequests.ts: createCustomerInfoRequest, queueCustomerInfoRequestForDispatch)
→ grid_owner_data_requests (lib/cis/db-data.ts: createGridOwnerDataRequest)
→ outbound_requests (lib/ediel/flows/shared.ts: findOrCreateDataRequestOutbound → lib/cis/db-outbound.ts: createOutboundRequest)
→ ediel_message_intents (lib/ediel/intent/intentEngine.ts: createEdielMessageIntent)
→ render: INLINE buildProdatZ01Draft in lib/ediel/flows/prodatCustomerMasterdata.ts (bypasses renderGateway/prodatZ01Guard)
→ ediel_messages (lib/ediel/db.ts: createEdielMessage)
→ ediel_outbox (lib/ediel/outbox/createOutboxItem.ts)
→ dispatch (lib/ediel/outbox/processEdielOutbox.ts → sendOutboxItem → Strato SMTP)
→ CONTRL/APERAK (lib/ediel/ack/*)
```

- The facility-lookup Z01 variant uses `renderGateway.renderAndQueueFacilityLookupZ01` with `prodatZ01Guard` (facility mandatory). The customer_masterdata variant does not.
- `ediel_outbound_queue` is schema-only legacy: zero runtime references. **`ediel_outbox` is the dispatch source of truth.**
- `gridex_validate_outbound_payload` does **not exist** anywhere (migrations or code). All outbound guards are app-layer.

### 1.3 Missing-facility manual path

```
evaluateCustomerIntake (lib/customer-operations/customerIntakeOrchestrator.ts)
→ requestMissingFacilityInformation (lib/customer-operations/requestMissingFacilityInformation.ts)
→ grid_owner_information_requests (channel=manual_email; FK column is customer_site_id, NOT site_id)
→ manual_email_outbox (columns: to_email/from_email/reply_to; NOT recipient_email)
→ cron app/api/internal/manual-email/outbox/process → lib/email/manualEmailOutbox.ts (Resend)
→ inbound: manualMailboxPoller / webhook → ingestManualInboundEmail → applyManualFacilityResponse
→ facilityResponseOrchestrator.completeFacilityLookupAndRunNextSteps → completeFacilityLookup
→ evaluateCustomerIntake(apply) → evaluateAndRunNextCustomerStep (supplier switch)
```

### 1.4 Communication source of truth

- Customer/contract e-mail: `triggerEmailEvent` (`lib/email/emailEvents.ts`) → `sendCompanyEmail` → **`communication_logs`** + **`tenant_email_outbox`** → Resend worker → webhooks → `communication_log_events`.
- **`customer_communications` is a legacy/orphan table**: written only by `sendCustomerConfirmation` (`lib/operations/businessActions/sendCustomerConfirmation.ts`), never dispatched, never read. `customer_communication_logs` does not exist. This explains the live-test observation ("API shows logs, `customer_communications` empty").
- Manual grid-owner e-mail: `manual_email_outbox` (Resend). EDIEL: `ediel_messages`/`ediel_outbox` (Strato SMTP). Auth mail: `AUTH_SMTP_*` (4th lane).
- `triggerCustomerEvent` does not exist; the real function is `triggerEmailEvent`.

### 1.5 Supplier switch

Unified gate `checkSupplierSwitchReadiness` (`lib/customer-operations/switchReadiness.ts`) is used by `startSupplierSwitch`, `ensureInitialSwitchEdielAutomation`, and `tryPrepareSupplierSwitch`. The automated engine requires a candidate metering point; POA externally-sendable policy and price plan validity are NOT gated (see findings SW-3, SW-7).

### 1.6 UI

Tenant and superadmin share `app/admin/customers/[id]/page.tsx`; separation via `isPlatformAdminContext()`. A simplified tenant view model exists (`lib/customer-operations/customerCardTenantView.ts` → `buildTenantCustomerCardView`) but is **not wired** to the page. Superadmin diagnostics is a collapsed `<details>` section (page.tsx ~L2935–2996).

---

## 2. Root causes (systemic classes)

1. **Guard-after-write ordering**: `outbound_requests` are created *before* Z01 prerequisites are evaluated; early exits (missing route) leave `status=queued`, `blocking_reasons=[]` split-brain rows.
2. **Guard inconsistency across layers**: anchor check (site_id OR metering UUID) < prerequisites (facility OR metering) < PRODAT guard (facility mandatory) < intent validation (no check). Only one path (facility-lookup render gateway) uses the strict guard.
3. **Parallel entry points**: customer-card/worker/profile-update/portal-sync bypass the intake orchestrator's facility-missing branch that website intake uses.
4. **ID namespace leaks**: `route_profile_id` assigned `communication_routes.id` (Z03 + facility-lookup fallback); explicit API `grid_owner_id` can bypass platform→OPS mapping.
5. **Null-overwrite of explicit input**: partial-address site insert nulls `grid_area_code`/`price_area_code`/`grid_owner_id`, keeping values only in `metadata.claimed_*`; resolver `postal_suggested` path nulls columns.
6. **Authorization chain drops**: `authorization_document_id` propagates to `outbound_requests` and intent payload but is dropped at `ediel_messages`; supplier switch never carries it; manual intake never creates `authorization_scopes`.
7. **Status/response truth gaps**: API `communication.triggered` includes `*_sent` when only queued; workflow step "SMTP skickad" marks done on waiting; dispatch events say "köad" when failed.
8. **Diagnostics guessing schema**: `app/admin/system-health/page.tsx` selects `manual_email_outbox.recipient_email` (column is `to_email`); no reusable customer-flow inspector exists.

---

## 3. Findings register

Legend: Risk P0 = breaks intake/dispatch safety, P1 = blocked/stuck workflow, P2 = UI/status/logging mismatch, P3 = cleanup. Impact: T=tenant UI, S=superadmin UI, B=backend, W=worker, D=DB, X=diagnostics. Mig=migration needed, Rep=repair script needed, Reg=regression needed.

### P0

- **Z01-1 — Outbound created before prerequisites; missing-route exit leaves queued split-brain**
  `lib/ediel/flows/prodatCustomerMasterdata.ts` `prepareAndQueueProdatZ01FromDataRequest` (~L767 outbound create; ~L794–861 early return). Tables: `outbound_requests`, `grid_owner_data_requests`. Pattern: guard-after-write (class 1/16/17). Fix: evaluate prerequisites and route context first, or persist `status=blocked` + `blocking_reasons=['facility_or_metering_point_missing'|route blocker]` + `required_admin_actions` on every early exit. Risk P0. Mig: no. Rep: **yes**. Reg: yes. Impact B/W/D. Bad rows likely exist (observed live).
- **Z01-2 — `createOutboundRequest` has no facility/metering guard for customer_masterdata**
  `lib/cis/db-outbound.ts` `createOutboundRequest` (L179–443); `lib/ediel/flows/shared.ts` `findOrCreateDataRequestOutbound`. Sets `queued` regardless of `metering_point_id`/facility. Pattern class 10. Fix: hard guard — for `business_process=customer_masterdata` with no facility/metering, force `blocked` + blockers; never `queued`. Risk P0. Mig: no (DB trigger optional, see DB-4). Rep: yes (shared with Z01-1). Reg: yes. Impact B/D.
- **Z01-3 — Guard inconsistency across Z01 layers**
  `lib/customer-operations/z01Prerequisites.ts` (facility OR metering, L230–244) vs `lib/ediel/profiles/prodatZ01Guard.ts` (facility mandatory) vs `lib/ediel/intent/intentEngine.ts` `evaluateIntentValidation` (no facility check for customer_masterdata). Pattern class 10. Fix: single canonical guard (facility_id or valid metering point per business rule), enforced at anchors, prerequisites, intent validation, render, resume, outbox creation. Risk P0. Mig: no. Rep: re-validate existing intents. Reg: yes. Impact B/W.
- **INT-1 — "Begär uppgifter"/worker/profile-update/portal-sync bypass orchestrator facility branch**
  `app/admin/customers/[id]/actions.ts` `startAutomaticOnboardingAction` (L1676–1729); `lib/customer-operations/automation.ts` `processCustomerDataRequest` (L899–1066); `lib/onboarding/infoRequests.ts` `customerMasterdataAnchorsAreMissing` (L1036–1047, checks only site/metering UUID, not facility identity); `lib/customer-portal/tenantSync.ts` (~L713). Worker creates CIR/GODR/outbound first, blocks at Z01 preflight only afterwards. Pattern classes 10/18 (parallel pipelines). Fix: central facility-identity guard in `enqueueCustomerDataRequestAutomation`/`processCustomerDataRequest`: if facility identity missing → `requestMissingFacilityInformation` path and stop; never create queued customer_masterdata rows. Risk P0. Mig: no. Rep: yes (shared). Reg: yes. Impact B/W/T/S. Bad rows exist (observed).
- **SW-1 — Z03 intent `routeProfileId` set to communication route id**
  `lib/ediel/flows/prodatSwitch.ts` (~L254: `routeProfileId: routeContext.route.id`); same fallback pattern in `lib/customer-operations/facilityLookupEdifactDispatch.ts` (~L242). Tables: `ediel_message_intents`, `ediel_route_profiles`, `communication_routes`. Pattern class 4 (ID mixing). Fix: use `routeContext.routeDecision.edielRouteProfileId`; null if absent + blocker `route_profile_missing`. Risk P0. Mig: no. Rep: yes (backfill mis-typed intents). Reg: yes. Impact B/D.
- **SW-2 — Supplier switch chain omits `authorization_document_id`**
  `lib/operations/db.ts` `createSupplierSwitchRequest` (~L1467, null unless param passed); `prodatSwitch.ts` payload (~L203–221); `flows/shared.ts` `findOrCreateSwitchOutbound`. Pattern class 8 (business object not propagated). Fix: resolve auth doc from POA (`powers_of_attorney.document_id` / `customer_authorization_documents`) and thread through switch → outbound → intent payload → message metadata. Risk P0 (legal/compliance). Mig: no. Rep: yes (backfill). Reg: yes. Impact B/D.

### P1

- **WEB-1 — Partial-address site insert nulls resolved grid fields**
  `lib/website/customerApplications.ts` `upsertSite` (~L2204–2231: `price_area_code: null, grid_area_code: null, grid_owner_id: null`, values only in `metadata.claimed_*`). Pattern class 1/2 (explicit input lost). This is the generalized LKA/SE4 class. Fix: write enriched/explicit values to columns as the complete-address path does. Rep: yes (backfill from `metadata.claimed_*`/`customer_site_resolution`). Reg: yes. Impact B/D.
- **WEB-2 — Resolver runs before site exists; `postal_suggested` path nulls grid columns**
  `lib/energy/resolver.ts` `saveResolution` (~L628–664). Pattern class 1/2. Fix: central merge rule — resolver only enriches missing values, never nulls existing non-null explicit values; re-run resolution with `customerSiteId` after site create. Reg: yes.
- **WEB-3 / RT-1 — Explicit `grid_owner_id` bypasses platform→OPS mapping**
  `customerApplications.ts` `mergeResolverWithExplicitInput` (~L1365–1373); readiness `hasVerifiedGridOwner` accepts non-UUID (applicationReview.ts ~L526); downstream `gridex_company_route_readiness_v` lookups fail silently (`route_readiness_missing`). Pattern class 4. Fix: normalize any explicit id through `resolvePlatformGridOwnerByAnyId`/`mapPlatformGridOwnerToOpsGridOwner`; reject unmappable. Rep: yes (detect sites whose grid_owner_id ∈ platform_grid_owners but ∉ grid_owners). Reg: yes.
- **WEB-4 — Contract schema fallback drops price_plan UUID columns**
  `customerApplications.ts` `createContract` (~L2698–2729 `omitKeys(['price_plan_id','price_plan_version_id'])`). Pattern class 7 (price plan). Fix: fail closed with precise blocker. Reg: yes.
- **POA-1 — Manual admin intake creates POA without `authorization_scopes`**
  `app/admin/customers/actions.ts` `maybeCreatePowerOfAttorneyFromIntake` (L1391–1451) vs website chain (`ensureWebsiteAuthorizationChainFromPowerOfAttorney`). Z01 dispatch requires scopes (`hasAuthorizationForRequest`) → manual customers block with `missing_authorization`. Pattern class 5/8. Fix: idempotent `ensureCustomerAuthorizationDocument`/`ensureAuthorizationScopes` helpers shared by all intakes. Rep: yes (backfill scopes from POA). Reg: yes.
- **POA-2 — Dual scope tables**
  `power_of_attorney_scopes` (legacy) and `authorization_scopes` both written by website; readers diverge. Pattern class 5. Fix: canonical = `authorization_scopes`; keep legacy writes only if a reader still needs them, then deprecate. Reg: yes.
- **POA-3 — `authorization_document_id` dropped at `ediel_messages`; PRODAT reference uses `external_reference`**
  `prodatCustomerMasterdata.ts` (~L517–518, ~L585–601); `lib/ediel/db.ts` `createEdielMessage`. Pattern class 8. Fix: thread into message parsed_payload/metadata; use POA/auth doc for `powerOfAttorneyReference`. Reg: yes.
- **Z01-4 — customer_masterdata bypasses RenderGateway / no sanctioned renderer**
  `prodatCustomerMasterdata.ts` inline render (~L1346–1425) vs `lib/ediel/intent/renderGateway.ts` (only facility-lookup). Pattern class 11 (valid pipeline exists but not used). Fix: `renderAndQueueCustomerMasterdataZ01` in renderGateway using `prodatZ01Guard`. Reg: yes.
- **Z01-5 — `resumeStuckEdielIntents` gaps**
  `lib/ediel/intent/resumeStuckIntents.ts` (L192–194 filter): draft intents never resumed nor blocked (stuck forever); resume of validated customer_masterdata re-enters guard-after-write path; no claim lock (concurrent crons). Pattern classes 7/9. Fix: sweep draft intents → re-validate or mark blocked with reasons; add claim semantics; hard facility guard inside resume. Reg: yes.
- **Z01-6 — Intent idempotent hit returns stale draft without re-validation**
  `intentEngine.ts` `createEdielMessageIntent` (~L252–259). Pattern class 9. Fix: re-run `evaluateIntentValidation` on idempotent hit. Reg: yes.
- **Z01-7 — Intent facility/metering columns not populated from live prerequisite evidence**
  `prodatCustomerMasterdata.ts` `facilityIdFromDataRequest` (L242–253; also conflates `meter_point_id` with facility). Fix: pass `z01Prerequisites` resolved identifiers into intent. Reg: yes.
- **Z01-8 — Z01 blocker fallback opens Ediel facility lookup instead of manual path**
  `lib/customer-operations/z01Prerequisites.ts` `ensureFacilityLookupForZ01Blocker` (L129–161). Pattern class 5 (one flow writes, downstream reads another). Fix: delegate to `ensureFacilityLookupAutomation`/`requestMissingFacilityInformation` (channel-aware). Reg: yes.
- **FAC-1 — Email queued while request stays `needs_review`**
  `requestMissingFacilityInformation.ts` (~L794–809 status advance excludes `needs_review`). Pattern class 7. Fix: advance any reused open request to `manual_email_queued` after successful outbox insert. Rep: yes (reconcile). Reg: yes.
- **FAC-2 — Outbox idempotency key ignores `request_type`/request id**
  `requestMissingFacilityInformation.ts` (~L733). Pattern class 19. Fix: include requestType/requestId in key. Reg: yes.
- **FAC-3 — `delivery_uncertain` outbox does not flag linked request**
  `lib/email/manualEmailOutbox.ts` `recoverStaleManualSendingRows` (L166–190). Pattern class 7. Fix: mirror bounce handling — request `needs_review` + dispatch error code. Rep: yes. Reg: yes.
- **SW-3 — Switch readiness ignores externally-sendable POA policy**
  `switchReadiness.ts` / `lib/operations/readiness.ts` (status-only POA check). Fix: add `structuredPoaIsExternallySendable` + `authorization_scopes` gate. Reg: yes.
- **SW-4 — `evaluateCustomerProcessRouteReadiness` hardcodes `environment: 'production'`**
  `lib/customer-operations/customerProcessRouteReadiness.ts` (L65). Pattern class 11 (environment mismatch). Fix: resolve environment from company/process context. Reg: yes.
- **SW-5 — Z03 `authorization_missing` check only at render**
  `lib/ediel/prodat.ts` (~L518–524). Fix: surface in unified readiness gate. Reg: yes.
- **COM-1 — API claims emails triggered/sent when only queued**
  `customerApplications.ts` `emailTriggerSucceeded` (~L313–316) + `triggered` array includes `contract.confirmation_sent`/`cooling_off_sent` at intake (~L3941–3970). Pattern class 16. Fix: expose `dispatch_status: queued|sent|failed` per event; never claim `*_sent` until log status is sent (domain events already correct). Reg: yes.
- **COM-2 — Workflow step "SMTP skickad" fakes done + conflates channels**
  `lib/customer-operations/customerCardWorkflow.ts` (~L665–668: done on `isWaiting`). Pattern class 7 + UI truth. Fix: channel-specific steps derived from `dispatchState`/`manual_email_outbox`/`communication_logs`; done only with dispatch proof. Reg: yes (UI regression).
- **COM-3 — Orphan `customer_communications` write path**
  `lib/operations/businessActions/sendCustomerConfirmation.ts` (L39–54). Pattern class 5. Fix: route through `sendCompanyEmail`/`triggerEmailEvent`; deprecate orphan table writes. Rep: optional (mark stale rows). Reg: yes.
- **UI-1 — Tenant sees superadmin-grade technical timeline; simplified tenant view unwired**
  `CustomerBusinessActionsCard.tsx` (`showTechnical` gates only message IDs); `buildTenantCustomerCardView` unused. Pattern class 14. Fix: wire tenant view (Swedish business steps) for `!isPlatformAdmin`; keep full technical timeline for superadmin. Reg: yes.
- **DB-1 — `supplier_switch_requests_open_site_uidx` conditionally skipped if duplicates exist**
  `20260702090000_gridex_production_readiness_switch_intake_constraints.sql` (L59–71). Pattern class 19. Fix: detection query in repair script; re-apply index after cleanup. Mig: yes (re-run). Rep: yes.

### P2

- **WEB-5 — Readiness treats `offer_reference` as `price_plan_id` → `price_plan_id_not_verified_uuid` + false `price_plan` blocker** — `lib/website/applicationReview.ts` (~L554–586, 722–729). Fix: exclude offer_reference from UUID checks; merge resolved `publicOffer` UUIDs into readiness input. Reg: yes. (Exact live-test warning.)
- **WEB-6 — API `blocking_reasons`/`status` stale vs DB after manual queue** — `customerApplications.ts` (~L3607–3627, 3853–3885). Fix: rebuild response blockers from `CustomerIntakeDecision` after orchestrator ran. Reg: yes.
- **WEB-7 — `normalizeRawApplication` doesn't hoist top-level grid fields into `site`** — (~L1671–1691). Fix: hoist. Reg: yes.
- **WEB-8 — Second address commit omits claimed grid/price metadata** — (~L3545–3558). Fix: pass full claimed trinity.
- **FAC-4 — facility lookup intent routeProfileId fallback to route.id** — `facilityLookupEdifactDispatch.ts` (~L242). Same class as SW-1; fix together (P1 in effect).
- **FAC-5 — Early blockers return `requestId: null`; blocked statuses never persisted** — `requestMissingFacilityInformation.ts` (`blocked()` helper, ~L449–531). Fix: persist blocker rows (statuses already in CHECK) so UI/API always get a request_id or explicit persisted blocker. Reg: yes.
- **FAC-6 — `blocked_missing_manual_mailbox` mapped to `needs_review`; missing from blocker catalog** — `facilityLookupAutomation.ts` (L191–198); `blockers.ts`. Fix: map + add label. Reg: yes.
- **FAC-7 — Site set to `waiting_manual_response` at queue time (before send)** — `requestMissingFacilityInformation.ts` (~L845–852). Fix: queue state until worker confirms send. Reg: yes.
- **FAC-8 — Orchestrator waiting detection omits `waiting_manual_response`** — `customerIntakeOrchestrator.ts` (L294). Fix: include. Reg: yes.
- **FAC-9 — Parser requires grid_area_code; valid facility-only replies → needs_review** — `manualFacilityResponseParser.ts` (L152–156). Fix: grid area optional when GSRN valid; merge from site context. Reg: yes.
- **FAC-10 — No recipient-resolution metadata / no safe-recipient override machinery** — `manual_email_outbox` has only to/from/reply_to. Fix (section M): add resolution metadata (`selected_to_email`, `actual_grid_owner_contact_email`, `resolution_mode`, `environment`, `reason`, contact source, warnings); env-gated safe-recipient override; block `grid_owner_contact_required` when missing. Mig: yes (metadata convention or columns). Reg: yes.
- **FAC-11 — Contact channel `is_verified` not enforced in production** — `findContactChannelEmail` (L249–255). Fix: env-gated enforcement. Reg: yes.
- **WRK-1 — Worker collapses PG errors; drops code/details/hint; terminal states clear last_error** — `automation.ts` (~L1658–1672), `customerOperationActionError` (L1545–1598). Fix: persist `{stage, code, message, details, hint, ids, retryable, required_admin_action, attempt, environment}` in job result/events. Reg: yes.
- **WRK-2 — Retry reuses blocked CIR across operations / duplicate downstream** — `automation.ts` `enqueue` (L448–468), `requestForSite` (L821–876). Fix: tie reuse to operation_id or explicitly reset on retry. Reg: yes.
- **WRK-3 — UI says "Uppgiftsbegäran startad" on enqueue without downstream proof** — `startAutomaticOnboardingAction` (L1704–1725). Fix: return job id + derive status from DB. Reg: yes.
- **DB-2 — `manual_email_outbox` idempotency unique not tenant-scoped** — `20260626120000` (L243–244). Mig: yes `(company_id, idempotency_key)`. Reg: yes.
- **DB-3 — `ediel_message_intents` allows duplicate NULL idempotency keys** — `20260625110000` (L115–116). Mig: yes (partial unique / not-null enforcement). Reg: yes.
- **DB-4 — No DB-level guard for customer_masterdata outbound without facility/metering** — Fix: add `gridex_validate_outbound_payload`-style BEFORE trigger (constrained to customer_masterdata; must not weaken existing guards). Mig: yes. Reg: yes.
- **DB-5 — No unique on `manual_inbound_messages.provider_message_id`** — `20260626120000` (L293–294). Mig: yes (partial unique). Reg: yes.
- **DIAG-1 — system-health queries `manual_email_outbox.recipient_email`** — `app/admin/system-health/page.tsx` (~L62). Column is `to_email`. Pattern class 13. Fix: select `to_email`. Reg: yes.
- **DIAG-2 — No reusable customer-flow inspector** — Fix: `scripts/gridex/inspectCustomerFlow.ts` + `npm run gridex:inspect-customer-flow`, schema-aware (probe columns, never assume `customer_sites.metering_point_id`, `powers_of_attorney.externally_sendable`, `grid_owner_information_requests.site_id`, `manual_email_outbox.recipient_email`, `customer_communication_logs`). Reg: yes.
- **DIAG-3 — `outbound_dispatch_events` says "köad" when failed** — `db-outbound.ts` (~L423–427). Fix: event type mirrors status. Reg: yes.
- **UI-2 — Facility card "Kontrolleras" without metering point** — `customerActionRegistry.ts` (L139–148). Fix: include metering in condition/label.
- **UI-3 — No tenant-safe customer email status** — `page.tsx` L1893 (`needsCommunicationLogs = isPlatformAdmin`). Fix: tenant summary from `communication_logs` (event, status, date only).
- **UI-4 — Duplicate operational panels (overview + data-requests both expose same action)** — Fix: single action surface for tenants.
- **UI-5 — `resendCustomerEmailAction` omits original idempotency key** — `app/admin/customers/[id]/email-actions.ts` (L43–50). Fix: derive `:resend:` key; surface result.
- **UI-6 — Test customers (`is_test_data`) not excluded by default from tenant lists** — `lib/customers/getCustomers.ts` (L251). Fix: default exclude for tenant scope; superadmin toggle. (Note: `manual_test_patch` exists only in DB rows, not in code — handle via diagnostics/repair detection on metadata JSON.)
- **SW-6 — Duplicate switch blocker code drift** — `duplicate_open_supplier_switch` vs `duplicate_active_supplier_switch`. Fix: canonicalize.
- **SW-7 — No price plan validation in switch readiness** — Fix: gate on contract with valid `price_plan_id`/`price_plan_version_id` UUIDs.
- **SEC-1 — POA signed-URL access not audit-logged** — `app/api/admin/customer-documents/[documentId]/route.ts` (L13–59; 60s expiry + RBAC are good). Fix: audit_logs insert on access. Reg: yes.
- **WQ-1 — Work queue omits manual-email lifecycle statuses** — `app/admin/work-queue/page.tsx` (L405). Fix: extend filter.
- **DB-6 — `resumeStuckEdielIntents` no claim lock (covered in Z01-5)**; `webhooks/dispatch` optimistic only (acceptable, documented).

### P3

- WRK-4: non-`request_customer_data` jobs terminal as `failed` (invisible if UI shows only `needs_review`) — `automation.ts` L1660–1663.
- INT-2: `resumeCustomerIntake` exported, never wired — wire or remove.
- FAC-12: `manual_email_sent` status never used; `applyManualFacilityResponse` records `source:'system'`.
- SEC-2: spot-price cron non-timing-safe compare — `app/api/cron/pricing/spot-prices/route.ts` (L8–14).
- RT-2: deprecated `lib/ediel/transport/tenantResolver.ts` — remove/block imports.
- DIAG-4: `scripts/customer-portal-live-test.sh` defaults to prod URL + fixed customer id.
- POA-4: `powers_of_attorney.externally_sendable` is not a column (runtime-computed) — any external SQL must use `evidence_payload`; inspector must be schema-aware.
- COM-4: `customer_communications`/`customer_communication_events`/`customer_communication_templates` schema drift — document/deprecate.

---

## 4. Existing bad-row repair (specification — script only, no automatic deletes)

Detection (report first, mutate only with explicit `--apply`):

1. `outbound_requests` where `business_process/request_type = customer_masterdata`, `status IN ('queued','prepared','ready')`, `metering_point_id IS NULL` and `payload->site->>facility_id IS NULL`, and no linked `ediel_messages`/`ediel_outbox` row → set `status='blocked'`, `blocking_reasons += ['facility_or_metering_point_missing']`, `required_admin_actions += ['request_facility_information']`, preserve payload/metadata, write audit metadata `repaired_by_script`.
2. `ediel_message_intents` for customer_masterdata with `facility_id IS NULL AND metering_point_id IS NULL` and `validation_status != 'blocked'` and no `ediel_message_id` → set `validation_status='blocked'`, keep `render_status`/`outbox_status`, add blocking reasons.
3. Rows already linked to a sent `ediel_message`/`ediel_outbox` → **never mutate**; list as high-risk historical data for manual review.
4. `manual_email_outbox` `delivery_uncertain` with request still `manual_email_queued` → flag request `needs_review`.
5. `grid_owner_information_requests` in `needs_review` with outbox `queued/sent` → reconcile status.
6. Detect dirty/manual rows: metadata containing `manual_test_patch`, `manual_sql`, `route_materialized_manually`; sites whose `grid_owner_id` matches `platform_grid_owners.id` but not `grid_owners.id`; duplicate open switches blocking the unique index.

---

## 5. Confirmations

- The audit searched the full mismatch class (explicit-input overwrite, ID namespace mixing, table drift, status truth gaps, worker/resume revival, idempotency, diagnostics schema-guessing, tenant/superadmin visibility) — not only LKA/SE4 or the listed examples.
- Preserved-good-behavior inventory: manual facility email happy path (queue→Resend→webhooks), route masterdata + materialization regressions, EDIEL outbox sender + claim RPC (SKIP LOCKED), inbound handling, audit triggers (batch4e), legal/POA validation gates, tenant email outbox with idempotency + dead-letter. None of these are weakened by planned fixes.
- `DX-100026`, `manual_test_patch`, `route_materialized_manually` do not appear in code — they are DB-data artifacts; handled via detection/diagnostics, not code deletion.
