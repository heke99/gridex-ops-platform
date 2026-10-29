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

### J1-B6: skyddad ACK-guide och beständigt hållkvitto (`20261028103000_j1_b6_normal_z04_hold_receipts.sql`)
- **Låser:** ACK-01–ACK-10, AT-ACK-01–AT-ACK-10, SC-039, SC-054 (kvittensguidens planerade svar för PRODAT-APERAK).
- **Varför:** `gridex_ediel_ack_guide.validate_response_for_message_v1` godtar bara de svar som `bound_prodat_response_v1` planerar, alltså svar ur valideringsfasetterna eller ur beständiga effektkvitton. Leveransägarens hållning skrev inget bevis, så guiden vägrade korrekt 42/210, 42/226, 40/105, 40/107 och 40/104 (`ediel_native_ack_guide_invalid`, J1-B6).
- **Nytt:**
  - **`gridex_received_sources.normal_z04_hold_receipts`:** endast tillägg (samma oföränderlighetstrigger som effektkvittona), RLS forcerad utan policyer, ingen åtkomst för public, anon, authenticated eller service_role. Raden innehåller källa, payload-hash, kanonisk bedömning, objekt (första LIN-segmentindex, anläggning, agency, LI), skäl, ERC, nationell kod eller fält, fältets eget trådvärde och SHA-256 av kvittotexten. Nyckeln är unik per källa, bedömning och objekt.
  - **`gridex_received_sources.normal_z04_hold_v1`** (SECURITY DEFINER, ingen EXECUTE-grant): skriver kvittot i ägarens transaktion. En omkörning med samma fakta godtas. Andra fakta för samma källa, bedömning och objekt ger `normal_z04_hold_receipt_replay_conflict` och rullar tillbaka. Ingen affärseffekt.
  - **`gridex_ediel_ack_guide.normal_z04_hold_overlay_v1`** (STABLE, SECURITY DEFINER, ingen EXECUTE-grant): gäller bara Z04. Den ersätter det planerade svaret för exakt det objekt som har ett giltigt kvitto för fasettens egen bedömning, aktuell payload-hash och originalets nationella guidebindning. Det nya svaret är kvittots negativa svar. Texten kommer från originalets egen guideprojektion: `applicationTexts` för ERC 40, `invalidPrefix`+etikett+värde för ERC 42, och `textMax` gäller. Kvittot ändrar inte ett objekt som den kanoniska ägaren redan besvarat negativt, ett objekt med annan LI eller annat id, eller planen när kvitto eller bindning saknas.
- **Ändrade kroppar (exakta nålar, markörer, ägare/ACL/säkerhetsläge/proconfig kontrolleras):**
  - `gridex_received_sources.normal_switch_scope_effect_v1`: J1:s fem hållreturer anropar `normal_z04_hold_v1` (samma retur). Inga andra returer ändras.
  - `gridex_ediel_ack_guide.bound_prodat_response_v1`: bara sista returen (fasetten före domäneffekter) går genom överlägget. Den positiva vägen efter domäneffekt (`prodat_structural_response_v1`) är oförändrad.
- **Bevarade skydd:** `validate_response_for_message_v1`, `validate_prodat_planned_v1`, `prodat_wire_responses_v1`, `require_before_mixed_object_results_v1`, `prepare_before_fresh_ack_envelope_v1`, `require_domain_response_at_birth_v1`, de frysta ägar- och strukturbindningarna, 103-ägaren och de etablerade svaren är oförändrade. Ett negativt svar utan kvitto, för ett annat objekt, med annan ERC, kod, fält eller text vägras fortfarande. Ett positivt svar kräver fortfarande ett beständigt effektkvitto.
- **Nya regressioner (världens databas, transaktion som alltid rullas tillbaka, riktiga guiden):** `scripts/inbound-prodat-j1-native.test.ts` beskrivningen "J1-B6". Det verkliga APERAK:et godtas. Annat fält, annan nationell kod och annat värde vägras. Samma APERAK utan kvitto vägras. En förfalskad 42/210 för en tillämpad Z04 vägras. Kvittot är oföränderligt. En omkörning ger samma kvitto, och en omkörning med ändrade fakta ger replay-konflikt.

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
