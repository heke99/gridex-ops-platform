# Avgränsad överlämning J1 — ägarbeslut 35, 36, 37 och 38 (2026-10-28)

Ägarvillkoret (ordagrant): "Ändringar i skyddad kod och godkända tester ska genomföras med avgränsad överlämning, bevarade skydd och nya positiva och negativa regressioner." Överlämningen postas av huvudagenten på #840.

## 1. Låsta SQL-kroppar

### `gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)` (enda ändrade låsta kroppen)
- **Låser:** AT-Z04L-SUPPLIER, AT-Z04LK-SUPPLIER, SC-037, SC-039 (PASSED/VERIFIED; installerad kropp från `20261019150000`).
- **Ändring (tre framåtmigrationer, exakta nålar, markör frånvarande, ägare/ACL/SECURITY DEFINER/proconfig kontrolleras):**
  - `20261028100000_j1_01_z04_start_date_conflict_hold.sql` (beslut 35): när ingen exakt egen Z03 kvalificerar och exakt en egen aktuell skickad Z03 för samma ärende stämmer i allt utom startdatum, och startdatumet inte är avtalets `requested_start_date`: `normal_z04_start_date_conflict`.
  - `20261028101000_j1_02_z04_without_own_z03_hold.sql` (beslut 36): när inget eget byte bär ärendereferensen (fält 226): `normal_z04_object_not_identified` (40/105, anläggningen finns men inte entydigt med nätområdet), `normal_z04_actor_not_related` (40/107, entydig anläggning utan eget avtal eller öppen period), annars `normal_z04_own_z03_missing` (42/226).
  - `20261028102000_j1_03_z04_duplicates_ack_09.sql` (beslut 37): en ny Z04 för ett byte som en tidigare mottagen Z04 redan bekräftat (bekräftelserad finns), med samma meddelandenamn, anläggning och agency, kund-id, leverantör, transaktionsorsak och ärendereferens: `normal_z04_case_duplicate`.
- **Bevarade skydd:** alla befintliga kontroller och deras ordning är oförändrade; de nya grenarna ligger bara där kroppen redan returnerade en hållning, returnerar alltid `applied:false` och skriver ingenting (ingen period, inget byte, inget avtal, ingen transition). Exakt Z04 tillämpas som förut. Tenant (`company_id`), miljö och omvända parter krävs i varje ny fråga. Z04A (Z26/Z70) når aldrig funktionen (`apply_supply_before_h_v1` skickar bara Z22/Z23 hit), så kravet på egen Z03 gäller inte anvisning.
- **Ej ändrade äldre vägar:** `normal_switch_confirm_v1`, `normal_switch_confirm_mixed_v1` (anropas av `apply_supply_before_own_partition_v1` och `dispatch_mixed_start_v1`) och H-vägen `confirm_h_start_v1`. Världens omkörningar visar att Z22/Z23 går via partitionsägaren.

### Ej ändrat: 103-ägaren (`gridex_ediel_duplicate_responses`, ACK-09)
- 40/103 för en ny protokolldubblett av en Z04 hålls fortfarande. Två skyddade hinder, båda ACK-09-design:
  1. `require_wire_v1` tillåter bara en referens efter ERC/FTX, men en Z04 har både Z07 och LI, och båda måste med (`ediel_duplicate_strict_96a_scope_held`). P26.A s.105 visar båda.
  2. Med formen lättad i en tillbakarullad transaktion stoppar nästa skydd: unika indexet `ux_ediel_ack_related` (ett APERAK per relaterat meddelande och tom transaktionsreferens). Originalet har redan sitt eget APERAK.
- Förslag till ACK-09-ägaren: tillåt Z07+LI i formen och ge 103-svaret en egen nyckel (t.ex. mottagnings-id som transaktionsreferens, eller indexet avgränsat till icke-dubblettsvar). Ingen ändring görs här.

## 2. Godkända tester som ändras

| Fil | Godkänt ID | Ändring | Skäl |
|---|---|---|---|
| `__tests__/ediel-prodat-own-source-register-reading-component.test.ts` | AT-Z03L-SUPPLIER, AT-Z03LK-SUPPLIER | `missing`/`other-object` 259 väntar FALSE i stället för UNKNOWN; inget 214/218 krävs eller är obestämt. `duplicate`, `malformed`, `misplaced`, `header` oförändrade (UNKNOWN). Anroparens TRUE/FALSE fyller fortfarande aldrig deklarationen. | Beslut 38 |
| `__tests__/ediel-prodat-own-source-runtime-integration.test.ts` | (evidens för samma källkomponent) | Samma uppdelning i den riktiga runtime-vägen. | Beslut 38 |
| `scripts/ediel-z04l-z04lk-future-start-native.test.ts` | AT-Z04L-SUPPLIER, AT-Z04LK-SUPPLIER, SC-037 | Varianten `start` väntar `normal_z04_start_date_conflict`. Övriga varianter oförändrade. | Beslut 35 |
| `scripts/helpers/ediel-z03-native-supply-observation.ts` (+ `scripts/ediel-at-z03l-z03lk-supplier-native.test.ts`) | AT-Z03L-SUPPLIER, AT-Z03LK-SUPPLIER | Kontrasterna `start date` och `line reference` väntar `normal_z04_start_date_conflict` respektive `normal_z04_own_z03_missing`; listan över kända hållskäl får de fem nya. | Beslut 35, 36 |
| `scripts/ediel-source-owner-native.test.ts` | (diagnostiklista) | De fem nya hållskälen läggs till listan över kända skäl. | Beslut 35–37 |

TS-kod som ändras: `lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations.ts` (L/LK: ingen egen 259 i något register och ingen i huvudet = FALSE), `lib/ediel/prodat/prodatFieldDiagnostic.ts` och `prodatDiagnosticProjection.ts` (A903 104/105/107 utöver 109, bara för leveransägarens egna hållningar), `lib/ediel/flows/normalZ04HoldResponse.ts` (ny), `lib/ediel/flows/inboundProcessing.ts`, `lib/inbound-mail/inboundOverdueMonitor.ts`, `lib/inbound-mail/edielInboundProcessor.ts` (felkoden från ett PostgREST-fel bevaras).

## 3. Nya regressioner
- `__tests__/reality-j1-normal-z04-hold-response.test.ts` (16): 42/210, 42/226 (aldrig 209), 40/105, 40/107, 40/104 med Z07+LI via den riktiga P34-renderaren; negativa: alla andra hållskäl (även Z26-skälen), delvis tillämpad källa, fel objekt, annan kod, för lång text.
- `scripts/inbound-prodat-j1-native.test.ts`: J1-01 ×2, J1-01 inget dubbelt ärende, J1-02, J1-FP2 (hållningen bär sin felkod), J1-03 (104 och intern omkörning), J1-03 103 som `it.fails` (öppen), J1-10 krävs/krävs inte, och två SQL-fall i en transaktion som alltid rullas tillbaka (skälen inklusive negativ kontroll för ändrad kund, inga skrivningar; 42/226, 40/105 och 40/107 hålls isär).

## 4. Vad som återstår för huvudagenten
- Installera `20261028100000`, `20261028101000`, `20261028102000` i världen. 103-hindret ovan behöver ett eget ACK-09-beslut. Därefter körs J1-nativesviten, AT-Z04L/LK- och AT-Z03L/LK-nativesviterna och `npm run ediel:masterplan-v2:test-coverage -- --check`.
- GEN-ägaren fångar om `schema.sql`.
