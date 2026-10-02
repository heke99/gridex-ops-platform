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
