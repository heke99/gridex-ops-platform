# Spår 2 (TERM) – fynd och körkvitton

- **Kampanj:** 20261029-3f1a8ab1
- **Arbetare:** `claude-track2`, session `session_01UHTg8HxykHjbe9QgaEz2sC`
- **Gren:** `claude/sim-20261029-track2`
- **Custody A:** PR930 6506072002

Paketet innehåller bara säkra sammanfattningar. Råloggar, miljöfiler och nycklar stannar i containerns `SIM_HOME` och publiceras inte. SHA256 nedan avser de lokala filerna.

## Identitet för körningarna

| Fält | Värde |
|---|---|
| Appcommit (bas) | `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`, oförändrad, ingen app-overlay |
| Harness | `scripts/simulation/track2` på denna gren. TERM01/TERM02: `da7a655c`. TERM03: `29285443`. Varje rapport har sha256 för alla 26 harnessfiler, och de stämmer mot commiten. |
| Bygge | `next build` av basen (`built-commit` = HEAD = replay-commit), `next start` på :3102 |
| DB | Lokal Supabase (CLI 2.101.0, images från ghcr.io), postgres 17.6 på 127.0.0.1:54322 |
| Replay | `scripts/gridex-aud-003-clean-replay.sh`, privat patchad kopia. Patcharna: EXIT-trap utan `supabase stop`, mailpit påslaget, portar. Diffen finns lokalt. Klar 2026-10-29T19:26:32Z. |
| Migrationer | `applied-migrations.tsv` tom. `git diff --name-status <replay> HEAD -- supabase/migrations` tom. |
| Schemaidentitet | Replayens fingeravtryck (delidentitet, utvalda tabeller) `d5816bb40115141c0e38af283de87d211191ca6c334cbd65ee259cdda89c0363`. Normaliserad `pg_dump --schema-only -n public` (utan pg_dumps slumpade `\restrict`-rader) sha256 `997d7631883327e55ca5b25e799171e2a502a912227d0e325e1ec26b1f7d593f`. Det tidigare angivna värdet `c1b1b164…` var en rå hash som inte går att reproducera. Hashen är identisk med ny replay 2026-10-29T20:55:20Z. |
| Node/PG | v22.22.0 / 17.6 |
| Resurser | Container med 4 vCPU och 15 GiB RAM, en stack och en körning åt gången |
| Klockor | Auth/JWT följer real tid och manipuleras aldrig. Affärstid sätts med explicita fixturdatum (`starts_at`, `billing_month`, `happened_at`) via normala ingångar. Där appen använder `now()` (lifecycle `referenceDate`) gäller real Stockholmsdag. Deklarerat signeringsdatum lagras bara som metadata. Faktiskt `signed_at` är real tid från finalize-RPC:n. |
| Externa värdar | Inga. Spotpris och mätvärden är syntetiska i stackens DB. Spotguarden visade NEJ på extern import. |

## Körningar på låst harness

| Körning | Harness | Utfall | Rapport sha256 | Logg sha256 |
|---|---|---|---|---|
| term01-20261029T202228Z | da7a655c | 16 passed, 1 failed, 0 skipped | `5c678026c6bcf5aa45cebf817b61f52c8be1d9ae9d0d9db492764e4de9d54d2b` | `20c4fba275560fc9da755de26c9489159985f5b30630e5031ed4b7e91b872b74` |
| term02-20261029T202315Z | da7a655c | 26 passed, 1 failed, 0 skipped | `b3ef09bacdead3be58eb2b1545203ec19aec27246285b6a21d3a02dcd1f3e570` | `bae1599f1520b33faae97e8ba73e0bcc7fe94907671c543687ad2f2a281b004c` |
| term03-20261029T203250Z | 29285443 | 17 passed, 2 failed, 0 skipped | `07849d560b5334c9bc8b5ef7e610515efd3192aed20c5d5fb22a7e27ff6713a7` | `dba9d66fb773914423ddc7c1f00c28b69f2b5b40569a434fd41f827b1796f58e` |

Tidigare försök (harnessfel, fixturfel och de första fynden) finns kvar lokalt under `SIM_HOME/reports`. De är sammanfattade under "Misslyckade försök".

## Ersättningssteg och vad de inte verifierar

- **Kund, anläggning och mätpunkt** skrivs med SQL i stället för `createCustomerAction`, på grund av fynd 004. Adminintaget verifieras därför inte.
- **Erbjudandet** skapas via RPC:erna `gridex_upsert_internal_contract_offer_v3` och `gridex_publish_internal_contract_version`, samma som adminens actions. Admin-UI:ts formulär för erbjudanden verifieras inte.
- **Avtal** skapas via adminens server action `createContractFromOfferAction` över HTTP, i appens RPC-väg (`gridex_create_internal_customer_contract_v1`). TS-vägen faller på fynd 005.
- **Signering** sker med `gridex_prepare_customer_contract_signature_request_v1` och `gridex_finalize_customer_contract_signature_v1` i stället för kundens signeringssida. UI-signering och PDF-arkivering verifieras inte (`document_sha256` är null). Bindningen bevisas via `customer_contract_evidence`, `customer_contract_acceptances` och `customer_legal_acceptances`.
- **TERM02/TERM03:**
  - B1: leveransperiod som SQL-rad. Z03/Z04-bytesprocessen verifieras inte.
  - B2: mätvärden som SQL. Utan UTILTS-original och PRODAT kan underlaget aldrig kvalificeras (`needs_review`/`blocked`, `billing_source_binding_unavailable`), och `ready_for_pricing` verifieras inte.
  - B3/B4: spotintervall och dagssammanställningar som SQL, låsning via routen `/api/internal/spot/lock-month`. Importören och `validateSpotPriceDay` verifieras inte.
  - B5: estimering avstängd per tenant.
- Prisberäkningen körs via `/api/internal/pricing/preview` med `persist:false`.
- **TERM03.04:** avtalets `actual_start_date` (leveransstart) sätts med SQL i stället för via Ediels startbekräftelse. Själva startbekräftelsen verifieras därför inte. Härledningen av uppsägningstid verifieras däremot, eftersom den går via admin-åtgärden `logContractEventAction` över HTTP.
- **TERM03.05b:** prövar överlapp mellan två av våra egna avtal på samma mätpunkt, inte byte mot en annan leverantör. Villkoret "debiterat ≤ uppmätt" uppfylls redan när 0 kWh debiteras. Bara kravet på överlappsvarning och `needs_review` skiljer rätt utfall från fel.

## Fynd

Kategorierna är produkt, prestanda, harness, miljö och obekräftad källkandidat. Allvaret är bedömt. Fynd 004–009 är bekräftade i körning. Fynd 002 är bekräftat ur DB och kod.

### 20261029-3f1a8ab1/claude-track2/001: inget ändringsflöde för signerade kundavtal
- **Scenario:** TERM01.05. **Kategori:** produktlucka eller ägarfråga. **Allvar:** medel. **Status:** observerad.
- Signerade avtal och prissnapshots är låsta i DB: SQLSTATE 55000 `signed_customer_contract_immutable:<kolumn>` och `signed_customer_contract_delete_forbidden`, och snapshots är immutabla. Ändringar via adminens edit-action ger fynd 007.
- Det finns ingen supersede- eller versionskedja för signerade kundavtal. Kedjor finns bara för erbjudanden (`contract_offer_versions`). Belägget är en namnsökning i kod och schema, alltså inget fullständigt bevis.
- Öppen PR932 inför en kundspecifik revision för osignerade prisändringar. Den täcker inte signerade avtal.
- **Behövs:** ägarbeslut om hur en avtalsändring ska versioneras.

### 20261029-3f1a8ab1/claude-track2/002: auto-renew-vakt utan trigger och saknad hjälpfunktion
- **Scenario:** TERM01 (observation). **Kategori:** produkt, latent. **Allvar:** medel. **Status:** styrkt.
- `gridex_customer_contracts_auto_renew_guard()` finns (senast i `20261028091248_allow_contract_signature_before_supply_start.sql`), men ingen trigger kopplar den.
- Den anropar `gridex_add_months_timestamptz`, som inte skapas av någon migration, bootstrapfil eller `schema.sql`.
- Följd: DB härleder aldrig `ends_at`. Om triggern kopplas kastar den fel.
- Appen härleder bindningsslutet vid visning, och TERM01.02–.04 stämmer mot det oberoende oraklet.

### 20261029-3f1a8ab1/claude-track2/003: mjukt nekande med HTTP 200 för en annan tenants kundsida
- **Scenario:** TERM01 (tenantkontroll). **Kategori:** produkt, UX/status. **Allvar:** låg. **Status:** styrkt.
- Tenant 2:s admin som öppnar tenant 1:s `/admin/customers/<id>` med egen company-cookie får 200 utan data (`CustomerLookupProblem`). Med tenant 1:s cookie blir det 307 till `/login`.
- Inget läckage: den positiva kontrollen visade kundnamn, e-post och GSRN i tenant 1:s vy, och ingen av de markörerna fanns i tenant 2:s svar.

### 20261029-3f1a8ab1/claude-track2/004: `createCustomerAction` nekar första inskickningen
- **Scenario:** utanför TERM (kunddomän T1), blockerade TERM:s normala väg. **Kategori:** produkt. **Allvar:** hög. **Status:** styrkt.
- **Orsak:** `app/admin/customers/actions.part-3.ts:98-152` @1c0c088c ignorerar `created` från `getOrCreateCustomerApplicationIntake`. In-progress-vakten slår till på den egna, nyss skapade `received`-raden. Formuläret `CustomerIntakeForm.tsx:350` använder actionen.
- **Kvitto:** 13 av 13 unika inskickningar nekades med "En identisk intagning bearbetas redan". Raderna är kvar som `received` och har inte rörts. Rapport `term01-20261029T195650Z`, sha256 `f90c12a6089624fa63d41e794817f4b228b0e2e6772d373f99c36bf3947798ec`.
- **Rättning:** adoption via öppen PR932, som har exakt rättningen (`!intakeCreated && …`). Filen har en befintlig claim. T2 gör ingen parallell patch. Omtest sker efter merge.

### 20261029-3f1a8ab1/claude-track2/005: avtalsskapandets TS-väg skriver kolumner som saknas
- **Scenario:** TERM01, blockerade avtalsskapandet. **Kategori:** produkt. **Allvar:** hög. **Status:** styrkt.
- **Orsak:** `createCustomerContract` (`lib/customer-contracts/db.ts:1002-1012`) skriver åtta kolumner `current_supplier_*` på `customer_contracts`. De finns inte i det kanoniska `schema.sql` eller i någon kanonisk migration. Bara legacyfilen `20260528_batch_1_customer_flow_masterdata_preflight.sql:29-36` har dem, och den replayas inte. Inga läsare läser kolumnerna på avtalet.
- **Kvitto:** `createContractFromOfferAction` (erbjudande utan `price_options`) gav HTTP 500 PGRST204 i 13 av 13 anrop. Rapport `term01-20261029T195836Z`, sha256 `271601e5986dcb363c927cdaeec6b43059ee2a832d8f5a20c8ea9f6f55d58ead`. Reproducerat i varje senare TERM01-körning i steget `TERM01.PRE createContract TS-path`.
- **Rättning:** ägarbeslut 6507038107 (kodrättning utan migration). CLAIMPLAN (B) 6507050567 är godkänd i 6507056170 men väntar på att Codex utför den. En lokal rättning med regression är förberedd och inte committad.

### 20261029-3f1a8ab1/claude-track2/006: nollförbrukning med avtalad månadsavgift kan inte prissättas
- **Scenario:** TERM02.03. **Kategori:** produkt. **Allvar:** hög, eftersom fakturor med 0 kWh stoppas helt. **Status:** styrkt.
- **Orsak:** `lib/pricing/engine.ts:407-408` avbryter med "Energimängden är noll för fakturaperioden." Pricing preview får status `failed` med totaler 0/0/0. Oberoende orakel: månadsavgiften 49,00 kr plus moms (6 125 öre inklusive moms).
- **Kvitto:** term02-20261029T202315Z, steget TERM02.03, gav samma utfall i tre körningar.
- **Nästa:** rättning med claim och regression, samordnad med T1/T4 (prisdomän).

### 20261029-3f1a8ab1/claude-track2/007: ändring av signerat avtal via adminens edit-action ger okontrollerat HTTP 500
- **Scenario:** TERM01.05. **Kategori:** produkt. **Allvar:** medel. **Status:** styrkt.
- **Orsak:** `updateContractAction` (`components/admin/customers/contracts/actions.ts:1050`) skriver alltid om `priceSnapshot`. Varje inskickning för ett signerat avtal, även med oförändrade värden, ger 55000 `signed_customer_contract_immutable:price_snapshot`, och användaren ser ett generellt 500 i stället för ett kontrollerat nekande. Raden ändras inte.
- **Kvitto:** term01-20261029T202228Z, med kontrollfall för oförändrade värden. Felet finns i `app.log` med digest 3331166686.

### 20261029-3f1a8ab1/claude-track2/008: `stockholmLocalToUtc` väljer tyst offset för den dubblerade hösttimmen
- **Scenario:** TERM02.07. **Kategori:** produkt, kandidat. **Allvar:** medel. **Status:** observerad, komponentnivå.
- `lib/time/stockholm.ts` returnerar 2027-10-31T01:30Z (+01:00) för 2027-10-31T02:30 utan fel, trots att också 00:30Z är möjligt. Den nekar korrekt 2027-03-28T02:30, som inte finns.
- Funktionen anropas från `lib/billing/providerEventProcessor.ts:131` med lokal tid utan offset, enligt granskaren.
- Prisberäkning med explicita UTC-instanser skiljer timmarna exakt: 39 078 öre, och fel pris skulle ge 750 öre fel.

### 20261029-3f1a8ab1/claude-track2/009: avrundning vid exakt halvt öre är asymmetrisk
- **Scenario:** TERM02.08. **Kategori:** obekräftad källkandidat. **Allvar:** låg, men regeln är ej fastställd. **Status:** observerad.
- Positiva halvor rundas bort från noll, negativa mot noll (`Math.round`): −4,5 öre blir −4 och −5,5 öre blir −5.
- Vanliga fall är exakt lika med det oberoende Decimal-oraklet i alla prisade fall. Momsen räknas per rad.
- **Behövs:** ägarbeslut om avrundningsregel.

### 20261029-3f1a8ab1/claude-track2/010: spotpris för månadsavtal är enkelt tidsmedel (öppen orakelfråga)
- **Scenario:** TERM02.01, TERM02.04e. **Kategori:** ägarfråga eller produktkandidat. **Status:** observerad.
- Appen använder `spot_price_monthly_summaries.average_sek_per_kwh`, ett enkelt medel (0,61785) mot kWh-viktat 0,925409 för samma förbrukning.
- Timavtal är korrekt kWh-viktade.
- Definitionen "viktat pris, inte enkelt snitt" kan inte kvalificeras för månadsavtal utan originalfilen.

### 20261029-3f1a8ab1/claude-track2/011: `generate-underlay` skalar dåligt och har nått statement timeout
- **Kategori:** prestanda, uppmätt. Orsaken är inte bekräftad.
- **Mätning, warm, n=1 per rad** (term02-20261029T202315Z, `[PERF]`, HTTP 200):
  - 720–745 rader: 4 094–4 942 ms (11 anrop).
  - 1 440 rader: 10 391 ms (cold).
  - 2 972–2 980 rader: 18 681–27 505 ms (6 anrop).
- **Tidigare försök:** term02-20261029T201025Z, cirka 6 000–9 000 rader per bolag i ett anrop, gav 57014 "canceling statement due to statement timeout" (rollen `authenticator` har `statement_timeout=8s`). Kontexterna var `gridex_billing_source.lock_values_v1` (`SELECT … FOR SHARE/UPDATE` på `metering_values` och `normalized_metering_values`) och `gridex_read_billing_source_values_v1`.
- **Behövs:** EXPLAIN och profilering innan något optimeringspåstående görs.

### 20261029-3f1a8ab1/claude-track2/012: `proration_policy` påverkar inte månadsavgiften i delperiod
- **Scenario:** TERM03.01, TERM03.02. **Kategori:** produkt. **Allvar:** medel. **Status:** styrkt.
- **Utfall:** med `proration_policy=prorated_by_days` debiterade appen hel månad, 4 900 öre. Oraklet ger 2 613 öre (16/30) respektive 2 450 öre (15/30).
- **Kvitto:** term03-20261029T203250Z.
- **Kedja** (DB read-only): policyn finns hela vägen. Den finns i offerns `commercial_snapshot.price_components` och i `price_components`. I avtalets `contract_price_snapshots.price_components_snapshot` finns både `periodization_mode` och `metadata.proration_policy`. Previewn läser den (`snapshotComponents.ts:127`). Namnet matchar `priceComponentCalculator.ts:72-83`.
- **Orsak:**
  - Underlaget har redan klippts till delperioden (`underlayEngine.ts:975`, till exempel 2026-09-15..2026-10-01).
  - `engine.ts:261-309` sätter `periodStart` och `periodEnd` från underlaget och `activeFrom` från `starts_at`.
  - `periodizationFactor` (`priceComponentCalculator.ts:24-49`) delar aktiva dagar med segmentets dagar i stället för kalendermånadens. Faktorn blir därför alltid 1 för ett klippt segment.
- **Felet beror inte på val av nämnare.** Faktorn blir strukturellt 1 för ett klippt segment, och en dagsproportion för 16 eller 15 levererade dagar kan aldrig ge en hel månadsavgift.
- **Tolkning som bör bekräftas:** bara de exakta beloppen 2 613 och 2 450 öre vilar på antagandet att nämnaren är kalendermånadens dagar. Ägaren bör bekräfta det.

### 20261029-3f1a8ab1/claude-track2/013: delperiod utan `proration_policy` ger hel månadsavgift (DESIGNBESLUT)
- **Scenario:** TERM03.01, .02, .05. **Kategori:** ägarfråga. **Status:** stängd som designbeslut 2026-10-30.
- Appen valde hel månad vid 16/30, 15/30 och 20/30 levererade dagar.
- **Beslut (användaren, 2026-10-30):** alternativ (a). Proration av månadsavgift kräver uttrycklig opt-in i komponentens metadata (`lib/pricing/priceComponentCalculator.ts:114-138`). Utan policy debiteras en delperiod som hel månad. Oraklet kräver nu exakt hel månad utan policy och exakt pro rata med policy.

### 20261029-3f1a8ab1/claude-track2/014: kanalpublicering plus avtalsskapande kan ge 23505
- **Kategori:** obekräftad källkandidat. **Status:** observerad i fixture, inte i UI.
- `gridex_create_internal_customer_contract_v1` anropar alltid `gridex_ensure_internal_contract_publication`. Den skapar en publicerad version om ingen hash matchar.
- Var den interna kanalen redan publicerad (`gridex_publish_contract_channel`) bröt det mot `contract_publication_versions_one_published_per_publication_uid`: 13 av 13 i term01-20261029T200228Z, sha256 `87c3358515e747bcd4cab55035546538a5967a1d89c04c4b91b57e54c5d595b6`.
- Det är inte prövat om appens UI-sekvens (kanalaktivering och sedan avtal) ger samma fel.

### 20261029-3f1a8ab1/claude-track2/015: uppsägningsmottagning valideras inte mot avtalets start, och senare mottagning flyttar slutdatumet
- **Scenario:** TERM03.04 (kontrollfall). **Kategori:** produkt, kandidat. **Allvar:** medel. **Status:** observerad.
- **Utfall** i `logContractEventAction` med `termination_notice_received`:
  - En mottagning daterad 2025-12-31, före avtalsstart 2026-01-01, accepterades med HTTP 200 och gav ett retroaktivt `ended_at` 2026-01-31.
  - En senare mottagning 2026-12-15 flyttade `ended_at` från 2026-12-30 till 2027-01-15.
  - Samma datum en gång till ändrade inget.
- **Kvitto:** term03-20261029T203250Z.
- **Behövs:** ägarbeslut om första eller senaste mottagning gäller, och utredning av validering av `happened_at` (`gridex_record_customer_contract_event_v1`).

## Miljö och harness

- **M1, miljö:** Docker Hub svarade 429 och public.ecr.aws "data limit exceeded". Images hämtades i stället från ghcr.io/supabase.
- **M2, miljö:** första `next build` fick heap OOM med standardheap (cirka 2 GB). Bygget gick igenom med `--max-old-space-size=8192`.
- **M3, miljö:** `masterplan-claim.py --execute` nekades av proxyn (403 på `POST git/commits`). Inga refs skapades. Paketet e3b037da har sin journal kvar lokalt och körs inte om. Custody A gäller enligt ägarbeslut.
- **H1–H8, harness, rättade:**
  - admin-rollen saknade `role_permissions`, vilket gav 307;
  - fixturens kundnamn renderas från för- och efternamn;
  - server action-kroppen hade fel fältprefix, så appen fick ett tomt formulär och alla anrop delade idempotensnyckel;
  - sökvägen till snapshot för v6-selection var fel;
  - behörighetslistan ersatte i stället för att utöka fixturens behörigheter;
  - BigInt-serialisering i spotguarden;
  - `beforeAll`-fel visades som tyst skip;
  - halvöresdata i delperioder.

  Inget av detta är produktfel.

## Misslyckade försök (sammanfattning)

term01 kördes nio gånger före den låsta körningen. Felen var: 307 till `/login` (H1), tenantmarkörer (H2), konvention och tolerans som granskaren underkände, fynd 004, 005 och 014, samt fel snapshotsökväg. Spår av dessa försök finns i DB, bland annat 14 `received`-intakes och fixturtenants. term02 kördes två gånger före den låsta körningen: Forbidden (H5) och timeouts (011) som gav skip (H7). term03 kördes en gång före den slutliga körningen, med halvöresdata och en felaktig 05b-räkning.

## Öppna ägarfrågor

1. ~~Hur ska en ändring av ett signerat avtal versioneras (001)?~~ Beslut 2026-10-30: uppsägning plus nytt avtal är rutin; supersede-kedja (`supersedes_contract_id` plus atomisk RPC) är öppen produktförbättring som inte blockerar kampanjen.
2. Vilken avrundningsregel gäller (009)?
3. Ska månadsavtal ha förbrukningsviktat spotpris (010)?
4. ~~Ska månadsavgiften i en delperiod utan policy räknas pro rata (013)?~~ Beslut 2026-10-30: nej, opt-in krävs (designbeslut).
5. Ska bindningsslutet räknas exklusivt eller inklusivt? Appen använder exklusivt (start + N månader), och det oberoende oraklet utgår från samma konvention.
6. Vilken uppsägningsmottagning gäller, den första eller den senaste? Får en mottagning ligga före avtalets start (015)?

## Utfall per ID (granskat av oberoende sim-reviewer)

| ID | State | Fynd |
|---|---|---|
| TERM01.01–.04 | PASS (ISOLATED_NATIVE) | – |
| TERM01.05 | PARTIAL | 001, 007 |
| TERM02.01 | PARTIAL | 010 |
| TERM02.02 | PASS (ISOLATED_NATIVE) | – |
| TERM02.03 | PASS (ISOLATED_NATIVE, omtest 2026-10-30) | 006 rättat |
| TERM02.04 | PARTIAL | 010 |
| TERM02.05, .06 | PARTIAL | – (B2/B4) |
| TERM02.07 | PARTIAL | 008 |
| TERM02.08 | PARTIAL | 009 |
| TERM03.01, .02 | PASS (ISOLATED_NATIVE, omtest 2026-10-30) | 012 rättat; 013 designbeslut |
| TERM03.03 | PASS (ISOLATED_NATIVE) | – |
| TERM03.04 | PASS (ISOLATED_NATIVE) | 015 (kontrollfall) |
| TERM03.05 | PARTIAL | B1 (013 designbeslut) |

Inget PASS är UI-PASS eller BROWSER_E2E.

## Omtest 2026-10-30 (main `a0958815`, med #936 och #937)

- Ny replay och full build, normaliserad schemahash `20a07cbb…7641`, harness `6035b7f7`.
- TERM01 16/1/0 (enda felet TERM01.05, fynd 001). Fynd 005: TS-vägen asserterar threw=false, HTTP 200, inga felrader, exakt ett nytt avtal → löst.
- TERM02 35/0/0, inklusive nytt steg med originalorakelts exempelvärden (0/0,25/1,5/2 kWh × −0,50/0/0,75/1,20 SEK/kWh, BigInt-orakel).
- TERM03 19/0/0 med strikt orakel enligt beslut 013(a).
- Originalorakelt (`27862b90`, sha256 `96518c18…9df3`) har inga numeriska TERM-värden; alla belopp härleds ur egen fixture.
- Granskat av oberoende sim-reviewer (tre rundor). Cleanup: `down.sh` exit 0, inget kvar.
