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
