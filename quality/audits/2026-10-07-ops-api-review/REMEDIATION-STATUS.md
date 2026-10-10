# OPS API remediation status

Plan: `docs/superpowers/plans/2026-10-09-ops-api-remediation-and-compatibility.md`.

| Fynd | Paket | Status | Bevis |
|---|---|---|---|
| F18 | 1 | FIXED (runtime) | `__tests__/partner-poa-commit-ownership.test.ts` — rött före fix (3/5), grönt efter. PDF raderas endast vid definitivt DB-avslag; completionfel ger `503 idempotency_completion_uncertain` och behåller filen. Gäller även legacy `core.ts`. |
| F19 | 1 | FIXED (runtime) | `__tests__/portal-idempotency-ack-loss.test.ts` — rött före (2/3), grönt efter. Fail-update kräver `status=processing`; completion-ACK-fel återläser lagrat completed-resultat. |
| F37 | 1 | FIXED (runtime) | Claim före upload; completed replay = 0 upload/remove (samma testfil). |

Kvarstår för Paket 1: native PostgreSQL/hosted Storage-prov (ej kört i denna miljö). Ledger som lämnas `processing` efter två misslyckade completionförsök kräver manuell reconciliation (oförändrat beteende jämfört med tidigare `idempotency_in_progress`).

Verifiering (Node 22.22.0): `typecheck` PASS; `api:docs`, `api:compatibility`, `api:release:verify`, `api:error-registry` PASS; 10 befintliga partner/staff/portal-idempotenstestfiler (107 tester) PASS. `typecheck:tests` har ett förexisterande fel i `evidence/current-pricing-directed-proof.test.ts` (från main).

## Paket 2 — F28, F42

| Fynd | Status | Bevis |
|---|---|---|
| F28 | FIXED (TS + native) | TS: `__tests__/website-poa-exact-accepted-document-ts.test.ts` (rött före: alternativt dokument accepterades; grönt efter, 0 RPC-anrop vid mismatch). Native: `supabase/migrations/20261009090000_ops_api_exact_accepted_poa_document.sql` + `__tests__/website-poa-exact-accepted-document.test.ts` (PGlite, riktig PL/pgSQL; rött utan migrationen, grönt med; hela fasen rullas tillbaka). |
| F42 | FIXED (versionsstyrd) | Livedefinitionen av `gridex_normalize_power_of_attorney_legal_reference` + trigger versionerad ordagrant i samma migration; tenant/modul/lås/FK-kontroller provade. |

Kvarstår: autentisk `schema.sql`/fingerprint-capture och hosted clean/upgrade-replay (kräver CI/Supabase-replay; typer oförändrade, manifestet noterar `schema_capture_pending`). Website-OpenAPI-beskrivningen av `textVersionId` uppdateras i den samlade docsreleasen (Paket 17); att höja den frysta releasen nu skulle ändra `contract_schema_version` för alla klienter innan Paket 4:s kompatibilitetsregler finns.

## Paket 3 — F26, F27

| Fynd | Status | Bevis |
|---|---|---|
| F26 | FIXED (runtime) | `lib/documents/pdfStructure.ts` (header, startxref→xref, Catalog, Page, även komprimerade objektströmmar) i Partner simple + legacy. `__tests__/partner-poa-pdf-structure.test.ts`, F26-fallet i `__tests__/partner-poa-commit-ownership.test.ts` (fem byte `%PDF-` → 422, 0 upload, 0 POA). Validerar inte digital signatur. |
| F27 | FIXED (runtime + native trigger) | Migration `20261009100000_ops_api_contract_confirmation_delivery_continuation.sql`: tenantbunden `customer_contract_confirmation_deliveries` skapas i signeringstransaktionen (trigger på `used_at`). Retry-worker i `customer-operations`-cron; signeringssidan visar köad/förbereds/misslyckad. `__tests__/signed-contract-receipt-continuation.test.ts` (handler-fejk + PGlite-trigger, inkl. rollback och annan tenant). |

Kvarstår: riktig mailleverans till testmottagare och hosted replay; `database.types.ts` utökad för- hand i typegen-format (`authentic_typegen_pending`).

## Paket 5 — F1, F2, F29, F30

| Fynd | Status | Bevis |
|---|---|---|
| F1 | FIXED (runtime) | `lib/staff-api/context.ts`: bestående externt ankare/bindning ger `403 staff_identity_registration_removed` även utan `staff_tenant_auth`-metadata (samma beslut som native skrivguard). Saknade externa tabeller (live idag) ⇒ legacy fortsatt tillåten; andra fel fail-closed. `__tests__/staff-historical-binding-required.test.ts`. |
| F2 | FIXED (docs) | `docs/gridex-staff-api.md` + `app/developers/staff-api/page.tsx`: två identitetsflöden, externa claims, fungerande exempel, länk till onboarding. |
| F29 | QUALIFIED — preflight införd, deploy kvarstår | `scripts/check-ops-api-deployment-contract.cjs` (static/catalog, per funktion, ACL-krav) + `__tests__/api-deployment-dependencies.test.ts`. Live omprov 2026-10-09 08:32 UTC: externa Staff-tabeller/RPC:er saknas fortfarande, senaste live-migration 20261005081122 ⇒ `staff_external_identity` BLOCKED. Ingen deploy gjord här; migrationskön (inkl. senare Ediel-migrationer) ska driftsättas via ordinarie releaseflöde. |
| F30 | FIXED (native) | Migration `20261009110000_ops_api_session_guard_auth_revocation.sql`: `gridex_is_current_session_allowed()` kräver existerande, ej softdeletad, ej bannad Auth-användare. `__tests__/staff-session-auth-revocation.test.ts` (PGlite + RLS; rött utan migration 3/6). Hosted gateway/omedelbar logout-revoke kvar att prova i disponibel miljö. |

## Paket 4 — kompatibilitet utan exakt docs-match

DONE (runtime + policy): `lib/integrations/apiContractCompatibility.ts` (registry: minimum `2026-10-02.3` + aktuell `2026-10-04.1` för Website/Customer; Staff/Staff onboarding egna rader), `lib/integrations/apiContractProjection.ts` (explicit allowlist per profil, idag identitet; profilunik cache-nyckel). Referenshjälparen `refreshPublicContractFeed` kräver inte längre exakt `contract_schema_version`; nekar annan major, återanvänder aldrig annan tenants snapshot (304/last-known-good). `docs/api-compatibility-policy.md`. Tester: `__tests__/api-contract-compatibility-policy.test.ts`, `__tests__/api-legacy-client-profiles.test.ts`. Kvar: prov med verkliga tenant-SDK:er (inga tillgängliga här) och serverstyrd per-credentialprofil (behövs först när en profil får avvikande representation).

## Paket 14 — F5, F44 (F29/F42 se Paket 5/2)

| Fynd | Status | Bevis |
|---|---|---|
| F5 | FIXED (forward migration) | `20261009160000_ops_api_service_only_restore_grants.sql` återkallar authenticated/anon/public EXECUTE för `gridex_db4b_archive_customer_registry_row` och `gridex_next_customer_number`; service_role behålls. `__tests__/restore-service-only-grants.test.ts` (PGlite: snapshotens grants → migration → endast service_role). Live redan spärrad (oförändrat beteende). `schema.sql` uppdateras genom autentisk capture. |
| F44 | QUALIFIED | `F44-SECURITY-DEFINER-INVENTORY.md`: 33 authenticated-körbara definer-funktioner klassade; ingen tenantläcka; en P3-rekommendation (behörighetsorakel). |

## Paket 15 — F31–F38, F43 (mätstyrt)

| Fynd | Status | Bevis / motivering |
|---|---|---|
| F31 | FIXED | `20261009170000_ops_api_drop_duplicate_indexes.sql` tar bort `ux_customers_company_customer_number` och `idx_fk_customer_case_events_b634ce08bab5` endast om tvillingen finns med identisk definition och ingen constraint äger indexet. `__tests__/duplicate-index-removal.test.ts` (unikhet kvar, idempotent, icke-identiskt index behålls). Vinsten är minskat skrivunderhåll; ingen latensvinst påstås (16 kB/index). |
| F33 | FIXED (paritet bevisad) | `20261009171000_ops_api_inbound_events_policy_initplan.sql`: `auth.role()`/plattformsadmin som initplan; `__tests__/inbound-events-policy-initplan.test.ts` visar identiska läs/skrivbeslut före/efter. Tabellen hade 0 live-rader; latensvinst ej mätt. |
| F37 | FIXED i Paket 1 | Räknas inte igen. |
| F32, F34, F43 | QUALIFIED_NO_CHANGE | Advisor-signaler utan uppmätt arbetslast; inga index skapas/raderas blint (564 oanvända-kandidater lämnas). Kräver representativ last och EXPLAIN ANALYZE i disponibel miljö. |
| F35 | QUALIFIED_NO_CHANGE | Auth connection cap 10; ingen anslutningsväntan uppmätt. Mät före poolkonfiguration. |
| F36, F38 | QUALIFIED_NO_CHANGE | Optimeringskandidater (portal-sektioner via `include`, fixed-only-resolver). Ingen mätning av bytes/p95 möjlig här; ändring utan mätt vinst behålls inte enligt performance-regeln. |

## Paket 6 + 16 — F3, F11, F12, F39, F40, F41

| Fynd | Status | Bevis |
|---|---|---|
| F3 | FIXED | Ett server-request-id per anrop i body/header/logg; klientens id loggas separat som `client_request_id`. `__tests__/staff-request-id-correlation.test.ts` (7 röda → 9/9). |
| F11 | FIXED | `Idempotency-Replayed` på invite/change-role/disable/enable; auth före replay. `__tests__/staff-user-replay-header.test.ts` (8/8 röda → gröna). |
| F12 | FIXED (guide) — spec i Paket 17 | `x-gridex-expected-project-ref`, `X-Gridex-Project-Ref`, `412 storage_project_mismatch` i guide/utvecklarsida. |
| F39 | FIXED | README pekar på aktuell kontraktsinventering; hotfix-README arkiverad. `__tests__/readme-current-contract-entry.test.ts`. |
| F40 | FIXED (opt-in) | `x-gridex-query-parsing: strict` (strikt decimal, inga dubbletter, 422 före DB); standard oförändrat för befintliga klienter. `__tests__/staff-query-parsing-policy.test.ts`. |
| F41 | FIXED | N+1-skannern täcker `lib/staff-api`, `lib/tenant`, `lib/partner-api`; ett verkligt fall annoterat som begränsad fallback. `__tests__/n-plus-one-query-budget-scope.test.ts`. Steg-/p95-telemetri kvar. |

## Paket 10 + 11 — F20–F25

| Fynd | Status | Bevis |
|---|---|---|
| F20 | FIXED | Ändrat `care_of` på samma fysiska adress sparas (`reason: care_of_updated`) utan att routing/verifiering nollställs. `__tests__/customer-profile-address-transaction.test.ts`. |
| F21 | FIXED (TS + native) | Lägre källa sänker inte proveniens; `20261009140000_customer_site_address_source_authority.sql` upprepar konfliktbeslutet på låst rad (PGlite i samma testfil). |
| F22 | FIXED | Anläggning valideras före profilmutation; 404 lämnar e-post orörd. |
| F23 | FIXED | Partner `POST /price` använder API-kanalens readiness/publicering; Website-only ger 404. `__tests__/partner-api-channel-quote.test.ts`. Kvar: prov mot en verklig API-only-publicering i disponibel miljö. |
| F24 | FIXED | `resolved`/`verified` kräver giltig assurance; stale ⇒ `partial`, `location_identifiers_provisional`, 422 för pris. `__tests__/partner-location-assurance.test.ts`. |
| F25 | PARTIAL | Semantik fixad (postnummer-only provisoriskt); schemadelen görs i Paket 7. |

## Paket 12 + 13 — F16, F17, F4, F45

| Fynd | Status | Bevis |
|---|---|---|
| F16 | FIXED | ETag omfattar tenant, kundtyp, kanal, profil, schema- och representationsrevision; `Vary: Authorization`. `__tests__/public-contract-profile-etag.test.ts` (9/13 röda → 13/13). |
| F17 | FIXED | RFC 9110 `If-None-Match` (svag jämförelse, listor, `*`) efter auth. Samma testfil. |
| F4 | FIXED | En autentisering/rate-limit-debitering per request (request-bunden WeakMap, ingen cross-request-cache). `__tests__/partner-single-auth-budget.test.ts` (4/5 röda → 5/5). |
| F45 | FIXED | `lib/integrations/webhookCredentialPolicy.ts`: rotation behåller, säkerhetsrevokering/offboarding stoppar länkade prenumerationer före transport (även köade). `__tests__/webhook-revocation-policy.test.ts`; runbook uppdaterad. Öppet beslut: nycklar revokerade före ändringen saknar revoke-typ och fortsätter leverera (medvetet för att inte tyst stoppa produktion). |

## Paket 8 + 9 — F7–F10, F13–F15

| Fynd | Status | Bevis |
|---|---|---|
| F7 | FIXED | Anläggningsfilter i DB före limit. `__tests__/partner-site-invoice-pagination.test.ts`. |
| F8, F9 | FIXED | Fortsättning via `X-Gridex-Next-Cursor` (krypterad, tenant/kund/resurs-bunden); första sidan oförändrad. `__tests__/support-history-continuation.test.ts`. |
| F10 | FIXED (policy) | Auth/ägarskap först; lyckad upload replayas efter stängning; stängt ärende blockerar nya skrivningar i execute. `__tests__/support-attachment-replay-after-close.test.ts`. |
| F13, F14 | FIXED | Aktuell revision före limit; `quantity_kwh` alltid kWh; netto utesluts dokumenterat ur simple V1. `__tests__/partner-current-metering-dto.test.ts`. |
| F15 | FIXED (native) | `20261009130000_portal_monthly_consumption_summary.sql` (`gridex_portal_monthly_consumption_v1`, Stockholm-månad, DST, korrigeringar, service_role). `__tests__/portal-complete-month-consumption.test.ts` (744 = 744). |

## Ny granskning 2026-10-09 (elpris, geo, bred buggjakt)

Livekontroll: `spot_price_intervals` 2026-10-09 SE1–SE4 = elprisetjustnu exakt (96 kvartar, snitt och stickprov identiska).

| Fynd | Status | Bevis |
|---|---|---|
| Elpris P1: höst-DST-dygnet förkastas (leverantörens fel `time_end`) | FIXED | `__tests__/spot-price-dst-provider-quirk.test.ts` med riktiga 2025-10-26-data (100 kvartar, 25 h). Nästa gång: 2026-10-25. |
| Elpris P2: timavtal saknar pris efter 2025-10-01 | FIXED | Timpris = medel av fyra kvartar från samma källa. `__tests__/spot-price-hourly-from-quarters.test.ts`. |
| Elpris P3: öre-flyttalsartefakter | FIXED | 6 decimaler. |
| Elpris P3: ett område stoppar settlement-cron | FIXED | Per område, 500 + `failed_areas`. |
| Elpris P3: revisioner av äldre dygn / statusnedgradering | REMAINING (P3) | Ej ändrat. |
| Geo P2: Lantmäteriet substring-matchning | FIXED | `__tests__/lantmateriet-exact-address-match.test.ts`. |
| Geo P2: centroid nära gräns prissatt | FIXED | `__tests__/postal-centroid-boundary-margin.test.ts`. |
| Geo P3: ID-only-förfrågan 200 utan effekt | FIXED | 422 `energy_area_address_required`. `__tests__/energy-area-id-only-input.test.ts`. |
| Geo P3: en nätägare för flernätägar-postnummer | FIXED | `__tests__/partner-location-multi-owner.test.ts`. |
| Bug P1: webhooks via värdnamn misslyckas på Node 22 | FIXED | `__tests__/webhook-transport-pinned-lookup.test.ts` (riktig socket). |
| Bug P1: en trasig bekräftelserad stoppar hela cron | FIXED | Per rad + lease. `__tests__/signed-contract-receipt-continuation.test.ts`. |
| Bug P2: 503 med samma nyckel kunde aldrig lyckas / upload förbrukade nyckeln | FIXED | `idempotency_reconciliation_required`, nyckel frigörs. `__tests__/portal-idempotency-ack-loss.test.ts`. |
| Bug P2: utkast-/misslyckade fakturor i Partner-API | FIXED | `__tests__/partner-invoice-visibility-and-stockholm-dates.test.ts`. |
| Bug P2: mätdata tappar sista intervallet / UTC-dygn | FIXED | Samma testfil. |
| Bug P2: ångerfristdatum en dag för kort | FIXED (visning) | `__tests__/withdrawal-deadline-stockholm.test.ts`. Lagrat värde oförändrat (accepted_at + 14 d). |
| Bug P2: dubbel bekräftelseleverans (race) | FIXED | Lease i `confirmationDelivery.ts`. |
| Bug P2: billing-webhook 500/läcker companyId | FIXED | `__tests__/billing-provider-webhook-status-mapping.test.ts`. |
| Bug P2: rate-limit skriver över metadata | FIXED | `__tests__/integration-rate-limit-metadata-preserved.test.ts`. |
| Bug P3: rullande avtalsperioder driver | FIXED | `__tests__/contract-lifecycle-rolling-terms.test.ts`. |
| Bug P3: filterinjektion i juridisk slug | FIXED | `__tests__/public-legal-company-slug-filter.test.ts`. |
| Bug P3: POA `accepted_at` 500 / UTC-fakturadatum | FIXED | Partner-testfilen ovan. |
| PDF-validering för strikt för verkliga PDF:er | FIXED | `__tests__/partner-poa-pdf-structure.test.ts`. |

Full svit efter sammanslagning: 994 filer / 15 458 tester PASS; typecheck, API-gates och migrationskontroller PASS.

## Paket 7, 17 och uppföljning (inkommande, betalning, fullmaktsmail)

| Område | Status | Bevis |
|---|---|---|
| F6, F25 Partner-schema | FIXED | OpenAPI 3.1 null-unioner, stängda svarsobjekt; `__tests__/partner-response-schema-validation.test.ts` (Ajv 2020, ajv@8.17.1 exakt pinnad devDependency). |
| Elpris P3 revisioner | FIXED | `updated_at` vid upsert, verifierat dygn nedgraderas inte, D-1 omverifieras. `__tests__/spot-price-import-refresh-safety.test.ts`. |
| Paket 17 docsrelease | DONE | Ny fryst release `2026-10-09.1`; minimum oförändrat `2026-10-02.3`; `docs/api-migration-guide.md`; `__tests__/api-supported-client-release-matrix.test.ts`. |
| Inkommande mail/Resend | FIXED | Monoton e-poststatus, 500 vid fel + `processed_at` (`20261009190000_…`), nästlad MIME, teckenkodning (UNOC/latin1), autosvar, dead-letter, 503 i manuell inkorg, omkörning av fastnade svar, sen studs öppnar inte avslutad förfrågan. `__tests__/inbound-review-*.test.ts`. |
| Betalhändelser | FIXED | 503 för ej routad men signerad händelse, enhetlig 401 före signatur, villkorad statusuppdatering, övergångstabell, `paid_at`-validering (svensk tid). `__tests__/billing-provider-*.test.ts`. |
| Personnummer/orgnr | FIXED (TS) / REMAINING (DB-backfill) | 422 vid ogiltigt; 12-siffrig normalisering. Befintliga 10-siffriga kundrader kräver separat backfill och dubblettstädning. |
| Fullmaktsmail till nätägare | FIXED | Resend-idempotens som HTTP-option, fullmakt kontrolleras vid kö och före utskick (sista dagen giltig i svensk tid), ingen falsk "köad", 23514 terminal, påminnelse/eskalering (5/10 arbetsdagar), isolerade cron-steg, preview skickar inte till riktiga nätägare, egen Message-ID + matchning av svar, mottagare omvärderas vid utskick (ny nyckel vid byte), `recipient_contact_channel_id` sparas, PDF rensas efter utskick, kontaktkanaltrigger spärrar gateway-/nätägaradresser och overifierad verifiering (`20261009210000_…`). `__tests__/poa-mail-review-*.test.ts`, `__tests__/poa-valid-through-last-day.test.ts`. |
| Nätägarnas kontaktadresser | ÅTGÄRD FÖR ÄGARE | 207 av 212 aktiva nätägare saknar verifierad kundtjänstadress; Ediel-filen (ediel.se 2026-10-09) innehåller endast EDIFACT-gateways. 57 avvikelser OPS ↔ Ediel-fil (bl.a. 5 Ediel-id som tillhör elhandelsbolag). |

Full svit: 1012 filer / 15 591 tester PASS; typecheck, API-gates, migrationskontroller och N+1 PASS.
