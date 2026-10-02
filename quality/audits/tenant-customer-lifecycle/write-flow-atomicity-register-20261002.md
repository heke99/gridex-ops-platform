# Write-flow atomicity register — 2026-10-02

Static audit of every server-side write that touches tenant or customer data
(app actions, API/cron routes, lib). Classes: A = one RPC; B = single table;
C = multi-table business writes from the app (non-atomic) → needs RPC;
D = multi-table side effects only (logs, emails, webhooks).

## Already atomic (A)
Tenant provision/lifecycle/invites/access, company legal profile, customer
onboarding graph, contact change, identity change, archive, test delete,
lifecycle close (contract events inside the RPC), supply activation/end,
contract offers/products, contract signing, portal move-out, invoice export
graph/file, billing underlay batch, outbox claim, metering ingest.

## Non-atomic (C) — conversion backlog, priority order
| # | Proposed RPC | Replaces |
|---|---|---|
| 1 | gridex_create_supplier_switch_v1 | switch-create-actions.ts:419, actions.part-2.ts:240, document-actions.part-1.ts:521, supplierSwitchOrchestration.ts:233, inboundEdielLinking.ts:246 |
| 2 | gridex_transition_supplier_switch_v1 | operations/actions.ts:205/262/498, cis/actions.ts:205–250, registerCancellation, switchLifecycleBlocks.ts:296, switch-actions.ts:49 |
| 3 | gridex_finalize_supplier_switch_v1 | operations/actions.ts:392 (delegate to gridex_activate_customer_supply_v1) |
| 4 | gridex_queue_ediel_outbound_message_v1 | prodatSwitch.ts Z03/Z09, cis/actions.ts:739 |
| 5 | gridex_apply_inbound_ediel_ack_v1 | canonicalInboundAckStatusUpdater.ts, inboundAckProcessing.ts |
| 6 | gridex_apply_inbound_business_status_v1 | inboundStatusUpdater.ts:331/882/993 |
| 7 | gridex_project_ediel_sent_v1 | projectSentSources.ts |
| 8 | gridex_apply_inbound_prodat_v1 | inboundEdielLinking.ts:307/485, automation.part-2.ts |
| 9 | gridex_register_customer_lifecycle_decision_v1 | customers/[id]/actions.part-4.ts:383 |
| 10 | gridex_create_grid_owner_data_request_v1 | actions.part-3.ts:39/332/557, actions.part-2.ts:886, infoRequests.ts:1133 |
| 11 | gridex_upsert_partner_invoice_v1 | customer-portal/partnerInvoices.ts:102 (delete+insert lines) |
| 12 | gridex_record_invoice_purchase_v1 | api/internal/invoices/[id]/purchase, invoiceExportCore.ts:409 |
| 13 | gridex_apply_invoice_send_result_v1 | invoiceApprovedDispatch.ts, invoiceExportCore.ts:715 |
| 14 | gridex_apply_invoice_provider_event_v1 | providerEventProcessor.ts |
| 15 | gridex_prepare_invoice_review_v1 | invoiceReviewPrepare.ts:210 |
| 16 | gridex_set_billing_period_lock_v1 | invoiceReadiness.ts:233/275 |
| 17 | gridex_import_billing_underlay_batch_v1 | billing/import/actions.ts:28 |
| 18 | gridex_sync_portal_customer_records_v1 | customer-portal/tenantSync.ts:1214 |
| 19 | gridex_finalize_website_application_v1 | customerApplicationProcess.ts:53, customerApplicationLegal.ts:836 |
| 20 | gridex_save_website_application_review_v1 | website-applications/actions.ts |
| 21 | gridex_merge_customers_v1 | customers/duplicates/actions.ts:110 |
| 22 | gridex_save_power_of_attorney_v1 | operations/db.part-1.ts:214/716, powerOfAttorneyWorkflow.ts, authorizationChain.ts |
| 23 | gridex_request_missing_facility_information_v1 | requestMissingFacilityInformationCore.ts:565, gridOwnerRequests.ts:204 |
| 24 | gridex_claim_portal_customer_v1 | customer-portal/claim.ts:325, customer-portal/db.ts:523 |
| 25 | gridex_finalize_tenant_website_integration_v1 | tenantWebsiteProvisioning.ts:322 |

Lower risk C (staging, test tooling, platform config, derived analytics) are
left as is: customer import staging, Ediel portal test data, actor/route/cert
config, analytics/forecast/spot.

## Gaps (no write flow exists)
Contract renewal, product change and a dedicated move-in flow (move-in runs
through website application/switch).

## Status after remediation (2026-10-02)

| # | Status | Evidence |
|---|---|---|
| 1–3 | Fixed | #449: gridex_create/transition/finalize_supplier_switch_v1 |
| 4–8 | Deferred | Ediel outbound/inbound is owned by the Ediel masterplan V2 workstream (user decision). Supply end on Z05 now uses gridex_end_customer_supply_v1 (#449) and keeps status `ended` for the reviewed-closure owner |
| 9 | Fixed | #449: gridex_register_customer_lifecycle_decision_v1 |
| 10 | Fixed | #450: gridex_create_grid_owner_data_request_v1; company_id NOT NULL; monthly autopilot no longer writes tenantless requests |
| 11 | No change | upsertPartnerCustomerInvoice has no callers (dead code) |
| 12 | Fixed | #451: gridex_record_invoice_purchase_request_v1; provider-status/dispute now fail on lost local update |
| 13–14 | Partly fixed | Provider webhook retries now always drain `received` events (lost-event bug); send-result/processor left as is (idempotent claim-based processor) |
| 15 | Fixed | gridex_create_invoice_review_draft_v1 (graph + calculation snapshot in one transaction) |
| 16 | Open | billing period lock, low traffic; next batch |
| 17 | Fixed | #451: gridex_import_billing_underlays_v1 (savepoint per row, once per content) |
| 18 | Accepted | tenantSync / ensureCustomerPortalUserLink are idempotent convergent upserts, every write is company_id + customer_id scoped, failures throw; a retry completes the graph |
| 19 | Fixed (tenant scope) | website application response update and POA document link now company-scoped; a failed POA document link fails the application |
| 20 | Open | admin review save, single-tenant admin path; next batch |
| 21 | Fixed | #452: gridex_merge_customers_v1; canonical merge columns converged |
| 22 | Partly fixed | #450: POA expiry status+event atomic; POA save chain still multi-call |
| 23 | Open | missing facility information request; next batch |
| 24 | Fixed | #453: gridex_approve_portal_claim_v1; canonical claim/event columns converged |
| 25 | Open | tenant website integration finalisation; platform-admin only |
| — | Fixed | Invoice test-center approval: gridex_approve_invoice_test_item_v1 |

Hosted DB (gridex-ops-dev) has every migration through 20261002225000 applied
except 20261002211000_atomic_test_customer_delete.sql, which contains DELETE
statements the Supabase MCP refuses without interactive confirmation; it must
be run once in the SQL Editor.
