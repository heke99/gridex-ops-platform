# Lokalt live-likt kedjetest — fyndregister (2026-10-15)

Branch `claude/gifted-hamilton-vss1hj`. Användarstyrt arbete; samordning och filclaims i [#766](https://github.com/heke99/gridex-ops-platform/issues/766).

## Vad testet prövar

Del B av kundprocessen, så som den ska fungera hos ett elbolag i drift:

1. Ett elbolag är konfigurerat för go-live: juridisk profil, avsändare, Ediel-identitet och roller, kvittensroute till nätägaren, publicerad kvartsprisprodukt (spot + 4 öre/kWh + 49 kr/mån) och faktureringsautomation.
2. En befintlig kund i leverans sedan 2026-08-01. Avtalet är signerat via plattformens egna signerings-RPC:er, som också låser prissnapshoten.
3. Nätägaren skickar en UTILTS E66 per dygn för september (96 kvartsvärden) som e-postbilaga över SMTPS.
4. Plattformens schemalagda inkorgs-cron hämtar via IMAPS, tar emot, kvitterar (CONTRL) och behandlar.
5. Administratören importerar och låser september-spotpriserna för SE3. Priserna är riktiga, från Elpriset just nu.
6. Månadsfaktureringens cron skapar underlag, låser prissättning och förbereder en testfaktura.
7. Fakturan jämförs med en oberoende beräkning från skickade värden och låsta priser.

**Miljö:** kastbar lokal Supabase (projektets rena replay `gridex-aud-003-clean-replay.sh`), riktig Next-app (`next build` + `next start`), riktiga cron-endpoints med `Bearer CRON_SECRET`, lokal GreenMail för IMAPS/SMTPS med lokal CA (TLS verifieras som i drift) och standardtidsgräns 8 s i databasen.

**Data:** bara syntetisk data (`E2E-`, `example.invalid`, påhittade GS1-ID:n). Inget skickas utanför maskinen.

**Kod:** `scripts/live-metering-billing-chain-native.test.ts`, `scripts/helpers/live-chain-fixture.ts`.

## Bekräftade fel

Statusvärden: **RÄTTAD** = rättad på branchen med regressionstest som är rött utan rättningen. **ÖPPEN** = bekräftad men inte rättad.

### F1 Kvadratiska EDIFACT-tolkare — RÄTTAD
- **Var:** `gridex_utilts_binding.wire_tokens_v1`, `gridex_received_sources.wire_tokens_bounded_v1` (och `closure_wire_tokens_v2`), `gridex_prodat_object_batch.raw_segments_v1`, `gridex_ediel_technical_ack.envelope`.
- **Bevis:** en månad med kvartsvärden (2 976 observationer) tog ~96 s per `wire_tokens_v1`-anrop (nu ~0,45 s). För `envelope` var siffrorna 8,4 s respektive 0,25 s. Resultatet är identiskt för 47 fixturer ur repot, specialfall och genererade storlekar. Ägare och ACL:er är oförändrade.
- **Påverkan:** månadsfiler med tim- eller kvartsvärden gick inte att lagra (tidsgräns 8 s).
- **Rättning:** migrationen `20261020120000_ediel_wire_tokenizer_linear_time.sql`. Test: `__tests__/ediel-wire-tokenizer-linear-time.test.ts`.
- **Verifiering:** full `npm test` gav 18 699 gröna och 0 nya fel. 92 av 99 SQL-regressioner har identiskt utfall före och efter. De 7 som misslyckas gör det också på main.
- **Kvar:** schema- och typ-capture görs av befintlig GEN-ägare.

### F2 IMAP-kommando inne i fetch-loopen ger låsning — RÄTTAD
- **Var:** `lib/inbound-mail/edielMailboxPoller.part-2.ts` och `manualMailboxPoller.ts` (`messageFlagsAdd` inne i `for await (client.fetch(...))`).
- **Bevis:** `imapflow` 2.2.1 dokumenterar *"You can not run any IMAP commands in this loop otherwise you will end up in a deadloop"*. I fristående prov låste mönstret sig 3 av 3 gånger, medan kommando efter loopen fungerade 3 av 3 gånger. I live-testet lagrades 1 av 30 mejl, och pollern fastnade sedan på samma mejl.
- **Rättning:** UID:erna samlas i loopen och markeras som lästa efter den. Test: `__tests__/imap-fetch-command-contract.test.ts`, med en falsk klient som följer `imapflow`s kontrakt.

### F3 Bilagan tolkas i två kopior — RÄTTAD
- **Var:** `processInboundEmailMessage` slog ihop `raw_edifact_payload` och samma bilagas `raw_text`.
- **Bevis:** med UNA ger det `edifact_dangling_release_character`. Utan UNA dubbleras segmenten (406 blir 812).
- **Påverkan:** alla Ediel-mejl med EDIFACT som bilaga.
- **Rättning:** identiska texter tas bara med en gång. Test: `__tests__/inbound-attachment-edifact-single-copy.test.ts`.

### F4 Inkorgs-cronen saknar aktör — RÄTTAD
- **Var:** `app/api/internal/inbound-mail/cron/route.ts`.
- **Bevis:** mottagningen kräver aktör (`ediel_real_reception_actor_and_parse_required`). I live-testet fallerade 25 av 25 jobb.
- **Rättning:** cronen använder `resolveConfiguredEdielAutomationActorId()` som utkorgens cron och svarar 503 om aktören saknas. Test: `__tests__/inbound-mail-cron-automation-actor.test.ts`.

### F5 Mejl från den delade brevlådan avvisas av tenant-vakten — RÄTTAD (ägarens beslut)
- **Var:** mejlet lagras med `company_id = NULL`, och `gridex_ediel_message_inbound_email_tenant_guard` (migration 20261002234100) kräver likhet.
- **Bevis:** A/B 2 av 2 gånger. Med NULL skapas 0 meddelanden, med tenantens `company_id` skapas 1.
- **Rättning:** vakten är oförändrad. Appen kopplar mejlet till den verifierade tenanten direkt efter tenantupplösningen, och bara om `company_id` är NULL. Ett mejl som redan tillhör en annan tenant ger `inbound_email_tenant_attribution_conflict`. Test: samma fil som F3, två fall.

### F6 Ett ej sparat Ediel-original blir manuell granskning i stället för omförsök — RÄTTAD
- **Bevis:** F5-felet loggades ("Kunde inte skapa/uppdatera inbound ediel_message"). `createInboundEdielMessage` returnerar `null` vid oväntat insert-fel. Den matchade vägen (`applySafeInboundStatusUpdate`) kastar då `ediel_inbound_original_persistence_required`, så jobbet går till `retry` (upp till 5 försök, sedan `failed`). Den omatchade vägen ignorerade `null`, skapade en granskning av typen "kräver manuell matchning" och avslutade jobbet som `manual_review`.
- **Rättelse av första bedömningen:** mejlet försvinner inte. Det syns i adminens inkorg som `manual_review`. Felet är att ett tillfälligt databasfel aldrig försöks igen och att operatören ser en vilseledande orsak.
- **Rättning:** den omatchade vägen följer samma kontrakt som den matchade. Test: `__tests__/inbound-attachment-edifact-single-copy.test.ts` (fall 4). 27 processorfiler med 422 tester är gröna.

### F7 IMAP-klienten saknar felhanterare — RÄTTAD
- **Bevis:** ingen `.on('error')` på `ImapFlow` i någon av pollerna. imapflow 2.2.1 `emitError` sänder anslutningsfel som `error`-händelse efter connect, och utan lyssnare kastar Node dem som uncaughtException. Lokalt sågs `uncaughtException: Error: Socket timeout`.
- **Rättning:** båda pollerna loggar händelsen. Det pågående kommandot avvisas som förut och befintlig catch registrerar felet på brevlådan. Test: `__tests__/imap-fetch-command-contract.test.ts` (fall 3). Den falska klienten sänder `error` från en timer, som den riktiga.

### F8 Test Center (Fakturatest)
- **F8a Uppslag med hela filen i URL:en — RÄTTAD.** `findExistingTestInboundEnvelope` skickade filen som `raw_edifact_payload=eq.<fil>`. Den lokala gatewayen svarar `414 URI too long` från 16 KB, medan 8 KB fungerar. Fakturatest accepterar bara hel månad, så fil med tim- eller kvartsvärden misslyckas alltid. Uppslaget går nu på `match_payload ⊇ {kund, sha256}`, som samma skrivare redan sparar. Test: `__tests__/test-center-raw-import-envelope-lookup.test.ts`, med riktig preflight av en genererad kvartsmånad (2 976 värden).
- **F8b `metering_points.metering_type` — schemadrift, lämnas till ägaren av #794.** Kolumnen finns i drift (`NOT NULL DEFAULT 'consumption'`) men inte i migrationerna, `schema.sql` eller staging. Den skrivs av `customerApplicationOnboarding.ts` och `invoiceTestEdifactMaterialization.ts`, och portalen läser den med reserv. I ren miljö och staging ger insert `PGRST204` (verifierat 2 av 2 gånger lokalt). PR #794:s plan för native-avstämning listar redan `metering_points_metering_type_check`.
- **F8c Övriga punkter — ej verifierade på nytt:** saknade `received_at`/brevlåda, överhoppad teknisk mottagning och korrigering med fält 505 sågs bara med lokala patchar. De kräver en riktig Fakturatest-körning innan de kan kallas fel.

### F9 Kundmatchningen jämför fri text med `customers.id` (uuid) — RÄTTAD
- **Var:** `lib/ediel/matching/customerMatcher.ts`, `lib/customers/matchingService.ts` (`findCustomersByIdentifierValues`).
- **Bevis:** alla 30 E66 i live-testet fick varningen "Backend automation pipeline trace kunde inte sparas" med `invalid input syntax for type uuid: "M2609…"` (22P02). BGM-dokumentnumret jämfördes med `customers.id` i ett ociterat PostgREST-`or()`. Reproducerat 2 av 2 gånger mot lokal PostgREST.
- **Påverkan:** automationsspåret (beslutsspår, affärsmatchning, körning) förloras för varje fil vars BGM-nummer inte är ett UUID, det vill säga för alla riktiga filer. Sändarens text kunde dessutom lägga till filtervillkor, dock inom tenanten.
- **Rotorsak:** samma fel som 04b14680 rättade för `processMatcher` och `permissionMatcher`. Kundmatchningen missades då.
- **Rättning:** befintliga `postgrestEqAny` används. Värden citeras och bara UUID-formade värden når uuid-kolumner. Ett tomt filter ger inga rader i stället för en ofiltrerad läsning. Test: `__tests__/ediel-customer-matcher-uuid-filter.test.ts` (3 fall, röda före rättningen). Verifierat mot riktig PostgREST: en kopplad kund hittas fortfarande via UUID.

### F10 CONTRL-skapandet blir långsammare för varje fil bolaget tagit emot — RÄTTAD (kritisk)
- **Var:** `gridex_ack_authority.read_outbound_originals_v1` → `gridex_ediel_technical_ack.retained_source_v1`.
- **Bevis:**
  - `auto_explain` visar att 1,27 av 1,4 s går åt till urvalet av bolagets utgående CONTRL. Filtret slutar med `OR gridex_ediel_technical_ack.retained_source_v1(m.*, false) = source.id`, som körs för varje CONTRL som inte är direkt kopplad.
  - `retained_source_v1` går igenom bolagets alla `ready`-källor (`FOR SHARE`) och tolkar varje käll-envelope. Det kostar cirka 6 ms per källa: 150 ms vid 25 källor, 175 ms vid 30. Mätt 3 gånger per bolag.
  - Kostnaden per anrop blir alltså ungefär antal CONTRL × antal källor. Med 8 CONTRL blir det ~1,3 s per läsning, vilket stämmer med uppmätta 1,4 s. Ett CONTRL-skapande gör läsningen 3–4 gånger, både direkt och via `require_business_binding_v1`.
  - Live-testet med parallellitet 1, alltså utan deadlocks: fil 1–10 fick CONTRL, och fil 11–25 fick alla `CONTRL skapades inte: canceling statement due to statement timeout (57014)`. Tiden per fil växte 4 → 4 → 5 → 6 → 7 → 8 → 9 → 11 → 12 s tills gränsen på 8 s nåddes.
  - Med parallellitet 4 blev det 8 CONTRL, och 16 tidsgränser plus en `ediel_existing_ack_original_read_unavailable`.
- **Påverkan:** kostnaden är kumulativ per bolag och miljö. Efter ungefär tio mottagna filer får ingen ny inkommande fil teknisk kvittens. Meddelandet blir kvar i `parsed`, utan affärsbehandling. Nätägaren får ingen CONTRL. Ett elbolag med normal volym (en E66 per mätpunkt och dygn) skulle slå i taket redan första dagen.
- **Ingen automatisk omkörning observerad:** i körningen med parallellitet 4 fick de 17 filerna som fastnat ingen CONTRL vid senare cron-körningar.
- **Rättning:** migrationen `20261020120100_ediel_technical_ack_original_lookup_by_uci.sql`.
  - Sammanslagning med main 2026-10-20: `retained_source_v1` fick samtidigt en egen förfiltrering på main (`20261019043000`, en annan agent). Min ändring av samma funktion togs bort, och mina migrationer flyttades efter main:s så att main:s hashlåsta migration kan köras.
  - `read_outbound_originals_v1` kör reserven bara när `may_reference_uci_v1` tillåter att `wire_v1` avkodar källans UCI-referens. Kontrollen följer `wire_tokens_v1`-reglerna och behåller full kontroll när ett release-tecken finns.
- **Verifiering:**
  - Resultaten från `retained_source_v1` (båda lägena) och `read_outbound_originals_v1` är byte-identiska för alla 26 CONTRL och 83 inkommande källor före och efter.
  - Läsningen tar ~40 ms i stället för ~1,4 s.
  - Live: alla 30 filer fick CONTRL, med 0 deadlocks.
  - Det genererade egenskapstestet `__tests__/ediel-technical-ack-original-lookup-scale.test.ts` blir rött mot en naiv delsträngskontroll.

### F11 Lås tas i fel ordning: radlås före tabellås — RÄTTAD (samma migration som F10)
- **Var:** `public.gridex_read_outbound_acks_for_source_v2` tar `SELECT … FOR SHARE` på källraden. Via `read_outbound_originals_v1`/`retained_source_v1` låses fler källrader. Därefter tar `read_business_original_v1` `LOCK TABLE public.ediel_messages IN SHARE MODE`.
- **Bevis:** Postgres deadlockrapporter, till exempel `Process 4535 waits for ShareLock on transaction 10778; blocked by process 4551. Process 4551 waits for ShareLock on relation 18763; blocked by process 4535.` Kedjan:
  - ACK-läsningen håller radlås och väntar på tabellåset.
  - En vanlig PATCH av ett annat meddelande har `ROW EXCLUSIVE` på tabellen och väntar på radlåset.
  - 22 respektive 24 deadlocks per körning med parallellitet 4. Med parallellitet 1 försvinner de, men F10 kvarstår.
- **Rättning:** `gridex_read_outbound_acks_for_source_v2` tar tabellåset först, i samma ordning som `read_business_original_v1`. Låset tas ändå senare i samma transaktion. Live med parallellitet 4: 0 deadlocks.

### F12 Inkorgs-cronen kan överskrida funktionens tidsgräns i Vercel — AVHJÄLPT av F10
- **Bevis:**
  - Lokalt utan tidsgräns tog den första cron-körningen 3 min 16 s för 25 mejl (parallellitet 4).
  - Med parallellitet 1 svarade cronen inte inom 300 s (klienten fick `HeadersTimeoutError`). Behandlingen pågick 21:57:00–22:03:32, alltså cirka 6,5 min.
  - Routen exporterar ingen `maxDuration`, och `vercel.json` saknar `functions`. Plattformens standardgräns gäller därför. Projektet skapades 2026-05, och enligt Vercels dokumentation är Fluid compute standard för nya projekt sedan 2025-04-23. Den exakta gränsen i projektets inställningar är inte avläst.
- **Påverkan:** om funktionen avbryts mitt i behandlingen blir mejl kvar halvbehandlade.
- **Efter F10:** 25 mejl tar 70 s och 5 mejl 16 s, mot tidigare 177–404 s. Pollern tar högst 25 mejl per brevlåda och körning, så en full omgång ryms med god marginal. Kodens egna kommentarer räknar med "300s platform limit". `maxDuration` sätts inte här: planens tak är okänt, och ett värde över taket stoppar driftsättningen.

### F13 Kapabiliteten `ediel_test` kan inte bli redo för en ny tenant — ÖPPEN, kräver produktbeslut
- **Bevis:**
  - Utkorgen skickar testmiljöns Ediel bara när `company_capabilities.ediel_test` har `enabled=true` och `readiness_status='ready'` (`ediel.test.process`). Annars blir posten `blocked_tenant_state/capability_not_ready`, och live-testet fick 30 av 30 blockerade.
  - Den enda skrivaren av `ediel_test='ready'` är en engångsmigration från 2026-08-02. För `ediel_production` finns go-live-övergången `canonical_transition_ediel_production`, men för `ediel_test` finns ingen app- eller RPC-väg.
  - Projektets egna native-fixturer sätter värdet med direkt SQL.
  - Drift (bara läsfrågor, aggregat): 3 tenanter har `ediel_test=blocked` sedan 2026-08-02, och ingen har `ready`.
- **Påverkan:** en ny tenant kan inte skicka CONTRL eller APERAK i testmiljön, och därmed inte göra aktörstester innan någon ändrar databasen direkt.
- **Varför inte rättat:** hur kapabiliteten ska godkännas (vem, vilket underlag) är ett produktbeslut. Live-fixturen sätter den som projektets native-fixturer gör, tydligt märkt.

### F16 `gridex_get_user_roles` saknas i det kanoniska schemat men anropas av koden — ÖPPEN, lämnas till ägaren av #794
- **Bevis:**
  - Drift har funktionen, med kropp identisk med `20260526_debug_step1_2c_full_schema_code_alignment.sql` (md5 `5ff87b0f…`) och `SECURITY INVOKER`.
  - Staging, `schema.sql` och den rena replayn saknar den, eftersom replayn utesluter 202605xx-debugmigrationerna.
  - Anropare: `lib/tenant/scope.ts:79`, där fel ger `false`, samt `app/dashboard/page.tsx:55`, `lib/auth/postLoginDestination.ts:32` och `lib/rbac/getUserPermissions.ts:61`.
- **Påverkan, reproducerat med Playwright:** i miljöer byggda från migrationerna, även staging, får en plattformsadmin utan bolagsmedlemskap `TenantCompanyRequiredError`, och `/dashboard` visar "Sidan kunde inte laddas". I drift har 1 av 2 plattformsadmins inget medlemskap.
- **Live-testet:** fixturen skapar funktionen exakt som i drift om den saknas (`ensureProductionRoleLookupParity`). Rapporterat på #766.
- **Latent inkonsekvens i samma område:** `canonical_actor_is_platform_admin` godtar `admin_users`, men `requireAdminAccess` räknar `isAdmin` från roller och behörigheter. En plattformsadmin som bara finns i `admin_users` får `is_platform_admin: true` men ändå inte `/admin`. Drift har 0 sådana konton, så det är inte aktuellt i dag.

### F17 Leveransperiod utan kvalificerat Ediel-underlag avbröt inläsningen efter första värdet — RÄTTAD
- **Bevis från live-körningen:**
  - Efter operatörens omkörning fanns alla 2 880 kvartsvärden i `meter_reading_values`, men bara 30 i `normalized_metering_values`, ett per fil med fakturaunderlagets första kvart.
  - Serverloggen visade 30 gånger `23514 billing_gate_qualified_supply_source_required` från `gridex_set_metering_billing_gate`.
- **Rotorsak:** TS-grinden (`evaluateBillingGate`) kontrollerar leveransperiodens status och täckning, men inte dess Ediel-marknadsunderlag (`gridex_received_sources.billing_supply_basis_v1`: bekräftat byte eller mottagen Z04 med reglerad grund). Den sa `eligible`. Databasen nekade, och `ingestBoundUtiltsMetering` avbröts efter första observationen. Ingen orsak syntes för operatören, och en omkörning fastnade på samma ställe.
- **Rättning:** databasen förblir auktoritet. Vid exakt den vägran registreras värdet som `blocked`, med orsaken `supply_source_unqualified` och ett `billing_gate_blocked`-ärende per leveransperiod och mätpunkt. Andra vägranden kastas som förut. Test: `__tests__/billing-gate-unqualified-supply-source.test.ts`. 7 filer med 153 tester runt grinden är gröna.
- **Live efter rättningen:** varje fil som operatören körde om fick exakt 96 värden, alla `blocked` med rätt orsak. Det blev 24 filer med 2 304 värden och summor som stämmer med de skickade per dygn. De övriga 6 filernas sidor laddades inte medan 25 serveråtgärder pågick samtidigt, eftersom testet då klickade utan att vänta. B5 kör nu en fil i taget, som en operatör. Den sista körningen avbröts av att containern startades om.
- **Följdfynd, rättat i samma område:** ärendena skapades per kvartsvärde, vilket gav 2 304 identiska ärenden för en kund och månad. Nu öppnas ett ärende per leveransperiod.
- **Prestanda (observation):** under parallell last lagrades cirka 4 värden per sekund, med flera RPC-anrop per värde. Ett dygn (96 värden) tar sekunder till tiotals sekunder. En månadsfil med kvartsvärden (2 976 värden) per serveråtgärd bör mätas mot Vercels tidsgräns innan den används i drift.
- **Förståelse av projektet:** fakturering kräver att leveransen vilar på mottagna Ediel-marknadsmeddelanden. En kund som bara lagts in som migrerad (`source='migration'`) kan aldrig faktureras. Kedjan mätvärde→faktura förutsätter därför kedja A (ansökan → avtal → leverantörsbyte bekräftat av nätägaren), eller ett mottaget leveransstartsunderlag.

### F10b ACK-läsningen var fortfarande linjär i bolagets ACK-historik — RÄTTAD
- **Varför fel:** efter F10 läste `read_outbound_originals_v1` fortfarande varje utgående ACK hos bolaget för att utvärdera sitt femdelade OR-villkor. Det kostade ~23 µs per CONTRL: 40 ms vid 130 och 240 ms vid 10 030. Med 3–4 läsningar per ACK nås gränsen på 8 s vid ungefär 100k ACK per bolag. F10 gjorde alltså kostnaden linjär, inte begränsad.
- **Rättning:** `20261020120200_ediel_ack_original_candidates_indexed.sql`. Kandidaterna kommer från fem indexerade grenar, och det ursprungliga villkoret ligger kvar som filter.
- **Verifiering:** alla 639 ögonblicksresultat är identiska. Läsningen tar 80 ms vid 10 030 CONTRL. `scripts/ediel-ack-original-scale-native.test.ts` räknar de rader läsningen rör: under 50, mot 502 före.

### F18 En tenant eller en kvarlämnad körning stoppade månadsfaktureringen för alla — RÄTTAD
- **Varför fel:** `runMonthlyBillingAutomation` körde bolagen i en loop utan felisolering. Ett bolag utan konfigurerad leverantör kastade fel, och cronen svarade 500 utan att övriga bolag kördes. En körning som avbrutits (tidsgräns, omstart) lämnade dessutom en `running`-rad som blockerade nästa körning.
- **Rättning (`lib/billing/monthlyAutomation.ts`):** fel fångas per bolag och redovisas som misslyckat resultat. `closeOrphanedRuns` stänger `running`-rader med annan `lock_token` som `failed/stale_run_recovered` inne i låset. Test: `__tests__/billing-monthly-company-isolation.test.ts`.
- **Live:** HTTP 200. Ett bolag fick fel med leverantörens felmeddelande, nästa blev `completed_with_blockers` och den kvarlämnade raden blev `failed/stale_run_recovered`.

### F19 CONTRL-kontrollen läste alla inkommande meddelanden på hela plattformen — RÄTTAD (kritisk)
- **Var:** `gridex_ediel_technical_ack.require_contrl_v1` bevisar att CONTRL:ens UCI-referens (first14) pekar ut exakt ett inkommande original, globalt. Kandidatfiltret körde `strpos(translate(raw_payload))` över `raw_payload` för **varje inkommande meddelande hos alla tenanter**. Det sker vid varje CONTRL-skrivning (trigger) och 4 gånger per `gridex_read_outbound_acks_for_source_v2`.
- **Varför fel och segt:** kostnaden växer med plattformens totala inkommande historik, inte med det enskilda bolaget. Uppmätt med syntetisk historik (meddelanden på 6,8 kB): ACK-läsningen tog 0,7 s vid 348, 1,25 s vid 1 348 och 2,5 s vid 3 348 inkommande meddelanden. Gränsen på 8 s nås vid ~12k inkommande meddelanden totalt. Ett enda elbolag får fler än så på några dagar (E66 per mätpunkt och dygn), och därefter får **ingen** tenant CONTRL.
- **Rättning:** `20261020120300_ediel_technical_ack_original_uniqueness_indexed.sql`. Kandidaterna kommer från ett uttrycksindex på `envelope(raw_payload)->>'uciReference'` för inkommande rader. Ytterfiltret kräver redan exakt den projektionen och den implicerar det gamla filtret, så de räknade raderna är oförändrade. `envelope` är IMMUTABLE, har ingen `RAISE` och gav inget fel på 20 000 slumpade indata, så indexet kan inte stoppa inserts.
- **Kostnad:** indexet räknar `envelope` en gång per inkommande insert, ~6 ms vid 6,8 kB och ~45 ms vid 59 kB. Det ersätter 0,15 ms × alla inkommande meddelanden × 4 per ACK-läsning. Drift har i dag 1 inkommande meddelande, så indexbygget är trivialt.
- **Verifiering:**
  - Resultat eller fel från `require_contrl_v1` är identiskt för alla 291 lokala CONTRL.
  - ACK-läsningen tar 0,36–0,45 s oavsett historik, både vid 348 och 3 348 inkommande meddelanden.
  - `__tests__/ediel-technical-ack-original-uniqueness-indexed.test.ts` kör tvetydighetsmatrisen (release-tecken, LF/CRLF, egen UNA, främmande tenant, korta, 14 tecken långa och icke-alfanumeriska referenser) mot både föregångaren och den nya kroppen. Det testet och `ediel-technical-ack-long-reference-prefix` ger tillsammans 110 av 110 gröna, med och utan simulerad GEN-capture.

### F20 Utkorgsposter som blockerats under en produktionspaus köades aldrig om — RÄTTAD
- **Varför fel:** en paus (`state <> 'live'`) skriver ett sändlås med `locked_reason` = pausorsaken. `sendOutboxItem` sparade den texten som `last_error`. Triggern som körs när låset släpps (`20260903161000`) köar bara om `last_error = 'active_ediel_send_lock'`. Varje meddelande som utkorgen mötte under pausen blev alltså kvar som `blocked` för alltid efter att bolaget gått live igen.
- **Rättning:** `lib/ediel/outbox/sendOutboxItem.ts` sparar sentinelvärdet i `last_error` och orsaken i `blocked_reason`/`blocked_at`. Triggern är oförändrad.
- **Test:** `__tests__/ediel-outbox-send-lock-release-requeue.test.ts` kör den riktiga sändvägen och därefter den riktiga triggern i PGlite. Testet är rött utan rättningen.

### F21 Jobb som blev klara i en senare körning affärsbehandlades aldrig — RÄTTAD
- **Varför fel:** motorn körde `processInboundEdielMessage` bara för mejl från den aktuella pollningen. Ett jobb som slutfördes i en senare körning, till exempel efter omförsök, fick sina Ediel-meddelanden tolkade men aldrig affärsbehandlade.
- **Rättning:** `processQueuedInboundProcessingJobs` returnerar `processedInboundEmailMessageIds`, och motorn slår ihop dem. Test: `__tests__/inbound-engine-later-job-processing.test.ts`.

### F22 Försöksgränsen för inkorgsjobb var ett steg fel och ett hängande jobb kunde återtas i det oändliga — RÄTTAD
- **Varför fel:** jämförelsen tillät ett försök för mycket, och ett jobb som återtogs som "stale" räknades aldrig mot gränsen. Ett jobb som alltid tar för lång tid kunde därför återtas varje körning för alltid.
- **Rättning:** ett jobb med `attempts_count > maxAttempts` avslutas som `failed`, med steget `attempt_limit_exceeded`. Test: `__tests__/inbound-job-attempt-limit.test.ts`.
- **Rättelse av beskrivningen (2026-10-22, efter jämförelse med Codex PR #853):** "ett försök för mycket" ovan är fel formulerat. Commit `f12a03f4` visar att försöken räknades två gånger, så bara 4 av 5 tillåtna försök kördes. Rättningen och testet är oförändrade. Den ursprungliga meningen står kvar som historik.

### F23 Mejl som sparats utan jobb behandlades aldrig — RÄTTAD
- **Varför fel:** `storeInboundEmail` skriver mejlraden och jobbet i två separata skrivningar. Om körningen dödades mellan dem (tidsgräns, driftsättning) dedupliceras mejlet vid varje senare pollning utan att något jobb finns.
- **Rättning:** när samma mejl hämtas igen (dedupliceras inom samma brevlåda) skapas det saknade jobbet, men **bara** om mejlet fortfarande är i sitt ursprungliga lagringsläge (`processing_status='received'` och `match_status='not_checked'`). Annars skulle ett redan behandlat oläst mejl, som hämtas vid varje pollning med `markSeen: false`, köas om. Det hittades när OPS-05-testet blev rött mot den första versionen.
- **Test:** `__tests__/inbound-mail-missing-job-recovery.test.ts` (4 fall). 31 inkorgsfiler med 380 tester och OPS-05 är gröna.

## Verklighetssimulering, scenario A (2026-10-20): webbkund → leverantörsbyte

Sviten finns i `scripts/reality/` (plan: `docs/testing/verklighetssimulering-plan.md`).
- **Riktig data där den finns:**
  - Svenska kraftnäts 280 nätområden via plattformens egen importcron
  - riktiga spotpriser via leverantörssimulatorn
  - postnummerkoordinater som ligger i SVK:s riktiga polygon
- **Motparter som egna processer:** nätägaren pratar bara SMTPS/IMAPS, och webbplatsen anropar bara det publika API:t.

### F24 Kanonisk replay saknar `webhook_subscriptions.api_client_id` — ÖPPEN, replay/GEN-ägaren
- **Varför fel:** `provisionTenantWebsiteIntegration` läser kolumnen. Drift har den (uuid, FK till `integration_api_clients`, tre index). Replayen och `schema.sql` saknar den, vilket `20260821103000` själv noterar som "absent".
- **Följd i en miljö byggd från migrationerna:** go-live av webbplatsen faller. Anropet är en HEAD-förfrågan som får 400 utan kropp, så admin ser bara ett tomt felmeddelande.
- **Simuleringen:** fixturen speglar driftens definition exakt (`ensureProductionWebhookClientParity`).

### F25 Beredskapskontrollen letar nätägarkontakter med en kanaltyp som tabellen inte tillåter — RÄTTAD (c48d806b)
- **Varför fel:** `lib/website/customerApplicationAutomationReadiness.ts:61` filtrerar `channel_type='email'`, men `grid_owner_contact_channels_channel_type_check` tillåter bara `facility_information_request`, `supplier_switch_manual`, `power_of_attorney`, `ai_list` och `escalation`. Det gäller både i drift och lokalt.
- **Följd:** varningen "Ingen aktiv nätägarkontakt via e-post hittades" kan aldrig försvinna. Live sågs den med en verifierad kontakt på plats. Den riktiga vägen (`customerSiteProcessContext.ts:577`) använder `facility_information_request` och verifierad.
- **Rättning:** samma filter som den riktiga vägen.

### F26 Webbplats som skickar `grid_area_code` får alltid 409 — TEXTEN RÄTTAD, gränsen kvar enligt ROOT
- **Varför:** med en uttrycklig kod går `resolveEnergyContext` bara till cachen för exakta adresser. Webbvägen stänger av den (`exact_address_provider_allowed:false`), så postnummergeokodningen nås aldrig, och resultatet blir `needs_review`.
- **Följd:** svaret säger "Komplettera full adress" fast full adress skickades. Utan koden löses samma adress automatiskt.
- **Beslut som behövs:** antingen korsvalideras koden mot postnummerresultatet, eller så dokumenteras att webbplatser inte ska skicka den.
- **Rättat:** `gridAreaClaimNextAction` i `lib/energy/resolver.ts` anger nu det faktiska skälet. Det kan vara att full adress togs emot men kanalen inte använder exakt adressverifiering, en miss i adresscachen eller en polygonmiss. Status, `conflictCode`, varningar och spärren för automatik är oförändrade. Test: `__tests__/energy-grid-area-claim-next-action.test.ts`.
- **ROOT (#840/6291333488):** bindningsgränsen ska stå kvar. En kod räknas bara med exakt adress och polygon som bevis. Det som ska rättas är texten: svaret ska ange det faktiska cache-, polygon- eller masterdatafelet i stället för att be om en adress som redan skickats.

### F27 Go-live-grinden säger "redo" fast ingen spotofferert kan skapas — ÖPPEN
- **Varför:** standardpolicyn `company_market_price_sources.allow_indicative_latest=false` stoppar offerter för en startmånad utan publicerade priser, med `422 market_price_unavailable`. Med 14 dagars varsel gäller det varje vanligt byte från mitten av månaden.
- **Drift:** alla 3 bolag har standardvärdet (läsfråga, aggregat).
- **Förslag:** grinden bör provköra en offert. Kontrollen bör också fånga ett bolag utan `slug`, eftersom då saknar alla juridiska dokument URL och juridiska paketet blir ofullständigt.
- **Simuleringen:** admin-valet i `/admin/pricing/market-sources` görs som en del av go-live.
- **Slug-delen RÄTTAD:** `tenantWebsiteReadiness` ger nu blockeringen `legal_public_slug_missing` (komponent `legal`) när `slug ?? company_slug` är tomt, med samma upplösning som det juridiska paketet. Kontrollen ingår också i `website_checkout_ready`. Test: `__tests__/tenant-website-readiness-legal-slug.test.ts`.
- **ROOT (#840/6291333488):** slug-luckan är bekräftad och ska fångas av grinden. Prispolicyn står kvar: en komplett och färsk förhandsvisning fungerar med `false`. Påståendet "varje månad utan publicerade priser" ska först bindas till exakt prisfönster, elområde och upplösning innan det räknas som fel.

### F28 Nummerserierna för ansökan, kund och avtal saknas i den kanoniska replayen — ÖPPEN, replay/GEN-ägaren (allvarlig för nya miljöer)
- **Varför fel:** `canonical_next_application_number`, `canonical_next_customer_number` och `canonical_next_contract_number` finns i drift (SECURITY DEFINER, bara `service_role`). De finns inte i replayen och förekommer 0 gånger i `schema.sql`. `20260801143000` används bara som källa för ett härlett utdrag.
- **Följd:** en miljö byggd från migrationerna tar inte emot en enda webbansökan. Det gäller ny staging, återställning efter katastrof och native-CI. Felet blir `500 internal_error` i steget `application_record_create`, utan rad i serverloggen. Det syns bara som `404` på `rpc/canonical_next_application_number` i Kong.
- **Två fel:** dels driften mellan drift och replay, dels att felet inte loggas.
- **Simuleringen:** speglar driftens exakta definitioner och behörigheter (`ensureProductionNumberSeriesParity`).

### F29 Aktörsregistret i admin kraschar efter import: 300 parallella databasanrop per sidvisning — RÄTTAD (anropsstormen)
- **Var:** `app/admin/ediel/actors/page.tsx:172`, `Promise.all(actorRoutes.map(route => readRegistryRouteSource(route.id)))`. `actorRoutes` är upp till 300 routes, alltså 300 samtidiga `rpc/ediel_registry_route_source_v1`.
- **Följd i simuleringen:** efter importen av hela Ediel-registret (704 bolag, 1 068 routes) visar sidan alltid "Adminvyn kunde inte laddas" (React #441). Operatören kommer då aldrig fram till "Verifiera för kundflöde", så nätägaren kan inte kopplas till kundflödet.
- **Bevis:**
  - Kong loggar "512 worker_connections are not enough".
  - Appens fetch får `UND_ERR_SOCKET`.
  - En sidvisning gav 250 RPC-rader i Kong.
- **Kostnad per anrop, mätt lokalt:** cirka 27 ms databastid, så 300 routes ger cirka 8 s.
  - Cirka 16 ms går åt till att serialisera och hasha om hela det normaliserade registret (`n.records::text`, 283 kB).
  - Cirka 1 ms går åt till att hasha om källfilen (788 kB).
  - Cirka 2 ms går åt till att söka igenom 704 poster.
  - Allt detta görs om för varje route, fast alla routes kommer från samma batch.
- **Drift:** 1 160 routes och 649 aktörer (läsfråga, aggregat).
- **Rättning:** `readRegistryRouteSources` i `lib/actor-registry/registryMarketSource.ts` gör samma läsning och validering per route, men med högst 6 anrop samtidigt och i samma ordning som indata. Sidan använder den.
- **Test:** `__tests__/ediel-registry-route-sources-bounded.test.ts` (300 routes ger högst 6 samtidiga anrop och behållen ordning; validering, databasfel och ogiltigt ID).

### F30 Varje route-läsning låser cirka 29 tabeller och hashar om hela registret — ÖPPEN, registerägaren
- **Var:** `gridex_registry_import.route_source_v1` anropar `gridex_ediel_ack_replay.lock_current_graph_v2()`. Den tar `SHARE`-lås på bland annat `auth.users`, `companies`, `meter_reading_series`, `metering_permissions` och `ediel_ack_transaction_results`. Därefter låser den 6 registertabeller till i `SHARE`.
- **Varför segt:** `SHARE` krockar med `ROW EXCLUSIVE`. Medan en route läses väntar alltså varje insert eller update på mätvärden, inloggningar (`auth.users`) och ACK-resultat, och tvärtom. En visning av adminsidan är 300 sådana läsningar, cirka 8 s databastid. Det är samma mönster som L1, men här i en ren läsväg.
- **Förslag, inte gjort (registerägarens SQL och GEN):** en batchvariant, till exempel `ediel_registry_route_sources_v1(uuid[])`, som tar låsen en gång och verifierar varje källbatch hash en gång. Alla kontroller per route ska vara identiska, och ett ekvivalenstest ska visa att batchresultatet är lika med enkelläsningen för varje route, även för hållna fall. Det sänker 300 × 27 ms till cirka 27 ms + 300 × cirka 1 ms.

### F31 Aktörsregistret visar och söker bara i ett urval — ÖPPEN (liten)
- **Var:** sidan läser de 500 senast uppdaterade aktörerna och 300 routes utan ordning. Sökningen filtrerar i appen efter den gränsen.
- **Följd:**
  - I drift (649 aktörer, 1 160 routes) går 149 aktörer inte att hitta eller verifiera i vyn.
  - Routes saknas slumpmässigt per aktör, så kortet kan säga "Route saknas" fast route finns.
  - Räknaren "verifierade routes" blir för låg.
- **Sökningen matchar inte Ediel-ID:** den matchar namn, org.nr, källa och antal routes. En operatör som söker "16700" får inga träffar. Simuleringen söker därför på namn.
- **Förslag:** filtrera i databasen (namn, org.nr, Ediel-ID via `platform_actor_identifiers`) innan gränsen, och läs routes för de aktörer som visas.

### F32 Att göra en nätägare redo för kundflödet kräver fem operatörssteg på tre sidor, utan vägledning — ÖPPEN (UX)
Simuleringen gör samma steg som i drift.
1. `/admin/ediel/actors`: importera registret.
2. `/admin/ediel/actors`: "Verifiera för kundflöde". Sätter `grid_owners.verified_for_customer_flow`, men kopplar inte SVK-nätområdets ägare (`platform_grid_owners.ops_grid_owner_id`).
3. `/admin/network-owners?edit=<id>`: "Sök certifikat nu för vald nätägare". Hämtar mottagarcertifikatet från Expisofts LDAP-katalog.
4. `/admin/ediel/auto-readiness`: "Fler kontroller" → "Bekräfta säkra routes". Behövs för en tom PRODAT/UTILTS-subadress, som för Alingsås 16700 i det riktiga registret.
5. `/admin/network-owners`: "Kontrollera nätägare". Kopplar nätområdet och räknar om status.

- **Följd:** efter steg 2 visar aktören "verifierad". Men "Kontrollera nätägare" sätter tillbaka `verified_for_customer_flow=false` (`needs_subaddress`, `missing_or_invalid_certificate`) tills steg 3 och 4 är gjorda.
- **Utan steg 5:** kundansökningar i området stannar på "Nätägare saknas" och "Nätområde saknas", och bytesjobbet går till `needs_review`.
- **Förslag:** "Verifiera för kundflöde" bör köra kopplingen och visa vilka av certifikat och subadress som återstår.
- **Separat (miljö):** utan `EDIEL_EXPISOFT_LDAP_HOST` slår varje miljö upp certifikat i Expisofts riktiga katalog (`sodir01.expisoft.se:389`), även lokala miljöer och testmiljöer med syntetiska adresser. Simuleringen pekar därför om till en lokal LDAP-katalog (`scripts/reality/simulators/certificateDirectory.ts`).

### F33 Route-beredskapens kort visar inte vilket bolag de gäller — ÖPPEN (UX, liten)
- **Var:** `/admin/ediel/route-readiness`. Korten listar nätägare, familj, kod och miljö för alla tenants, men inte bolagsnamnet. Bolag-ID finns bara i dolda formulärfält.
- **Följd:** med flera elbolag mot samma nätägare kan operatören inte se vilket bolags route hen materialiserar.

### F34 Route-beredskapssidan kraschar med hela Ediel-registret: URL för lång — RÄTTAD
- **Var:** `app/admin/ediel/route-readiness/page.tsx`, `loadContacts`. Alla aktörs-ID på sidan skickades i en enda `.in('actor_id', ids)`.
- **Mätt:**
  - Drift har 434 olika aktörer bland sidans 500 rader (läsfråga, aggregat). Det ger en URL på cirka 17 kB.
  - Lokalt svarar gatewayen `414 URI too long` från cirka 220 ID, alltså cirka 8 kB.
- **Följd:**
  - Next loggar `Error: {"message":"URI too long"}` och sidan visar "Adminvyn kunde inte laddas".
  - Utan sidan kan ingen materialisera bolagets operativa route ("Materialisera production-route"). Alla Z01 stannar då på `platform_route_exists_but_not_materialized`.
- **Rättning:** kontakterna läses i bitar om 100 ID (cirka 4 kB), med samma kolumner och samma hantering av saknat schema.
- **Test:** `__tests__/route-readiness-contacts-chunked.test.ts` (434 aktörer ger 5 bitar, varje aktör en gång; fallerar utan rättningen).

### F35 UTILTS-routen kan aldrig materialiseras från route-beredskapen — ÖPPEN
- **Var:** raden UTILTS (utan meddelandekod) i `gridex_company_route_readiness_v` erbjuder knappen "Materialisera production-route".
- **Utfall:** åtgärden fallerar alltid med `ediel_route_profile_insert_failed` (`utilts_application_reference_message_unsupported:missing`). Det gäller Alingsås 16700 i det riktiga registret, utan subadress och applikationsreferens.
- **Följd:** knappen som sidan erbjuder kan aldrig lyckas, och raden ligger kvar som blockerad. Antingen ska vyn ange en meddelandekod (till exempel E66), eller så ska knappen inte visas.

### P2 "Materialisering tar cirka 70 s" — MÄTARTEFAKT, inte ett fel
Alla skrivningar för materialiseringen (`communication_routes`, `ediel_route_profiles` och `company_market_party_routes`) sker inom samma sekund. Vyerna bakom sidan tar 15–25 ms. Tiden kom från simuleringens hjälpkod, som väntade 30 s per frånvarande dolt fält. Det är rättat i `operatorConsole.ts`.

### F36 Ett nytt bolag kan inte bli live i produktion via något stödd väg — AVSIKTLIG SPÄRR plus ett cirkelberoende, ägarbeslut
Granskat oberoende och verifierat på de angivna raderna.

**1. Inget produktionsmeddelande före live**
- En ny avsändarinställning är låst (`production_send_lock_enabled`, `first_production_send_approved=false`; `lib/ediel/senderSettingsResolver.ts:332`).
- Ruttbeslutet lägger då till `production_send_locked` (`lib/routes/routeDecisionEngine.ts:772`). Z01 och Z03 avbryts innan något meddelande sparas (`z01: null` i jobbresultatet).
- Låset hävs bara av `approveFirstProductionSend`, som kräver `ediel_production_state.state='live'` (`lib/ediel/productionSendApproval.ts:45`).
- Live kräver i sin tur en dry run på ett sparat utgående produktionsmeddelande (`app/admin/platform/go-live/approval-actions.ts`).

**2. Inget bevis kan skapas**
- Dry run kräver dessutom scoped kapabilitetsbevis (`lib/ediel/productionReadiness.part-3.ts:24`).
- Den enda skrivaren är `ediel_record_scoped_capability_evidence_v1`. Den kräver godkända TGT-, AGT-, SHADOW_PRODUCTION-, LIVE_TENANT_INTEGRITY- och RESTORE_REPLAY-certifieringar bundna till exakt det meddelandet.
- Dess wrapper (`lib/ediel/scopedCapabilityReadiness.ts:93`) anropas bara från tester.
- Migrationen säger det uttryckligen: "OPS-01 / CALL-16 prospective support. No production capability is enabled and no passed evidence is seeded."

**Bedömning**
- Lager 2 är en avsiktlig extern certifieringsgrind och inget fel.
- Lager 1 är ett cirkelberoende som finns kvar även när beviset finns: beviset binds till ett meddelande som inte kan skapas före live.
- Go-live-sidan erbjuder ändå "Kontrollera & godkänn production" utan att säga att det inte kan lyckas.
- Dessutom läser `approveCompanyProductionAction` `ediel_production_state` med `.single()`, så den fallerar redan när raden saknas, som för ett helt nytt bolag.

**Drift (läsfråga):** inget av de 3 bolagen är `live` (2 `disabled`, 1 `blocked`), och inget har ett utgående produktionsmeddelande.

**Beslut som behövs (ägare):**
- en stödd väg att förbereda och spara, men inte skicka, det första produktionsmeddelandet under låset, eller en dry run för första aktivering som inte kräver ett sparat meddelande
- ett operatörsflöde som registrerar certifieringsbeviset

**Simuleringen:** kör marknadsflödet i Ediels testmiljö, vilket är så ett bolag arbetar före certifiering. Miljöväljaren (`lib/ediel/customerInfoEnvironmentResolver.ts`) väljer `test` när bolaget bara har en test-avsändare.

### F37 Produktionssändning kräver en tillitsversion (CA, CRL, mottagarens fingeravtryck) som bara en extern databasroll kan publicera — AVSIKTLIG SPÄRR, ägarbeslut
- **Grinden:** utgående S/MIME i produktion stoppas med `receiver_certificate_trust_and_revocation_evidence_missing` utan en giltig version i `gridex_certificate_trust.authority_versions` för bolag, miljö och mottagare (`lib/ediel/security/outboundRecipientCertificate.ts:466`).
- **Vem kan publicera:** bara rollen `gridex_ediel_certificate_authority_owner` (migration `20260930163734`: "Prospective external trust ownership only. No CA/CRL … is seeded"). Ingen väg i appen och inget gränssnitt finns.
- **Drift (läsfråga):** 0 tillitsversioner och 0 scoped kapabilitetsbevis. Inget utgående Ediel-meddelande i produktion kan alltså skickas i dag.
- **Relaterat:** åtgärderna för route-profilens produktionsgodkännande (`checkRouteProfileProductionReadinessAction`, `applyRouteProfileReadinessFixesAction`, `approveRouteProfileProductionAction`) finns, men ingen sida renderar dem.
- **Simuleringen:** certifikatkatalog-simulatorn publicerar test-CA, CRL och fingeravtryck. Publiceringen görs genom ägarrollen, som en databasadministratör antar, och verifieras sedan med plattformens riktiga PKIX/CRL-kontroll (`openssl verify -crl_check_all`).

### F38 Route-profilens produktionsgodkännande kunde aldrig lyckas för en ny profil — RÄTTAD
- **Var:** `evaluateRouteProfileProductionReadiness` lade till `production_route_profile_not_ready` när `is_production_ready=false` eller `production_mode='disabled'`. Det är kolumnernas standardvärden, och `routeMaterializer` lämnar varje ny profil så.
- **Varför fel:** godkännandet (`approveRouteProfileForProduction`) sätter `true`/`live` bara utan spärrar, så det spärrades av just det tillstånd det ska ändra.
- **I simuleringen:** med avsändargodkännande, mottagarcertifikat, tillitsversion och route på plats var detta den enda kvarvarande spärren.
- **Testtäckning före rättningen:** de godkända TR-06/IMP-05-testerna startar alla från en redan `live` profil.
- **Rättning:** profilens eget ej godkända tillstånd räknas inte som spärr vid själva godkännandet. Alla verkliga villkor spärrar fortfarande: lås, certifikat, tillit, säkerhetspolicy, route, transport, ID och adresser. Statusutvärderingen rapporterar som tidigare.
- **Test:** `__tests__/route-profile-production-approval-from-default.test.ts`. Det fallerar på 4 av 6 utan rättningen, och de 202 testerna märkta TR-06/IMP-05 är gröna.
- **Närliggande:** profilen tar en ögonblicksbild av avsändarens sändlås när den materialiseras (`metadata.production_send_lock_status`). Ett senare godkännande av första sändningen ändrar inte profilen, och route-beredskapen erbjuder inte ommaterialisering när routen redan är operativ. Simuleringen materialiserar därför efter go-live. Det noteras här men är inte ändrat.

### F39 Alla webbansökningars fortsättning fallerade med "grid_owner_data_request hittades inte." — RÄTTAD
- **Reproducerat:** så snart bolagets Z01-route var redo fallerade samtliga 4 jobb av typen `customer_application_continuation` efter 5 försök med `technical_error`. Processen stannade innan någon Z01 skapades.
- **Orsak:** `customerProcessNextStepEngine.tryPrepareZ01` tog bolagets senaste kunduppgiftsbegäran och gick vidare så fort den hade ett id, även utan kopplad nätägarbegäran. Den anropade sedan alltid `finalizeStuckZ01GridOwnerDataRequest`, som bara reparerar en befintlig, fastnad nätägarbegäran och kastar annars (`z01Finalizer.ts:756`).
- **Varför det inte syntes:** felet nås först när routen är redo, och det var den aldrig före F36–F38.
- **Rättning:** en begäran utan nätägarbegäran skickas genom den vanliga, skyddade vägen `queueCustomerInfoRequestForDispatch`, som skapar den och behåller alla spärrar. En fastnad begäran finaliseras som förut.
- **Test:** `__tests__/customer-process-z01-dispatch-without-godr.test.ts` (5/5; 24 relaterade tester gröna).

### F40 Go-live-guiden för routes fallerade för varje bolag som redan hade en produktionsprofil — RÄTTAD
- **Var:** `deactivateExistingProductionFamily` (`app/admin/platform/go-live/[companyId]/route-wizard/actions.ts`) satte `production_mode: "superseded"` på befintliga profiler.
- **Varför fel:** `ediel_route_profiles_production_mode_check` tillåter bara `disabled|shadow|dry_run|live|active`, och samma CHECK finns i drift (läsfråga).
- **Följd:** "Skapa valda production routes" gav `status=failed` (`violates check constraint …`) så snart en PRODAT- eller UTILTS-profil fanns. Det gäller alla bolag som kan publicera avtal. Inget läser `"superseded"`.
- **Rättning:** `production_mode: "disabled"` tillsammans med befintliga `is_enabled: false`.
- **Test:** `__tests__/route-wizard-supersede-production-mode.test.ts` kör den riktiga åtgärden mot en databas med samma CHECK. Den fallerar utan rättningen med exakt driftens felmeddelande.
- **Verifierat i appen:** guiden svarar "Production route skapad för PRODAT + UTILTS".

### F41 Två route-modeller som utesluter varandra — RÄTTAD (kod), Z01 för nya bolag
- **Beslut:** routes per nätägare, materialiserade från Ediels register, är produktionsmodellen.
- **Rättning:**
  1. `customerInfoEnvironmentResolver` räknar en profil med `metadata.platform_actor_route_id` som nätägar-route.
  2. `routeMaterializer.upsertRouteProfile` tar PRODAT-referensen enbart från registerrouten eller policyn (`23-DDQ-PRODAT`). Avsändarinställningens `PRODAT` används inte längre. För UTILTS gäller avsändarens deklarerade referens fortfarande, enligt SC-059.
  3. Route-guiden avaktiverar aldrig registermaterialiserade profiler. Den använder policyreferensen `23-DDQ-PRODAT` för PRODAT och ingen referens för UTILTS. Den felaktiga spärren "23-DDQ är test/portal-referens" är borttagen; masterplanens tabell anger `23-DDQ-*` som leverantörens produktionsreferens.
- **Test:** `__tests__/route-model-registry-materialized-z01.test.ts`, 5 gröna. Utan rättningen fallerar 3.
- **Regressioner:** 16 filer och 185 tester gröna, bland annat SC-058, SC-059, TEN-05/06, DB-01, IMP-05, TR-01 och AT-Z03L. Materialisering, partiell reparation, route-beredskap och Z01-route är gröna.

- **Guidens modell:** dynamiska profiler (`receiver_source=selected_metering_point_grid_owner`, `is_production_route=true`) som mottagaren hämtas till per kund. Det är bara dessa som miljöväljaren för kunduppgifter räknar (`routeMatchesCustomerGridOwner`).
- **Route-beredskapens modell:** profiler per nätägare, materialiserade från registret med fast `receiver_ediel_id`.
- **Krock 1:** guiden ersätter alla produktionsprofiler i familjen, även de materialiserade nätägarprofilerna.
- **Krock 2:** beredskapsmotorn (`evaluateRouteProfileProductionReadiness`) kräver fast mottagare och mottagarcertifikat på profilen. Den ger `receiver_ediel_id_missing` för varje dynamisk profil, så en guide-profil kan aldrig bli produktionsgodkänd.
- **Krock 3:** en materialiserad nätägarprofil räknas inte av miljöväljaren, så kundflödet hittar ingen miljö (`environment_not_resolved`, inga kandidatmiljöer).
- **Krock 4:** efter guiden fallerar materialiseringen med `ediel_application_reference_route_mismatch:PRODAT:23-DDQ-PRODAT`, eftersom guidens profil har `application_reference=PRODAT`. Kundflödet stannar då på `platform_route_exists_but_not_materialized`.
- **Bevisat åt båda hållen i simuleringen:**
  - Bara materialiserad route ger `environment_not_resolved` (14:37).
  - Guiden först ger att materialiseringen fallerar och `platform_route_exists_but_not_materialized` (14:43–14:46).
- **Slutsats:** ingen ordning av operatörsstegen ger en Z01 för ett nytt bolag. Det krävs ett beslut om vilken modell som gäller. Antingen räknar miljöväljaren materialiserade nätägarprofiler, eller så räknar Z01-beredskapen (`evaluateCustomerProcessRouteReadiness`) guidens dynamiska profiler och beredskapsmotorn stöder dynamisk mottagare.

## Körning 2026-10-20 från noll (`scripts/reality/up.sh`): scenario A och C

Världen byggdes från noll med `up.sh` (ren replay, `next build` och `start`, simulatorer). Mätvärdena gäller den lokala stacken: PostgREST-pool med 10 anslutningar och Kong med 512 worker connections. Absoluta tider skiljer sig från drift, men antal anrop och beteende gör det inte.

### F42 Inget bolag kan få automatiska leverantörsbyten: "egen elhandlare" kan inte registreras — RÄTTAD
- **Rättning:** `resolveIncomingSupplierIdentity` (`lib/masterdata/selfSupplier.ts`) slår upp i ordningen
  1. en markerad egen rad,
  2. en rad med bolagets namn,
  3. bolagets egna `companies.name` och `org_number`.
  
  Den är bolagsscopad och läser aldrig något Ediel-ID. Z03-identiteten (UNB-avsändare och NAD+FR från avsändarinställning och identifierare, TEN-01/TEN-02) är oförändrad. Det är verifierat: Z03-segmenten byggs bara från `prodatRendered`, och namnet finns bara i diagnostikdata.
- **Test:** `__tests__/supplier-switch-incoming-supplier-identity.test.ts`. F-9-testerna för bolagsisolering är gröna.
- **Fel:** varje `start_supplier_switch` fallerade med "Bolaget saknar en registrerad egen elhandlare. Markera bolagets leverantör som den egna innan ett byte till oss skapas." (`lib/operations/db.part-2.ts:454`).
- **Hur leverantören hittas:** `resolveOwnElectricitySupplier` (`lib/masterdata/selfSupplier.ts`) kräver en rad i `electricity_suppliers` med bolagets `company_id` och `is_own_supplier=true`, eller en rad med exakt bolagets namn.
- **Varför ingen sådan rad finns:**
  - `/admin/electricity-suppliers` (`saveElectricitySupplier`) sätter varken `company_id` eller `is_own_supplier`.
  - Flaggan sätts bara via en kryssruta i den manuella panelen för att skapa ett byte på ett kundkort (`switch-create-actions.ts:572`).
- **Drift (läsfråga):** 9 leverantörsrader, 0 med `company_id`, 0 egna. 0 av 3 bolag kan lösas, så varje automatiskt byte i drift skulle fallera.
- **Exempel Gridex El AB (drift, läsfråga):**
  - Bolaget är självt elhandlare i Ediels register (21660, PowerSupplier).
  - Avsändaren i produktion är 21660.
  - Bixia AB (48800) är rätt inlagd som balansansvarig (`ediel_brp_settings`).
  - Bixia ska alltså inte vara "egen elhandlare". Den egna elhandlaren är Gridex El AB själv.
  - Uppgiften används bara för namn och org.nr som inkommande leverantör på bytesärendet. Den finns redan i bolagets egen identitet, så kravet på en separat rad i `electricity_suppliers` tillför inget.
- **Förslag:** skapa och markera bolagets egen leverantör när bolagets Ediel-avsändare sätts upp (namn, org.nr och Ediel-ID finns redan där). Alternativt läs den egna leverantören från bolagets avsändaridentitet i stället för från `electricity_suppliers`. Go-live-grinden bör kontrollera detta.

## Faktura: flera anläggningar, avtalstider och belopp (scenario F, 2026-10-21)

Kandidaterna nedan kommer från kodkartläggningen. Var och en bekräftas eller avfärdas i scenario F (riktig fakturakörning). Status uppdateras här, och ingenting tas bort.

### F70 Ingen samlingsfaktura: en kund med flera anläggningar får en faktura per mätpunkt — KANDIDAT, hög, kräver beslut
- **Kod:** underlaget skapas per mätpunkt, leveransperiod och energiriktning (`lib/billing/underlayEngine.ts:813, 845, 1029`). Varje underlag blir ett eget fakturautkast (`lib/billing/invoiceReviewPrepare.ts:436-450`).
- **`consolidated_invoice`/`billing_level`:** finns på kund, anläggning och avtal men sätter bara en etikett, `consolidated_invoice_group_key` (`invoiceReviewPrepare.ts:272-276`). Ingenting slår ihop underlag.
- **Kodkommentar:** `invoiceFileExport.ts:298-299` säger själv "One invoice covers one billing underlay, i.e. one facility".
- **Påverkan:** en kund som valt samlingsfaktura i intaget ("Samla flera anläggningar och mätpunkter på samma fakturaadress") får ändå en faktura per anläggning.

### F71 Månadsavgift och fakturaavgift tas ut en gång per anläggningsfaktura — KANDIDAT, hög, kräver beslut
- **Kod:** `underlayToInput` hårdkodar `siteCount: 1` och `invoiceCreated: true` (`lib/pricing/engine.ts:311-312`).
- **Påverkan:** en kund med tre anläggningar betalar tre fakturaavgifter. Om månadsavgiften avtalats per kund betalar kunden också tre månadsavgifter. En avgift per anläggning kan vara avtalsenlig, men fakturaavgiften ska följa antalet faktiska fakturor och samlingsvalet (F70).

### F72 Avtalsvillkoren syns inte på fakturan i de flesta utgångar — KANDIDAT, medel
- **Var de finns:** bindningstid, bindningens slutdatum, återstående bindningstid, uppsägningstid och automatisk förlängning byggs bara i `buildContract` (`lib/billing/invoiceFileExport.ts:241-261`) och följer bara med i Nordfins XML och JSON.
- **Var de saknas:** Capway-underlaget (`lib/integrations/billing/capway/payloadBuilder.ts`), CSV/XLSX-kolumnerna (`invoiceFileExport.ts:478-503`) och adminsidan för fakturor (`app/admin/billing/invoices/[id]/page.tsx`).

### F73 Avtals-PDF:en saknar slutdatum, återstående avtalstid och automatisk förlängning — KANDIDAT, medel
- **Kod:** `lib/customer-contracts/agreementPdf.ts:176-204` skriver bindningstid och uppsägningstid men inte avtalets slutdatum, förlängning eller förlängningsperiod.

### F74 Två fältnamn för automatisk förlängning — KANDIDAT, medel
- **Kod:** avtalet läser `auto_renew_enabled`, medan erbjudande och produktversion använder `automatic_renewal` (`20260716010000_...sql:351,450`). `AutoRenew` på fakturan kan därför bli fel för avtal skapade från ett erbjudande med automatisk förlängning.

### F75 Betalreferens (OCR) saknas på Nordfin-fakturan — KANDIDAT, hög, kräver beslut
- **Kod:** `PaymentReference` är null i väntan på beslut (`lib/billing/nordfinInvoiceXml.ts:81`). Utan OCR kan inbetalningar inte matchas automatiskt.

### F76 Kunden ser aldrig fakturan i Mina sidor — KANDIDAT, medel
- **Kod:** `upsertPartnerCustomerInvoice` (`lib/customer-portal/partnerInvoices.ts:102`) anropas aldrig, så `customer_invoice_documents` och `customer_invoice_lines` fylls inte.

### F77 Totalbeloppet öresavrundas inte; avrundningskomponenten avrundar energibeloppet — KANDIDAT, låg, kräver beslut
- **Kod:** `finalizePricingPreview` summerar avrundade rader utan att avrunda totalen (`lib/pricing/pricePreviewBuilder.ts:10-52`). Komponenten `rounding` avrundar baspriset för energi till hela kronor (`priceComponentCalculator.ts:292-295`), och Capway får differensen som `rounding` (`payloadBuilder.ts:141`).

## Ediel-routing till rätt tenant och kund (scenario E, 2026-10-20)

Scenario E: två elhandlare delar nätägare. Nätägaren skickar via SMTPS
- vanliga E66 och E66 med timvärden,
- en korrigering,
- en felriktad fil och en fil till ett okänt Ediel-ID,
- värden för en kund före leveransstart.

Felen skrivs in här i den ordning de hittas.

### F68 Ingen inkommande Ediel-fil kunde sparas på grenen — RÄTTAD, kritisk (bara den här grenen, inte drift)
- **Utfall:** efter ren replay togs alla sex filerna emot i brevlådan, men inga sparades som Ediel-meddelanden. Jobben föll med `ediel_inbound_original_persistence_required`, och appens logg visade `permission denied for function envelope`.
- **Orsak:**
  - Min egen prestandamigration `20261020120300` lade till uttrycksindexet `ediel_messages_inbound_envelope_uci_idx` på `gridex_ediel_technical_ack.envelope(raw_payload)`.
  - Postgres utvärderar ett indexuttryck med rättigheterna hos rollen som skriver raden.
  - `envelope()` och `gridex_utilts_binding.wire_tokens_v1()`, som den anropar, fick bara köras av `postgres`.
- **Drift:** indexet finns inte i drift (bara läsfrågor mot metadata), så produktionen är opåverkad.
- **Rättning:** migrationen `20261020280000` ger EXECUTE på exakt de två rena parsningsfunktionerna (IMMUTABLE, utan sidoeffekter) till `service_role` och `authenticated`. Inga scheman öppnas.

### F69 En Ediel-fil till ett okänt Ediel-ID blir aldrig en ohänförd Ediel-källa med granskningsärende — ÖPPEN, medel, kräver beslut
- **Utfall (scenario E):** nätägaren skickar en E66 till Ediel-ID 69999, som ingen tenant har.
  - Filen hamnar inte hos någon tenant, och tenantisoleringen håller.
  - Mejlet sparas med bilaga och tolkningsresultat som `manual_review`/`unassigned` utan bolag och syns för plattformspersonalen i `/admin/inbound-mail`.
  - Däremot skapas varken ett ohänfört `ediel_messages` eller ett `ediel_unresolved_items` (kö för tenantlösa filer).
- **Orsak:** `gridex_unattributed_intake.selection_v1` kvalificerar bara MIME som saknar `Content-Transfer-Encoding: base64/quoted-printable`, PKCS7 och signerade eller krypterade multipart. Appen loggar `ediel_technical_intake_original_custody_required`.
  - En EDIFACT-bilaga som `application/edifact` kodas i praktiken alltid base64, och här skickad med nodemailer.
  - Riktig Ediel-trafik är dessutom S/MIME.
  - Spåret för ohänförd teknisk mottagning nås därför i praktiken aldrig för riktiga mejl.
- **Varför den inte rättas här:** regeln ingår i det godkända kontraktet SC-014 (PASSED). Att godta avkodade bilagor som originalbevis är ett säkerhets- och förvaringsbeslut inom ett godkänt område.
- **Förslag:** antingen kvalificerar förvaringen avkodade bilagor, bundna till exakt base64-text och hash, eller så skapar mejlnivån ett granskningsärende för `unassigned` Ediel-mejl. Beslut krävs.

### F78 Rättelsen i F68 räckte inte: ändringar på inkommande Ediel-meddelanden föll fortfarande — RÄTTAD, kritisk (bara den här grenen, inte drift)
- **Utfall (scenario E, körning 4):** korrigeringen A15C togs emot och sparades men blev stående i `received`/`manual_review` och behandlades aldrig. Ett direkt anrop av `processInboundEdielMessage` på meddelandet föll med `42501 permission denied for schema gridex_utilts_binding`. Databasens logg visade samma fel vid flera `UPDATE public.ediel_messages` från appen.
- **Orsak:**
  - Indexet `ediel_messages_inbound_envelope_uci_idx` från F68 utvärderas med den skrivande rollens rättigheter.
  - `envelope()` är plpgsql, så dess anrop av `gridex_utilts_binding.wire_tokens_v1` slås upp vid körning och kräver USAGE på schemat.
  - F68 gav bara EXECUTE.
  - En uppdatering som inte kan bli HOT (till exempel när kund, mätpunkt eller referens sätts) utvärderar indexet och faller. En ren HOT-uppdatering gör det inte, och därför syntes felet bara ibland.
- **Bevis:** i en transaktion som rullades tillbaka föll en icke-HOT-uppdatering som `service_role` med samma fel efter `REVOKE USAGE`, och gick igenom med grant. Efter rättelsen gav samma `processInboundEdielMessage` status `validated`. Exakt de 24 ändrade kvartsvärdena fick revision 2 (2,220 → 2,508 kWh = 24 × 0,012), originalvärdena markerades `replaced` och de 72 oförändrade är kvar som `current`.
- **Rättning:** migrationen `20261020290000` ger USAGE på `gridex_utilts_binding` till `service_role` och `authenticated`. Schemats tabeller saknar grants till rollerna, och den enda körbara funktionen är den rena tokenizern. PUBLIC EXECUTE dras in som standard för framtida funktioner i schemat.
- **Följder som förklaras av F78 (inga egna fel):**
  - Tenant B:s E66 låg kvar som `internal_review` med `UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE`, trots godkänt issuer-bevis och ombearbetning. Den första spärren var korrekt: beviset fanns ännu inte. Operatörens ombearbetning klockan 07:14:07 föll sedan på F78, vid den `UPDATE` som sätter kund och mätpunkt, så diagnosen låg kvar från första körningen. Efter rättelsen ger läsningen `qualified`, och B15 sparar 96 värden (8,898 kWh) på B:s kund.
  - Det enda `ediel_historical_rule_pack_basis_unavailable` i appens logg kom vid samma tidpunkt och syntes för operatören som ett ohanterat serverfel. Det kontrolleras i körning 5 av scenario E.
- **Körning 5 (efter rättelsen):** B:s fil ombearbetas av operatören och sparar 96 värden (8,898 kWh) på rätt tenant, kund och mätpunkt, utan något fel. För A visades däremot ingen ombearbetningsknapp. Det utreds som ett eget fynd nedan.

### F79 Mina sidor och kund-API:t visar mätvärden från före kundens leveransstart — RÄTTAD (ägarbeslut 2026-10-22), medel (integritet)
- **Utfall (scenario E):** nätägaren skickar E66 för 15 september för en mätpunkt där tenant A:s leverans börjar 1 oktober (`ALATE`).
  - Filen är korrekt adresserad till A och mätpunkten är A:s, så 96 värden sparas på kunden (`normalized_metering_values`, `billing_gate_status=pending_match`).
  - Värdena faktureras aldrig, och faktureringsspärren håller.
- **Kod:** `lib/customer-portal/apiData.ts` (Mina sidor) och `app/api/v1/customer/metering-values/route.ts` (kund-API) filtrerar bara på `company_id` och `customer_id`. De tar inte hänsyn till leveransperiod, billing gate eller historikbehörighet. Kunden ser därför förbrukningen från tiden före leveransen som sin egen.
- **Varför det är ett integritetsproblem:** vid inflyttning tillhör förbrukningen före leveransstart den tidigare boende, alltså en annan person. Vid ett leverantörsbyte är det samma kund, men vi har ingen grund för uppgifterna, eftersom ingen Z14/Z15-historikbehörighet finns. Systemet skiljer inte de två fallen åt.
- **Varför den inte rättas direkt:** vad kunden ska få se före leveransstart (inget, bara vid historikbehörighet, eller bara vid byte) är ett integritets- och produktbeslut. Det berör också partner-API:t (`lib/partner-api/*`), som läser samma tabell.
- **Förslag:** kundens egna kanaler visar bara värden inom kundens leveransperioder för mätpunkten, eller värden som har en giltig historikbehörighet (`permission_id`). Övriga värden ligger kvar för drift och granskning.

### S1 Simuleringens cron-körare hoppade över cron-jobb som körs varje minut — RÄTTAD (simuleringen, inte produkten)
- **Utfall:** efter sammanslagningen med main stod nätägarförfrågan i scenario D köad i 6 minuter utan att skickas.
- **Orsak:** main kör den manuella e-postutkorgen och manuell inkommande e-post med schemat `* * * * *`. `runOperationalCronSlot` kände bara igen `N-M/k`. Produkten skickade direkt när utkorgen anropades.
- **Rättning:** cron-jobb som körs varje minut ingår nu först i varje omgång.

- **Ägarbeslut 2026-10-22:** en kund ser bara mätvärden som kunden har verifierad rätt till. Kopplingen till en anläggning ger inte hela anläggningens historik.
- **Rättning (commit `7a50dce4`):** en gemensam databasregel styr alla kundkanaler (`20261022100000_customer_metering_access_windows.sql`, `lib/metering/customerMeteringAccess.ts`):
  - Ett värde visas bara om hela intervallet ligger inom ett fönster för samma tenant, kund och mätpunkt.
  - **Leveransfönster:** etablerad period (`confirmed_by_grid_owner`, `active`, `ending`, `ended`), från Ediel-bekräftad `market_start_at`/`market_end_at`, annars bekräftat startdatum och slutdatum som exklusiv gräns kl. 00:00 svensk tid. Varje period är ett eget fönster, glapp öppnas aldrig, och avslutade perioder behåller kundens egen historik.
  - **Historik före vår leverans:** bara värden bundna till en behörighet som vilar på ett faktiskt mottaget PRODAT Z14 från nätägaren (kvalificerad övergång, status `active`/`ended`), inom det godkända rapportintervallet. `normalized_metering_values` saknar bindningen, så där är historiken stängd tills rätten kan styrkas.
  - Filtreringen sker i databasen före gräns, sidbrytning, summor och diagram. Månadskorten mäter fullständighet mot kundens egna fönster.
  - Läsvägar som går genom regeln: Mina sidor (detaljrader och månadskort), portal-bundlen, kund-API:t `metering-values` och partner-API:ts två mätvärdesläsningar.
  - Lagrade värden, originalmeddelanden och personalens interna åtkomst är oförändrade. Funktionerna får bara köras av `service_role`.
- **Inkonsekvenser som hittades på vägen:**
  - Partner-API:t läste per anläggning (`customer_site_id`) utan periodkontroll.
  - `metering_permissions.inbound_z14_message_id` saknar främmande nyckel, så en godtycklig uuid hade kunnat se ut som ett godkännande. Regeln kräver därför ett verkligt mottaget Z14.
  - Statusarna `approved` och `z14_received` sätts inte av den kvalificerade Z14-vägen och öppnar ingenting.
- **Bevis:**
  - `scripts/customer-metering-access-native.test.ts` (9/9 mot replay-databasen) täcker inflyttning på samma anläggning, avslutad period, glapp, bakdaterad bekräftad start, flera anläggningar, makulerad period, obevisade och manuella behörigheter, intervallgränser, att filtret körs före gränsen, manipulerade anrop och läsningarna i Mina sidor.
  - På scenario E:s data ser kund A sina 144 av 144 värden, medan kunden med leverans från 1 oktober ser 0 av 96 sparade septembervärden.
- **Kvar:** den positiva vägen för historik via ett verkligt Z14 är inte prövad native, eftersom databasen vägrar fejkade Z14-meddelanden, vilket är korrekt. Den prövas i ESCO-kedjan när en riktig Z14-mottagning finns.

### F80 Ett meddelande med spärrade transaktioner kan låsas ute från ombearbetning — UNDER RÄTTNING, hög
- **Utfall (körning 5 och 7 av scenario E, på en redan använd värld):** efter godkänt issuer-bevis visade operatörens sida ingen knapp "Kör UTILTS engine / skapa TGT-svar" för tre av A:s spärrade E66-filer. Inga värden sparades. I körning 6 (ren värld) fungerade allt.
- **Utredning (databas, kod och gatewaylogg):**
  - Akut orsak i körning 5 och 7: testriggen (S2 nedan). De tre meddelandena hade bara CONTRL, så knappvillkoret var inte uppfyllt. Sidan hade bara inte renderat färdigt.
  - Verkliga produktfel i samma flöde (bekräftade i koden):
    1. Sidan (`app/admin/ediel/messages/[id]/page.tsx:430-434`) och serveråtgärden (`app/admin/ediel/actions.part-3.ts:85-115`) vägrar ombearbetning så snart *något* APERAK eller UTILTS-ERR finns för källan. En fil där en transaktion är spärrad och en syskontransaktion har avvisats (negativt APERAK/UTILTS-ERR, `utiltsDataRequest.part-1.ts:706-797`) kan därför aldrig återupptas. Spärren blir permanent.
    2. Sidan räknar även makulerade svar, och serveråtgärden räknar bara aktiva. De två villkoren är inkonsekventa.
    3. Listans "Kör engine" (`app/admin/ediel/messages/page.tsx:285,349`) döljs så snart en CONTRL finns, alltså alltid för ett spärrat meddelande.
    4. Ombearbetningen skriver över `validation_report.utiltsRuntime`, så den tidigare spärrdiagnosen finns bara kvar i händelserna. Det är en lucka i revisionsspåret.
    5. Händelsetexten för ett spärrat meddelande säger "avvisades av produktionsruntime och korrekt kvittensflöde skapades", fast ingenting avvisades och inget svar skickades.
  - Det som redan håller: utkast återanvänds för samma utfall och ger `blocked_final_ack_exists` vid ett annat. Slutsvaret per transaktion skrivs en gång. Mätvärden spelas upp i stället för att skrivas om. Issuer-grunden läses om från det bevarade originalet. Upprepade körningar gav exakt 96 värden per fil.
- **Rättning (pågår):** en gemensam serverregel bestämmer om ombearbetning är tillåten. Den är det när minst en transaktion är `internal_review` utan slutsvar. Detaljsidan, listan och serveråtgärden använder samma regel. Tidigare svar raderas eller ändras aldrig. Nya svar skapas bara för transaktioner som lämnar granskning. Tidigare diagnoser bevaras i en historik som bara kan växa. Händelsetexten rättas.

### S2 Scenario E:s operatörssteg läste detaljsidan innan den hade renderat — RÄTTAD (simuleringen)
- **Utfall:** `button.count()` väntar inte. Detaljsidan visar `loading.tsx` i 15–32 sekunder, och när filerna kom i en viss ordning gick nästa sida upp medan föregående serveråtgärd fortfarande renderade om. Testet gick då vidare efter ungefär en sekund utan att klicka.
- **Rättning:** steget väntar på den renderade detaljvyn, sparar URL och HTTP-status och väntar in serveråtgärdens svar (`submitServerAction`) innan nästa sida öppnas.

### P7 Detaljsidan för ett Ediel-meddelande tar 15–32 sekunder att rendera — ÖPPEN, medel (prestanda)
- **Mätning (gatewaylogg, körning 6 och 7, lokalt):** från sidans läsning av kvittensstatus till renderad sida tog det 15–32 sekunder per UTILTS-meddelande.
- **Påverkan:** operatören ser bara en laddningsvy. Långsamma sidor gör också att operatörer klickar två gånger eller går vidare för tidigt.
- **Nästa steg:** mät vilka av sidans parallella läsningar som dominerar innan något ändras (prestandaregeln: mät, identifiera, åtgärda, verifiera).

## Manuellt kundintag (scenario D, 2026-10-20)

Kedjan i scenario D, i ordning. Varje fel nedan dolde nästa. Alla är verifierade i en ren replay och, där det anges, mot driftens funktionskroppar (md5) eller aggregat (bara läsfrågor). Alla är rättade. De fem behörighets- och produktbesluten fattades av ägaren 2026-10-20.

### F56 Inget manuellt intag kunde sparas — RÄTTAD, kritisk
- **Utfall:** varje första inskick gav "En identisk intagning bearbetas redan" och ingen kund skapades. Drift har 0 intag via `admin/*`.
- **Orsak:** `createCustomerAction` ignorerade `created` från idempotensloggen, så raden som just skapats tolkades som ett pågående dubbelinskick.
- **Rättning:** spärren gäller bara en rad som fanns före inskicket. Test: `__tests__/admin-intake-fresh-ledger-row.test.ts`.

### F57 Ett internt publicerat erbjudande kunde inte säljas manuellt — RÄTTAD, hög
- **Orsak:** `gridex_ensure_internal_contract_publication` kände bara igen sin egen v1-snapshot och skapade en andra publicerad version bredvid kanalpubliceringens v6-version. Unikindexet stoppade det. Funktionen är md5-identisk i drift.
- **Rättning:** migrationen `20261020240000` återanvänder erbjudandets publicerade interna kanalversion.

- **Följdfel (Codex #840/6297402243, bekräftat 2026-10-22):** migrationen `20261020240000` tålde inte att köras två gånger. Ersättningstexten slutar med söktexten, så kontrollen "exakt en förekomst" passerade igen och blocket lades in en gång till. **Rättat:** en redan omskriven funktionskropp lämnas orörd, och annars krävs exakt en föregångare. Migrationen finns bara på grenen och är inte applicerad i drift, så den ändrades på plats och manifestets hash uppdaterades. Bevis: två körningar i följd mot replay-databasen, och funktionen innehåller den nya bindningen exakt en gång.
### F58 Gemensam nätägare tappades när anläggningen sparades — RÄTTAD, hög (variant av F54)
- **Orsak:** `normalizeGridOwnerIdToOps` filtrerade på `company_id = bolaget`.
- **Rättning:** gemensam eller egen nätägare, aldrig ett annat bolags. Test: `__tests__/grid-owner-normalizer-shared-registry.test.ts`.

### F59 Ingen anställd hos en tenant kunde registrera ett redan signerat avtal — RÄTTAD (ägarbeslut), hög
- **Orsak:** importen kräver `contracts.create`, som i drift bara `pricing_manager` och `super_admin` har. Felet kom dessutom först efter att kund, anläggning och avtal skrivits.
- **Rättning:**
  - Migrationen `20261020250000` ger `contracts.create` till `company_admin`, `owner` och `customer_service_manager`.
  - Intaget nekar redan före första skrivningen när behörigheten saknas.

### F60 Ett uppladdat signerat avtal kunde aldrig importeras — RÄTTAD, kritisk
- **Orsak:** importtriggern skapade ett andra priskvitto med samma `valid_from` som kontraktets bundna snapshot, och unikindexet stoppade det. Funktionen är md5-identisk i drift, och drift har 0 importer.
- **Rättning:** migrationen `20261020260000` signerar den bundna, hashade snapshoten när den matchar exakt.

### F61 Importen kraschade på händelseloggen — RÄTTAD, kritisk
- **Orsak:** dokumentraden skrevs med användarsessionen, men triggerns händelselogg kräver `service_role`. Båda uppladdningsvägarna (intaget och kundkortet) var berörda. Drift har 0 avtal och 0 händelser.
- **Rättning:**
  - Raden skrivs med service-rollen och med den anställde som `created_by`. Triggern kontrollerar fortfarande behörighet och tenantkedja.
  - En nekad import blir en varning på den sparade kunden, i stället för "kunde inte sparas".
- **Test:** `__tests__/signed-agreement-import-service-role.test.ts`.

### F62 Inget automatiskt leverantörsbyte kunde någonsin auktoriseras i drift — RÄTTAD (ägarbeslut), kritisk
- **Orsak:**
  - Switcharbetaren kräver `communication.write` och `operations.write`.
  - I drift hade ingen roll `communication.write`, och den krävs i cirka 80 Ediel-steg.
  - `operations.write` fanns inte ens i katalogen. Bara native-fixturer skapade den, och fixturerna ger dessutom alla nycklar direkt, vilket dolde felet.
- **Rättning:** migrationen `20261020270000` och `lib/rbac/catalog.ts` lägger till nyckeln. `company_admin`, `owner`, `operations_manager` och `customer_service_manager` får båda rättigheterna.

### F63 Manuellt registrerade anläggningar fick aldrig geografisk nätägare — RÄTTAD, kritisk
- **Utfall:** nätägarförfrågan med fullmakt hölls alltid som "inte kanoniskt verifierad".
- **Orsak:** intaget körde aldrig webbens `resolveEnergyContext` och precisionspass (Papilite + SVK).
- **Rättning:** intaget kör båda för den exakta anläggningen. Om adressen pekar ut en annan nätägare än den valda vinner adressen och den anställde får veta det. Om adressen inte går att lösa sparas valet bara som granskningskandidat.
- **Test:** `__tests__/manual-intake-site-geography.test.ts`.

### F64 En nätägare utan nätområde blev "facility_verified" — RÄTTAD, medel
- **Orsak:** genvägen i `resolveCustomerSiteGridOwner` litade på vilket `grid_owner_id` som helst.
- **Rättning:** genvägen kräver nu också känt nätområde.

### F65 Anläggningen saknade adressversion — RÄTTAD, hög
- **Orsak:** varje nätägarkontakt binds till `address_hash`, men intaget skrev aldrig den.
- **Rättning:** intaget går via samma atomiska adresscommit som kundkortet och webben (källa `manual_intake`).

### F66 Fullmakten från intaget var aldrig sändbar — RÄTTAD (ägarbeslut), hög
- **Orsak:** undertecknare och metod saknades.
- **Rättning:**
  - Formuläret har fält för undertecknare och dennes person- eller organisationsnummer.
  - För privatkund används kundens namn och personnummer när fälten lämnas tomma. För företag antas aldrig någon undertecknare.
  - Metoden blir `pdf_upload`.
- **Test:** `__tests__/manual-intake-poa-signer.test.ts`.

### F67 En elhandlare utan webbförsäljning kunde aldrig skicka nätägarförfrågan — RÄTTAD (ägarbeslut), kritisk
- **Orsak:**
  - Kapabiliteterna `email_outbound`, `facility_lookup` och `customer_automation` blev bara redo när en webbplatsklient konfigurerades.
  - Utkorgen hoppade därför över med `capability_not_ready`.
  - I drift har 2 av 3 aktiva bolag dessa som `not_configured`.
- **Rättning:**
  - Go-live-sidan har steget "Driftkapabiliteter" med samma kontroller som webbens go-live, men utan webbplatsklient. Kontrollen körs också vid godkännande för produktion.
  - Webbspecifika kapabiliteter är oförändrade.
- **Test:** `__tests__/tenant-operational-capabilities.test.ts`.

### F55 Replayen saknar policyer på `price_areas` — PARITET (inte drift)
- **Drift:** fyra policyer.
- **Replay:** RLS är på men utan policy, så ingen bolagsanvändare kunde välja prisområde.
- **I simuleringen:** `ensureProductionPriceAreaPolicyParity` speglar driftens policyer exakt.

### F53 Bolagsanvändare ser ingen gemensam nätägare: det manuella intaget kan inte välja någon riktig nätägare — RÄTTAD, hög
- **Utfall:** en riktig bolagsanvändare med `company_admin` öppnade `/admin/customers/intake`. Listan "Nätägare" var tom, trots att Alingsås Energi Nät (16700) är verifierad för kundflödet.
- **Orsak 1, RLS (samma i drift):** den tillåtande policyn på `grid_owners` släpper igenom `company_id IS NULL`, alltså gemensamma registerrader. Den begränsande livscykelspärren `tenant_lifecycle_select_guard` (`20260814162500`) kräver däremot `company_id IN (användarens bolag)`, och det är aldrig sant för NULL. Samma krock finns på `grid_owner_contact_channels`, `grid_owner_contact_routes` och `consumption_profiles` (drift, read-only).
- **Orsak 2:** beredskapsflaggan i vyn (`can_start_supplier_switch`) bygger på `platform_actor_certificates`, och den tabellen är bara läsbar för plattformsadmin.
- **Rättning:**
  - Migrationen `20261020230000_shared_reference_rows_through_lifecycle_guard.sql` låter gemensamma rader (NULL) passera spärren när sessionen är tillåten, på de fyra tabellerna. Uttrycket ändras bara om det är exakt det förväntade. Bolagsägda rader har oförändrad regel. Probe som bolag: 175 gemensamma rader och 1 egen av 9 bolagsägda.
  - `listCustomerFlowGridOwnersForCompany`: intagets lista läses på servern och avgränsas till gemensamma nätägare plus bolagets egna. Certifikat-RLS:en lämnas orörd.
  - `contract_invoice_fee_remediation_tasks`, som har samma mönster men är plattformsintern, lämnas orörd.
- **Test:** `__tests__/intake-grid-owner-tenant-scope.test.ts`, 3 gröna. Utan rättningen fallerar 2. 57 relaterade tester är gröna.

### F54 Intaget godtog ett annat bolags nätägare — RÄTTAD, medel (tenantisolering)
- **Var:** `resolveOrCreateGridOwnerForIntake` läste `grid_owners` med service-rollen enbart på id. Ett postat id för ett annat bolags egen, verifierade nätägare godtogs och kopplades till kunden.
- **Rättning:** `.or(company_id.is.null,company_id.eq.<bolaget>)`. Testet ovan kontrollerar avvisningen.

### F52 Replayen saknar bolagsroller (`company_admin` m.fl.) — PARITET (inte drift)
- **Drift:** `company_admin` har 36 behörigheter (read-only metadata).
- **Replay:** inga roller och inga `role_permissions`, så en bolagsanvändare kan inte öppna adminytan lokalt. Den delade fixturen lägger dessutom en tillfällig `native_actor`-roll utan behörigheter på bolagets admin.
- **I simuleringen:** `scripts/helpers/reality/tenantStaff.ts` speglar `company_admin` exakt och skapar bolagsanvändaren via GoTrue.
- **Observation:** i drift saknar `company_admin` behörigheten `communication.write`, som Ediels affärshandlingar kräver.

### F51 Z01 kan inte skapas för någon webbkund: kundens folkbokföringsadress samlas aldrig in — ÖPPEN, kritisk, ägarbeslut
- **Utfall (körning 17:54, efter F49):**
  - Z01-begäran till nätägaren skapas och godkänns mot fullmakten.
  - Renderingen stoppas med `customer_masterdata_source_held:source_qualified_customer_identity_registered_address_at_requested_time`.
- **Regeln** (`20261001014700`/`20261001025107`, skyddad): slutkundens UD i Z01 använder kundens egen registrerade adress, alltså `customer_addresses.type='registered'` som gäller i dag. Alternativet är en signerad, granskad kunddeklaration. "Neither an installation/invoice address nor a caller hint is a customer masterdata basis."
- **Fakta:**
  - Webb-API:t tar bara emot anläggningsadress och fakturaadress (`billingAddressSameAsSite`). Webbkunder får adresser av typen `billing` och `facility`.
  - Ingen kod i appen och ingen migration skriver en `registered`-adress.
  - Kunddeklarationen (`gridex_customer_masterdata.signed_declarations`) är oseedad och kräver granskat original.
  - Drift (read-only): `customer_addresses` har bara 1 rad av typen `facility` och 0 `registered`.
- **Följd:** ingen ny kund kan få Z01. Därmed når ingen ny kund Z03 heller (se även F45 och F46).
- **Beslut som krävs:** var folkbokföringsadressen ska komma ifrån. Alternativen:
  - webbformuläret och API:t samlar in den som ett eget fält;
  - den hämtas från ett adressregister (SPAR eller motsvarande, extern tjänst);
  - operatören anger den på kundkortet.

  Regeln förbjuder att faktura- eller anläggningsadressen används i stället.

### F49 Webbkundens Z01 låstes med `missing_power_of_attorney` trots giltig fullmakt — RÄTTAD (följd av min F39-rättning)
- **Utfall (körning 16:54):**
  - Alla fyra webbkunders Z01 blockerades med "Nätägarbegärans bundna fullmakt och anläggning måste motsvara den aktuella behörigheten".
  - Fullmakten var i sin ordning: signerad, `supplier_switch` täcker nätägaruppgifter, och scope, dokument och avtal stämmer. Den skapades före GODR.
- **Orsak:** `tryPrepareZ01` (F39) tog den senaste CIR:en för anläggningen, alltså webbens egen onboarding-post, och skickade den genom Z01-dispatchen:
  - `request_type='website_customer_onboarding'`, `target_party_type='customer'`, kategorierna `grid_area_code` och `grid_owner`.
  - `requestNeedsGridOwnerAuthorization` gav `false`, så ingen nätägarfullmakt löstes ut.
  - Dispatchen skapade ändå en GODR, utan `authorization_document_id`.
  - Bindningskontrollen avvisade den, och nästa försök låstes av den obundna GODR:en.
- **Rättning:** när ingen GODR finns och CIR:en inte är en Z01-begäran till nätägaren (`z01_customer_masterdata` riktad mot `grid_owner`) startar `tryPrepareZ01` det kanoniska jobbet `request_customer_data`. Det jobbet kontrollerar anläggningen, löser nätägaren, skapar en Z01-CIR med nätägarfullmakt och skickar den.
- **Uppföljning (körning 17:21):** den första versionen skickade inte med mätpunkten. Z01-begäran fick ingen mätpunkt, och fullmakten är bunden till mätpunkten. Den matchade därför inte: "Fullmakt/avtal måste täcka nätägarens anläggnings- och kunduppgifter". Nu följer anläggningens mätpunkt med till jobbet.
- **Test:** `__tests__/customer-process-z01-dispatch-without-godr.test.ts`, 6 gröna. Utan rättningen fallerar det nya fallet, och testet kontrollerar att mätpunkten följer med.
- **Regressioner:** next-step-regressionen och 25 relaterade tester gröna.

### F48 En UTILTS-route från Ediels register kan aldrig materialiseras för ett bolag — ÖPPEN, medel
- **Utfall:** `Materialisera production-route` ger `ediel_route_profile_insert_failed` för UTILTS. PRODAT/Z01 materialiseras efter F41. Felet fanns också före F41.
- **Orsak:** registrets UTILTS-route har ingen meddelandekod (`defaultMessageCode('UTILTS')` ger `null`). UTILTS-policyn (`getUtiltsApplicationReferenceTarget`) kräver en kod och kastar `utilts_application_reference_message_unsupported:missing`. Även en giltig UTILTS-referens hos avsändaren (`23-DDQ-E66-S`, SC-059) hjälper bara när routen bär en kod.
- **Följd:** bolaget får ingen operativ UTILTS-route till nätägaren. Det påverkar inte PRODAT-bytet. Det påverkar utgående UTILTS (till exempel ERR och S07) och route-beredskapen för UTILTS.
- **Förslag:** materialisera UTILTS per meddelande som leverantören faktiskt sänder (enligt `assertCanonicalSupplierUtiltsOutboundAllowed`), eller låt en familje-route bära referensen för den mottagna huvudprofilen (E66). Det kräver ett beslut om vilka UTILTS-meddelanden ett elhandelsbolag ska sända i produktion.

### F45 Webbplatsens avtal får aldrig `signed_version`, så Z03 kan inte förberedas för en webbkund — RÄTTAD framåt (ägarbeslut), hög
- **Rättning:** migrationen `20261020200000_website_contract_signed_version.sql` ändrar kroppen i båda överlagringarna av `gridex_finalize_website_contract_signature`. Kroppen ändras på plats, oid behålls, och raden måste förekomma exakt en gång. Samma uppdatering som signerar sätter nu `signed_version=coalesce(terms_version,contract_version,'v1')` och `terms_signed_version`, som token-signering och admin-import redan gör.
- **Ingen bakåtfyllnad:** `signed_version` är oföränderligt efter signering (`customer_contracts_lock_signed`, `signed_customer_contract_immutable`). Att skriva om redan signerade avtal skulle kräva att en skyddad spärr försvagas, och det görs inte. Det enda signerade avtalet i drift får signeras om, eller hanteras av ägaren.
- **Bevis:** verklighetsscenario A, steg A2, kräver att varje webbavtal får `signed_version` lika med avtalets `terms_version`.
- **Var:**
  - `gridex_finalize_website_contract_signature` (`schema.sql` cirka 73369–73389) sätter status, `signed_at`, `signature_snapshot` och dess sha256, men inte `signed_version`.
  - `gridex_create_website_customer_contract` sätter den inte heller.
  - Bara admin-importen och signering med token sätter den.
- **Följd:**
  - Avtalsintaget (`scope_v1`) avvisar med `contract_intake_actual_signed_contract_tuple_required`.
  - Mätmetodskällan (`contract_request_basis_v1`) ger `held: current_signed_new_customer_agreement`.
  - Z03 kastar `prodat_new_agreement_requested_method_held`.
- **Drift (read-only):** 1 av 1 signerade avtal saknar `signed_version`.
- **Ägare:** native/SQL (GEN). Rättningen kräver en migration som sätter `signed_version` (avtalets `contract_version`) när webbsignaturen slutförs, plus bakåtfyllnad av signerade avtal.

### F46 Varje nytt avtal och varje nätägare kräver en granskad källa med extern utfärdarsignatur, som ingen väg i appen kan skapa — RÄTTAD (ägarbeslut: automatiskt), kritisk
- **Nätregistret, rättat:** migrationen `20261020210000_ediel_network_registry_platform_actor_source.sql`.
  - Om bolaget saknar granskad källa för nätägaren ger `network_for_company_v1` underlag från nätägaren som Gridex-personal verifierat i Ediels aktörsregister. Kraven: aktiv, `verified`, aktiv roll `grid_owner` och ett verifierat, gällande Ediel-ID.
  - En granskad källa avgör fortfarande när den finns.
  - Probe: 16700 ger `authorized`, en okänd nätägare ger `held`.
  - Nativetest `ediel-network-registry-source-native` och SQL-regressioner för nätregister, avtalsintag, Z04C och Z05C är gröna.
- **Mätmetoden, tidigare status (före rättningen, bevarad):** återstod: Z03-bindningen (`switch_contract_request_bindings.declaration_id`) har en FK till en verklig deklarationsrad. Lagringsspärren kräver också avtalets PDF-original med hash lika med `customer_contracts.document_sha256`. En automatisk deklaration måste därför skapas på servern från det arkiverade signerade avtalet, med metoden härledd ur den signerade prismodellen: `price_snapshot.interval_resolution='quarterly'` ger F (begär kvartsmätning), annars G (nätägaren avgör).
- **Mätmetoden, rättad:** migrationen `20261020220000_ediel_contract_requested_method_from_signed_agreement.sql` och `lib/operations/switchRequestedMethodPreparation.ts`.
  - **Före Z03:** i båda byte-vägarna (`edielAutomation`, `startSupplierSwitch`), alltså utanför den godkända renderingsvägen AT-Z03L, härleds deklarationen från det arkiverade signerade avtalet. Bytes laddas ner från Storage och sha256 måste vara lika med `document_sha256` på ett verifierat `signed_contract_pdf`.
  - **Metoden:** tas ur den signerade prismodellen. `price_snapshot.interval_resolution='quarterly'` ger F, metod Z04 (begär kvartsmätning). Annars G, metod Z03 (nätägaren avgör). Värdena kommer från `canonical_tuple_projection_v1`.
  - **Samma villkor som en granskad deklaration:** mätpunkt, nätägare, nätregister och avsändare kontrolleras på samma sätt. Mätpunkten måste vara en GS1-identitet med giltig kontrollsiffra (byrå 9). Avtal som har eller har haft en egen deklaration lämnas orörda. Raden uppfyller lagrings- och FK-kraven med verkliga originalbytes.
  - **Tester:** `__tests__/ediel-contract-requested-method-source.test.ts` är grönt, och 175 tester i bytesflödet är gröna, inklusive AT-Z03L/LK och AT-P-06.
- **Fakta:** Z03 för en ny kund kräver tre saker:
  - en mätmetodsdeklaration per avtal (`gridex_metering_method_changes.contract_request_declarations`);
  - en nätregisterkälla per bolag och nätägare (`network_for_company_v1`);
  - för BRP, före F44, en deklaration per avtal.
- **Hur källorna godkänns:** båda skapas bara via uppladdning och granskning av en annan person (fyra ögon). Godkännandet kräver också ett utfärdarkvitto: en HMAC med en `issuer_keys`-nyckel och en `representations`-rad, med `purpose='signed_contract_requested_metering_method'` respektive `format='ediel_network_registry_receipt_v1'`.
- **Saknad väg:** ingen kod i appen skapar `issuer_keys` eller `representations`, bara testfixturer. Migrationerna säger själva "No issuer, representation, registry version, approval or grant is seeded".
- **Värdet saknas också:** mätmetoden (`requestedMethod` F eller G) kommer från utfärdarens signerade paket, inte från avtalet.
- **Drift (read-only):** 0 utfärdarnycklar (avtal och nätregister), 0 mätmetodsdeklarationer, 0 nätregisterkällor, 0 skickade Z03.
- **Följd:** inget leverantörsbyte för en ny kund kan skickas i produktion. Felet syns inte heller som en operatörsuppgift. Z03-felet blir ett vanligt jobbfel (`customer_operation_failed`, `operation.failed`) efter omförsöken, inte en `needs_review`-blockerare (`automation.part-3.ts:474-553`).
- **Beslut som krävs:** vem som är utfärdare. Alternativen:
  - ett extern intag ansluts, med nycklar och representationer;
  - bolagets egna uppgifter blir källa, så som BRP blev i F44. Mätmetoden ur avtalets prisprodukt (kvartspris ger kvartsmätning) och nätägaren ur den verifierade registeraktören.

### F47 Replayen saknar `companies.white_label_platform_id`: go-live-sidan kraschar i replayen — PARITET (inte drift)
- **Drift:** kolumnen finns (uuid, FK till `white_label_platforms`, index), och den finns i `schema.sql`.
- **Replay:** den kanoniska replayen skapar varken kolumnen eller `white_label_platforms`. `getActorTestingSummary` ger 42703 för varje bolag, och `/admin/platform/go-live/<bolag>` kan inte visas lokalt. BRP-steget syntes därför inte i första körningen.
- **I simuleringen:** paritetsshim `ensureProductionWhiteLabelColumnParity` speglar kolumnen och indexet, på samma sätt som F24 och F28.
- **Ägare:** replay/GEN.

### F44 Ingen ny kund kan få ett leverantörsbyte (Z03): BRP (fält 262) har ingen användbar källa — RÄTTAD (ägarbeslut: automatiskt), hög
- **Fakta i drift:** 0 registerunderlag (`gridex_brp_changes.registry_grounds`), 0 BRP-deklarationer per avtal och 0 utgående Z03. Bolagets BRP (Bixia AB 48800, rollen BalanceResponsible i Ediels register) finns i `ediel_brp_settings` men används inte av något meddelande.
- **Orsak:** för en första leverans godtogs fält 262 bara från en signerad deklaration per avtal. Deklarationen kräver ett registerunderlag per nätägare och nätområde, och det kan ingen väg i appen skapa. Onboarding hade inget BRP-steg. BRP fanns bara som fritext på bolagskortet, utan någon länk dit från go-live, och onboardinglistan räknade även test-BRP.
- **Rättning:**
  - **Onboardingsteg:** `/admin/platform/go-live/[companyId]#brp` (`lib/ediel/tenantBrp.ts`, `brp-actions.ts`). Superadmin väljer BRP ur Ediels aktörsregister: en aktiv aktör med rollen `balance_responsible` och ett entydigt, verifierat Ediel-ID. Aktören verifieras med registrets eget kommando. Varje ändring blir en ny daterad version; den föregående stängs med `valid_to`, och historiken skrivs inte om. Ändringen auditeras.
  - **Migration `20261020190000_ediel_tenant_brp_agreement_source.sql`:** saknar avtalet egen deklaration tar Z03 den BRP-version som gäller på startdatumet. Den kontrolleras mot registret, med mätpunkt och parter från avtalets granskade mätmetodskälla och samma nätregister- och avsändarkontroll som deklarationsvägen. Ett avtal som har eller har haft en egen deklaration behåller den vägen. Bindningen per Z03 godtar källtypen `tenant_brp_agreement`, och vid sändning kontrolleras att versionen är oförändrad.
  - **`companyReadiness`:** BRP-steget kräver en aktiv produktions-BRP, samma regel som SQL-avstämningen.
- **Test:** `__tests__/tenant-brp-onboarding-z03-source.test.ts`, 9 gröna. Testet hittade och fick rättat att en Ediel-ID-dubblett hos en annan roll inte upptäcktes.
- **Regressioner:** BRP SQL 19, 204, 297 och 39 kontroller gröna. AT-Z03L/LK, Z09F/G, signerat BRP-intag och registerkompatibilitet: 110 gröna. Kroppskontrollen i nativetestet (`brpBytesGate`) bevaras, eftersom kroppen ändras på plats och oid behålls.
- **Kvar för GEN:** checksummanifestet (`check-migration-versions`) samt `schema.sql` och typer. `scripts/ediel-brp-field-source-embedded-check.mjs` fallerar redan i sin egen fixtur (`site_id already exists`), före någon BRP-kod.

### F43 Ett tillfälligt fel från databaslagret ger webbplatsen 500 "försök inte igen" — RÄTTAD, medel
- **Rättning:** `lib/supabase/transientErrors.ts` (`isTransientSupabaseError`) känner igen transportfel (`fetch failed`, `UND_ERR_*`, gateway 502/503/504, Postgres 08xxx/57P01/57P03/53300, PGRST000–003). Valideringsfel, affärsfel, behörighetsfel och `57014` statement timeout räknas aldrig som tillfälliga. Följderna:
  - `customer-applications` svarar `503` med `stage: dependency_unavailable`, `retryable: true` och `Retry-After: 2`.
  - `classifyPublicContractsError` ger 503, och `public-contracts` sätter `retryable: true` och `Retry-After`.
  - Okända fel förblir `500` med `retryable: false`.
- **Test:** `__tests__/website-api-transient-upstream-errors.test.ts`, 16 gröna. Utan rättningen fallerar 8.
- **Regressioner:** API-paritet, felregister och hardening är gröna.
- **Utfall:** i 2 körningar av 2 fick 1 av 6 checkouter `500 website_application_failed` med `stage: internal_error` och `retryable: false`.
- **Orsak:** en enda `canonical_tenant_operation_decision` fick 502 (`Connection reset by peer` mellan gateway och PostgREST, utan någon last). Appen loggade `An invalid response was received from the upstream server`.
- **Varför det är fel:** felet är tillfälligt, och ett omförsök med samma Idempotency-Key är bevisat säkert (C2: samma ansökan, 1 rad). Webbplatsen får ändå beskedet att inte försöka igen, så kunden tappas.
- **Förslag:** klassa transportfel (`fetch failed`, `UND_ERR_SOCKET`, 502, 503 och 504 från databaslagret) som `503` med `retryable: true` och `Retry-After`. Skriv i API-dokumentationen att webbplatsen ska göra om anropet med samma nyckel.

### P3 Avtalslistan räknar om bolagets hela beredskap vid varje anrop: 32 databasanrop — ÖPPEN, prestanda
- **Mätt:** ett `GET /api/v1/website/public-contracts` gav 32 anrop till PostgREST.
- **Var anropen hamnar:** `loadExternalTenantContext` → `loadTenantWebsiteFlowReadiness` utvärderar per anrop bolag, beredskapsvy, automationskontroller (e-postmallar, regler, avsändare, brevlåda, nätägarkontakter, runtime-kontrakt), webhooks och 6 separata `canonical_tenant_operation_decision`. Dessutom läses `companies` 3 gånger.
- **Följd:** listan som webbplatsen visar för varje besökare kostar lika mycket som en admin-kontroll. Under last multipliceras det (P6).
- **Förslag:**
  1. Ett batch-anrop för alla operationsbeslut (6 till 1).
  2. Läs bolaget en gång per anrop.
  3. Skilj de kapabiliteter som visas (kan cachas per bolag i 30–60 s och ogiltigförklaras vid admin-ändring) från spärrbeslutet (live, ett enda anrop). Behörighetsbeslut cachas aldrig mellan anrop.

### P4 En webbplats-checkout kostar cirka 181 databasanrop — ÖPPEN, prestanda
- **Mätt:** 5 anrop (avtalslista, adress, offert, juridiskt paket, ansökan) gav 181 anrop till PostgREST. Ansökan har p50 cirka 0,8 s och p95 0,9–1,6 s. Övriga steg ligger på 100–330 ms.
- **De mest upprepade anropen:**
  - `companies` 12 gånger
  - `canonical_tenant_operation_decision` 12 gånger
  - `legal_bundle_versions` och `legal_bundle_version_documents` 6 gånger vardera
  - `PATCH event_outbox` 6 gånger
  - autentisering, `PATCH integration_api_clients` och `integration_api_requests` 5 gånger vardera
- **Förslag:**
  - Memorisera per anrop bolag, operationsbeslut och juridiskt paket, så att varje sak läses en gång.
  - Samla eventen i outboxen till en skrivning per transaktion.
  - Målet är under 60 anrop per checkout och under 400 ms p95 för ansökan.

### P5 Varje API-anrop skriver samma rad (`integration_api_clients.last_used_at`) — ÖPPEN, prestanda
- **Var:** `lib/integrations/apiAuth.ts:410` gör en UPDATE på klientraden efter varje autentiserat anrop, utan att vänta på svaret. Varje 429 skriver dessutom `rate_limited_until` på samma rad (`apiAuth.ts:255`).
- **Följd:** under en burst köar alla anrop från en webbplats på samma radlås, och varje anrop kostar en extra HTTP-anslutning till databaslagret.
- **Förslag:** skriv `last_used_at` högst en gång per minut och klient, med ett villkor (`last_used_at < now()-60s`) och ett minne i processen.

### P6 En burst på 150 anrop ger 95 × 503 i stället för 429 — ÖPPEN, robusthet
- **Mätt:** 150 samtidiga anrop mot avtalslistan med en nyckel som har gränsen 120/min gav 42 × 200, 11 × 429, 95 × `503 PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE` och 2 × 500.
- **Orsak:** 150 × 32 är cirka 4 800 interna anrop. Kong slår i `512 worker_connections` och PostgREST-poolen har 10 anslutningar, så anslutningar stängs (`other side closed`).
- **I drift:** gränserna är högre, men grundorsaken är densamma, nämligen antalet anrop per förfrågan (P3–P5).
- **Förslag:**
  - Minska antalet anrop per förfrågan.
  - Kontrollera rate limit innan det dyra arbetet. I dag görs autentisering och loggning av förfrågan först, och sedan räknas hela beredskapen.
- **Rate limitern fungerar:** de förfrågningar som nådde den fick 429 med `Retry-After`.

### G1 En ny miljö saknar nätområden tills SVK-importen har körts, och go-live-grinden kontrollerar inte det — ÖPPEN, drift
- **Utfall:** i en nybyggd miljö gav adressteget `price_area: null` (`postal_suggested`), och alla checkouter stannade.
- **Varför det inte syns:** go-live svarade ändå `launchReady`.
- **Importen själv fungerar:** plattformens cron (`/api/internal/platform/grid-areas/import/cron`) hämtade 280 nätområden från SVK på 2 anrop (cirka 5 s).
- **Förslag:** go-live-grinden bör kräva en verifierad geodataversion (`energy_geodata_versions.status='verified'`) och färska spotpriser. En miljö kan inte sälja utan dem.
- **Simuleringen:** `prepareMarketData()` gör detta via plattformens egna cron-jobb.

### C-kostnader per cron-körning (scenario A, 11 körningar, 3 bolag)

| Cron | p50 | max |
|---|---|---|
| `customer-operations` | 2,1 s | 5,8 s |
| `inbound-mail` | 0,55 s | 7,9 s |
| `email/outbox` | 22 ms | 1,4 s |
| `tenant-provisioning` | 82 ms | 0,9 s |
| övriga | under 0,5 s | |

- `customer-operations` växer med antalet bolag (S1). `inbound-mail` nådde nästan 8 s med en enda brevlåda.
- **Förslag:** mät stegtider i cron-svaret (`customer-operations` saknar `timings`), dela upp svepen per bolag med en markör (S1) och sätt larm på p95 över 50 % av funktionens tidsgräns.

### Verifierat korrekt i körningen (inte fel)
- **Idempotens:** samma ansökan skickad igen med samma nyckel ger samma ansökningsnummer och 1 rad (C2).
- **Bolagsisolering:** ett annat elbolags API-nyckel får 404 `application_not_found` på en ansökan, utan bolagsdata i svaret (C3).
- **Tredjepartsavbrott:** spot som hänger, svarar 500 eller 429, papapi som hänger eller ger trasig JSON, och Lantmäteriet som hänger ger alla en lyckad checkout på 1,1–1,9 s. Ingen förfrågan hängde (C5).
- **Inget fastnat:** stuck-detektorn hittade inget med kategorin `stuck`. 8 jobb ligger korrekt som `needs_operator` (`needs_review`).

### Korrekta spärrar som simuleringen bekräftade (inte fel)
Go-live kräver:
- standardmejl och regler för kunder
- verifierad operationsbrevlåda
- en fakturaavgift som kanonisk komponent

Kontakt till nätägaren:
- verifieras bara av plattformsadmin
- får inte vara Ediel-gatewayens adress

Adress och identitet:
- en nätområdeskod räknas bara som påstående tills adressen korsvaliderats
- `pre_auth_required` kräver kundens verifierade Mina sidor-identitet

### O1 Misslyckade utkorgsposter försöks inte igen automatiskt — avsiktligt
`claim_ediel_outbox_items` hämtar bara `prepared` och `queued`. En post som fallerat före SMTP, till exempel för att arkivlagringen var nere, blir `failed` och kräver att en operatör köar om den. Det stämmer med TR-10 (fail-closed), men ett känt-ej-skickat fel skulle kunna köas om automatiskt. Det noteras som driftobservation.

## Jämförelse med Codex fynd (2026-10-22)

Codex har ingen egen verklighetssimulering i repot. Deras fynd kommer från kontrollerade drifttester (#766), granskningar av mejlkedjan (#840) och rättnings-PR:er. Fynd som rör min simulering:

| Codex fynd | Hos mig | Läge |
|---|---|---|
| Försöken för inkorgsjobb räknades två gånger, så bara 4 av 5 kördes (PR #853) | F22 | Samma orsak och rättning. Min beskrivning var fel och är nu rättad under F22. |
| F57-migrationen tål inte att köras två gånger | F57 | Bekräftat och rättat (se F57). |
| PERF006: avslut av mejl- och jobblås saknar ägarkontroll (`edielMailboxPoller.part-1.ts:960-996`), så en gammal worker kan avsluta en nyare workers lås | saknades | Bekräftat i koden. Codex rättning väntar på filägarskap. **Ägs av Codex.** Följs upp på #840. |
| PERF005: spot-importen tappar Retry-After vid femte försöket, och claim-SQL kör ett misslyckat jobb för tidigt (PR #870) | saknades (mitt C5 såg bara att kassan överlever 429) | **Ägs av Codex** (PR #870). |
| Katalog och offert: korta databasfel ger 503 (PR #876) | F43 | Samma. Codex återanvänder min rättning. |
| 4 offerter fick 504 med 57014 vid bara 4 samtidiga anrop i drift | P6 (bara lokalt) | **Ny driftdata.** Kontrollera vad offert-API:t svarar för 57014: F43 behandlar det som icke-transient. |
| `startSupplierSwitch` reserverar dedupe-nyckeln före förberedelsen, så ett nytt försök svarar "redan köat" utan någon rad i utkorgen | saknades | **Ägs av Codex.** |
| Delad kö markerar originalet som `queued` före utkorgsinserten | saknades (närliggande O1/F20) | **Ägs av Codex.** |
| Två samtidiga avsikter om normalt leverantörsbyte: förloraren skriver över vinnaren (PR #899) | saknades | **Ägs av Codex** (PR #899). |
| Manuell brevlåda sätter `received_at` till behandlingstid i stället för IMAP INTERNALDATE (PR #900) | saknades (min simulering använder inte den manuella fullmaktsmejlvägen för relativa datum) | **Ägs av Codex** (PR #900). |
| `/customer/sync` kunde spara portalkopplingen före assertion-kontrollen | saknades | Redan rättat i den delade koden (`externalApi.ts:264-275`). |

Det som bara min simulering täcker: start från noll, go-live för en ny tenant, nätägarsimulatorn på riktig Ediel-tråd, routing till rätt tenant (F68, F69, F78), manuellt kundintag (D), fakturor (F) och åtkomst till mätvärden (F79). Det som ingen av oss har kört live: avflytt, ånger/Z08 och avvisningsvägar för APERAK/CONTRL i en hel kedja. De står kvar som nästa scenarier.

## Tidsgränser i verkligheten (kontrollerat 2026-10-15, bara läsfrågor)

| Inställning | Lokal replay | gridex-ops-dev (drift) | gridex-ops-staging |
|---|---|---|---|
| `authenticator` statement_timeout / lock_timeout | 8 s / 8 s | 8 s / 8 s | 8 s / 8 s |
| `authenticated` / `anon` | 8 s / 3 s | 8 s / 3 s | 8 s / 3 s |
| `service_role` egen inställning | ingen | ingen | ingen |
| `deadlock_timeout` | 1 s | 1 s | – |
| `max_connections` | 100 | 60 | – |

Appen går via PostgREST som `authenticator` och växlar till `service_role`. Tidsgränserna i testet är alltså desamma som i drift. Drift har färre anslutningar, vilket gör parallell belastning tuffare, inte lättare.

## Det som fallerar på grund av lång tid, tidsgräns eller som fastnar

Gränser i drift: 8 s per SQL-sats, 8 s låsväntan, Vercel-funktion ~300 s, cron var 5:e minut. Tabellen samlar allt som kan nå en gräns eller bli liggande.

| # | Vad | Varför det fallerar eller är segt | Mätt | Status |
|---|---|---|---|---|
| T1 | CONTRL-skapande per bolag (F10) | kvadratisk kostnad: CONTRL × källor | 4→12 s per fil, tidsgräns från fil 11 | RÄTTAD |
| T2 | ACK-läsning per bolag (F10b) | linjär i bolagets ACK-historik | 240 ms vid 10k, 8 s vid ~100k | RÄTTAD |
| T3 | CONTRL-kontrollen globalt (F19) | läser alla inkommande meddelanden på plattformen | 2,5 s vid 3,3k, 8 s vid ~12k totalt | RÄTTAD |
| T4 | Inkorgs-cron (F12) | 25 mejl tog 177–404 s före F10 | 70 s efter | AVHJÄLPT |
| T5 | Deadlocks (F11) | radlås före tabellås | 22–24 per körning | RÄTTAD |
| T6 | Månadsfakturering (F18) | ett bolag eller en kvarlämnad körning stoppade alla | 500 för hela cronen | RÄTTAD |
| T7 | Inkorgsjobb (F21–F23) | senare jobb affärsbehandlades inte, oändlig återtagning, mejl utan jobb | – | RÄTTADE |
| T8 | Utkorg efter paus (F20) | blockerade poster köades aldrig om | – | RÄTTAD |
| T9 | Globala tabellås vid ACK-skapande | se L1 nedan | 153 s väntan observerad | ÖPPEN |
| T10 | `wire_namespace.reserve` | se P1 nedan | ~9 µs × alla utgående | ÖPPEN |
| T11 | Fast kostnad per ACK-läsning | ~0,4 s utan tillväxt, mest `read_business_original_v1` och guidekontroller | 0,36–0,45 s | OBSERVATION |
| T12 | Utkorgsposter i `blocked_tenant_state` | se B1 nedan | – | ÖPPEN, produktbeslut |

### L1 ACK-skapande tar globala tabellås över alla tenanter — ÖPPEN (arkitektur)
- **Varför fel:** ACK-skapandet tar `SHARE ROW EXCLUSIVE` på `ediel_messages` och `SHARE` på ~30 tabeller, för alla tenanter. En ACK-läsning hos ett bolag väntar alltså på varje pågående skrivtransaktion hos alla andra bolag, och tvärtom.
- **Bevis:** två gånger. Först 153 s väntan bakom en orelaterad skrivtransaktion. Sedan, 2026-10-16, väntade en ACK-läsning 10 min (`Lock/relation`, `pg_blocking_pids` = en insert-transaktion för andra tenanter). Med `lock_timeout` 8 s blir det fel i stället för väntan: `canceling statement due to lock timeout`.
- **Varför inte rättat:** låsen är del av ACK-designens serialiseringsbevis (en replik per original). Att byta till låsning per bolag eller per källa är en arkitekturändring som ägaren av ACK-auktoriteten måste godkänna. **Förslag:** `pg_advisory_xact_lock` per `(company_id, environment, källa)` i stället för tabellås, verifierat med samma ögonblicksjämförelse som F10.

### P1 `gridex_ediel_wire_namespace.reserve` hashar alla utgående meddelanden vid varje utgående skrivning — ÖPPEN
- **Varför segt:** triggern `ediel_wire_reference_namespace_before_write` (INSERT, och UPDATE av `raw_payload`, `company_id`, `environment` eller `direction`) går igenom alla utgående meddelanden i miljön, för alla tenanter, och räknar sha256 av varje `raw_payload` för att hitta äldre rader utan täckning. Mätt: ~9 µs per rad för små CONTRL, mer för stora PRODAT/UTILTS. Kostnaden är linjär i plattformens hela utgående historik och tas under advisory-lås. Gränsen på 8 s nås ungefär vid 900k små utgående meddelanden.
- **Varför inte rättat:** att hoppa över hashningen kräver ett bevis för att ingen äldre rad har ändrad payload utan trigger. **Förslag:** en lagrad genererad kolumn `payload_sha256` på `ediel_messages`, som inte kan förbigås ens i replikaläge, plus en engångsverifiering. Det är en schemaändring som kräver GEN-capture och beslut av ägaren.

### B1 `blocked_tenant_state` släpps aldrig när bolaget aktiveras igen — ÖPPEN, produktbeslut
- **Verifierat i kod:** bara `company_provisioning_jobs` släpps när bolaget aktiveras igen (`canonical_sync_provisioning_jobs_for_lifecycle`). `ediel_outbox`, `tenant_email_outbox`, `manual_email_outbox`, `webhook_deliveries` och `canonical_event_outbox` har ingen väg tillbaka från `blocked_tenant_state`, varken i SQL eller i appen.
- **Varför inte rättat automatiskt:** ett Ediel- eller kundmeddelande som skickas dagar senare kan vara skadligt (passerade tidsfrister, inaktuellt innehåll). Om posterna ska släppas, kasseras eller granskas är ett produktbeslut. Rekommendation: släpp poster yngre än en gräns och låt operatören hantera resten.

### S1 Svepet för affärsförväntningar växer linjärt med antalet bolag och stannar vid 201 — ÖPPEN (skala)
- **Var:** `sweepEdielBusinessExpectations` (`lib/ediel/operations/businessExpectationSweep.ts`), anropas i `/api/internal/customer-operations/cron` var 5:e minut.
- **Kostnad:** för varje bolag och båda miljöerna görs read och expire för två ägare plus en next-action-projektion, i följd. Det blir cirka 12 RPC-anrop per bolag.
- **Mätt i simuleringen:** 27 bolag gav 324 anrop per körning (`gridex_ediel_business_expectations_v1` och `gridex_ediel_metering_method_expectations_v1`).
- **Drift idag:** 3 bolag, cirka 36 anrop per körning.
- **Vid taket:** 200 bolag ger cirka 2 400 anrop i följd i en och samma cronkörning.
- **Hårt stopp:** vid 201 medlemskap kastar svepet `ediel_expectation_sweep_scope_limit`. Då körs inga förväntningstimrar alls för någon tenant, och felet syns bara i stegresultatet.
- **Förslag:** gör svepet sidindelat med en markör per körning i stället för att stoppa vid taket. Läs bara bolag och miljöer som har öppna förväntningar.

### Övriga stopp- och tidsrisker (verifierade i kod, inte ändrade)
- **Ediel-utkorgen `delivery_uncertain`:** en post som fastnat i `sending` blir `delivery_uncertain` och väntar på avstämning mot transporten. Det finns ingen åtgärd i gränssnittet för att köa om Ediel-poster (för e-post finns `requeueUncertainEmailAction`). Automatisk omsändning vore fel, eftersom ett dubbelt EDIFACT-meddelande kan ha effekt. Operatörsvägen saknas dock.
- **Utkorgen `blocked` på grund av beredskap (rutt, certifikat):** `createOutboxItem` köar om bara från `draft`, `prepared` och `failed`. En post som blockerats för att en rutt eller ett certifikat saknades blir kvar även när konfigurationen rättats. Observerat live. Om den ska köas om automatiskt efter ny beredskapskontroll är ett produktbeslut, med samma risk som B1.
- **Lagring:** ~67 kB per inkommande E66 med 2 880 värden i `raw_payload` plus bilaga och mejl. Det växer linjärt och påverkar inte längre ACK-vägen efter F19.
- **Manuell brevlåda:** försöksräknaren förloras om körningen dödas mitt i. Mejlet försöks då igen utan att räknas mot gränsen. Det är begränsat av att samma mejl dedupliceras, och inte ändrat.
- **Undanträngning:** pollern tar högst 25 mejl per brevlåda och körning. Mejl som alltid fallerar tar plats i varje omgång tills jobbgränsen (F22) avslutar dem. Efter F22 är det begränsat och inte längre oändligt.
- **EJ VERIFIERAT:** att sändstaketets reservation `prepared` aldrig löper ut. Det är ett påstående från en annan agent, och det är inte bekräftat här.

### Mätartefakt (inte ett fel)
`INSERT … SELECT (jsonb_populate_record(...)).*` räknar funktionen en gång per kolumn, ~150 gånger per rad. Det gav ~1 s per syntetisk rad i skalningsskripten. Med `LATERAL` försvinner det. Appen använder inte mönstret.

## Under utredning

### U1 Deadlocks när mejl behandlas parallellt — orsaken bekräftad, se F11 och F10

### U2 → F15 Databasfel rapporteras som "Okänt pollingfel/processfel/fel" — RÄTTAD
- **Bevis:** supabase-js 2.103 returnerar PostgREST- och RPC-fel som vanliga objekt (`instanceof Error === false`, verifierat 2 av 2 gånger). Pollerns `error instanceof Error ? error.message : 'Okänt …'` (part-2 422/479/695, part-3 130/154) ersatte därför varje databasorsak. Det gällde också jobbets `error_message`, som operatören ser.
- **Rättning:** befintliga `formatErrorMessage` (`lib/errors.ts`) används på de fem ställena. Test: `__tests__/inbound-poller-error-messages.test.ts`. 48 inkorgsfiler med 735 tester är gröna.
- **Varianter (ÖPPET, inte ändrat):** samma mönster finns på 121 ställen i `lib` och `app`. Det är bara fel där ett PostgREST-objekt kan nå koden via `throw error`. Det bör avgöras per ställe, till exempel med en lint-regel eller `formatErrorMessage`, och inte genom en blind massändring.

### F14 Hållna UTILTS beskrivs som "avvisades" — ÖPPEN (texten)
`lib/ediel/flows/utiltsDataRequest.part-2.ts` använder "Inbound UTILTS avvisades av produktionsruntime och korrekt kvittensflöde skapades." både för verkliga avvisningar och för filer som hålls i väntan på utfärdarunderlag (`internal_review`, ingen APERAK). För en hållen fil är texten vilseledande. Det som skiljer fallen åt är `validation_report.utiltsRuntime.validation.classification` och `ediel_ack_transaction_results.disposition`.

### O2 Hållna UTILTS släpps bara manuellt, per meddelande
- Inget jobb utvärderar hållna UTILTS på nytt när utfärdarunderlaget finns. Gridex-personal kör "Kör UTILTS engine / skapa TGT-svar" på `/admin/ediel/messages/[id]`, en sida bara för plattformsadmin. Åtgärden kräver `communication.write`, som bolagets admin har, men bolagets admin når inte sidan.
- "Processa om" på `/admin/inbound-mail/[id]` kör inte UTILTS-flödet. `EdielSafeApplyReviewPanel` ("Processa till mätvärde/underlag") används inte på någon sida.
- Inget befintligt test täcker kedjan hållen → underlag → omkörning. Live-testets B5 gör det.
- Krav på operatören, verifierat i live-körningen: sidan kräver plattformsadmin (`super_admin`). Åtgärden kräver att aktören är aktiv medlem i bolaget med `communication.write` (`require_business_read_actor_v1`), annars `42501 ediel_business_ack_current_actor_required` (6 av 6 klick). Plattformsbehörighet räcker alltså inte; operatören måste också vara medlem i elbolaget. Bolagets egen admin har behörigheten men når inte sidan.

## Avsiktliga spärrar och externa beroenden (inte fel)

- **E1 Utfärdarunderlag (EXT-ISSUER-01/EXT-ARCHIVE-02):** inga mätvärden blir fakturerbara förrän det externa underlaget finns. Det är en känd spärr (`external-evidence-requests-20260930.md`). I testet ersätts underlaget syntetiskt, uttryckligen märkt, på samma sätt som i projektets native-fixturer.
- **E2 Strukturunderlag:** månads- och dygns-E66 med register kräver godkänd PRODAT-struktur. Energivärden per timme eller kvart undantas.
- **E3 Bara Ediel-källor faktureras:** manuella värden och BRP-importer blir aldrig fakturaunderlag (billing-grinden).

## Skillnader mellan testmiljö och hostad miljö

- Den rena replayn saknar delar av behörighetskatalogen, till exempel `pricing.write`. Fixturen speglar `lib/rbac/catalog.ts` som referensrader, inte som tilldelningar.
- Den delade test-brevlådan finns som rad från migrationerna och konfigureras som plattformsadmin gör (lokal IMAPS/SMTPS).
- Den rena replayn saknar rollraden `super_admin` (drift: 56 behörigheter). Driftens plattformsadmins är `super_admin` i `user_roles` utan bolag. Fixturen speglar rollraden som referensdata och skapar operatören på samma sätt.
- Den lokala stacken körde först utan Storage. Arkivet `ediel-files` krävs före varje SMTP-sändning, så utan det blir sändningen `failed`/`name resolution failed` (Kong). Storage startades sedan med CLI:ns namn och nätverk.
- I sandlådan går utgående HTTPS via en TLS-inspekterande proxy med egen CA. När `NODE_EXTRA_CA_CERTS` bara pekade på GreenMails CA nådde appen inga externa tjänster, och SVK-importen gav `dependency_unavailable`. Lösningen är ett kombinerat CA-paket och `NODE_USE_ENV_PROXY=1`. Det är ingen produktfråga, eftersom Vercel har direkt internet.
- Produktionen (`gridex-ops-dev`, bara läsfrågor mot driftmetadata): 43 inkommande mejl totalt, inga EDIFACT-flöden. Därför kan F2–F5 varken bekräftas eller avfärdas där.

## Status för live-testets steg

| Steg | Status |
|---|---|
| B1 konfiguration och befintlig kund | grön |
| B2 nätägaren skickar 30 dygnsfiler (SMTPS) | grön |
| B3 mottagning, CONTRL till nätägaren | grön: 30 av 30 mottagna, 30 av 30 CONTRL levererade, 0 deadlocks (efter F2–F5, F9–F11) |
| B4 hålls utan fakturaeffekt utan utfärdarunderlag | grön |
| B5 underlag och operatörens omkörning (`/admin/ediel/messages/[id]`) | Operatörsvägen fungerar (plattformsadmin som är medlem). Varje omkörd fil ger 96 lagrade värden, blockerade med `supply_source_unqualified` eftersom kunden är migrerad (F17). Fullständig körning av alla 30 filer återstår: avbröts av omstart av containern. |
| B6 spotpris SE3, import och låsning | ej nådd i de senaste körningarna |
| B7–B8 faktura och oberoende kontroll | hoppas över tills leveransen vilar på Ediel (kedja A) |
