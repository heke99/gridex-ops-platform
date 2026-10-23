# H3d – Uppsägningstid, bindningstid och avgifter vid flytt/uppsägning (read-only utredning)

Datum: 2026-10-23. HEAD `1993d6703` (main-arbetsträd, rent). Inga filändringar i repo, inga commits.
SQL: endast läsfrågor och tre helt återrullade transaktioner (`exp1.sql`, `exp2.sql`, `exp3.sql` i samma scratchpad) på syntetisk tenant `cbe55eb8…` (E2E Live Elhandel AB), kund `e21bc2a9…`, avtal `0e2199b7…`, period `fe0a5ab6…`. Tenant `69e8e257…` rördes inte. Lokala DB:ns funktionskroppar innehåller H3b (`move_out` i spärr och lager), så de motsvarar repot.

## 0. Vad repots egna regler säger (inte vad jag antar)

- **Masterplan-registren** (`docs/ediel/masterplan-v2/registers/rules.json`, `acceptance_tests.json`) innehåller bara Ediel-tidsfönster: "L D-14 dagar; LK senast inflyttningsdagen" och Z05/Z08-semantik. Där finns **ingen** regel om kommersiell uppsägningstid, bindningstid eller brytavgift vid flytt. "14 dagar" i registren avser leverantörsbytets marknadsfönster, inte kundens uppsägningstid.
- **Juridiska standardtexter** (`supabase/migrations/20260716223000_legal_defaults_readiness_and_profile_repair.sql`):
  - :41: "Uppsägningstid, bindningstid och eventuell brytavgift framgår av avtalsbekräftelsen."
  - :138 (fastpris): "För privatkund tillämpas endast avgifter som är skäliga och tillåtna. Vid flytt eller annan särskild situation gäller vad avtalet och lag anger."
- **Den enda konkreta regeln i koden:** `gridex_end_customer_supply_v1` (`supabase/migrations/20261002213000_end_customer_supply_on_switch_away.sql:146-148`): "A switch away inside the binding period may carry a break fee. Moving out does not. … never charged automatically; a person reviews it."
- I repot finns ingen referens till EL 2012 K, Ellagen 11 kap. om kundens uppsägning, eller en regel om 14 dagar för konsumenter. Den enda träffen på "11 kap." (`docs/ediel/handbook-26b/README.md:9`) gäller EIFS 2025:1 leverantörsunderrättelse. Den rättsliga regeln för konsumenters flytt är alltså **inte verifierad i repot och kräver ett ägar- eller juristbeslut** (se B1).

## 1. Hur avtals- och leveransslut beräknas idag

### 1a. Lagring av uppsägnings- och bindningstid
- `customer_contracts.notice_months integer`, `binding_months integer`, `break_fee_sek numeric`, `termination_notice_date date`, `termination_reason text`, `ends_at date`, `ended_at timestamptz`. Samma fält finns som `default_notice_months`/`default_binding_months` på `contract_offers` och `notice_months` på `contract_price_options` och `contract_product_versions` (information_schema).
- **Uppsägningstiden lagras bara i hela månader.** Zod `notice_months: z.number().int().min(0).max(36)` (`lib/pricing/commercialModel.ts:145`) och formulären visar "mån" (`CustomerContractsCard.tsx:411`, `agreementPdf.ts:277`). "Högst 14 dagar" går inte att uttrycka, eftersom det enda som ryms under en månad är 0.
- `customers.customer_type` ∈ {private, business, association} (CHECK) finns, men **ingen** livscykel-, uppsägnings- eller faktureringsväg läser den.
- Signerade avtal är oföränderliga för bland annat `ends_at`, `notice_months`, `binding_months` och `break_fee_sek`: `gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1`, trigger `customer_contracts_lock_signed`.

### 1b. Beräkning av uppsägning (TS)
- `deriveContractEndsAt` (`lib/customer-contracts/lifecycle.ts:145-165`) gör följande: ett explicit `ends_at` vinner, annars `max(start + binding_months, uppsägningsdatum + notice_months)`. Med notice 0 blir slutet uppsägningsdatumet. Funktionen tar inte hänsyn till `terminationReason` (flytt), kundtyp eller dagar.
- `addCustomerContractEvent('termination_notice_received')` (`lib/customer-contracts/db.ts:1315-1340`) skickar resultatet som `p_derived_ends_at`. `gridex_record_customer_contract_event_v1` sätter då `termination_notice_date = happened_at` och `ended_at = derived`, men **status ändras inte**. Inget jobb läser senare `ended_at` för att avsluta avtal eller leverans. Den enda läsaren är en räknare på instrumentpanelen, `upcoming_terminations` (`20260826093000_platform_dashboard_and_rls_read_performance.sql:30`).

### 1c. Manuell flytt eller avslut från kundkortet → `gridex_close_customer_lifecycle_v1`
- UI: `components/admin/customers/CustomerProfileCard.tsx:306-380`, med valen "Kund flyttar" och "Avsluta kundrelation manuellt" (`terminate`). Serveråtgärden är `closeCustomerLifecycleImpl` (`app/admin/customers/[id]/profile-actions.part-1.ts:404-580`). Utan datum används UTC-dagen (`normalizeIsoDateOrToday`, :373-377).
- SQL (`20261002212000_atomic_customer_lifecycle_close.sql`):
  - :110-132: kunden blir `moved`/`terminated`. **Alla** kundens anläggningar och mätpunkter stängs.
  - :139-151: varje öppen period får `end_date = flyttdatum`, som är sista levererade dagen, och status behålls.
  - :168-201: **alla** signed- och active-avtal blir `terminated` med `ends_at = flyttdatum`, `termination_notice_date = now()` och `termination_reason = 'move_out'`, **även i läget `terminate`**.
  - :203-216: alla bytesärenden i draft/queued/submitted/accepted sätts till `failed`.
  - :219-223: alla öppna uppgifter makuleras.
  - Ingen `final_invoice_pending` skapas. Ingen brytavgiftsbedömning görs. Inget Ediel-meddelande köas.
- **Uppsägningstid, bindningstid, en tidigare registrerad uppsägning och kundtyp ignoreras helt.** Bevisat i `exp1.sql`:
  - avtalet fick 1 månads uppsägningstid och 12 månaders bindning, och uppsägningen registrerades 2026-10-10 med `ended_at` 2026-11-10;
  - `terminate` 2026-10-15 gav sedan `status=terminated, ended_at=2026-10-15, termination_notice_date=2026-10-23 (now), termination_reason=move_out, status_reason_code=terminated`, och perioden fick `end_date=2026-10-15, planned_end_reason=terminate`.

### 1d. Manuellt slut per mätpunkt → `gridex_end_customer_supply_v1`
- `20261002213000_end_customer_supply_on_switch_away.sql:14-220`:
  - perioden får `end_date = actual_end_date = p_end_date` och status `ended`;
  - avtalet avslutas bara när ingen annan mätpunkt fortfarande levereras under det (:112-123), med `ends_at = p_end_date`, `termination_notice_date = now()` och reason `move_out` eller `supplier_switch`;
  - `break_fee_review` skapas bara vid `supplier_switch` inom bindningstiden (:149-169);
  - `final_invoice_pending` skapas alltid (:173-189).
- Uppsägningstiden ignoreras även här. **Ingen UI- eller serveranropare finns.** En grep i `app/`, `lib/` och `components/` hittar bara en kommentar i `lib/billing/supplyPeriodEnd.ts:8`. Funktionen används bara av tester och skript.

### 1e. Mottaget Z05 (L/LK) → triggern `trg_supply_end_followup` → `gridex_supply_end_followup_v1`
- Den senaste kroppen kommer från `20261023199000_final_month_pricing_contract.sql`. Avtalet avslutas på `v_end`, Z05:s exklusiva dag, med reason `supply_end`.
- `break_fee_review` skapas för **varje** slut inom bindningstiden, även LK-flytt, och bindningsslutet räknas från `starts_at`. Bevisat i `exp2.sql`: Z05-slut 2026-10-20 gav `break_fee_review` (binding_ends_at 2027-09-01) och `final_invoice_pending`. Samma data via `gridex_end_customer_supply_v1('move_out')` gav ingen `break_fee_review`. Det här är FINDINGS H6 (rad 1110), som fortfarande är öppen.

### 1f. Kundportal och API
- `gridex_submit_customer_move_out_v1` (`20260730153000_customer_portal_api_production_completion.sql:116-415`) skapar bara en completion och ett `customer_cases`-ärende med `next_action 'review_move_out_submission'`. Ingen automatisk effekt följer och ingen uppsägningstid räknas.
- **Ett passerat flyttdatum nekas:** :164-169 (`v_requested_date < current_date` → `customer_move_out_date_invalid`). En kund som redan har flyttat kan alltså inte anmäla det.
- Statuslistan :245-255 innehåller `pending_activation` och `pending_switch`, som inte finns i `customer_contracts_status_check`. Det är dött men ofarligt.

### 1g. E-post
`classifyManualInboundIntent` (`lib/inbound-mail/manualInboundCorrelation.ts:128-129`) klassar "utflytt" som `move_out_notice` (nätägarkorrespondens). Det ger ingen automatisk livscykeleffekt, så flytten hanteras manuellt via kundkortet (1c).

### 1h. Uppsägning utan flytt
Ingen väg fungerar hela vägen:
- **"Spara avtalet"** (`updateContractAction` → `updateCustomerContract`, `lib/customer-contracts/db.ts:1170-1285`) skriver `ends_at = deriveContractEndsAt(...)` och `status` direkt. För signerade och aktiva avtal nekar DB detta. Bevisat i `exp3.sql`:
  - `signed_customer_contract_immutable:ends_at`;
  - `customer_contract_terminal_evidence_required`, eftersom `ended_at` och `status_reason_code` saknas.
- **Händelseformuläret "Uppsägning mottagen"** (`ContractForms.tsx:886`, `logContractEventAction`) sätter bara `ended_at`. Inget utförs på det datumet.
- **Händelsen "Avslutat"** avslutar avtalet direkt på datumet utan `termination_reason`. Perioden förblir öppen och inget Z08 H skickas (Z08 H finns bara via `/api/ediel/supply-rescission-sources/[artifactId]/queue`, som kräver ett granskat rättsligt mandat).
- **`terminate` i 1c** kapar perioden i plattformen men skickar inget till nätägaren.
- **`gridex_register_customer_lifecycle_decision_v1`**, beslutet 'cancelled' (`20261002216000…:62-86`), sätter avtalet till `cancelled` med `ends_at = idag` och `termination_reason customer_request`. Perioden förblir öppen.

## 2. Bindningstid och brytavgift
- Brytavgiften lagras i `break_fee_sek` och som priskomponent `break_fee` med `unit sek_event`, `lifecycle event_only` och `metadata.event = 'early_termination'` (`lib/customer-contracts/db.ts:429-436`, `lib/pricing/contractPricingVersioning.ts:952-960`).
- Prismotorn tar med den bara när `underlay.payload.contract_event` är lika med `'early_termination'` (`lib/pricing/priceComponentCalculator.ts:180-186`, `engine.ts:386`). **Ingen kod sätter `contract_event`.** En grep i lib, app och migrationer gav inga träffar. En brytavgift beräknas eller debiteras alltså aldrig automatiskt, varken vid flytt eller vid uppsägning.
- Det finns bara granskningsuppgifter av typen `break_fee_review`. Vid manuellt slut skapas de bara för `supplier_switch`. Vid Z05 skapas de för alla slut, även LK, vilket är H6. `break_fee_review` hanteras inte någonstans i app eller lib (grep). Kundkortets avslut (1c) makulerar dessutom alla öppna uppgifter, så en tidigare skapad `break_fee_review` eller `final_invoice_pending` försvinner.
- Flytt undantas alltså bara i den manuella SQL-vägen, som saknar UI-anropare. Den väg som faktiskt används för flytt, kundkortet, skapar varken granskning eller avgift. Z05 LK skapar en granskning.

## 3. Slutfakturan: vilka dagar debiteras
- Faktureringen följer **leveransperioden**, inte avtalets `ends_at` eller uppsägningstid. `underlayEngine` `segmentBounds` → `supplyPeriodBillingSegment` (`lib/billing/underlayEngine.ts:343-350, 905-944`):
  - manuell flytt: till och med flyttdatumet, till civil midnatt därefter (`supplyPeriodEndInstant`, `lib/billing/supplyPeriodEnd.ts:75-83`);
  - Z05: till marknadsinstanten.
- H3/H3b-regeln (`contractEndedBySupplyPeriod`/`contractCarriesBilledPeriod`, `supplyPeriodEnd.ts:119-173`) gäller i DB-spärren, lagret, läsarna och exportvyn (`20261023200000_move_out_final_month_billing.sql:44-55`). Ett avtal som är `terminated` bär perioden bara om `termination_reason ∈ {supply_end, move_out}` **och** `ended_at::date = sp.end_date`. Ett `signed`- eller `active`-avtal bär alltid perioden.
- **Uppsägningstid som löper efter flyttdagen** kan inte uppstå idag, eftersom båda manuella vägarna sätter `ended_at` till flyttdagen (1c, 1d). Dagar under uppsägningstiden efter flyttdagen debiteras därför aldrig, varken energi eller fasta avgifter. Om man inför att avtalet slutar efter uppsägningstiden medan leveransen slutar vid flytten, gäller följande:
  - så länge avtalet är `signed`/`active` debiteras leveransdagarna korrekt;
  - när avtalet avslutas med `ended_at` = uppsägningsslutet nekas hela slutmånadens segment. Orsaken är att `ended_at::date ≠ sp.end_date`. `underlayEngine` gör då om avtalet till "saknas", och spärren och lagret nekar med 23514.
  - **Regeln klarar alltså inte avtalsslut ≠ leveransslut.** Se D8.
- **Uppsägning utan flytt via händelsen "Avslutat"** ger reason null. Då nekas hela segmentet i den månaden, även dagarna före avslutet, och därefter alla månader. Leveransen hos nätägaren pågår ändå (D2).
- **Ediel-start + manuellt slut** (H3c): `billing_supply_basis_v1` → `supply_period_source_basis_v1` ger NULL. Slutmånaden för en Ediel-kund med manuell flytt nekas fortfarande. Ägarbeslutet 2026-10-23 är fattat men **inte implementerat** (FINDINGS rad 2284-2292).
- **Månadsavgiften i slutmånaden:**
  - Som standard tas hela månadsavgiften ut (`explicitMonthlyProrationEnabled`, `priceComponentCalculator.ts:66-85`).
  - Även med uttrycklig proportionering blir faktorn sannolikt 1. Faktorn räknas mot underlagets egen `billing_period_start/end`, som redan är det kapade segmentet (`underlayEngine.ts:1073`, `engine.ts:329-331`), och `activeTo = contracts.ends_at` (`engine.ts:380`), som inte är flyttdagen. Detta bygger på kodläsning och är inte kört.

## 4. Befintliga tester och scenarier
- `__tests__/h3b-move-out-final-month.test.ts`: slutmånaden efter manuell flytt prissätts och exporteras. Avslag gäller annat skäl, annat datum, cancelled/expired, annan tenant och efter flyttdagen.
- `__tests__/h3-final-month-pricing.test.ts`, `__tests__/customer-leaves-billing.test.ts` (H1–H4) och `scripts/move-out-final-month-sql-regression.mjs`.
- `scripts/customer-lifecycle-close-regression.sql`: tenant, roll, stängning, period, byten, uppgifter. Ingen uppsägnings- eller bindningskontroll.
- Native: `scripts/supply-move-out-z05lk-native.test.ts` (H7), `scripts/customer-leaves-z05-native.test.ts`.
- Världen: `scripts/reality/chain-h-customer-leaves.test.ts` (TERMS binding 12 / notice 1). Den mjuka kontrollen :229 "H6 no break-fee review for a move-out" täcker H6.
- `__tests__/contract-lifecycle-rolling-terms.test.ts` testar bara förlängningsfönstret.
- **Saknas:** tester för uppsägningstid vid flytt eller avslut, privat- mot företagskund, notice 0 mot ≤14 dagar, `terminate` utan flytt, bevarat uppsägningsdatum, en uppsägning som körs vid sitt slutdatum, ett passerat flyttdatum i portalen, kundkortets uppsägning av ett signerat avtal och brytavgiftshändelsen `early_termination`.

## 5. Defekter

| # | Allvar | Fynd | Bevis | Reproduktion | Förslag |
|---|---|---|---|---|---|
| D1 | Hög, **ägarbeslut** | Ingen modell för uppsägningstid vid flytt eller avslut. Båda manuella vägarna avslutar på angivet datum och ignorerar `notice_months`, bindning, en registrerad uppsägning och `customer_type`. Uppsägningstid i dagar (≤14) kan inte lagras. | 1a–1d, `exp1.sql` | `exp1.sql` | Ägaren beslutar regeln per kundtyp och skäl (B1–B3). Därefter kommer en forward-migration med `notice_days` (eller notice i dagar) på erbjudande, prisval och avtal, en gemensam beräkning `effectiveContractEnd(reason, customerType, …)` i SQL och TS, och en visning av det beräknade slutet i flyttdialogen innan AVSLUTA. |
| D2 | Hög | Uppsägning utan flytt fungerar inte hela vägen. "Spara avtalet" nekas av DB, "Uppsägning mottagen" utförs aldrig, "Avslutat" och lifecycle 'cancelled' avslutar avtalet medan leveransen fortsätter utan Z08 H. Följden är att leveransen hos nätägaren inte faktureras (spärren nekar) och att leverantören fortfarande är balansansvarig. | 1h, `exp3.sql`, `record_customer_contract_event_v1` | `exp3.sql`; händelsen "Avslutat" på ett aktivt avtal med öppen period ger ett underlag med needs_review/saknat avtal | Ett atomiskt kommando `gridex_register_customer_termination_v1`: registrera uppsägningen och beräkna slutet; vid slutet, eller i förväg enligt Ediel-fönstret, skapa ett Z08 H-mandat för granskning och avsluta perioden och avtalet med samma datum och ett skäl som faktureringsregeln känner igen. Blockera "Avslutat" på ett avtal med öppen period. |
| D3 | Medel | Kundens uppsägningsdatum skrivs över med `now()` vid flytt eller slut, och `ended_at` från uppsägningen skrivs över. Underlaget för uppsägningstiden går förlorat. | `20261002212000…:193`, `20261002213000…:135`; `exp1.sql` (2026-10-10 → 2026-10-23) | `exp1.sql` | `termination_notice_date = coalesce(befintligt, kundens anmälningsdatum)`, och tidpunkten för registreringen skrivs separat. |
| D4 | Medel (H6, öppen) | Z05 LK-flytt skapar `break_fee_review`, men manuell flytt gör det inte. Bindningen räknas från `starts_at` och inte från marknadsstarten. | `gridex_supply_end_followup_v1` (DB-kropp), `exp2.sql`, chain-h :93/:229 | `exp2.sql` | Läs L/LK från den mottagna källan (CAV Z23 / transaction subtype) och hoppa över granskningen vid LK om B2 beslutar så. Räkna bindningen från `actual_start_at`/`market_start_at`. |
| D5 | Medel | Kundportal-API:t nekar ett passerat flyttdatum, så en kund som redan har flyttat kan inte anmäla det. | `20260730153000…:164-169` | Anropa API:t med `requested_move_out_date` = igår | Tillåt bakåt till exempelvis 90 dagar, märk ärendet `retroactive`, och låt H3c-regeln korta perioden men aldrig förlänga den. |
| D6 | Medel (sannolik) | Kundkortets flytt gäller hela kunden. Alla avtal, anläggningar och byten stängs, även en inflytt (LK) till ny adress under samma kund. Per-anläggningsfunktionen `gridex_end_customer_supply_v1` saknar UI-anropare. | `20261002212000…:120-216`; grep | Kund med två anläggningar, eller med pågående LK-inflytt, registrerar flytt från den ena | Erbjud flytt per anläggning via `gridex_end_customer_supply_v1`, eller begränsa close till anläggning eller mätpunkt. Ägaren beslutar om avtalet följer med till ny adress (B5). |
| D7 | Medel | Kundkortets flytt skapar ingen `final_invoice_pending` och makulerar befintliga `final_invoice_pending` och `break_fee_review` från ett tidigare Z05. | `20261002212000…:219-251` | Z05 och sedan close: uppgifterna blir cancelled | Undanta slutfaktura- och brytavgiftsuppgifter från makuleringen och skapa `final_invoice_pending` som i 1d. |
| D8 | Medel (latent) | H3/H3b-regeln kräver `ended_at::date = sp.end_date`, så avtalsslut efter uppsägningstiden kan inte förenas med leveransslut vid flytt. | `supplyPeriodEnd.ts:128-136`, `20261023200000…:45` | Avsluta ett `move_out`-avtal med ett senare `ended_at` än periodens slut: slutmånaden nekas | Om D1 inför ett senare avtalsslut ska regeln bli `ended_at::date >= sp.end_date` för det egna periodslutet, alternativt ska leveransslutet lagras separat på avtalet. Ändringen kräver ett exakt textbyte i fem kroppar, som i H3b. |
| D9 | Låg | `terminate` skriver `termination_reason='move_out'`, så statistik och faktureringsregel blandar ihop uppsägning och flytt. | `20261002212000…:194` | `exp1.sql` | Skilj på `customer_termination` och `move_out`, och ta med det nya skälet i faktureringsregeln bara när leveransen faktiskt slutar samma dag. |
| D10 | Låg (sannolik) | Månadsavgiften i slutmånaden tas alltid ut helt, även när proportionering är uttryckligen påslagen (segmentet jämförs med sig självt). | `priceComponentCalculator.ts:25-50,66-92`, `engine.ts:329-331,380` | Enhetstest: underlay 1–5 sep, `prorated_by_days` + `proration_enabled` ger kvantitet 1 | Räkna faktorn mot hela fakturamånaden. Ägaren beslutar om full eller proportionerad slutmånad (B4). |
| D11 | Låg | Brytavgiftskomponenten `event_only`/`early_termination` aktiveras aldrig, eftersom ingen sätter `contract_event`. | grep `contract_event` | – | När B2 är beslutad ska en godkänd `break_fee_review` sätta `contract_event` på slutunderlaget eller skapa en separat avgiftsrad. |
| D12 | Låg | `normalizeIsoDateOrToday` och portalens `current_date` använder UTC-dagen, inte Stockholmsdagen. | `profile-actions.part-1.ts:373-377`; SQL `current_date` | Registrera kl. 00:30 svensk tid | `currentStockholmCalendarDate()`. |
| D13 | Låg | TS-typen för `termination_reason` (`switch_supplier`, `stop_supply`, …) skiljer sig från SQL-värdena (`supplier_switch`, `supply_end`, `customer_request`, `customer_withdrawal`). | `lib/customer-contracts/types.ts:13-14` | – | En gemensam enum med en CHECK-constraint. |

Befintliga öppna punkter som påverkar detta: H3c (Ediel-start + manuellt slut, ägarbeslutet är inte implementerat), Z05 LK med "nästa dag" efter manuell stängning, H8 (texten "till och med" i slutfakturauppgiften).

## 6. Det som är korrekt
- Faktureringen följer leveransperioden. Inga dagar efter flyttdagen eller Z05-instanten debiteras (H1, H4, H3b-testerna). Ingen dubbeldebitering sker när H6 körs två gånger per månad.
- Slutmånaden efter manuell flytt debiteras till och med flyttdagen när leveransen är manuell eller legacy (H3b). Z05-slut debiteras till marknadsinstanten (H3).
- Tenant-isolering: alla funktioner kräver `service_role`, `company_id` och `customer_id`. Close nekar cross-tenant (regressionen :42).
- Brytavgift debiteras aldrig automatiskt, och manuell flytt skapar ingen brytavgiftsgranskning. Det stämmer med repots enda regel och med den juridiska texten "skäliga och tillåtna".
- Signerade avtalsvillkor är oföränderliga, så uppsägnings- och bindningstiden kan inte ändras i efterhand.
- `gridex_end_customer_supply_v1` avslutar avtalet bara när ingen annan mätpunkt fortfarande levereras, och den är idempotent via `end_key`.

## 7. Beslut som krävs av ägaren (eller jurist)
- **B1:** Vilken avtalsslutsregel gäller vid flytt?
  - För privatperson: slutar avtalet på flyttdagen oavsett uppsägningstid, eller gäller en uppsägningstid på högst 14 dagar räknat från anmälan, där faktureringen ändå bara gäller leveransdagarna?
  - För företag och förening: gäller avtalets hela uppsägningstid?
  - Vad gäller med notice 0 eller utan uppsägningstid?
  - Ägarens formulering "saknar uppsägningstid, eller har en uppsägningstid på högst 14 dagar (privatpersoner)" behöver översättas till en exakt regel. Regeln i EL 2012 K (rev) och Ellagen är inte verifierad i repot.
- **B2:** Brytavgift vid flytt inom bindningstiden. Ska konsumenter alltid undantas? Ska företag bedömas? Ska Z05 LK alls skapa en granskning (H6)?
- **B3:** Uppsägning utan flytt. Ska plattformen skicka Z08 H vid uppsägningstidens slut, eller ska den vänta på den nya leverantörens Z05? Hur ska ett avtal hanteras när uppsägningstiden har passerat och leveransen fortsätter?
- **B4:** Månadsavgiften i slutmånaden: hel eller proportionerad?
- **B5:** Följer avtalet med till en ny adress ("ta med avtalet")? Det avgör om kundkortets flytt får stänga hela kunden.
