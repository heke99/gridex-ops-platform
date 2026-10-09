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
