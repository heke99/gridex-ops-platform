# Tenant/kund-konsistens och arkivering/radering — 2026-10-02

Källa: live-schema gridex-ops-dev (`piidsfebjqjmnepdpnas`, endast läsfrågor) + appkod på `main`.

## Bekräftat OK
- Ingen rad i någon tabell har `company_id` skilt från kundens `customers.company_id` (0 wrong-tenant över alla tabeller med båda kolumnerna).
- Inga föräldralösa `company_id` i någon tabell.
- Bolagsarkivering/stängning: `canonical_transition_tenant_lifecycle` (DB-RPC) + triggern
  `gridex_assert_company_operational_for_write` på customers, customer_sites, metering_points,
  customer_contracts, supplier_switch_requests, outbound_requests, ediel_messages. Ett arkiverat
  bolag fryses alltså centralt i databasen. Radering av bolag är mjuk (`deleted_test_only`) och blockeras vid historik.
- Kundradering är begränsad till platform admin + testdata + inga skyddade historikobjekt.

## Fynd

### F1 (Hög) — Arkiverad kund har inget skrivskydd i databasen
Ingen trigger på customer_contracts / supplier_switch_requests / outbound_requests / ediel_messages /
customer_sites / metering_points kontrollerar `customers.status = 'archived'`. Skyddet finns bara i
kundkortets profil-action (`profile-actions.part-1.ts:298`). Andra vägar (API, portal, jobb, Ediel-inbound)
kan skapa nytt avtal, byte eller utskick för en arkiverad kund.
Fix: forward migration med trigger `gridex_assert_customer_writable` (samma mönster som bolagsguarden), med undantag för själva arkiveringsstängningen.

### F2 (Hög) — Kundarkivering är inte atomisk
`archiveCustomerImpl` (`app/admin/customers/[id]/profile-actions.part-2.ts:342`) markerar kunden arkiverad
och stänger sedan anläggningar, mätpunkter, avtal och byten via `runBestEffortCustomerArchiveStep`, som bara
loggar `console.warn` vid fel. Resultat vid delfel: arkiverad kund med aktiva avtal/byten och ingen synlig varning.
Fallback till `{status:'archived'}` utan `archived_at/by/reason` tappar dessutom revisionsspår.
Fix: en SECURITY DEFINER-RPC som gör allt i en transaktion (tenant-kontrollerad), och appen anropar bara den.

### F3 (Medel) — Testkund-radering är inte atomisk
`deleteCustomerForRecreateImpl` kör ~40 separata DELETE samt tar bort Storage-filer först. Avbrott mitt i
ger halvraderad kund. Begränsat till testdata. Fix: DB-RPC för raderingen, Storage efter commit.

### F4 (Medel) — 51 tabeller med `company_id` och 4 med `customer_id` saknar foreign key
company_id: actor_registry_*, auth_email_events, auth_provisioning_events, communication_routes,
company_market_party_routes, customer_communication_events/templates, customer_invoice_documents,
ediel_actor_settings, ediel_route_profiles, ediel_outbound_queue, ediel_message_* m.fl. (fullständig lista
via frågan i verifieringen), grid_owners, metering_value_batches/errors, user_permissions.
customer_id: customer_portal_write_idempotency, inbound_operation_events, platform_usage_event_failures, platform_usage_events.
Dagens data är ren, men databasen hindrar inte fel bolag-id. Fix: `NOT VALID` FK + `VALIDATE` i små migreringar,
börja med Ediel-konfig (ediel_actor_settings, ediel_route_profiles, communication_routes, ediel_outbound_queue) och user_permissions.
Händelse/användningsloggar (platform_usage_events m.fl.) kan medvetet sakna FK för att överleva radering — dokumentera i stället.

### F5 (Låg) — `platform_usage_events.customer_id` har 29 rader mot raderade kunder
Förväntat för fakturerbar användningslogg efter testradering; ingen åtgärd utöver dokumentation.

## Verifiering
Alla fynd från live-katalogfrågor (pg_constraint, pg_trigger, pg_proc) och radräkning i dev. Inga ändringar gjorda i databasen.
Dev saknar arkiverade kunder/bolag, så F1/F2 är bevisade från kod och schema, inte från befintlig felaktig data.

## Föreslagna PR:er
1. F1 trigger + test. 2. F2 atomisk arkiverings-RPC + app-anrop. 3. F4 FK:er för Ediel-konfig + user_permissions. 4. F3.

## Uppdatering — F1/F2 åtgärdade (migration 20261002200000_atomic_customer_archive.sql)
- `gridex_archive_customer_v1`: kund, anläggningar, mätpunkter, avtal (via `gridex_record_customer_contract_event_v1`),
  leverantörsbyten och audit-rad i en transaktion; service_role-only, tenant-bunden (`for update`), idempotent.
- Spärr `gridex_assert_customer_not_archived_for_insert` (BEFORE INSERT) på customer_contracts,
  supplier_switch_requests, customer_sites, metering_points.
- `archiveCustomerImpl` anropar bara RPC:n; best-effort-hjälparna är borttagna.
- **Nytt bekräftat fel i gamla flödet:** avtalsavbokningen vid arkivering avvisades alltid av
  `gridex_customer_contracts_auto_renew_guard` ("termination_notice_date is required when termination_reason is set").
  Felet sväljs av best-effort-steget, så varje arkiverad kund med avtal har behållit aktivt avtal. Bevisat i dev-transaktion
  (rollback). RPC:n sätter termination_notice_date.
- Verifiering: dev-transaktion med rollback på riktig kund (arkiverad, avtal cancelled, anläggning closed, 1 audit-rad,
  andra anrop idempotent, ny anläggning blockerad). Native-test `scripts/customer-archive-atomic-regression.sql` körs i
  OPS clean replay. Unit 6429/6429, tsc, lint.
- Uppföljning: befintliga arkiverade kunder i produktion med aktiva avtal bör listas och rättas separat.

## Inventering: appkod som skriver till ≥4 tabeller i följd utan transaktion
Kolumner: antal tabeller, antal `.rpc(` i filen, fil, tabeller. Kandidater för RPC i prioritetsordning:
1. Kundlivscykel: `profile-actions.part-1.ts` (closeCustomerLifecycle), `actions.part-4.ts`, `switch-create-actions.ts`, `lib/operations/db.part-1/2.ts`.
2. Kundansökan/portal: `website-applications/actions.ts`, `lib/website/customerApplicationLegal.ts`, `lib/customer-portal/tenantSync.ts`.
3. Inkommande Ediel/ACK: `lib/inbound-mail/inboundStatusUpdater.ts`, `canonicalInboundAckStatusUpdater.ts`, `lib/onboarding/inboundEdielLinking.ts`.
4. Ediel-konfig: `app/admin/ediel/routes/actions.ts`, `certificates/actions.ts`, `rule-profiles/actions.ts`, `actors/actions.ts`.
Test-/importverktyg och analysbyggare (monthlyMetricsBuilder, spotPriceImporter, invoiceTest*) är lägre prioritet.

```
11 rpc=0 lib/ediel/portalTestCustomer.ts | communication_routes customer_addresses customer_contacts customer_sites customers ediel_route_profiles grid_owners metering_points powers_o
11 rpc=0 app/admin/ediel/actors/actions.ts | ediel_parties ediel_party_addresses electricity_suppliers grid_owners platform_actor_aliases platform_actor_identifiers platform_actor_impor
10 rpc=0 lib/inbound-mail/inboundStatusUpdater.ts | ediel_message_events ediel_messages ediel_unresolved_items grid_owner_data_requests inbound_ediel_parse_results inbound_email_messages meter
10 rpc=3 lib/actor-registry/importActorRegistry.ts | actor_registry_import_items actor_registry_import_runs electricity_suppliers grid_owners platform_actor_certificates platform_actor_identifi
9 rpc=0 lib/customer-operations/automation.part-2.ts | customer_info_request_events customer_info_requests customer_sites ediel_messages grid_owner_data_requests grid_owner_information_requests m
8 rpc=2 app/admin/website-applications/actions.ts | customer_application_workflows customer_contracts customer_operation_jobs customer_site_resolution customer_sites customers metering_points 
7 rpc=0 lib/website/customerApplicationLegal.ts | authorization_scopes customer_authorization_documents customer_documents customer_legal_acceptances power_of_attorney_events power_of_attorn
7 rpc=0 lib/operations/batch2cAutomation.ts | billing_export_run_items customer_cases external_contract_intakes metering_period_gaps operations_automation_runs outbound_requests partner_
7 rpc=1 lib/integrations/billing/invoiceExportCore.ts | customer_invoices customer_operation_tasks invoice_dead_letters invoice_export_attempts invoice_export_items invoice_export_runs invoice_pur
7 rpc=1 lib/inbound-mail/edielMailboxPoller.part-2.ts | ediel_inbound_poll_runs ediel_message_payloads ediel_messages ediel_unresolved_items inbound_email_attachments inbound_email_messages inboun
7 rpc=1 lib/ediel/db.ts | ediel_business_references ediel_message_events ediel_messages ediel_test_artifacts ediel_test_run_messages ediel_test_run_steps ediel_test_r
7 rpc=0 lib/customer-portal/tenantSync.ts | customer_documents customer_legal_acceptances customer_sites customers metering_points powers_of_attorney website_customer_applications
7 rpc=0 lib/billing/invoiceApprovedDispatch.ts | billing_export_run_items billing_export_runs customer_invoices invoice_dead_letters invoice_export_attempts invoice_export_items invoice_exp
7 rpc=1 app/admin/ediel/route-readiness/actions.ts | audit_logs platform_actor_contact_import_runs platform_actor_contacts platform_actor_import_issues platform_actor_roles platform_actor_route
7 rpc=0 app/admin/customers/[id]/profile-actions.part-1.ts | customer_internal_notes customer_lifecycle_events customer_operation_tasks customer_sites customers metering_points supplier_switch_requests
6 rpc=0 lib/operations/db.part-1.ts | audit_logs customer_authorization_documents grid_owner_data_requests outbound_requests powers_of_attorney supplier_switch_requests
6 rpc=0 lib/onboarding/infoRequests.ts | authorization_scopes customer_info_request_events customer_info_requests grid_owner_data_requests metering_permission_sites metering_permiss
6 rpc=0 lib/onboarding/inboundEdielLinking.ts | customer_info_request_events customer_info_requests customer_operation_jobs metering_permission_sites metering_permissions supplier_switch_e
6 rpc=0 lib/masterdata/db.ts | customer_internal_notes customer_sites electricity_suppliers grid_owners metering_points price_area_localities
6 rpc=0 app/admin/customers/[id]/actions.part-4.ts | customer_operation_tasks customer_sites customers metering_points power_of_attorney_scopes supplier_switch_requests
5 rpc=0 lib/pricing/spot/spotPriceImporter.ts | canonical_energy_flow_events spot_price_daily_summaries spot_price_import_runs spot_price_intervals spot_price_monthly_summaries
5 rpc=0 lib/operations/db.part-2.ts | customer_operation_tasks customer_sites metering_points supplier_switch_events supplier_switch_requests
5 rpc=0 lib/inbound-mail/canonicalInboundAckStatusUpdater.ts | ediel_message_events ediel_messages grid_owner_data_requests outbound_requests supplier_switch_requests
5 rpc=0 lib/ediel/testing/invoiceTestCenterWorkspace.ts | customer_invoices customer_sites customers invoice_export_items metering_points
5 rpc=1 lib/ediel/certificates/actorCertificateRefresh.ts | audit_logs ediel_certificate_directory_cache ediel_certificate_refresh_jobs grid_owners platform_actor_certificates
5 rpc=0 lib/customer-operations/requestMissingFacilityInformationCore.ts | customer_sites customers grid_owner_information_requests manual_email_outbox power_of_attorney_events
5 rpc=0 lib/customer-operations/automation.part-1.ts | customer_operation_jobs customer_operation_request_snapshots customer_sites metering_points website_customer_applications
5 rpc=0 app/admin/ediel/rule-profiles/actions.ts | ediel_field_matrix_imports ediel_field_matrix_rules ediel_rule_activation_log ediel_rule_profile_versions ediel_rule_profiles
5 rpc=0 app/admin/ediel/actions.part-4.ts | ediel_message_events ediel_messages ediel_test_run_messages supplier_switch_events supplier_switch_requests
5 rpc=0 app/admin/customers/[id]/switch-create-actions.ts | audit_logs customer_sites outbound_dispatch_events outbound_requests supplier_switch_requests
4 rpc=0 lib/operations/batch2bAutomation.ts | customer_info_requests customer_operation_tasks operations_automation_runs outbound_requests
4 rpc=2 lib/integrations/tenantWebsiteProvisioning.ts | companies integration_api_clients tenant_website_installation_receipts webhook_subscriptions
4 rpc=0 lib/email/resendWebhookEvents.ts | communication_log_events customer_sites grid_owner_information_requests manual_email_outbox
4 rpc=0 lib/email/manualEmailOutbox.ts | customer_sites customers grid_owner_information_requests manual_email_outbox
4 rpc=0 lib/ediel/testing/invoiceTestEdifactMaterialization.ts | customer_contracts customer_sites customer_supply_periods metering_points
4 rpc=0 lib/ediel/testing/invoiceTestCenterQuarantine.ts | customer_contracts customer_sites customers metering_points
4 rpc=0 lib/ediel/testing/invoiceTestCenterArchive.ts | customer_contracts customer_sites customers metering_points
4 rpc=1 lib/ediel/systemTestSettings.ts | audit_logs ediel_active_test_configurations ediel_counterparties ediel_system_test_settings
4 rpc=0 lib/ediel/outbox/projectSentSources.ts | customer_info_requests ediel_messages grid_owner_data_requests outbound_requests
4 rpc=0 lib/cis/db-data.ts | billing_underlays grid_owner_data_requests metering_values partner_exports
4 rpc=0 lib/analytics/monthlyMetricsBuilder.ts | bidding_zone_monthly_metrics company_monthly_metrics customer_monthly_metrics grid_owner_monthly_metrics
4 rpc=0 app/admin/ediel/routes/actions.ts | communication_routes ediel_go_live_events ediel_route_profiles grid_owners
4 rpc=0 app/admin/ediel/certificates/actions.ts | ediel_certificate_events ediel_certificates ediel_mailboxes ediel_route_profiles
```
