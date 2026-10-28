# Avgränsad överlämning — J2-02 (ägarbeslut 40): rättelse av redan fakturerad månad

Begäran om avgränsad överlämning för låsta/skyddade objekt, enligt ägarens villkor 2026-10-28 ("Ändringar i skyddad kod och godkända tester ska genomföras med avgränsad överlämning, bevarade skydd och nya positiva och negativa regressioner"). Postas i #840.

## Objekt som ändras (exakta textbyten, migration `20261028120000_j2_02_metering_correction_after_billing.sql`)
1. `public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])` — kroppen efter D11 (`20261025120000`) och D11-G1 (`20261026120000`).
   - Pinnas av: DB-06 / AT-DB-06 (`scripts/ediel-billing-source-sql-regression.mjs`, egen PGlite-ersättning av äldre kropp; berörs inte), D11/D11-G1-testerna (förbild ur `supabase/schema.sql`; berörs inte).
   - Ändring 1: ny gren före `break_fee`: ett rättelseunderlag (`payload.charge_kind='metering_correction'`) är kvalificerat exakt när dess egen rad i `metering_billing_corrections` binder det och har status `underlaid`/`invoiced`.
   - Ändring 2: ny nyckel `correctionPending` (journal finns och minst en korrigerad revision saknar rättelse). `correctionRequired` och `qualified` för alla andra underlag är oförändrade.
2. `public.gridex_create_billing_export_run(jsonb,jsonb)` — kroppen efter H-B6 (`20261027160000`) och H-B6b (`20261027170000`).
   - Pinnas av: H-B6/H-B6b native-testerna (markörer), DB-06 (äldre kropp i egen harness).
   - Ändring: ett färdigt rättelseunderlag med egen rättelserad (`underlaid`/`invoiced`) godtas utan mätvärdesbindning, på samma sätt som brytavgift och brytavgiftskredit. Alla andra poster går fortfarande genom `gridex_billing_source.require_underlay_v1`; nedströmskontrollerna (exakt avtal, prissnapshot, låst prisberäkning) gäller alla poster.
3. TS: `lib/billing/monthlyAutomation.ts` (nytt steg efter underlagen), `lib/pricing/engine.ts` (rättelseunderlag: bara energikomponenter, etikett och bindning per rad), `lib/ops/reconciliation.ts` (hanterade rättelser räknas inte; ny kontroll för väntande godkännanden; rättelsedokument är inte dubbelfakturering), `lib/billing/underlayEngine.ts` (bara varningstexten). DB-03/AT-DB-03, DB-06/AT-DB-06, SC-019 och U-09 listar `underlayEngine.ts`; ingen logik där ändras.

## Bevarade skydd
- Ursprungsfakturan, det låsta underlaget, dess rader och källbindning ändras aldrig (`billing_source_finalized_immutable`, `underlay_bindings`, `correction_journal`, `require_underlay_v1` orörda). Bevisat i native-testet (före/efter-jämförelse).
- Rättelsens rader pekar på aktuella, faktureringsgodkända värden i samma leveransperiod (befintlig `billing_underlay_items_gate_guard`), och varje revision kvalificeras med samma källbasregler som lagringen (`gridex_billing_source.bases_v1`).
- Idempotens per mätvärdesrevision (unik nyckel underlag + rad + aktuellt värde), under rådgivande lås per ursprungsunderlag.
- Nya tabeller: RLS, bara läsning för tenantmedlemmar; skrivning enbart via SECURITY DEFINER-funktioner. Inspelningen kräver `service_role`; beslutet kräver aktör = anropare (eller tjänsten) och `billing_underlay.export` i tenanten.
- Rättelseunderlaget och dess rader är oföränderliga när de bundits; en faktura per rättelse; aldrig mot en makulerad ursprungsfaktura; tecknet måste stämma.

## Nya regressioner
- `scripts/reality-j2-02-metering-correction-native.test.ts` (världens databas, återrullat): 6 fall, positiva och negativa.
- `__tests__/reality-j2-02-metering-correction-pricing.test.ts`: 9 fall (prissättning, körningsresultat, avstämning).
- Världens J2-10 (`scripts/reality/chain-j2-inbound-utilts.test.ts`) förväntar nu det nya beteendet.
