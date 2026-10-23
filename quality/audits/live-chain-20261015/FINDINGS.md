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

### F87 Ingen Z03 kunde renderas i produktion: fakturamottagaren (NAD+IV) hade ingen källa — RÄTTAD (commit `8d1476b5`), kritisk
- **Utfall (scenario F körning 7):**
  - Z03 passerade nu routen (F85) och kunddeklarationen (F51).
  - Renderingen stoppades med `PRODAT_DEPENDENT_CONDITION_UNDETERMINED`: "Z03:INVOICEE_GROUP, P26.A s.23/82/109 … oberoende valt underlag saknas".
- **Orsak:**
  - Villkoret för fakturamottagare godtar bara en oberoende vald, serverägd källa på bytet (`validation_snapshot.portalData.dependentConditionFacts.invoiceeObjects`). Ett sparat förhandsvärde räcker aldrig, vilket det godkända testet P-06 kräver.
  - Ingen produktväg skrev källan för ett vanligt byte. Bara makuleringen (`switchCancellationSource.ts:120`), hävningen och stängningen läser `readContractInvoicee`.
  - Spärren i routen (F85) dolde felet. Ingen Z03 hade tidigare kommit så långt.
- **Rättning:** förberedelsen före Z03 (`selectInvoiceeBeforeSwitch` i `lib/operations/switchInvoiceePreparation.ts`) väljer fakturamottagaren från det signerade avtalet på samma sätt som makuleringen. Den jämför med slutanvändarens masterdata per begärd startdag. Den blockerar aldrig.
- **Godkända tester:** 397 tester gröna, bland dem P-06, SC-001/002 och AT-Z03L/LK. Själva renderingsvägen är oförändrad.
- **Test:** `__tests__/switch-invoicee-preparation.test.ts`, 3/3.

### F88 Avtalsreferensen RFF+ANJ, som krävs för Z03, saknade skrivare — RÄTTAD (commit `8d1476b5`), kritisk
- **Utfall:** nästa lager efter F87. Kuvertets kontroll stoppade Z03 med "FIELD_MATRIX_REQUIRED_FIELD_MISSING: RFF+ANJ krävs för PRODAT Z03".
- **Orsak:** renderaren läser `powerOfAttorneyReference` bara från bytets sparade portaldata, och ingen skrev den för ett riktigt byte. Plattformens egen kontextbyggare (`lib/ediel/prodatContext.ts:291`) tar den från bytets bundna fullmakt.
- **Rättning:** samma förberedelse sätter referensen från den signerade fullmakt som är bunden till bytet. Bara samma tenant och kund godtas, och bara status `signed` eller `active`. En annan tenants fullmakt eller ett utkast godtas aldrig, och testet visar det.
- **Verifierat i världen:** den riktiga byggaren köade en produktions-Z03 med:
  - `DTM+92:202609010000`
  - `NAD+Z02+48800`
  - `RFF+ANJ:POA…`
  - `RFF+Z05:ALS`
  - `NAD+UD` med den deklarerade folkbokföringsadressen

  Det är första gången i hela simuleringen som en Z03 byggs.

### F86 En fortsatt Z03 hoppade över härledningen av mätmetod och kunddeklaration — RÄTTAD (commit `b138c2e14`), medel
- **Utfall (scenario F körning 4, på en ren replay med F85 och F51):** F85 är bekräftat rättat, och Z03-byggaren nådde inte längre någon route-spärr. Alla fyra anläggningar hölls i stället med `customer_masterdata_source_held:source_qualified_customer_identity_registered_address_at_requested_time`, och det fanns 0 deklarationer.
- **Orsak i testet:** F3 anropade byggaren direkt. Det gör automationen aldrig: den kör härledningen för F46/F51 (`deriveRequestedMethodBeforeSwitch`) precis före byggaren (`edielAutomation.ts:286`), och det gör även `startSupplierSwitch.ts:172`. Scenariot gör nu samma anrop och rapporterar deklarationerna.
- **Samma lucka i produkten:** operatörens åtgärd "fortsätt med Z03" (`continueSwitchEdielAutomation`, anropad från `app/admin/customers/[id]/switch-actions.ts:246`) byggde Z03 utan härledningen. Ett återupptaget byte kunde därför stå kvar som hållet på en deklaration som aldrig härletts, och ett adressbyte slog inte igenom.
- **Rättning:** den vägen härleder nu källorna före Z03. Z05 och Z09 påverkas inte. Test: `__tests__/switch-z03-source-derivation.test.ts`, 2/2. Det faller utan rättelsen.

### T1 `up.sh` rapporterade en klar värld trots att bygget föll — RÄTTAD (commit `aed922d5`), verklighetsvärlden
- **Utfall:** typkontrollen i `next build` fick slut på minne (standardgränsen 2 GB; kodbasen har vuxit). Ändå skrev `up.sh` "ready". Appen startade utan bygge, och scenario D föll på "connection refused".
- **Rättning:** bygget körs med 8 GB heap. `up.sh` avbryter om `.next/BUILD_ID` saknas eller om appen inte svarar på inloggningssidan.
- **Notering:** `npx tsc --noEmit` behöver också `--max-old-space-size=8192` i den här miljön.

### F85 Ingen ny elhandlare kan skicka Z03 i produktion: registret materialiserar bara PRODAT Z01 — RÄTTAD i koden (commit `8a02dbb5`), kritisk, verifieras i scenario F efter ombyggnad
- **Utfall (scenario F körning 3):** den riktiga Z03-byggaren vägrade i produktion med `production_route_profile_not_ready`. Blockerarna var `receiver_ediel_id_missing`, `production_send_locked`, `receiver_certificate_missing`, `security_policy_not_approved` och `missing_receiver_subaddress`. Ingen Z03 har byggts i någon körning av verklighetssimuleringen, varken i scenario A eller F.
- **Orsak (bekräftad i koden):**
  - Route-motorn kopplar Z03 till `route_scope='supplier_switch'` (`routeDecisionEngine.ts:482`). Den letar först efter nätägarens route (188-191) och faller annars tillbaka på en route utan nätägare (192).
  - Registermodellen, som enligt F41 är den enda produktionsmodellen, materialiserar varje PRODAT-registerroute bara som Z01 → `customer_masterdata`:
    - registerimporten (`20261001040159…:147`) sätter ingen `message_code`;
    - vyn `gridex_company_route_readiness_v` faller tillbaka på Z01;
    - `route-readiness/actions.ts:22` och `routeMaterializer.ts:127-131, 218` gör likadant.
  - Z03 hamnar därför på go-live-guidens route utan nätägare. Den routen saknar fast mottagare, sändlås och adressbekräftelse och kan aldrig godkännas för produktion (`routeProfileProductionReadiness.ts:133-135, 228-230, 314-347`, samma som "Krock 2" i F41).
- **Inte simuleringen:** go-live-guiden, materialiseringen och godkännandet kördes alla. Att lägga in registerdata med `message_code='Z03'` vore att hitta på uppgifter som Ediels register aldrig innehåller.
- **Rättning (pågår):** en framåtriktad migration låter varje aktiv PRODAT-registerroute ge en rad per utgående scope (Z01 och Z03, och fler om elhandlaren skickar dem till nätägaren). Materialiseraren skapar då nätägarens `supplier_switch`-route med fast mottagare och samma adressbekräftelse som Z01. Motorns scopefilter ändras inte.
- **Öppen fråga till ägaren:** ska go-live-guidens dynamiska produktionsprofiler finnas kvar, när de aldrig kan godkännas?
- **Rättning levererad (commit `8a02dbb5`):**
  - Migration `20261022120000`: en PRODAT-registerroute utan `message_code` ger både en Z01-rad (`customer_masterdata`) och en Z03-rad (`supplier_switch`) i readiness-vyn. Vyns kolumner, `security_invoker` och behörigheter är oförändrade. Profilernas unika index omfattar nu `message_code`.
  - Z08 åker på Z01-routen och Z09 på Z03-routen, eftersom motorn väljer route per scope. Att materialisera dem separat skulle ge en tvetydig route. Z13/Z18 är ESCO-meddelanden och ingår inte.
  - Massåtgärden skickar aldrig Z03 till den hashlåsta SQL-funktionen (`gridex_materialize_company_operational_routes`), eftersom den annars pekar om fastnade Z01-begäranden till Z03-routen och skriver över deras `message_code`. Ett test återskapar det felet.
  - Test: `__tests__/registry-route-supplier-switch.test.ts`, 15/15, varav 11 faller utan migrationen. 113 tester i 14 närliggande sviter är gröna. Typkontroll och lint är rena.
- **Nya fynd under rättningen (öppna):**
  - **Den hashlåsta SQL-funktionen** pekar på samma sätt om fastnade Z01-begäranden när den kör UTILTS-rader. En rättning kräver ägarbeslut, eftersom funktionens hash är låst av audit19-kontraktet i `20261019180400`.
  - **Registermaterialiserade profiler saknar transportläge och brevlåda**, så motorn rapporterar `missing_production_transport` i produktion. Gäller även Z01. Verifieras i scenario F.
  - **Registerverifieringen sätter `auto_send_allowed=false`**, och materialiseraren hoppar över sådana routes. Verifieras i scenario F.
  - **Ingen bakåtfyllnad:** befintliga tenants får Z03-routen först när en operatör materialiserar den.

### F81 Kundens önskade startdatum från webben når aldrig leverantörsbytet — RÄTTAD i koden, hög, verifieras i scenario F efter ombyggnad
- **Kod:** webbansökan sparar `contract.requested_start_date`. Bytet skapas av nästa-steg-motorn via `ensureSupplierSwitchRequestForReadySite` (`lib/customer-operations/customerProcessNextStepEngine.ts:273-283`) utan `requestedStartDate` och utan kontext. Funktionen tar då startdatumet bara från ett inflyttningsdatum (`supplierSwitchOrchestration.ts:374`). Kontextläsaren (`customerSiteProcessContext.ts:282`) läser avtalets datum, men den vägen används inte här.
- **Påverkan:** ett vanligt byte får tidigast möjliga datum (idag + 14 dagar) i stället för kundens val. Om kunden valt ett senare datum, till exempel när bindningstiden hos nuvarande leverantör går ut, startar bytet för tidigt, och kunden kan få brytavgift hos den förra leverantören. Avtalet och bytet får också olika startdatum.
- **Verifiering:** scenario F2 registrerar kundens valda datum och det datum plattformen valde, per anläggning.
- **Rättning:** nästa-steg-motorn läser det signerade avtalets önskade start (`isContractOperationallyReadyForSite`) och skickar den till bytesskapandet. Ett datum som är tidigare än marknadens framförhållning lyfts fortfarande till tidigast giltiga dag av skaparen. Test: `__tests__/supplier-switch-requested-start.test.ts`, som faller utan rättelsen. 56 tester i de närliggande sviterna är gröna. Den första körningen av scenario F gick på bygget från före rättelsen, så den visar fortfarande felet.

### F82 Prisberäkningen använder avtalets önskade start före den faktiska — KANDIDAT, medel
- **Kod:** `lib/pricing/engine.ts:262-264` tar `starts_at` före `actual_start_at`. När marknadsstarten skiljer sig från det signerade önskade datumet kan förstagångs- och årsdagsavgifter beräknas från fel datum. Bekräftas eller avfärdas i scenario F.

### F83 Avtals-PDF:en skriver det önskade startdatumet, inte det som nätägaren bekräftat — KANDIDAT, låg
- **Kod:** PDF:en visar "Önskat startdatum" från den signerade begäran (`lib/customer-contracts/agreementPdf.ts`). Det bekräftade startdatumet syns inte. Hör ihop med F73. Bekräftas i scenario F.

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

### F80 Ett meddelande med spärrade transaktioner kan låsas ute från ombearbetning — RÄTTAD och verifierad, hög
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
- **Rättning:**
  - **Regeln:** `lib/ediel/utilts/utiltsResumability.ts` avgör om ombearbetning är tillåten. Det är den när minst en transaktion är `internal_review` utan slutsvar, eller när källan aldrig besvarats.
    - CONTRL och svar på andra transaktioner blockerar inte.
    - Makulerade och misslyckade svar räknas inte.
    - En transaktion som redan har ett eget svar blir manuell granskning.
    - För avvisade transaktioner säger sidan att nätägaren måste skicka en ny, korrigerad fil, och visar ingen knapp.
  - **Samma regel överallt:** detaljsidan, listan och serveråtgärden använder regeln, och serveråtgärden kontrollerar den på nytt efter behörighetskontrollen.
  - **Varje försök loggas** med vem, när, vilka transaktioner som var spärrade före och vilka som återupptogs eller fortfarande hålls.
  - **Samtidiga och upprepade försök** stoppas av de befintliga dubblettskydden och ger "redan bearbetad" i stället för ett serverfel. Ett avvikande slutsvar behålls oförändrat och markeras för manuell granskning.
  - **Revisionsspår:** `validation_report.utiltsRuntimeHistory` bevarar varje tidigare körning.
  - **Händelsetexten** för ett spärrat meddelande säger nu att transaktionerna hålls för intern granskning.
  - **Tester:** 24 nya (`__tests__/utilts-held-source-resumability*.test.ts`) och 521 gröna i 24 berörda sviter. Testerna visar bland annat att issuer-grunden läses om exakt för källan, att originalet är oförändrat och att resultatet blir ett positivt APERAK och en skrivning av mätvärden.
- **Verifierat (scenario E körning 9, ren värld byggd med F79, F80 och F84):** 6 av 6 steg är gröna. Alla A:s och B:s spärrade filer återupptogs av operatören i den riktiga vyn efter godkänt issuer-bevis, och serveråtgärden svarade 200. A sparade 96, 96, 96 och 24 (korrigeringen) värden, och den felriktade filen avvisades som okänd mätpunkt. B sparade 96 värden.
- **Kvar (inte rättat ännu):**
  - ~~`DispatchPanels.tsx` och `EdielOperationalBridgePanel.tsx` visar knappen utan att läsa regeln~~ **Rättat:** båda följer nu samma regel. 12 nya tester, och 133 tester i de berörda sviterna är gröna. **Inkonsekvens:** ingen av panelerna monteras i appen i dag, eftersom varken `EdielWorkbench` eller `EdielOperationalBridgePanel` importeras någonstans. Det är död kod. Monteras de senare måste `EdielWorkbench` skicka beslutet vidare.
  - ~~`utiltsInboundPolicyProcessor.ts:174` skriver över `utiltsRuntime` utan historik~~ **Rättat:** samma historik som i `utiltsDataRequest.part-2.ts`.
  - Det unika indexet `ux_ediel_ack_related` omfattar även makulerade svar, så ett makulerat svar kan stoppa ett nytt för samma transaktion. Serveråtgärden rapporterar det tydligt.
  - Historiken växer utan tak. Det är avsiktligt för revision, och tak eller arkivering kräver ett beslut.

### F84 Manuell UTILTS-ERR kan skapas utan att resumability-regeln kontrolleras — RÄTTAD, medel
- **Kod:** `createNegativeUtiltsResponseAction` (`app/admin/ediel/actions.part-4.ts:368-418`, formuläret på detaljsidan rad 641) skapar en negativ UTILTS-ERR för vilket inkommande UTILTS-meddelande som helst. Det sker oavsett om transaktionerna redan fått ett slutligt positivt svar eller bara hålls för intern granskning.
- **Risk:** ett motsägande applikationssvar till nätägaren.
- **Kodspårning (2026-10-22):** `createNegativeUtiltsResponse` (`lib/ediel/flows/inboundProcessing.ts:1481`) anropar `createAckIfMissing` för hela meddelandet. Dubblettskyddet i `readExistingAckBeforeDraft` (`lib/ediel/core/ackDraftSource.ts`) jämför bara mot ett befintligt svar av **samma typ**, och det unika indexet `ux_ediel_ack_related` gäller också per typ. En UTILTS-ERR stoppas alltså inte av ett befintligt positivt APERAK för samma transaktioner. Bekräftat i koden, inte prövat i en körning.
- **Rättning:** serveråtgärden läser F80-regeln först. En manuell UTILTS-ERR vägras och loggas om källan redan har ett applikationssvar, ett slutligt transaktionssvar eller transaktioner som hålls för intern granskning. Test: `__tests__/utilts-manual-err-guard.test.ts` (4 fall). Utan vakten faller exakt de tre vägran-fallen.

### S2 Scenario E:s operatörssteg läste detaljsidan innan den hade renderat — RÄTTAD (simuleringen)
- **Utfall:** `button.count()` väntar inte. Detaljsidan visar `loading.tsx` i 15–32 sekunder, och när filerna kom i en viss ordning gick nästa sida upp medan föregående serveråtgärd fortfarande renderade om. Testet gick då vidare efter ungefär en sekund utan att klicka.
- **Rättning:** steget väntar på den renderade detaljvyn, sparar URL och HTTP-status och väntar in serveråtgärdens svar (`submitServerAction`) innan nästa sida öppnas.
- **Verifierat (körning 8, samma redan använda värld som körning 7):** 6 av 6 steg är gröna. Alla sex filerna fick knappen och serveråtgärden svarade 200. A: 96, 24 (korrigeringen), 96 och 96 värden, och den felriktade filen avvisades som okänd mätpunkt. B: 96 värden.

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

### F51 Z01 kan inte skapas för någon webbkund: kundens folkbokföringsadress samlas aldrig in — UNDER RÄTTNING (ägarbeslut 2026-10-22), kritisk
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
- **Ägarbeslut 2026-10-22:** webbkunden anger själv sin folkbokföringsadress i webbformuläret och API:t. Vid manuellt intag anger operatören eller den inloggade personalen den.
- **Rättning (pågår):**
  - En gemensam skrivare (`lib/customers/registeredAddress.ts`, commit `e1adc1ca`) validerar adressen mot Ediels masterdataform, sparar ursprung (`website_declaration` eller `staff_entry`) och historik, och garanterar exakt en gällande `registered`-adress.
  - Webbspåret och det manuella intaget byggs parallellt på den.
- **Viktigt (regeln, `20261001014700`):** `registered`-adressen godtas bara när begärans marknadsdag är **idag**, som för Z01. För Z03 med en senare eller tidigare start krävs en signerad, granskad kunddeklaration (`gridex_customer_masterdata.signed_declarations`), bunden till det signerade avtalets version och hash. Den skapas av det befintliga arkiv- och granskningsflödet för avtalsoriginal (`ediel_archive_contract_original_source_v1`/`ediel_review_contract_original_source_v1`, `/admin/ediel/contract-originals`). Hur den deklarerade adressen ska nå det signerade avtalet och flödet utreds.
- **Ägarbeslut 2026-10-22 (deklarationen för Z03):**
  1. Deklarationen härleds **automatiskt** från det signerade avtalet, på samma sätt som F46. Den härleds bara med service-rollen, binds till avtalets hash och gäller från signeringen.
  2. Fullt person- eller organisationsnummer och folkbokföringsadress ska stå **i den signerade avtals-PDF:en**.
  3. Vid manuellt intag och importerade externa avtal **räcker personalens uppgift** som deklaration.
  4. Vid adressbyte **ersätter en ny deklaration** den gamla från ändringsdagen, och historiken bevaras.
- **Utredning (deklarationen):** i dag kan ingen deklaration skapas i produkten. PDF:en och snapshoten saknar identitet och adress, inget i signeringsflödet förbereder en deklaration, och arkivflödets utfärdarnyckel kan bara skrivas av migrationer. Native-fixturerna skriver `signed_declarations` direkt med en platshållaradress.
- **Manuellt intag (commit `08f787f4`):** fältet finns i formuläret och på kundkortet, och adressen sparas som `staff_entry`. 13 och 6 nya tester, och 253 tester i 19 närliggande sviter är gröna.
- **Fynd under rättningen:**
  - **Befintligt brott mot regeln (rättat):** det manuella intaget kopierade anläggningsadressen som `registered` utan ursprung (`actions.part-2.ts`, tidigare rad 857-869), och scenario D kontrollerade det. **Öppet:** befintliga kunder från manuellt intag har kvar en sådan kopierad rad som Z01 kommer att använda. Den ersätts när personalen sparar en adress på kundkortet, men en städning kräver beslut.
  - **Samma fel, inte rättat (utanför custody):** `lib/external-contracts/intake.ts:396-405` skriver anläggningsadressen som `registered`.
    - **Uppdatering: rättat (commit `3f172f1d`).** Filen gjordes claim på i #840. Formulärets adress sparas nu som `facility`, med intaget som källa i metadata (`externalIntakeAddress`). Test: `__tests__/external-contract-intake-address.test.ts`, 3/3. Folkbokföringsadressen anges av personalen på kundkortet vid granskningen (ägarbeslut: personalens uppgift räcker).
  - **Tenantlucka (adressformuläret rättat, kontaktformuläret öppet):** det generella adressformuläret uppdaterade bara på `customer_id` och avgränsas nu till personalens bolag. `saveCustomerContactAction` i `CustomerContactsAddressesCard.tsx` (cirka rad 108-169) uppdaterar fortfarande `customer_contacts` och `customers` utan bolagskontroll.
    - **Uppdatering: kontaktformuläret är också rättat (commit `f2b28960`).** `saveCustomerContactAction` använder `requireOperationalCompanyId`, kontrollerar att kunden tillhör bolaget och avgränsar alla frågor med `company_id`.
- **Webb och API levererat (commit `a7eb0ae3`):**
  - `POST /api/v1/website/customer-applications` kräver `customer.registered_address` för privat- och företagskunder. Ägarbeslutet var "obligatoriskt direkt".
  - Fälten valideras mot Ediels masterdataform: högst 35 tecken, fem siffror i postnumret och bara `SE`.
  - Adressen sparas genom den gemensamma skrivaren med ursprung `website_declaration`.
  - En omsändning med samma nyckel ger det ursprungliga utfallet. Samma nyckel med en annan adress ger 409, aldrig en tyst adressändring.
  - OpenAPI-release `2026-10-22.1`:
    - Webben klassas `breaking-client-update-required`. Kundportal och Staff är `backward-compatible`.
    - Standardversionen på tråden (`2026-10-09.1`) och miniminivån (`2026-10-02.3`) är oförändrade.
    - Guider, README, kompatibilitetspolicy (med undantaget från regel 1 dokumenterat) och migrationsguide är uppdaterade.
  - **gridex-web (annat repo) måste skicka fältet**, annars får varje ny webbansökan 422 `registered_address_required`.
  - Hela enhetssviten kördes i en isolerad worktree: 22 204 av 22 211 tester gröna. De tre fallen:
    - RBAC-granskningen, rättad nedan;
    - två tester i `tenantservice-support-attachment-api`, som faller likadant på ren HEAD. Det är en 5-sekunders timeout som går igenom med längre gräns, alltså ett befintligt fel och inte orsakat här.
- **RBAC (rättat, commit `b9a0795e`):** min åtgärd för folkbokföringsadress på kundkortet (`08f787f4`) saknades i listan över granskade filer som använder service-klienten. Den är nu granskad och registrerad med motivering. Granskningen: 24/24.
- **Deklarationen för Z03 levererad (commit `d38a350e`, migration `20261022130000`):**
  - Avtals-PDF:en och den signerade snapshoten får avsnittet KUNDUPPGIFTER med fullt person- eller organisationsnummer och folkbokföringsadress.
  - Före bytet kontrolleras det arkiverade signerade originalet mot `document_sha256`. Varje rad i avsnittet måste finnas i de signerade byten.
  - Manuellt intag använder personalens adress.
  - Vid adressbyte återkallas den öppna deklarationen. Den återutfärdas fram till ändringsdagen och en ny öppnas från ändringsdagen, så exakt en gäller varje dag.
  - Test: native mot den riktiga regeln 5/5, regressionen för tokensignering 14/14 och enhetstester 75/75.
  - **Inte bevisat än:** tokensignering hela vägen med en folkbokföringsadress. Det verifieras i scenario F.
- **Inkonsekvenser funna under deklarationsarbetet (bekräftade, öppna):**
  - Ett adressbyte ersätter den öppna deklarationen. En Z03 som redan förberetts från den gamla, med start före ändringsdagen, faller då vid sändningskontrollen (`customer_masterdata_current_source_changed`) och måste förberedas igen.
  - Folkbokföringsadresser som ändrats på plats, utan `moved_in_at`, kan inte dateras. Deklarationen hålls då med `registered_address_change_date_required`.
  - Webb-PDF:en skapas efter signeringen. Kunden signerar den hashade snapshoten med avsnittet, och PDF:en är bekräftelsen av den.
- **Öppna frågor till ägaren (deklarationen):**
  1. Redan signerade webbavtal utan avsnitt (snapshot v2) har inget underlag, och personalen kan inte rätta det, eftersom samma adress igen ignoreras som oförändrad. Ska personalens uppgift godtas som reserv för dem?
  2. Deklarationen gäller från exakt signeringstidpunkt. Ska den gälla från signeringsdagens början?
  3. Kunden har en öppen deklaration, bunden till det första avtalet tills det upphör. Räcker det för kunder med flera avtal?
  4. Deklarationer härleds för både test- och produktionsspåret vid varje byte. Godtas det?
  5. Ett adressbyte slår igenom när nästa Z03 förbereds, inte när adressen sparas. Godtas det?

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

- **O3 Webbansökningar i scenario F fastnar på `postal_suggested` (2026-10-22, körning 2 av F):** fyra webbansökningar för adresser i ALS stod efter 10 minuters cron-körningar kvar i `processing`, med `resolution_status=postal_suggested` och utan nätområde, och fick därför inget leverantörsbyte. Samma adresser löstes exakt i chain A. Skillnaden ska utredas: simulatorns adresspunkter registreras i F2, men tenanten är ny och nätägaren verifierades i F1. Det är oklart om felet sitter i simuleringen eller i produkten, så det är inte klassat än.
  - **Utrett:** inget adressfel. Anläggningarna löstes till ALS med verifierad nätägare (0,97) inom en minut. Värdena på ansökningsraden skrivs bara vid intaget och blir föråldrade (D2 nedan). Kunderna fastnar i stället på Z01, som blockeras av F51. Nästa-steg-motorn tar Z01-grenen före bytet (`customerProcessNextStepEngine.ts:455-458`).
  - **D2, ny, låg, bekräftad:** ansökningsradens `resolution_status`, `grid_area_code`, `blocking_reasons` och `missing_fields` uppdateras aldrig efter intaget (`opsPrecisionGridOwnerResolution.ts:326-345` uppdaterar bara anläggningen, och `customerApplicationRepair.ts:718-727` uppdaterar inte heller dem). Ansökan visar därför "Nätägare ej verifierad" fast anläggningen är verifierad.
  - **D3, hypotes:** `start_supplier_switch`-jobben som skapas vid signering blev `needs_review` ("Nätägare saknas") 33 sekunder innan nätägaren var löst, och inget köar om dem.

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
- **Bakdaterad leverantörsbytesstart vägras på tre ställen, och det är korrekt (scenario F, 2026-10-22):** ett signerat avtals `starts_at`/`expected_start_at` kan inte ändras (`signed_customer_contract_immutable`, `20260818170828`). En ny bytesbegäran lyfts alltid till minst idag + 14 dagar (`db.part-2.ts:542`, `switchStartDate.ts`). En Z03 måste skickas minst 14 dagar före start (`deadlinePolicy.ts:80-83`, `supplierSwitchScheduler.ts:140-145`). Scenario F etablerar därför sin historiska leveransperiod som den skedde i augusti: kunderna och avtalen skapas via plattformens signaturväg med start 1 september, och Z03 byggs av den riktiga byggaren och besvaras av nätägaren med en riktig Z04. Bara tidsfönstret som representerar "nu är det augusti" hoppas över, och det redovisas i rapporten.

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

## Scenario G, H och I (2026-10-22, parallella agenter, kod och native; världskörning återstår)

Agenterna fick inte röra den delade världen medan F körde, så allt nedan är verifierat med enhetstester och native-tester mot den lokala databasen. Scenariofilerna `chain-g-dst`, `chain-h-customer-leaves` och `chain-i-grid-owner-rejects` är skrivna och laddar, men de är ännu inte körda i världen.

### G: vintertid 25 oktober (25 timmar, 100 kvartsvärden)
- **Bekräftat korrekt (inte fel):**
  - UTILTS-tolkning, lagring och antalskontroll: 100 värden, och 96 värden för ett civilt 25-timmarsdygn nekas med E87.
  - Månadsfunktionen för portalen och åtkomstfönstren: oktober = 31 dygn + 1 timme.
  - Partner-API:ts dygnsgränser.
  - Underlagens täckning, intervallprissättning och spottäckning.
- **DST-C1 Fullständighetskontrollen läste bara 1 000 värden per månad — RÄTTAD (commit `04cbf19b`), hög:**
  - `loadNormalizedValues` (`lib/metering/validation.ts`) bad om 50 000 rader, men PostgREST returnerar högst 1 000. En kvartsmånad har 2 880–2 980 värden per mätpunkt.
  - Varje kvartskund blev därför `metering_gap` ("33,6 % täckt"). Månadsautopiloten skickade en databegäran till nätägaren, och varje underlag spärrades för export.
  - Felet gäller inte bara sommartid; gränsen på 1 000 rader finns även i hostad Supabase.
  - Rättning: sidläsning. Native-test DST-N5 föll före rättningen och går igenom efter.
- **DST-E1 Preliminära uppskattningar förskjuts en timme över tidsbytet — ÖPPEN, låg:** `lib/billing/consumptionEstimate.ts:188-191, 207-209` räknar referensveckor i UTC. Det påverkar bara tenanter med uppskattning påslagen. Testerna är `it.fails` och har ett patchförslag.
- **Troliga fel av samma klass (öppna, inte verifierade):**
  - Gränsen på 1 000 rader i `consumptionEstimate.ts:241`, `forecastRuns.ts:76-86` och `meteringPointForecast.ts:55-62`.
  - UTC-månad i stället för Stockholmsmånad i prognos och analys (`meteringPointForecast.ts:61`, `forecastRuns.ts:82`, `analytics/db.ts:95,408`).
- **Simuleringsfel (rättade):** nätägarsimulatorn och spotsimulatorn kunde bara bygga 96-värdesdygn i +0200.
- **Öppna frågor:**
  - Ska G köras efter 1 november med riktiga spotpriser, eller nu med syntetiska?
  - Ska nätägarens fil vara ett civilt dygn eller ett fast CET-dygn (ENV-08)? Båda godtas.
  - Kundens API tolkar ett rent datum i `from`/`to` som UTC-midnatt.

### H: kunden lämnar
- **H7 Flyttanmälan (Z05 LK) avslutar aldrig leveransen — ÖPPEN, kritisk (bekräftad native):**
  - Varje Z05 med LK-objekt går till koden för bilateral stängning, som kräver en egen skickad Z08 LK. Anmälan rullas därför tillbaka med `bilateral_closure_exact_sent_original_required`.
  - Perioden förblir öppen, avtalet förblir signerat och ingen slutfakturauppgift skapas. Faktureringen fortsätter efter flytten.
  - Patchförslag: en migration i `apply_supply_before_rescission_v1`.
- **H1 Z05:s slutdatum lästes som sista levererade dag — RÄTTAD (commit `9724b51f`), hög:** en kund som lämnade 1 november fick ett novembersegment. Det blev ett spärrat underlag, en uppskattning eller en Z13 till nätägaren för en anläggning vi inte längre levererar. Vid inflyttning på samma mätare spärrades den nya kundens hela första månad.
- **H4 Sista kvarten av varje avslutad period täcktes aldrig (`- 1 ms`) — RÄTTAD (commit `9724b51f`), medel.**
- **H2 Status `ending` (Z05 med framtida slut) känns inte igen av faktureringen — ÖPPEN, hög:** värdena för de sista veckorna spärras som `supply_period_missing` och prövas aldrig om.
- **H3 Avtalet avslutas redan när Z05 kommer, så slutfakturan förbereds aldrig — ÖPPEN, hög:** databasgrinden `gridex_set_metering_billing_gate` godtar bara `active` eller `confirmed_by_grid_owner`. Rättningen kräver en migration och kod tillsammans; patchförslag finns.
- **H5 En ny boende kan aldrig bli kund hos samma tenant på samma mätare — ÖPPEN, hög, produktbeslut:** unikt index på (tenant, mätar-ID), och grafkärnan återanvänder inte raden.
- **H6 Brytavgiftsgranskning skapas även vid flytt — ÖPPEN, medel:** bindningsslutet räknas dessutom från `starts_at`.
- **H8 Slutfakturatexten säger "till och med" nästa leverantörs första dag — ÖPPEN, låg.**
- **H9 Kundens åtkomstfönster sommartid är en timme förskjutet mot faktureringen — TROLIGT, låg.**
- **Ångerrätt:** fältet "spärra fakturering" lagras bara i metadata och har ingen effekt. Om Z03C faktiskt skickas visas i H8.
- **Inte fel:**
  - Plattformen avbryter byten med Z03C och Z04C, inte med Z09.
  - Upprepade månadskörningar är idempotenta.
- **Not:** H:s native-test föll två gånger av sex medan världens cron körde samtidigt, och gick igenom fyra gånger i rad när det kördes ensamt.

### I: nätägaren avvisar eller tiger
- **GOR-01 En vanlig affärsavvisning (APERAK BGM 34 med ERC per objekt) nådde aldrig bytet — RÄTTAD (commit `2219c5a5`), hög:**
  - Gäller koderna 40/105 okänd GSRN, 40/106 annan leverantörs byte, 42/210 startdag och 42/227 kund-id.
  - Bytet stod kvar som `prepared` och Z03 som `sent`, utan förfallodatum. Detsamma gällde Z01.
- **GOR-02 En sen negativ kvittens efter Z04 flyttade ett accepterat byte till `failed` — RÄTTAD, hög:** leveransen skulle aldrig ha startat (P-11). Nu skrivs i stället en varningshändelse för operatören.
- **GOR-03 Nätägarens ERC-kod och text försvann ur felorsaken — RÄTTAD, medel.**
- **GOR-04 En avvisning öppnar inget operatörsärende, flyttar inte webbansökan och köar inget kundbesked — ÖPPEN, hög:** patchförslag finns. Produktfråga: ska en negativ CONTRL, alltså vårt eget syntaxfel, ge kunden ett avvisningsbesked?
- **GOR-05 En tyst nätägare blir aldrig försenad för Z03 — ÖPPEN, hög:**
  - Vyn kontrollerar "inväntar" före "försenad", och `ackSlaMonitor` har ingen anropare.
  - I den lokala databasen visas 8 Z01 som passerat sin frist som `awaiting_contrl`.
  - Patchförslag: migration för vyn plus ett cronsteg.
- **GOR-06 En positiv slutkvittens lämnar bytet som `prepared` — ÖPPEN, låg.**
- **GOR-07 Listan över öppna byten i appen missar `prepared` och `sent` — TROLIGT, låg.**
- **GOR-S1 Nätägarsimulatorns `rejectShare` skickar ingen APERAK alls — testharnesk, patchförslag.**

### Observation under F körning 7 (inte produktfel)
- F2 fick 503 `dependency_unavailable` (retryable) när API-gatewayen fick ett ogiltigt svar från PostgREST. Det sammanföll med att två native-sviter kördes mot samma databas.
- Plattformen svarade korrekt. Scenarier och native-sviter körs hädanefter inte samtidigt.

## Uppföljning 2026-10-22: H7, H2, H3, GOR-04 och GOR-05 rättade (ägarbeslut), commit `64829c21`

- **H7:** migration `20261022140000`. En vanlig flyttanmälan (Z05 LK) avslutar leveransen, avslutar avtalet, skapar slutfakturauppgiften och får positiv APERAK och CONTRL. Bilateral stängning gäller bara när det finns en egen Z08 LK.
- **H2/H3:** migration `20261022150000`.
  - Faktureringsgrinden godtar en period med status `ending` eller `ended` som har slutdatum.
  - Den godtar också ett avtal som avslutats av exakt det leveransslutet. Kod och databas gör samma bedömning.
  - Månadskörningen prövar om värden som bara hölls på grund av leveransslutet.
- **GOR-04:**
  - En negativ APERAK ger ett operatörsärende, flyttar webbansökan till `switch_rejected` och köar ett kundbesked, en gång.
  - En negativ CONTRL, alltså vårt eget fel, ger bara ett tekniskt ärende. Ägarbeslut: inget kundbesked.
- **GOR-05:** migration `20261022160000` plus ett cronsteg. En tyst nätägare syns som `ack_overdue`, i bytet visas "Kvittens försenad", och stuck-detektorn rapporterar `needs_operator`.
- **Verifierat:**
  - 1 048 enhetstester.
  - Masterplanens täckningskontroll: 352 av 352 gröna.
  - Native-tester för H och GOR.
- **Kvar att verifiera:** den godkända AT-Z05-sviten. Den kräver en ren replay utan samtidiga skrivare.

## Inkommande Ediel och statistik (J1–J4, K), 2026-10-22, kod och native; världskörning pågår

### J3 Robusthet för inkommande e-post — commit `cbd82bcc`
- **J3-01 Varje EDIFACT-bilaga vars UNA slutar med CRLF eller börjar med BOM föll — RÄTTAD, kritisk:**
  - Bilagan tolkades som två kopior och föll med `edifact_dangling_release_character` efter 5 försök. Ingen CONTRL skickades.
  - De flesta riktiga Ediel-filer slutar med radbrytning. Inga testfixturer gjorde det, så felet syntes aldrig.
- **J3-02 Två bilagor slogs ihop — RÄTTAD (hålls för granskning):** de slogs ihop från första UNA till sista "UNZ". Ett följebrev med ordet "unzip" räckte för att sträcka ut en giltig fil.
- **J3-03/J3-04 En del med U+0000 föll vid insättning — RÄTTAD:**
  - Ett sådant mejl markerades aldrig som läst och hämtades först vid varje körning. 25 sådana mejl blockerade hela brevlådan.
  - Nu läggs mejlet åt sidan efter 3 försök, synligt och markerat som läst.
- **J3-05 Ett testinterchange (0035=1) i produktionsbrevlådan behandlades som produktion — RÄTTAD:** det hålls nu som `environment_mismatch`.
- **J3-06/J3-10 Trunkerad fil och ordet "unable" som UNA — RÄTTADE.**
- **Öppna, kräver beslut:**
  - **J3-07 (hög, säkerhet):** avsändaren verifieras aldrig. From-adress, S/MIME-signatur och DKIM kontrolleras inte, så vem som helst kan skicka i nätägarens namn.
  - **J3-08:** CONTRL och APERAK som inte kunde skickas på grund av SMTP-avbrott försöks aldrig igen (samma som O1).
  - **J3-09:** underadressen matchas inte.

### J4 Tolkning av inkommande meddelanden — commit `a7b54f22` (+ D12 i `5f2db53e`)
- **J4-D1 Escape-tecken avkodades två gånger — RÄTTAD, hög:** en giltig FTX som slutade med `??` fällde hela mejlet.
- **J4-D2 — RÄTTAD:** FTX-kod och FTX-text blandades ihop.
- **J4-D3/D4 Fel värden från CONTRL — RÄTTADE:**
  - Åtgärdskoden lästes från felkodselementet.
  - Segmentpositioner lagrades som felkoder.
- **J4-D9 — RÄTTAD:** BGM-koden i en fil med egna separatorer behöll separatorerna.
- **J4-D12 `isNegativeContrL` var inverterad (7 räknades som negativ, 4 inte) — RÄTTAD i `5f2db53e`.**
- **Öppna, med patchförslag:**
  - D5/D6: inramning i `canonicalEdifactAst`. Skyddas redan i e-postflödet av J3.
  - D13: Latin-1-filer som märkts som utf-8 tappar ÅÄÖ.
  - D7: S/MIME-teckenkodning.
  - D10, D11, D14, och D8 (död kod).
- **Korrekt:** UTILTS och PRODAT, fält för fält, och korrelationen per objekt.

### J1 Inkommande PRODAT — commit `5f2db53e` (scenario och simulator pågår)
- **J1-04 Varje matchad Z04 skrev `confirmed` innan den validerats — RÄTTAD, hög:** en Z04 som kom efter makuleringen (Z04C) återupplivade därmed det makulerade bytet.
- **J1-01 En Z04 med annan startdag än begärd hålls — DELVIS RÄTTAD, hög:**
  - Ingen leveransperiod skapas och nätägaren får ingen APERAK.
  - Nu skapas en operatörsuppgift efter 30 minuter.
  - **Beslut krävs:** godta nätägarens datum, eller avvisa med APERAK 42/210?
- **Öppna:**
  - **J1-02:** Z04 för ett byte vi aldrig skickat ger ingen APERAK och ingen uppgift.
  - **J1-03:** en Z04 som skickas om får inget svar.
  - **J1-05:** en makulerad bekräftad start ger inget ärende och inget kundbesked.
  - **J1-10:** Z04 utan fält 259 hålls. Ett godkänt test kräver det, men specifikationen säger att fältet får saknas.
  - **J1-11:** vår APERAK pekar på fel original när Z04 kommer före kvittensen.
- **Troliga:** aktiveringen uppdaterar aldrig `starts_at`/`actual_start_at` (F82), och Z06 uppdaterar aldrig pris- eller nätområde.

### J2 Inkommande UTILTS — commit `4b980b16`
- **J2-01 En korrigering efter ett slutfört underlag fällde tenantens hela månad vid varje körning — RÄTTAD, hög.**
- **J2-02 En korrigering för en fakturerad månad når aldrig kunden — ÖPPEN, hög, beslut krävs:**
  - Ingen kreditering eller omfakturering sker.
  - Nu syns det som avstämningskontrollen `metering_corrections_after_billing`.
- **J2-03 Uppmätta värden ersätter aldrig uppskattade (STS 56) — ÖPPEN, hög:** de blir aldrig fakturerbara. Patch finns, men funktionen är hashlåst, så den går till GEN-ägaren.
- **J2-04 Ett månadsvärde (P1M) för del av en månad persisteras inte alls — ÖPPEN, hög:** godkänt område U-09/U-10.
- **J2-06 Fakturakällan läses om för varje värde, cirka 130 ms per värde — ÖPPEN, kritisk (prestanda):**
  - Det blir cirka 11 minuter per kvartsanläggning och månad, så månadskörningen hinner bara med ungefär en kvartsanläggning per tenant.
  - Patch föreslagen.
- **J2-07/08/09/10/11/12/15 — RÄTTADE:**
  - J2-07: 128 MB metadata per anläggning och månad.
  - J2-08: en operatörspost per kvart i stället för per fil.
  - J2-09: gränsen på 1 000 rader i uppskattningen.
  - J2-10: en ny Z13 var 6:e timme efter ett svar.
  - J2-11 och J2-15: 414 "URI too long".
  - J2-12: kontrollen för dubbelfakturering.
- **J2-13 Ingen jämförelse mellan uppmätt, fakturerat och E31/S03 — ÖPPEN, beslut.**
- **J2-14 Prognosens utfall dubbelräknar revisioner och stannar vid 1 000 — ÖPPEN, patch finns.**

### K Statistik (tenant och white label) — commit `1628acf7`
- **Inget läckage mellan tenanter:** 980 tenantmånader är jämförda.
- **RÄTTADE:**
  - **K-01:** pågående byten saknade `prepared` och räknade med avslutade.
  - **K-02:** korrigerade mätvärden räknades två gånger.
  - **K-03/K-05:** månader räknades i UTC, så mätvärden och fullmakter hamnade i fel månad.
  - **K-04:** "saknade mätvärden" räknade också anläggningar vi inte levererar till.
  - **K-07/K-08:** testkunder och arkiverade kunder räknades, och anläggningar förblev aktiva efter att kunden lämnat.
  - **K-09:** prognos och CSV stannade vid 1 000 rader.
  - **K-11/K-12:** zonvärden och "idag" i UTC.
- **Öppna:**
  - **K-06:** vilken månad räknas churn i, sista leveransdag eller första dag utan leverans? Beslut krävs.
    - **RÄTTAD 2026-10-23 (ägarbeslut: "gör det som är bäst"), migration `20261023150000`:**
      - Churn räknas i månaden för den sista leveransdagen. Den beräknas av hjälparen `gridex_supply_period_last_day_v1`: en Z05 med marknadsslut är exklusiv, och ett manuellt avslut är inklusivt.
      - En kund är aktiv vid ett månadsskifte bara om den har leverans både dagen före och den första. Då gäller att slutet på månad M är lika med början på M+1, att slut minus början är lika med nya minus churn (utom återinträden), och att en kund som startar den första är ny i den månaden.
      - Gäller `monthly_internal`, `rebuild_company_analytics_month`, `cohorts_at`, `active_counts`, `bidding_zones`, `churn_reasons` och `missing_metering_points`.
      - Prognosfunktionerna och faktureringsspärren är oförändrade.
      - **Tester:** PGlite 4 av 4 (åtta kundfall), native K 5 av 5, analys 196 av 196, typkontroll, och täckningen 352 av 352.
  - **K-10:** användningssidan klipper vid 250 tenanter och räknar en status som inte finns.
  - **K-14:** tenanter kan skriva sina egna statistikrader.
- **Blockerat:** replayen saknar white label-tabeller (F47). Scenario K speglar dem.

### T4 Kvarlämnade nätägarsimulatorer tog nästa körnings meddelanden — RÄTTAD (commit `621403f7`), verklighetsvärlden
- **Utfall (F körning 13):**
  - För första gången i simuleringen skickades alla fyra Z03 i produktion (`sent`).
  - Svar uteblev ändå: körningens egen nätägarsimulator hade inte tagit emot något (`received: []`).
  - Fyra simulatorer från avbrutna körningar (17:12, 18:39, 19:44, 19:58) läste fortfarande samma brevlåda, `ediel-16700@example.invalid`.
- **Orsak:** simulatorerna startas frikopplade (`detached`) och stoppas bara i scenariots `afterAll`.
- **Rättning:** körskriptet stoppar alla kvarlämnade scenariosimulatorer innan en körning startar.

### F körning 13–15: första produktionsbytet hela vägen till nätägaren (2026-10-22)
- **T5 Nätägarsimulatorn kastade S/MIME-krypterad produktionspost — RÄTTAD (commit `8c9c0a68`), verklighetsvärlden.**
  - Produktionspost krypteras till mottagarens certifikat (enveloped-data), precis som i verklig Ediel-trafik.
  - Simulatorerna letade bara efter klartext. De markerade alla Z03 som lästa men tog aldrig emot dem (`received: []`).
  - Nu dekrypterar de med den nyckel som certifikatkatalogens simulator utfärdat.
- **Körning 15, nätägarsidan:** nätägaren tog emot alla fyra Z03 och skickade CONTRL, APERAK och Z04 (start 2026-09-01) för varje anläggning. Plattformen tog emot allt.
- **Körning 15, plattformssidan:**
  - Z04 bedömdes som accepterad på alla nivåer (syntax, funktion och tillämpning). Svarsplanen var positiv CONTRL och positiv APERAK.
  - **Ingen leveransperiod skapades, och bytet stod kvar som `prepared`.**
  - Händelsen "CONTRL skapades inte: ediel_technical_ack_route_unavailable" visades, och `ediel_technical_ack_route_count:0`.

### F92 Go-live skapar aldrig den tekniska kvittensrouten till nätägaren — UNDER UTREDNING, misstänkt kritisk
- **Krav:** CONTRL och APERAK till nätägaren kräver exakt en aktiv route med `route_scope='ediel_ack'`. Dess profil måste matcha originalets UNB, fast omvänt: Ediel-ID, underadresser och applikationsreferens. Dessutom ska brevlåda och SMTP stämma.
- **Saknas:** varken go-live-guiden eller registermaterialiseringen skapar en sådan route.
- **Produktion (summeringsfråga, bara läsning):** 2 kvittensroutes, för 1 bolag, av totalt 361 routes.
- **Utreds nu:**
  - om Z04:ns affärseffekt (aktivering av leveransen) väntar på att vår kvittens skapas;
  - vilken väg en operatör har i admin för att skapa routen;
  - ett operatörssteg för verklighetsvärlden.

### J3 i världen (körning 1, 2026-10-22): 5 godkända, 1 överhoppad, 1 underkänd
- **Godkända:**
  - Två bilagor och två interchange i ett mejl hölls som `multiple_interchanges`.
  - En trunkerad fil hölls som `edifact_unparseable`.
  - UTF-16, tom bilaga och PDF hölls som `missing_payload`.
  - Ett mejl som kraschar behandlingen lades åt sidan efter 3 försök (`storage_dead_lettered`).
  - Ingen CONTRL skickades för sammanslagna eller trunkerade filer.
  - CRLF, BOM och ZIP gav positiv CONTRL.
  - NOUNZ och felaktigt UNT-antal gav negativ CONTRL (åtgärd 4).
- **J3-11 Den andra kopian av samma interchange fastnade tyst — RÄTTAD (commit `237dab119`), hög:**
  - Mejl till den delade brevlådan sparas utan tenant. När kopia två skulle kopplas till tenanten bröt den mot det partiella unika indexet `ux_inbound_email_messages_company_sender_interchange`.
  - Jobbet misslyckades 5 gånger, och mejlet blev kvar som `received/not_checked` utan något felmeddelande.
  - Nu hålls kopian som `duplicate_interchange`, och ett mejl vars jobb ger upp markeras `failed`.
- **J3-12 Teknisk CONTRL förloras när en sats når sin tidsgräns — ÖPPEN, hög:**
  - COVER: CONTRL avbröts med `statement timeout 57014`. En senare CONTRL blev kvar som `draft` utan rad i utkorgen.
  - CONTROL: samma sak, `draft` utan rad i utkorgen.
  - LARGE (månadsfil): ingen CONTRL skapades alls.
  - Inget av dem försöktes igen; SLA:n gick ut. Hör ihop med L1 (globala tabellås).
- **J3-07 bekräftad i världen:** ett förfalskat mejl i nätägarens namn behandlades och fick positiv CONTRL.
- **Observationer:**
  - Fel underadress: behandlades, men ingen CONTRL skickades (`ediel_technical_ack_route_unavailable`).
  - Produktionsfil i testbrevlådan: hölls, eftersom fält 208 saknades.

### Scenario F, körning 8 (2026-10-22)
- **F1–F3 gick igenom:** Z03 byggdes och köades för alla fyra augustianläggningarna.
- **F4 avbröts:** bakgrundskörningen nådde sin tidsgräns på 2 timmar, inklusive bygget, när arbetsprocessen startades om.
- Körs om på en ren replay.

### T2 Den simulerade go-live-hjälparen satte aldrig förmågan `ediel_production` — RÄTTAD (commit `4bb4f54f`), verklighetsvärlden
- **Utfall (F körning 9, ren replay):**
  - Alla Z01 och Z03 i produktion stod kvar i utkorgen som `blocked_tenant_state` med orsaken `capability_not_ready`.
  - Företaget hade `ediel_production_status=live`, men `company_capabilities.ediel_production` var `not_configured`.
- **Orsak:** den riktiga övergången `canonical_transition_ediel_production` sätter förmågan till ready när tenanten går live. Ersättaren för den saknade certifieringsvägen (`simulateEdielCertifiedGoLive`, F36) gjorde inte det.
- **Följd:** det förklarar varför inga produktionsmeddelanden från de nya tenanterna har lämnat utkorgen i tidigare körningar.
- **B1 bekräftat i flödet:** de spärrade posterna släpps aldrig när förmågan senare blir ready. Körningen kunde därför inte återhämta sig. B1 är fortfarande öppet och kräver ett produktbeslut.

### T2b Den simulerade certifieringen saknade de certifieringsbevis som go-live kräver — RÄTTAD (commit `ebfb0c7f`), verklighetsvärlden
- **Utfall (F körning 10):** produktionssändningar spärrades med `ediel_production_evidence_not_ready`.
- **Orsak:** `canonical_ediel_production_evidence_readiness` kräver godkända bevis av typerna TGT, AGT, SHADOW_PRODUCTION, LIVE_TENANT_INTEGRITY och RESTORE_REPLAY, och LIMITED_PILOT efter första sändningen. Ersättaren för F36 registrerar dem nu, märkta `reality_simulated`.

### T3 Testvärldens app saknade release-SHA — RÄTTAD (commit `67090f6c`), verklighetsvärlden
- **Utfall (F körning 11):** första gången Z03 passerade alla tenantspärrar föll den i utkorgen med `ediel_release_sha_unavailable`.
- **Orsak:** produktionssändning kräver `VERCEL_GIT_COMMIT_SHA` eller `GIT_COMMIT_SHA`. Vercel sätter variabeln vid varje deploy, men testvärlden gjorde det inte.
- **Rättning:** `up.sh` skriver nu SHA:n från checkouten vid varje start.
- **Följdfel (O1):** posten misslyckades och försöktes aldrig igen. Varje miljöfel kräver därför en ny körning.

### F89 Ingen tenant kan skicka något Ediel-meddelande i produktion: inga bevis per meddelandetyp finns, och produkten kan inte skapa dem — EXTERNT BEROENDE (avsiktlig spärr), kritiskt för go-live
- **Utfall (F körning 12):** alla gemensamma spärrar passerade, men transporten nekade med `ediel_scoped_capability_evidence_required` (`assertScopedEdielProductionCapability`).
- **Bevis från produktionen (en summeringsfråga, bara läsning, 2026-10-22):**
  - `gridex_ediel_readiness.evidence` har 0 rader;
  - 0 utgående Ediel-meddelanden har någonsin skickats i produktion;
  - 5 certifieringsbevis är godkända.
- **Orsak:**
  - `recordScopedEdielProductionEvidence` anropas bara från tester.
  - Koden säger själv: "Future test-phase publication requires real approved, scope-bound evidence. No migration seeds evidence."
  - För att registrera beviset krävs ett verifierat release-kvitto (`platform_release_receipts`) för exakt den körande release-SHA:n, och certifieringsbevis med testresultat per meddelandetyp.
- **Bedömning:** spärren är avsiktlig, men utan en produktväg kan go-live inte ske. Det hör ihop med F36.
- **Verklighetsvärlden:** en ersättare som använder plattformens egna funktioner byggs nu.

### F90 Certifieringen per meddelandetyp kan bara gälla en typ åt gången och faller vid varje deploy — BEKRÄFTAD (native, commit `d3d647ff`), kritisk (designfel)
- **Analys av koden (`20260930145202`):**
  - `ediel_certification_evidence` är unik per (tenant, miljö, bevistyp, motorversion).
  - Registreringen kräver att varje certifieringsrads `metadata.edielScopedReadiness.scope` är exakt den meddelandetyp som certifieras, med tester där `candidateSha` är release-SHA:n.
  - Beredskapen kräver att raden fortfarande är byte-identisk med den lagrade kopian.
- **Följd:**
  - Att certifiera en andra typ, till exempel Z01 efter Z03, ändrar raderna och ogiltigförklarar den första typen.
  - En ny deploy, det vill säga en ny release-SHA, ogiltigförklarar alla.
  - En tenant skulle alltså aldrig kunna skicka mer än en meddelandetyp i produktion.
- **Bekräftat natively:** testet `scripts/ediel-scoped-capability-f90-native.test.ts` kör med en syntetisk tenant och rullas tillbaka.
  - Z03 certifierades och blev ready.
  - Z01 med samma rader nekades.
  - En andra TGT-rad nekades av den unika nyckeln.
  - När raderna knöts om till Z01 blev Z01 ready och Z03 `ready:false`, trots att Z03:s bevis fanns kvar och inte hade gått ut.
  - Samma typ via en andra route gav en annan beroendehash.
  - En ny release-SHA gjorde alla bevis ogiltiga.
  - Slutsats: det är värre än befarat. En tenant kan bara ha **en kombination av meddelandetyp, route och release** sändbar åt gången.
- **Designförslag (inte implementerat):**
  - en oföränderlig tabell för testresultat per meddelandetyp, med release-SHA och separat godkännare, där certifieringsraden förblir ett godkännande för hela företaget;
  - en ny version av registreringen (v2) som bara jämför godkännandefälten;
  - CI som certifierar om aktiva meddelandetyper vid varje deploy;
  - ett operatörsflöde med fyraögonsprincip;
  - en övergång med enbart framåtriktade migrationer.

### F91 `tenant_message_capabilities` har ingen skrivare — BEKRÄFTAD (kod + produktion), kritisk för go-live
- **Orsak:** ingen migration, `lib`- eller `app`-kod skriver till tabellen.
- **Produktion:** 0 rader (summeringsfråga, bara läsning, 2026-10-22).
- **Följd:** utan en rad nekas varje utgående meddelandetyp redan innan bevisen kontrolleras.
- **Release-kvitton:** `canonical_record_platform_release_receipt` har ingen anropare i CI. Produktionen har ett verifierat kvitto, men om det stämmer med den körande SHA:n kontrolleras bara när en ny deploy görs.
- **Verklighetsvärlden:** ersättaren `scripts/helpers/reality/scopedCertification.ts` körs före utkorgen i varje cron-cykel, men bara för tenanter med simulerad certifiering.
  - Den gör det en riktig publicering i Ediels testfas skulle lämna efter sig: ett release-kvitto, rader för förmågor per meddelandetyp, testresultat och registrering via plattformens egen funktion.
  - På grund av F90 är Z03 sändbart och Z01 inte, så länge någon Z03 väntar.

### F92 uppföljning (utredning klar 2026-10-22): BEKRÄFTAD, kritisk för go-live; rättning pågår
- **Ingen produktväg skapar en kvittensroute** (kontrollerat i koden och i testvärldens admin-gränssnitt som operatör):
  - Inget `route_scope`-val erbjuder `ediel_ack`: varken `/admin/integrations/routes`, de äldre redigeringsformulären eller bootstrapformuläret. Bootstrapformuläret visas dessutom bara när tenanten saknar routes.
  - `saveCommunicationRoute` (`lib/cis/db-routes.ts`) sätter aldrig `environment_type`. Det kräver CHECK-villkoret `communication_routes_ediel_ack_environment_required`.
  - Go-live-guiden erbjuder bara PRODAT och UTILTS.
  - Registermaterialiseringen mappar inte CONTRL eller APERAK till något scope (`routeScopeForProcess`).
- **Vad som krävs:** en route och en profil per applikationsreferens som nätägaren skickar (`23-DDQ-PRODAT`, `23-DDQ-E66-T`, …) och per kanal. Profilen ska ha omvänt UNB, exakt originalets applikationsreferens och samma SMTP-konto som utgående post.
- **Z04:ns affärseffekt väntar inte på vår kvittens.**
  - Leveransen aktiveras (`applySupplyMarketSource`) bara när minst ett objekt är accepterat (`domainObjectCount > 0`).
  - Ett misslyckat CONTRL-försök loggas, och sedan fortsätter behandlingen.
  - I körning 15 stoppades Z04 av två andra orsaker, T6 och T7 nedan.
- **Beslutad rättning:** när nätägarens PRODAT- och UTILTS-routes materialiseras från aktörsregistret skapas även kvittensroutes, idempotent och utan att någon spärr lättas. Registermaterialiserade routes är redan den enda produktionsmodellen (F41), och det skalar till många nätägare.
- **Sidofynd, bekräftat i koden:** `/admin/integrations/routes` postar `is_aktiv` (page.tsx:149), men `app/admin/cis/actions.ts:288` läser `is_active`. Varje route som sparas där blir därför inaktiv. ÖPPEN, medel.
- **Sidofynd, sannolikt:** de äldre redigeringsformulären saknar alternativet `ediel_ack`. Att spara en befintlig kvittensroute där ändrar den troligen till `supplier_switch`. ÖPPEN.
- **Sidofynd, antaget:** en Z04 som hålls med `PRODAT_DEPENDENT_CONDITION_UNDETERMINED` skapar varken ärende eller granskningspost. Operatören märker den bara genom SLA-timern. Om det är avsiktligt är oklart.

### F92 rättning implementerad (2026-10-23): kvittensroutes materialiseras med nätägarens routes — RÄTTAD (native), väntar på verifiering i världen
- **Kod:**
  - Den nya modulen `lib/ediel/technicalAckRouteMaterializer.ts` anropas från `materializeCompanyGridOwnerRoute` och `materializePlatformActorRoute`.
  - Den skapar en `ediel_ack`-route och en profil per applikationsreferens och kanal. Referenserna härleds bara via den kanoniska fasaden:
    - PRODAT ger `23-DDQ-PRODAT`;
    - UTILTS ger `23-DDQ-E31-S/T`, `23-DDQ-E66-S/T`, `23-DDQ-S02-S` och `23-DDQ-S03-S`.
  - Idempotent: en befintlig handgjord rad behålls, och tvetydiga träffar hålls (`technical_ack_route_ambiguous`).
  - Saknad SMTP-konfiguration hoppar över kvittensroutes (`ediel_smtp_not_configured`) och fäller aldrig affärsrouten.
- **Test:** `scripts/ediel-technical-ack-route-materialization-native.test.ts` (`// reality-defects: F92`), 2 av 2 gröna.
  - Testet kör väljarfunktionens egna route-predikat ur den installerade definitionen (`pg_get_functiondef`) mot de materialiserade raderna.
  - Det kontrollerar PRODAT, E66-T och E66-S: exakt en route för både CONTRL och APERAK.
  - Det kontrollerar också att fel referens eller underadress ger ingen träff, att en andra körning inte skapar nya rader, att en annan tenant inte får någon träff, att saknad SMTP fungerar och att en handgjord rad behålls.
- **Begränsning:** väljaren körs inte hela vägen i testet, eftersom det kräver en verklig mottagen fil. Det verifieras i världen (scenario F).
- **F93 Registermaterialisering i testkanalen fallerar — ÖPPEN, medel (från agentens utredning, inte körd i världen):**
  - `upsertCommunicationRoute` skriver `environment_type = route.environment`, men `'test'` är inget giltigt värde i `ediel_environment_type`.
  - Bara produktionskanalen får därför routes, inklusive kvittensroutes, via den här vägen.
- **F94 En UTILTS-registerroute utan `metadata.message_code` fallerar i efterkontrollen av beredskapen — ÖPPEN, låg (från agentens utredning).**
- **Gamla regressionsfel, även på main:** `gridex-communication-route-materializer-contract-regression.cjs` (2 kontroller) och `gridex-tenant-customer-edifact-production-flow-regression.cjs` (3 kontroller) fallerar både på `origin/main` och på grenen utan F92. Inte F92:s fel. Ägs av respektive regressionsägare.

### F körning 16–17 (2026-10-23): svaren kommer nu fram i produktionskanalen
- **Körning 16:** föll i F1 på RPL-01. Sparning av brevlådan gav `PGRST204 'updated_by'`. Rättat i `cc814fbd`.
- **Körning 17:**
  - Go-live klarades, och F92 verifierades delvis i världen: registermaterialiseringen skapade automatiskt kvittensrouten `Alingsås Energi Elnät AB PRODAT teknisk kvittens 23-DDQ-PRODAT production`.
  - 4 Z01 köades och 4 Z03 skickades i produktion.
  - Nätägaren svarade med CONTRL, APERAK och Z04 i **produktionskanalen**, och T7 är därmed verifierad: CONTRL och APERAK godkändes, och alla fyra Z03 blev `acknowledged`.
  - Ingen leveransperiod skapades ändå, eftersom Z04 stoppades av F95 och T8 nedan.

### F95 Inget signeringsflöde sätter `customer_contracts.contract_version`, så nätägarens Z04 kan aldrig bekräfta bytet — BEKRÄFTAD (världen + kod), kritisk för go-live; rättning pågår
- **Utfall (körning 17):** alla fyra Z04 hölls av `normal_switch_confirm_v1` med `normal_z04_owned_signed_contract_scope_required`. Ett ärende för admin-godkännande skapades, och bytena blev kvar som `prepared`.
- **Orsak:**
  - Villkoret kräver `nullif(contract.contract_version,'') IS NOT NULL`.
  - Alla andra delar av villkoret var uppfyllda: mätpunkt, anläggning, kund, nätägare, nätområde, avtalets status `signed`, `signed_at` och `signed_version`.
  - `contract_version` var NULL för alla 4 webbavtal (`website_application`, terms `e2e-v1`) och för alla 4 tokensignerade avtal.
  - Ingen SQL-väg sätter fältet: varken skapandet (webb, internt, partner) eller signeringen (webb, token, adminimport). Bara TypeScript-vägen `createCustomerContract` gör det, med `terms ?? price ?? campaign ?? 'v1'`.
- **Produktion (summering, bara läsning):** 1 webbavtal, signerat, med `contract_version` satt av en okänd senare skrivare och utan `signed_version` (F45 är inte driftsatt där än).
- **Rättning — RÄTTAD (native 12/12), väntar på verifiering i världen:**
  - Migrationen `20261023100000_contract_version_at_signing.sql` skriver om alla fem signeringsfunktioner: webb (2 varianter), token, `before_record_retention` och trigger-funktionen för adminimport. Teknik som F45, med oförändrad metadata.
  - Uttrycket är `contract_version = coalesce(nullif(contract_version,''), terms_version, 'v1')`, alltså exakt det `signed_version` får när ingen version finns. Skälet: fem grindar kräver `signed_version = contract_version` (bilateral PRODAT-förberedelse, reglerad leverans, BRP-deklaration, utgående förmåga, granskning av ändringsartefakt).
  - En befintlig `contract_version` behålls.
  - Ingen bakåtfyllnad: 65 signerade avtal i världen saknar värdet.
  - **Kontroller:**
    - det nya native-testet `scripts/contract-version-at-signing-native.test.ts`: 12 av 12 (10 av 12 föll före migrationen);
    - masterdata-native: 5 av 5;
    - signatur- och faktureringsprojektion: 14 av 14;
    - de sju `__tests__` som rör signeringen: 83 av 83;
    - retentionsregressionen gick igenom;
    - täckningen för masterplanen: 352 av 352.
- **ÖPPEN (ägs av ägaren till retentionsvakten), medel:**
  - Låset på signerade rader omfattar inte `contract_version`. Fältet kan därför ändras efter signering, vilket sannolikt förklarar produktionsraden.
  - Fältet ingår i `production_contract_hash_v1`.
- **Kvar sedan F45, låg:** om ett avtal redan har en `contract_version` och en annan `terms_version`, blir värdena olika efter signering.
- **Gamla regressionsfel (inte F95):** `gridex-canonical-contract-model-regression.cjs` och `gridex-contract-api-signature-visibility-regression.cjs` fallerar redan på oförändrade filer, eftersom de matchar strängar i filerna.

### T8 Världens Ediel-SMTP-konto var testbrevlådan — RÄTTAD (`up.sh`), verklighetsvärlden
- **Utfall (körning 17):** varje CONTRL till nätägarens Z04 föll med `ediel_technical_ack_route_unavailable`, trots att kvittensrouten fanns.
- **Orsak:**
  - Väljaren kräver att svaret skickas från exakt den adress där originalet togs emot (`current_smtp_from = originalMailboxSmtpAddress`), och att profilens `mailbox` är samma adress.
  - Världens `EDIEL_SMTP_FROM` var testbrevlådan, medan produktionssvaren togs emot i produktionsbrevlådan.
- **Produktionen:** ett enda konto, `EDIEL_SMTP_*` och `EDIEL_IMAP_*` (Vercel, bara namn). Test- och produktionsraden i `ediel_mailboxes` delar samma adress, och bara produktionsraden har IMAP (summering, bara läsning).
- **Rättning:** `up.sh` sätter kontot till den delade brevlådan för kanalen `REALITY_EDIEL_LANE`, med produktion som standard, precis som i produktionen. Scenarier i testkanalen startar världen med `REALITY_EDIEL_LANE=test`.
- **Följd att känna till (designobservation, ingen åtgärd):**
  - En driftsättning kan bara kvittera filer som tas emot på adressen i `EDIEL_SMTP_FROM`.
  - Kvittensroutes sparar adressen när de materialiseras (`mailbox`). Om kontot byts måste de materialiseras om.

### F körning 21 (2026-10-23, ren replay efter omstart av containern): bytet och kvittenserna fungerar från noll
- **Återuppspelningen:** godkändes (PASS) med alla nya migrationer: RPL-01, F95 och F96.
- **Bytet:** 4 Z03 skickades och blev `acknowledged`; nätägarens Z04 togs emot; 4 leveransperioder blev `active`; 4 CONTRL skickades.
- **E66, med F98:** nätägarens 25 E66 fick egna CONTRL (`draft`, sedan köade). Kvittensrouten för UTILTS hittas alltså nu.
- **Z01 står kvar som `queued`:** F90 gör att certifieringen per meddelandetyp bara kan gälla en typ åt gången, och Z03 hade förtur. Det blockerar inte bytet.

### F körning 21, F5–F6c: mätvärdena tas emot och kvitteras, men lagras aldrig (F101)
- **F5–F6b:**
  - nätägaren skickade september och tre dagar i augusti, en fil per dag och mätare;
  - 50 E66 blev `validated`;
  - rättelsefilen för 2026-09-10 togs emot.
- **F6c, operatörens omkörning:** varje omkörning via "Återuppta hållna transaktioner" gav 500, med `0 av 96` lagrade värden per fil. Körningen stoppades efter att rapporten sparats (`report-f-run21.json` i scratchpad).
- **Statement timeouts:** under F6 avbröts många satser på grund av tidsgränsen (≥ 7 per anslutning). Det hör ihop med J3-12 och L1.

### T11 Körning 24: F90-migrationen var inte applicerad i världen — RÄTTAD, verklighetsvärlden (min egen miss)
- **Utfall:** alla 4 Z01 och 4 Z03 föll med `ediel_scoped_capability_evidence_required`. Jobbet för certifieringsbevisen gav `ediel_company_certified_scopes_failed`.
- **Orsak:** agenten körde sina tester av `20261023160000_ediel_company_certified_scope_evidence.sql` i transaktioner som rullades tillbaka, och migrationen applicerades aldrig i världen.
- **Rättning:** migrationen applicerades, och efter `notify pgrst, 'reload schema'` körde jobbet (`status: ran`). Körning 24 kan inte återhämta sig (O1) och ersattes av körning 25.
- **Lärdom:** innan en körning kontrolleras att varje ny migration finns i världen.
- **Observation:** migrationen saknar `notify pgrst, 'reload schema'`. I den lokala världen syntes den nya funktionen inte för PostgREST förrän cachen laddats om. Om den hostade miljön laddar om automatiskt vid DDL är inte kontrollerat. Låg.

### T12 Körning 24 stoppades aldrig och gick parallellt med körning 25 — RÄTTAD, verklighetsvärlden (min egen miss)
- **Utfall:** när körning 25 startade 09:47 levde körning 24:s vitest-process fortfarande (pid 14655, föräldralös under pid 1 efter `setsid`). Två körningar delade databasen, e-postservern och `report.json`, så cron-slotar och rapporter från körning 24 kunde blandas in i körning 25.
- **Orsak:** stoppet av körning 24 dödade bara skalprocessen. Den frikopplade `npm exec vitest`-processen överlevde.
- **Rättning:** båda processträden stoppades via exakta pid, och körning 26 startades i en ren process 09:49.
- **Lärdom:** efter ett stopp kontrolleras att ingen `reality-native`-process lever innan nästa körning startas.
- Resultat från körning 25 räknas inte.
- **Tillägg 10:11:** vitest-arbetaren från körning 24 (pid 14760, förälder pid 1) överlevde SIGTERM. Den levde till `kill -9` 10:11.
  - Den skrev över `report.json` med sin egen tenant (`1000c638…`), så en monitoravläsning 10:10 visade fel tenant.
  - Körning 26:s riktiga tenant är `7b53f121…`. 10:11 hade den 4 Z01 och 4 Z03 kvitterade, 4 utgående CONTRL skickade, 3 Z04 tolkade och 3 aktiva leveransperioder.
  - Monitorn är nu låst till den tenanten i stället för att läsa `report.json`.
  - **Lärdom:** kontrollera processer via `/proc/<pid>/cwd` i världens arbetsträd, inte bara efter kommandonamn.

### T13 Scenarierna G, H, J2, J3, J4, K och E antar fortfarande testkanalen — ÖPPEN → agent, verklighetsvärlden
- Upptäckt vid förberedelsen av G–K-körningarna. Ingen körning har ännu fallerat på det, eftersom G–K inte körts live sedan kanalbytet.
- **Bakgrund:** sedan T7/F90 går tenanterna live i produktionskanalen (Z03 med `environment: 'production'`), och nätägarsimulatorn svarar till produktionsbrevlådan via `platformMailboxFor`. Scenario F rättades då, men inte de andra.
- **Fel i scenarierna:**
  1. Insamlingsslingorna anropar bara `inbound-mail/cron?environment=test`: G:116, H:112, K:140, E:80, J4:198, J3:152 och J2 i `inboundUtiltsWorld.ts:73`. Svar till produktionsbrevlådan skulle aldrig läsas, och scenariot skulle vänta tills tidsgränsen löper ut.
  2. `gridOwnerSends` (`live-chain-fixture.ts:41`) och `sendJ4File` skickar alltid till testbrevlådan, oavsett filens kuvert.
  3. Handbyggda filer bär testindikatorn (UNB 0035=1) trots att tenanten är i produktion: `dst.ts dayE66` (G, K), `inboundUtilts.ts` (J2) och J4-byggarna i `parseConformanceWire.ts`. De skulle hållas som `environment_mismatch` (J3-05) eller hamna i fel kanal.
- I och J1 använder `runOperationalCronSlot`, som redan kör båda kanalerna, och H:s egna PRODAT-filer går redan via `platformMailboxFor`.
- **Åtgärd:** en agent ska ge scenarierna en gemensam insamlare för båda kanalerna, adressera post efter filens kuvert och ge byggarna parametern `environment`. Endast testkod. Ingen produktkod och ingen spärr ändras.
- **RÄTTAD 2026-10-23 (agent + granskning):**
  - **Gemensam insamlare:** `pollInboundMailLanes()` i `world.ts` läser produktionskanalen som Vercel och sedan testkanalen. Alla listade slingor använder den.
  - **Adressering:** `gridOwnerSends` och `sendJ4File` adresserar efter filens kuvert.
  - **Byggarna** `dayE66`, `utiltsE66`, `utiltsE31`, de fyra fristående J4-byggarna och `buildZ05End` har fått `environment`. Standardvärdet är test, och testindikatorn sätts bara i testkanalen.
  - G, J2, J4 och K skickar nu produktionsfiler. I H skickas Z05 och E66-satsen i produktion.
  - **Tester:** 58 av 58 gröna. Varje byggare provas med standardvärde, test och produktion, och avkodad kanal och vald brevlåda kontrolleras. J4 kontrollerar dessutom `expectedParse` i produktion. Typkontroll (`tsconfig.scripts.json`) och eslint utan fel.
  - **Fynd vid rättningen (alla rättade):**
    - H5:s E66-sats skickades utan `environment: 'production'`, så simulatorn skrev testfiler.
    - `buildZ05End` hårdkodade testindikatorn (`++1++1`), så Z05 i H4 och K5 gick till testbrevlådan för en produktionstenant.
  - **Kvar, ÖPPNA:**
    - E och J3 kör fortfarande med testtenanter (`configureTenant`). Det verkar avsiktligt: J3-6 testar avbrott i testbrevlådan. Premissen att alla tenanter går live i produktion gäller alltså inte för dem. Låg.
    - H:s och K:s `receiveUntil` kontrollerar inte inkorgens svarsstatus, till skillnad från F och G. Status registreras bara. Låg.
    - F har kvar sin egen slinga med två anrop och kan byta till hjälparen. Kosmetiskt.
    - `tsconfig.tests.json` har ett befintligt fel i `__tests__/supplier-switch-requested-start.test.ts:47`, som inte är berört här. Låg.

### Ägarbeslut 2026-10-23
- **F89/F90/F91, certifiering i produktion:** "Certifieringar ska vi använda oss av vår certifiering samt krypteringen vi har."
  - Produktionssändning vilar på bolagets egen godkända Ediel-certifiering (`ediel_certification_evidence`, `canonical_ediel_production_evidence_readiness`, förmågan `ediel_production`) och på vår egen S/MIME-kryptering.
  - Bevis per meddelandetyp och release, som ingen produktväg kan skapa, ska inte längre krävas.
  - Övriga spärrar finns kvar: tenantens behörighet, roll, regelpaket, S/MIME, certifikat och routekontrakt.
  - Implementeras av en agent.
- **F89/F90, uppföljning (agentanalys och nytt ägarbeslut):**
  - **Krocken med godkända masterplanregler:** beslutet att bolagets certifiering ska räcka direkt motsäger godkänt beteende i tre regler.
    - OPS-01/AT-OPS-01 (`__tests__/ediel-scoped-capability-readiness.test.ts:37,104`): en ny release eller route ska ogiltigförklara beviset.
    - SC-069 (`__tests__/ediel-sc-069-scope-inbound.test.ts:261,266-267,279-280`): en ändrad regelversion kräver ett nytt bevis, och Z01-bevis får aldrig gälla Z13.
    - IMP-05/AT-IMP-05 (`scripts/ediel-scoped-readiness-sql-regression.mjs:160-165,190-191,293-294`).
  - **FYND, spärren finns på två ställen:** samma spärr upprätthålls också i databasens transportlager.
    - `gridex_ediel_transport.mutate_before_service_origin_v1` anropar `ediel_require_scoped_capability_for_message_v1`.
    - AI-listor går genom `gridex_ai_processing.require_ai_outbound_source_before_origin_v1`.
    - Att bara byta TypeScript-anroparen räcker alltså inte.
  - **FYND:** `canonical_record_platform_release_receipt` har ingen anropare i CI, så inget skriver ett verifierat release-kvitto vid driftsättning.
  - **Ägarbeslut ("Automatiska bevis"):**
    - Masterplanreglerna och spärrarna lämnas oförändrade.
    - Plattformen registrerar själv beviset för varje aktiverad meddelandetyp utifrån bolagets egen godkända certifiering: vid go-live och efter varje deploy, route-ändring eller ändrad regelversion. Det görs i ett jobb före utkorgen, aldrig i själva spärren.
    - Flera typer kan då gälla samtidigt, vilket rättar F90.
    - Implementeras av en agent.
- **F89/F90/F91 — RÄTTADE ("Automatiska bevis", agent, native gröna):**
  - **Varför v1 kan godta bevisen:** readiness v1 kräver att de lagrade certifieringsraderna är identiska med de levande, `passed` och inte utgångna. Den läser aldrig vilken meddelandetyp en rad är bunden till; det kravet finns bara i record-RPC:n och är själva F90-felet. Ett bevis med bolagets oförändrade rader godtas därför för hur många typer som helst. Det ogiltigförklaras fortfarande vid ändrad rad, ny release, route, regelpaket eller certifikat.
  - **Ny funktion:** `ediel_record_company_certified_scope_evidence_v1` och en batchvariant, i migrationen `20261023160000`. Den registrerar bara när alla förutsättningar gäller:
    - förmågan är ready;
    - bolagsgrinden för certifieringsbevisen är ready;
    - tenantoperationen är tillåten;
    - rollen är tillåten;
    - routeprofilen är produktionsgodkänd;
    - ingen explicit deny finns;
    - det finns ett verifierat release-kvitto.
  - **F91:** förmågeraden skrivs i samma block och härleds från den godkända profilen.
  - **Jobbet:** `lib/ediel/companyCertifiedScopes.ts` körs före utkorgen, aldrig i spärren. SC-069 gäller därmed fortfarande.
  - **Release-kvittot:** ett nytt steg i `.github/workflows/vercel-production-deploy.yml` (`scripts/record-production-release-receipt.mjs`) skriver det bara från observerade fakta: git HEAD, `GITHUB_SHA` och Vercel-deploymentens commit stämmer överens, deploymenten är READY i produktion och `platform_runtime_readiness` är ready.
    - **ÄGARÅTGÄRD:** lägg till GitHub-hemligheterna `GRIDEX_PRODUCTION_SUPABASE_URL` och `GRIDEX_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY`. Tills dess hoppar steget över, och sändningar i produktion förblir spärrade.
  - **Tester:**
    - OPS-01, SC-069, OPS-04 och TR09 samt 2 nya enhetstester: 149 gröna;
    - IMP-05: 43 PASS;
    - F90-testet (oförändrat): grönt;
    - nytt native-test, grönt: Z01, Z03 och UTILTS samtidigt; en ny SHA nekas tills jobbet har körts igen; en ändrad certifieringsrad ogiltigförklarar allt; nekade fall registrerar ingenting; en annan tenants certifiering räknas aldrig;
    - typkontroll och eslint utan fel.
  - **Täckningen:** först 350 av 352, där AT-Z02L/LK-SUPPLIER gav tidsrelaterade fel under belastning. `__tests__/ediel-z02-original-grid-refusal.test.ts` gav sedan 7 av 7 när det kördes ensamt.
  - **FYND, inte rättade:**
    - F36 kvarstår: beviset kräver att förmågan är ready, vilket den blir först vid live, så en provkörning före go-live får inget bevis.
    - Ingen UTILTS-utgåva är aktiv i världen just nu: 2025-utgåvan slutade 2026-09-30 och nästa är `future`, så v1-capture nekar all utgående UTILTS i produktion där.
    - Lucka vid första produktionssändningen: bevis som registrerats före den förblir giltiga i upp till 30 dagar, även när bolagsgrinden därefter kräver `LIMITED_PILOT`. Bara tenantoperationens kontroll nekar då. Låg till medel.
- **K-06, churnmånad:** "spelar inte roll, gör det som är bäst."
  - Beslut: churn räknas i månaden för kundens **sista leveransdag**. Slutdatumet normaliseras efter källa: en Z05 är exklusiv och ett manuellt avslut är inklusivt.
  - Skäl: kortet säger redan "Sista leveransdag i månaden", det stämmer med hur leveransen faktiskt upphör, och samma avflytt hamnar då i samma månad oavsett källa.
  - Implementeras av en agent.
- **Planen:** scenario F körs klart till faktura. Därefter körs G, H, I, J1–J4 och K i världen, ett i taget, och varje fel rättas och dokumenteras.
- **Väntar fortfarande på beslut:**
  - F94: vilket UTILTS leverantören själv skickar till nätägaren;
  - B1/O1: spärrade och fallerade utkorgsposter försöks aldrig igen.

### F körning 22 (2026-10-23): mätvärdena lagras för första gången hela vägen från nätägarens E66
- **Bytet:** Z03 skickades och kvitterades; nätägaren svarade med Z04; 4 leveransperioder blev aktiva.
- **Kvittenser:** 59 CONTRL skickades till nätägaren, för både Z03 och alla E66. F92, F96, F98 och F100 är därmed verifierade i världen.
- **F6c, operatörens omkörning:** 3 744 septembervärden för 2 anläggningar lagrades. 3 736 är `eligible` och 8 är `blocked: supply_source_unqualified`. F101 är därmed verifierad i världen.
  - Efter migrationen lagrades även 1 297 värden för körning 21:s tenant.
- **Avbrott:** körningen stoppades av verktygets tidsgräns på 2 timmar för bakgrundskommandon, mitt i F6c. Omkörningen tar ungefär 1 minut per fil.
  - Detta är en begränsning i testmiljön, inte i produkten. Körning 23 startas därför frikopplad.
- **Att följa upp:** de 8 spärrade värdena med `supply_source_unqualified`, sannolikt gränsen vid leveransstarten.

### F102 Varje inkommande produktionsmeddelande lagras med `test_flag=1` — BEKRÄFTAD (världen), hög (latent i produktion); utreds av agent
- **Utfall:** i världen har alla 425 inkommande produktionsmeddelanden från senaste dygnet `test_flag=1`, medan utgående produktionsmeddelanden har 0. Gäller bland annat körning 26:s fyra Z04, som annars är korrekta produktionsmeddelanden: UNB `++1` är kvittensbegäran (0031), och 0035 saknas.
- **Orsak:** insert-vägen i `lib/inbound-mail/inboundStatusUpdater.ts` (`insertPayload`, `parsed_by_batch_7a1_inbound_mail_engine`) sätter aldrig `test_flag`, och kolumnens standardvärde är 1. `lib/ediel/db.ts:435` har samma standardvärde. `edielInboundProcessor.ts:236` sätter däremot flaggan efter miljö.
- **Möjliga följder (att bevisa):**
  - `customer-cases/engine.ts:233,504` kopierar källans flagga till utgående svar. `productionGuards.ts:152` stoppar sedan produktionssändning med `production_test_flag`.
  - `ack.ts:532` behandlar flaggan som testkörning.
  - `actorTestingEngine` väljer testmeddelanden på flaggan.
- **Produktion (bara aggregat):** ett enda Ediel-meddelande, ett test/inbound. Felet är alltså latent där.

- **RÄTTAD 2026-10-23 (agent + granskning):**
  - **Orsak:** tre inkommande insert-vägar satte aldrig `test_flag`, så kolumnens standardvärde 1 gällde:
    1. `inboundStatusUpdater.ts` (`createInboundEdielMessage`);
    2. `canonicalInboundAckStatusUpdater.ts` (`persistInboundAck`, de inkommande CONTRL/APERAK);
    3. SQL-funktionen `gridex_ediel_header_negative_birth.create_v1`.
  - **Bevisade följder** (anrop av koden, inte strängsökning):
    - **Hög:** `decideProdatAperak` (`decisionEngine.ts:247`) hoppar över `manual_review_required` för en produktions-Z14, Z15 eller Z18 utan koppling till process eller fullmakt, och planerar i stället ett positivt APERAK.
    - **Hög:** admins "RADERA TESTDATA" (`actions.part-2.ts:105`) behandlar inkommande produktionsoriginal som testdata. Den raderar deras händelser, ärenden och testkopplingar innan oföränderlighetsspärren stoppar själva raden, så sidotabellerna förstörs utan atomicitet.
    - **Utan bevis, bara läsning:** `contextKind` i `edielProcessingPipeline.ts:35` märker körningen fel.
    - **Ingen följd (bevisat):** kundärendets svar (källan är det utgående Z03:et) och E66-portalkontrollen.
    - Min hypotes om `production_test_flag` för ärendesvar var alltså fel och avfärdas.
  - **Rättning:** `inboundTestFlag.ts` sätter test → 1 och produktion → 0. En utväxling med UNB 0035=1 får alltid 1, så J3-05 försvagas inte. Båda TypeScript-vägarna använder funktionen. Kolumnens standardvärde ligger kvar på 1, eftersom `createEdielMessage` själv har standardmiljön test och 1 därmed är konsekvent och säkert för utgående meddelanden.
  - **Migration `20261023180000_ediel_inbound_production_test_flag.sql`:**
    - ersätter `create_v1` med en kropp som är identisk utom att flaggan sätts uttryckligen;
    - rättar inkommande produktionsrader utan 0035=1 en gång, med `metadata.f102_test_flag_from`, utan att röra `updated_at`;
    - torrkörd i en transaktion som rullades tillbaka: 409 rader, inga sidoeffekter från triggers;
    - **INTE applicerad i världen ännu**, eftersom den skulle skriva om 16 rader för körning 26:s levande tenant. Den appliceras efter körningen.
  - **Tester:**
    - `reality-f102-inbound-production-test-flag` 9 av 9, där 7 föll med den gamla koden;
    - 184 relaterade testfiler, 2 805 tester;
    - typkontroll och eslint utan fel;
    - täckningen 352 av 352. SC-014 föll en gång under parallell last men var grön ensam och vid omkörningen.
  - **Sidofynd, ÖPPNA:**
    1. J3-05 håller bara i en riktning. En testbrevlåda som tar emot en produktionsutväxling hålls inte. En produktionsbrevlåda som får 0035=1 hoppar över spärren när en Test Center-bindning finns (`edielInboundProcessor.ts:355`). Medel.
    2. Ett avbrottsärende utan källa skapas som test (`environment:'test'`, `testFlag:1`) även för en produktionstenant (`customer-cases/engine.ts:503`). Medel.
    3. Testdatarensningen gissar på mottagare 91100, `@ediel.se`, AGT/TGT eller "test" i brevlådenamnet. Den läser bara `limit(5000)` utan ordning och raderar inte atomiskt. Hög.
    4. `actions.part-4.ts:1051` och `selftest.ts:656` anropar `registerInboundCanonicalMessage` utan miljö och kastar därför alltid `canonical_inbound_scope_required`. Medel.
    5. Fyra inkommande produktions-E66 i världen saknar postkoppling och `validation_report`. Troligen direkta seeds. Låg.
    6. En inkommande Z04 i testkanalen (`0e79c120…`) har `raw_payload` null och står kvar i `received`. Låg.
    7. SC-014 är tidskänsligt under last. Låg.

### F103 En av fyra Z04 från samma inkommande körning blev aldrig behandlad och står kvar i `received` — BEKRÄFTAD (världen, körning 26), hög; utreds av agent
- **Utfall:** de fyra Z04 togs emot 10:04:16 och lagrades 10:05:53–55. Tre blev `parsed` inom 14 sekunder med aktiva perioder. Den fjärde (`db3b04be…`, anläggning `…170171`) har bara händelsen `linked` och står kvar i `received`.
  - Postraden är `processed/matched`, och bytet står kvar som `prepared`.
  - Ingen senare cron-slot (varje minut) tog upp den, och appens logg visar inget fel.
- **Konsekvens:** en av kundens fyra anläggningar får aldrig sin leveransperiod, och inget syns för operatören.
- **Hypoteser:** budget per körning, ett svalt fel efter `linked`, en låskonflikt med de tre andra Z04:orna för samma kund, eller att ingen sopare återupptar inkommande meddelanden i `received`.

- **RÄTTAD 2026-10-23 (agent + granskning):**
  - **Orsak**, bevisad med skrivskyddade läsningar i världen:
    - Den första affärsbehandlingen kastade `prodat_canonical_source_validation_unconfirmed` (`inboundProcessing.ts:390`). `recordReceivedSourceValidation` omsluter `gridex_record_prodat_source_validation_v6` med `AbortSignal.timeout(2000)`.
    - Databasen skrev bedömningen ändå, 2,36 sekunder efter `linked`. Funktionen har max 2 233 ms i `pg_stat_statements`, och syskonen tog 0,18–0,35 sekunder.
    - Samtidigt behandlade testkanalens motor sex produktionskvittenser.
    - Felet hamnade bara i körningsloggen (`ediel_inbound_poll_runs.autoProcessErrors`) och aldrig på meddelandet.
    - Ingen cron, sopare eller stuck detector väljer om ett inkommande meddelande i `received` när posten redan är `processed`. Meddelandet blir därför strandat för alltid.
    - Det var inte budget, dedupe eller lås.
  - **Rättning (`strandedInboundEdielResume.ts`):**
    - Ett fel vid första körningen skrivs som en varaktig händelse på meddelandet.
    - Den inkommande cron-körningen återupptar, i sin egen kanal, meddelanden som är `received/received` och `tenant_resolved` och vars post är `processed` i samma bolag. De ska vara minst 10 minuter gamla, högst 7 dygn, och ha färre än 3 försök.
    - Varje meddelande tas med compare-and-set på `updated_at`, så två samtidiga körningar inte kan ta samma.
    - Behandlingen körs om via samma `processInboundEdielMessage` som operatörens omkörning. v6 returnerar den befintliga bedömningen, och CONTRL skapas inte dubbelt.
    - Efter 3 försök lämnas en notering till operatören.
  - **Tester:**
    - `reality-f103-stranded-inbound-resume` 6 av 6. Helkedjan föll med den gamla `part-3`. Testerna täcker även urvalets spärrar, två samtidiga anspråk, gränsen för antal försök och att databasen hinner skriva klart medan klienten avbryter.
    - Agenten körde 213 tester för motor och cron och 3 273 för inkommande post. Ett befintligt test, `test-center-raw-import-envelope-lookup`, gick i timeout under parallell last men passerade ensamt.
    - Typkontroll och eslint utan fel, täckningen 352 av 352.
    - Jag körde om F103-testet och motortesterna, 10 av 10, och eslint.
  - **Världen:** `db3b04be` är den enda kandidaten i båda kanalerna. Den tas upp automatiskt av första produktions-cron efter ombyggnaden av appen.
  - **Sidofynd, ÖPPNA:**
    1. **Statusregression, sannolik:** Z04-intaget sätter utgående begäran till `confirmed`, och kvittensbehandlingen (`inboundAckProcessing.ts:397`) skriver sedan över med `acknowledged`. J1-01:s 30-minutersvakt utlöses därför aldrig, och 24-timmarsvakten `ediel_z04_overdue` kommer falskt att larma "Z04-svar saknas", även för slutförda byten. Hög.
    2. **Kanalläckage:** testkanalens motor tog 6 produktionsjobb, eftersom `claim_inbound_processing_jobs` inte filtrerar på miljö. Samma meddelanden behandlades parallellt av båda kanalerna. Hög.
    3. **Tidsgräns som ljuger:** `AbortSignal.timeout(2000)` på 41 ställen i `lib` gör att en skrivning som lyckats i databasen rapporteras som misslyckad. Medel.
    4. **Dubbelbehandling:** manuell pollning (`inboundProcessing.ts:1461-1484`) kör motorn, som redan behandlar meddelandena, och sedan `processInboundEdielMessage` igen på samma id:n. Medel.
    5. **Typglapp för händelser:** TypeScript-typen `EdielMessageEventType` saknar typer som databasen tillåter (`retry`, `inbound_mail_processed` m.fl.) och har typer som databasen avvisar (`dispatching`, `provider_accepted`, `delivered`). Medel.
    6. **Felräkning:** kontrolltornets `overdueAcks` räknar varje rad med `ack_due_at` utan att jämföra med nu. Låg.
    7. **Andra rader i `received`:** 25 Z04 i testkanalen (rester från native-tester) och en produktions-UTILTS (`c87918c4`) vars post står i `manual_review`. Inte utredda. Låg.
    8. **Index saknas** för återupptagningens urval över tenanter. Kostnaden är inte mätt. Låg.

### F104 Testkanalens inkorgsmotor tar produktionsjobb — BEKRÄFTAD (världen, körning 26), hög; RÄTTAD (kod + migration)
- **Orsak:** `claim_inbound_processing_jobs` filtrerar redan på `p_environment`, men anroparen `claimQueuedInboundProcessingJobs` (`edielMailboxPoller.part-2.ts`) skickade alltid `p_environment: null`. `runInboundEdielMailEngine` skickade aldrig sin kanal vidare, så varje kanalkörning tog jobb från alla kanaler.
- **Bevis från världen** (skrivskyddat):
  - Testkörningen `c6d8dcc6` hämtade 0 brev men tog 6 produktionsjobb (10:05:53.069). Bakom jobben låg exakt de sex produktionskvittenserna (4 CONTRL och 2 APERAK) för tenant `7b53f121`.
  - Produktionskörningen `df0b5faa` behandlade samma sex samtidigt.
  - Det är den enda testkörning någonsin med `processed_jobs > 0`.
- **Bevisade följder:**
  - Fel kanal tog jobben.
  - Två körningar behandlade samma meddelanden parallellt. `72236dbf` gick igenom två gånger med dubbla händelser, och `ff20fb9a` delvis två gånger.
  - Körningsstatistiken var fel.
  - **Inga dubbla auktoritativa effekter:** kvittensauktoriteten, SLA-timrarna, revisionen, ärendena och bytesbegärandena skrevs en gång var, och ingen CONTRL eller APERAK skickades dubbelt. Det beror på ett tabellås, en `prior`-kontroll och unika index.
- **Rättning:**
  - Kanalen skickas vidare hela vägen. En okänd kanal avvisas i stället för att breda ut sig till alla kanaler.
  - En kanalkörning faller aldrig tillbaka till den kanallösa listningen.
  - Admins knapp "kör kön" tar fortfarande alla kanaler, avsiktligt.
- **Migration `20261023190000_inbound_processing_claim_lane.sql`** (härdning):
  - Jobbets kanal blir `coalesce(m.environment, mb.environment, 'test')`. Tidigare gick ett brev utan miljö i en produktionsbrevlåda till testkanalen.
  - En okänd `p_environment` ger fel 22023.
  - Lås och lease är orörda. Ägare, ACL, `SECURITY INVOKER` och `search_path` kontrolleras.
  - Inte applicerad i världen ännu.
- **Tester:**
  - native 5 av 5 i transaktioner som rullas tillbaka. Med den gamla funktionen föll 3.
  - enhetstester: 8 för F104, varav 7 föll med den gamla koden, och totalt 34 av 34 med de relaterade sviterna. Jag körde om 18 av 18.
  - typkontroll och eslint utan fel.
- **Kontrollerade, inte ändrade:**
  - Utkorgen är kanallös med flit, eftersom samma sändare tjänar båda kanalerna.
  - Manuell inkorg filtrerar på miljö, men en okänd miljö ger tyst noll.
  - Webhooks har inget kanalbegrepp.
  - `customer_operation_jobs` saknar miljö och töms av båda kanalernas körningar, så testkanalen kör produktionstenanters kundoperationer. Det är avsiktligt men bör vara känt.
- **Sidofynd, ÖPPNA:**
  1. **Lopp inom samma kanal:** två körningar i samma kanal kan fortfarande behandla samma meddelande. Världen visar dubbla körningar inom en sekund vid 10:05:52, 10:07:16, 10:09:28 och 10:10:33. Bara kvittensauktoritetens lås och kontrollen av redan sparade kvittenser stoppar dubbla effekter. En riktig rättning kräver ett anspråk per meddelande. Hög.
  2. **Kanallösa steg i motorn:** `createInboundOverdueTasks` skannar `outbound_requests` globalt i varje kanalkörning, och `listRecentParsedInboundEdielIds` saknar kanalfilter. Medel.
  3. **Grants:** `claim_inbound_processing_jobs` ger EXECUTE till `anon` och `authenticated`. RLS begränsar, men grantsen borde tas bort. Låg.
  4. **Manuell granskning:** 492 produktionsjobb står i `manual_review` (04:12–11:09). Medel, ska utredas.
  5. **APERAK utan CONTRL:** `ff20fb9a` och `e2adb097` fick "CONTRL skapades inte: ediel_technical_ack_route_unavailable", och deras `contrl_due`-timrar blev kritiska 10:30. Hög, eftersom ett CONTRL-krav inte uppfylls.
- **Falskt positivt:** agenten trodde att täckningsskriptet avslutas med kod 0 trots fallerande tester. Skriptet gör `process.exit(1)` vid `--check` när problem finns, rad 118. Agenten läste sannolikt exit-koden från en pipe.
- **F105:s pågående arbete:** F105-agentens ocommittade ändring i `lib/cis/db-outbound.ts` fick AT-Z01L-SUPPLIER och AT-Z01LK-SUPPLIER att falla (`unexpected_finite_port:update_field:outbound_requests:updated_at`). Agenten är informerad. Inget av det är committat.

### F105 Bytesbegärans status `confirmed` från Z04 skrivs över med `acknowledged` av en senare kvittens — BEKRÄFTAD (världen + kod), hög; RÄTTAD
- **Bevis:**
  - Ingen statushistorik finns, så tidsstämplarna får tala. `updated_at` på alla fyra Z03-begäranden i körning 26 ligger 40–120 ms efter deras Z04, alltså skrivningen av `confirmed`.
  - Sista dispatch-händelsen är "Outbound request uppdaterad till acknowledged" 10:06:04–05 med `acknowledgedVia = inbound_ediel_ack`.
  - Med den gamla koden ger den riktiga vakten nästa dygn "Z04-svar saknas". J1-01 kan inte heller slå till, eftersom den bara tittar på `confirmed`.
  - Ett native-test med egen tenant och riktigt intag och runtime återskapar regressionen.
- **Orsak:**
  - `updateOutboundRequestStatus` (`lib/cis/db-outbound.ts`) skrev vilken status som helst utan att se på den nuvarande.
  - `inboundAckProcessing.ts:397` anropar den med `acknowledged`.
  - Den godkända regeln P-11 förbjuder detta: "Sena kvittenser får inte backa ett giltigt affärstillstånd".
- **Rättning:**
  - `lib/cis/outboundStatusLattice.ts` är en gemensam regel. En utskicks- eller positiv kvittensstatus ersätter aldrig en avgjord status (`confirmed`, `business_response_received`, `completed`, avvisningar, `cancelled`). En senare teknisk status ersätter inte heller en flagga om uppmärksamhet efter kvittens, ett negativt kvitto eller ett senare tekniskt steg.
  - **Statusskrivaren:** gör compare-and-set på den lästa statusen med omläsning, högst tre försök. Kvittensfakta (id:n, `acknowledged_at`, en dispatch-händelse) registreras även när statusen behålls. Operatörens formulär kan fortfarande backa uttryckligen (`allowStatusRegression`).
  - **Intagets skrivare:** använder samma lista.
  - **24-timmarsvakten för Z04:** hoppar över ett byte som redan har Z04 eller avgjord status.
  - Ingen migration, eftersom den enda SQL-skrivaren bara flyttar `draft/queued/prepared` till `sent`.
- **Rättade varianter:**
  - en sen kvittens kunde återuppliva ett `cancelled` försök;
  - Z02- och UTILTS-svar backade `business_response_received`;
  - vid intaget suddade en positiv CONTRL ut en negativ APERAK och dess `failure_reason`;
  - en CONTRL efter APERAK backade till `syntax_accepted`;
  - samma regression för Z13 hade matat 24-timmarsvakten för Z14;
  - lopp mellan intag och skrivare.
- **Tester:**
  - `reality-f105-outbound-status-monotonic` 37 av 37, där 15 föll med den gamla koden;
  - native-testet faller på HEAD och passerar nu;
  - 108 relaterade sviter, 1 599 tester;
  - jag körde om F105, AT-Z01L/LK och F102: 55 av 55;
  - typkontroll och eslint utan fel;
  - täckningen 352 av 352 med 0 fallerande, kontrollerat i utdatatexten.
- **Agentens första version bröt godkända tester:** den skrev `outbound_requests.updated_at`, vilket fick de godkända AT-Z01L-SUPPLIER och AT-Z01LK-SUPPLIER att falla (finite port). F104-agenten upptäckte det, och skrivningen togs bort innan commit.
- **Sidofynd, ÖPPNA:**
  1. **J1 native-baslinjen** faller i världen med en negativ APERAK, "ERC 42/214 Felaktigt Konstant för mätare". Samma 5 fel finns på oförändrad HEAD. Medel.
  2. **Befintliga rader** i världen står kvar som `acknowledged`. Ingen bakåtfyllnad gjordes. Låg.
  3. **SLA-timern backar:** på Z04 `0d5fbeb5` gick timern från resolved (10:28:49.47) till warning (10:28:49.54) och sedan critical. Hög, eftersom den ger falska larm.
  4. **Sen negativ kvittens:** en sådan efter Z04 sätter fortfarande begäran till `failed` eller `application_rejected`. Bytet skyddas av P-11. Medel.
  5. **Gap i intagets enkla filter:** det skyddar varken en flagga efter kvittens eller ett negativt `failed` mot en senare positiv CONTRL. Låg.
  6. **Ingen pålitlig historik:** statusskrivaren uppdaterar aldrig `updated_at`, vilket den godkända Z01L-porten låser fast. Intagets och SQL:s statusskrivningar lämnar ingen dispatch-händelse. Medel.
  7. **Typglapp:** TypeScript-typen för status har 6 värden medan datat använder ungefär 14, och databasen saknar check constraint. Medel.
  8. **`acknowledged` är överlastat:** Z02- och UTILTS-skrivarna använder det för "affärssvar mottaget". Medel.
  9. **Payload skrivs över:** när statusen hålls ersätts `response_payload` fortfarande av kvittensens nyttolast, som förut. Affärsuppgifter från Z04 i payloaden kan skrivas över. Låg, inte en regression.

### F107 "Återuppta hållna transaktioner" svarar 500 fast värdena lagras — BEKRÄFTAD (världen, körning 26), medel; ej utrett
- **Utfall:** i F6c har operatören tryckt på knappen för 70 av 123 filer (12:54). Alla 70 gav `actionStatus: 500`, men varje fil har `stored 96 = expected 96`.
- **Konsekvens:** operatören ser ett fel efter en lyckad åtgärd. Det kan leda till upprepade tryck och ärenden i onödan, och det döljer riktiga fel bakom samma 500.
- Troligen samma klass som F103: en lång kedja där ett efterföljande steg kastar eller tidsgränsen löper ut efter att lagringen redan är gjord. Ska utredas efter körningen.

- **RÄTTAD 2026-10-23 (agent + granskning):**
  - **Orsak:**
    - Åtgärden `processEdielOperationalMessageAction` (`actions.part-3.ts`) går via `processInboundUtiltsMessage` (`utiltsDataRequest.part-2.ts`). Den uppgraderar transaktionen i liggaren, lagrar värdena, skapar underlaget och anropar först därefter `createUtiltsRuntimeAcks` för APERAK. Det anropet kastade.
    - Catch-blocket i åtgärden kände inte igen felet. Det skrev "… misslyckades. Inga tidigare svar har ändrats.", vilket är fel eftersom 96 värden redan var lagrade, och kastade vidare, vilket gav HTTP 500.
    - Felen bakom: i körning 28 F111 (`ediel_ack_atomic_foreign_source_resource`, 14 rader i loggen). I körning 26 F106b ("Ingen aktiv communication_route för ediel_ack", 81 källor) och statement timeouts (28).
    - Testkörningen läste inte fel: `submitServerAction` ger den verkliga statusen.
  - **Rättning:**
    - `lib/ediel/utilts/utiltsReplyAfterStore.ts`: om svaret fallerar efter att värden eller underlag lagrats skrivs en felhändelse på källan, med fasen `utilts_reply_failed_after_store`, id:n, antal och fel. Felet märks och kastas oförändrat vidare, så andra anropare beter sig som förut.
    - Åtgärden svarar 200 med `{status:"reply_failed_after_store"}`, skriver ett försök med utfall, antal lagrade värden, saknat svar och orsak, och revaliderar sidan. Omärkta fel kastas som förut.
    - Sidan visar senaste misslyckade försök i rött.
    - Idempotens och spärrar är oförändrade.
  - **Tester:** `reality-f107-utilts-reply-after-store-processor` och `reality-f107-utilts-resume-action-report`, 9 av 9. Fyra föll med den gamla koden. Agenten körde 36 relaterade sviter med 675 tester. Typkontroll och eslint utan fel, och täckningen 352 av 352.
  - **Sidofynd:**
    1. **KRITISKT, ÖPPET:** ingen hållen E66 har någonsin fått sin APERAK eller UTILTS-ERR efter omkörningen. 239 källor har lagrade värden men inget applikationssvar, och SLA har gått ut. F111 löser den nuvarande blockeringen; verifieras i nästa F-körning.
    2. `failure_reason` behåller den gamla hålltexten även efter lagring, eftersom `updateEdielMessageStatus` aldrig kan rensa den. Medel.
    3. Det finns ingen status som betyder "lagrad, väntar på svar". Meddelandet står kvar som `parsed`. Låg.
    4. Efter ett misslyckat försök byter knappen namn till "Kör UTILTS engine / skapa TGT-svar", vilket är rätt men lätt att missa. Låg.
    5. Lagringen tar cirka 64 sekunder per fil med 96 värden (P1).
    6. Loggbrus: PGRST205 för `production_route_wizard_runs`, tenant-provisioneringen, IMAP-hemligheten för den manuella brevlådan (sedan tidigare), samt 123 "Skipping customer-scoped task because no canonical customer is resolved". Låg.
  - **Testkörningen (T17):** F6c kontrollerar bara lagrade mot förväntade värden. Den ska också läsa utfallet för `utilts_source_resumption_attempt` eller om APERAK/UTILTS-ERR finns. Läggs till.

### F106 Våra tekniska kvittenser till nätägaren går förlorade under last, och SLA-timrarna stängs inte — BEKRÄFTAD (världen, körning 26), kritisk för Ediel-efterlevnad; utreds
- **Underlag** (skrivskyddat, tenant `7b53f121`, 12:40):
  - **E66:** 123 har tagits emot, och 81 har en utgående CONTRL (63 `sent`, 18 `draft`). 42 E66 från 10:51–11:09 har ingen CONTRL alls.
  - **Händelser på E66:**
    - "CONTRL skapades inte: canceling statement due to statement timeout · kod: 57014" 57 gånger;
    - "CONTRL skapades inte: ediel_existing_ack_original_read_unavailable" 3 gånger;
    - "CONTRL hanterad via canonical kernel." 18 gånger.
  - **Utkast:** alla 18 CONTRL i `draft` saknar post i `ediel_outbox` (NO_OUTBOX). De är skapade men köas aldrig och skickas därför aldrig.
  - **APERAK:** de 4 inkommande APERAK har 0 CONTRL. Händelserna lyder "CONTRL skapades inte: ediel_technical_ack_route_unavailable" och "APERAK skapades inte: Ingen aktiv communication_route för ediel_ack". Rättningen av ACK-routerna i F92 täcker alltså inte inkommande APERAK. Två `contrl_due` blev kritiska 10:30.
  - **SLA-timrar:** `contrl_due` har 123 `open`, 4 `critical` och 3 `resolved`, trots att 63 CONTRL har skickats. `aperak_due` har 123 `open` och 3 `critical`. Timrarna stängs alltså inte när svaret skickas, eller så räknar de fel. Ska utredas.
  - **CONTRL på CONTRL:** inkommande CONTRL har `requires_contrl=t`. En CONTRL ska aldrig kvitteras med en ny CONTRL. Antingen sätter simulatorn kvittensbegäran i UNB, eller så härleder plattformen kravet fel. Ska utredas.
- **Orsak (delvis):** `ediel_create_outbound_ack_atomic_v1` tar i snitt 2,6 sekunder och upp till 8 (P1). Under last ger det statement timeout, och inget försöker skapa den missade CONTRL:en igen.
- **Konsekvens:** nätägaren får inte de tekniska kvittenser Ediel kräver. I produktion leder det till omsändningar, eskalering och avtalsbrott mot motparten.

- **F106 del A RÄTTAD 2026-10-23 (agent + granskning):**
  - **Fördelning** av de 123 E66: 63 fick en skickad CONTRL, 18 ett utkast som aldrig köades (16 på grund av timeout, 2 läsfel) och 42 ingen CONTRL alls (41 timeout, 1 läsfel).
  - **(a) Timeout förlorar kvittensen för alltid:**
    - Det tekniska steget i `processInboundEdielMessage` fångar felet och skriver bara en notering. Meddelandet slutar ändå som `parsed` eller `validated`.
    - Ingenting tar upp det igen: jobbet är klart, F103 väljer bara `received`, och någon sopare finns inte.
    - Andra försöket (UTILTS-runtime) gick också i timeout. Världens app körde kod från före F103, så felet hamnade bara i körningsmetadata.
  - **(b) De 18 utkasten:** efter det första felet skapade `createUtiltsRuntimeAcks` → `createAckIfMissing` (`utiltsDataRequest.part-1.ts`) en CONTRL, men den vägen anropar aldrig `createOutboxItem`. En skickad CONTRL har händelserna `created` → `queued` → `sent`, ett utkast bara `created`.
  - **(c) `ediel_existing_ack_original_read_unavailable`** är samma timeout i lässteget. `formatErrorMessage` tappar orsaken (57014).
  - **(d) `requires_contrl=t` på inkommande CONTRL är vårt eget fel, inte simulatorns:**
    - Insert-vägen i `canonicalInboundAckStatusUpdater.ts` sätter aldrig fältet, så standardvärdet true gäller. Samma klass som F102.
    - Ingen CONTRL planeras dock för en CONTRL: steget hoppas över, och 0 sådana rader finns.
    - Inte rättat eftersom filen var under arbete av del B. ÖPPEN, låg.
  - **Mätning:**
    - PostgREST har `statement_timeout=8s` och `lock_timeout=8s`, vilket förklarar maxtiderna på cirka 8 sekunder.
    - Varje läsning och skapande av kvittens tar tabellås som serialiserar alla tenanter, bland annat `LOCK ediel_messages IN SHARE ROW EXCLUSIVE` och SHARE-lås på ungefär 40 tabeller.
    - Inuti låsen skannar `gridex_ediel_technical_ack.retained_source_v1` tenantens alla tekniska källor. Förfiltret släpper igenom varje nyttolast med `?`, och alla E66 har `DTM+735:?+0200`. Därför tolkades 123 av 131 källor tecken för tecken (cirka 4 ms vardera) och låstes FOR SHARE, 3–4 gånger per CONTRL.
  - **Rättningar:**
    1. **`missedTechnicalAckResume.ts`** körs i den inkommande cron-körningen med samma flagga som F103.
       - Den tar bara källor som har noteringen "CONTRL skapades inte", per kanal och tenant, med väntetid, tidsfönster, begränsning och högst 3 försök.
       - En saknad CONTRL körs om i enbart det tekniska steget, efter compare-and-set.
       - Ett okött utkast läggs i utkorgen som `prepared`, bara insert, efter en skyddad omläsning av originalet. Pekar originalet på ett annat svar avbryts det.
    2. **`inboundProcessing.ts`:** det tekniska CONTRL-blocket är oförändrat utbrutet till `acknowledgeInboundTechnicalSyntax`, och den nya `resumeInboundTechnicalAck` använder det.
    3. **Migration `20261023192000_ediel_retained_contrl_source_uci_index.sql`:**
       - lägger loopens eget exakta villkor (UCI-referensen) i kandidatfrågan, så att det befintliga indexet används;
       - mätt i sessionskopior: `retained_source_v1` 847 → 13,6 ms och `read_outbound_originals_v1` 858 → 54 ms med identisk utdata;
       - 439 CONTRL kontrollerades, och 406 jämförda rader gav samma resultat;
       - tabelllåsdesignen är orörd, eftersom den bär godkända garantier, men låsen hålls ungefär 20 gånger kortare tid;
       - inte applicerad i världen.
  - **Tester:**
    - `reality-f106-missed-technical-ack-resume` och `reality-f106-technical-ack-resume-owner`, totalt 11. Motortesterna faller med den gamla filen.
    - Agenten körde 55 relaterade filer med 920 tester. Typkontroll och eslint utan fel, täckningen 352 av 352 med 0 fallerande.
    - Jag körde om F106a, F103, F104 och motortesterna: 29 av 29.
  - **Sidofynd, ÖPPNA:**
    1. **UTILTS-runtimens kvittenser köas aldrig:** senaste dygnet finns 49 produktions-CONTRL för E66 utan utkorgsrad, plus utkast i testkanalen (13 APERAK, 11 UTILTS_ERR, 12 CONTRL). Återupptagningen täcker bara källor med felnotering. Hög.
    2. **Ack-fälten är fel:** `requires_contrl` kommer från standardvärdet på alla 54 inkommande CONTRL och 50 APERAK, och `contrl_status` på E66 förblir NULL även efter skickad CONTRL. Låg.
    3. **Simulatorns kuvert:** E66 saknar 0031, medan Z04 och APERAK har den. Vi kvitterar ändå allt enligt den godkända ACK-01. Låg.
    4. **Operatörens omkörning av inkommande UTILTS** föll 63 gånger (timeout och "Ingen aktiv communication_route hittades för ediel_ack") 11:10–11:11. Kopplat till F107 och del B.
    5. **APERAK besvarad med APERAK:** 9 utgående APERAK köades som svar på inkommande APERAK i den syntetiska tenanten "Synthetic normal switch native" (testkanalen, 12:16–12:27). Den godkända ACK-05 förbjuder det. Hög, orsak ej verifierad.
    6. **Radlås:** `retained_source_v1` låste varje kandidatrad FOR SHARE, vilket blockerar statusuppdateringar. Migrationen minskar det till den matchande raden.

- **F106 del B RÄTTAD 2026-10-23 (agent + granskning).** Tre av mina antaganden var fel:
  - Svarsrouten för APERAK fanns redan.
  - "APERAK skapades inte" stod på Z04, inte på APERAK.
  - F105:s påstådda timerregression gällde två olika timrar.
  - **Orsak 1 – APERAK får ingen CONTRL:**
    - `persistInboundAck` (`canonicalInboundAckStatusUpdater.ts`) lagrade varje inkommande CONTRL och APERAK utan `mailbox_message_id` och utan mottagningsrad. Väljaren `select_configured_reply_route_v2` kastade då `ediel_original_mailbox_source_required`, och det rapporterades som "route unavailable".
    - Testat i en transaktion som rullades tillbaka: när kopplingen och mottagningen sattes valdes PRODAT-routen `d647b006`. Ingen inkommande APERAK hos någon tenant kunde alltså få en CONTRL.
    - Regler: ACK-01 (CONTRL på all EDIFACT utom CONTRL) och ACK-05 (aldrig APERAK på APERAK).
    - **Rättning:** en inkommande kvittens får nu `mailbox_message_id` och sin mottagningsrad via den befintliga mottagnings-RPC:n.
      - Ett fel vid mottagningen loggas som en varning och backar inte kvittensens effekt.
      - `requires_contrl`/`requires_aperak` kommer nu från ACK-matrisen: CONTRL får false/false och APERAK true/false. Det rättar också F106a:s sidofynd (d).
  - **Orsak 2 – Z04 får ingen APERAK:**
    - `findBestCommunicationRoute` tillåter bara en aktiv `ediel_ack`-route per nätägare och kanal, men F92/F98 skapar en per applikationsreferens, 7 i världen. På HEAD gav det `communication_route_ambiguous`. Världens app är äldre än F101-varianterna och gav därför "Ingen aktiv".
    - Regel: ACK-02 kräver APERAK på PRODAT.
    - **Rättning:** bara vid just tvetydighetsfelet smalnas valet av till de routes vars aktiverade profil i kanalen har exakt källans applikationsreferens, en kompatibel svarsfamilj och svarskod, och källans avsändare som mottagare. Exakt en träff används. Annars kastas det ursprungliga felet vidare, så det blir aldrig en gissning.
  - **SLA-timrarna:**
    - `contrl_due`/`aperak_due` är vår egen svarsplikt inom 30 minuter. De stängs bara av svepet `checkAckDeadlines`, och det senaste svepet i världen gick 10:33:05.
    - Alla 63 skickade CONTRL uppfyller villkoret för att stänga sin timer. Det är alltså en lucka i testkörningen (T14), inte ett produktfel.
    - E66 kräver också APERAK per transaktion eller UTILTS-ERR (`UCASE-E66-SUPPLIER-inbound`), så de 123 `aperak_due` är rätteligen öppna.
    - Timern backar inte: svepet läser aldrig stängda rader och uppdaterar villkorat. Ett test låser fast det.
  - **Tester:**
    - `reality-f106-ack-reply-route-and-timers` 11 av 11, där 4 föll med HEAD;
    - native 2 av 2, och med den gamla koden föll båda exakt som i världen;
    - 107 relaterade filer, 1 988 tester;
    - typkontroll och eslint utan fel, täckningen 352 av 352 med 0 fallerande;
    - jag körde om F106, F102 och F105: 63 av 63.
  - **Sidofynd, ÖPPNA:**
    1. **Gamla kvittensrader** (världens 4 APERAK och alla tidigare) saknar fortfarande koppling och mottagning. F106a:s återupptagning kommer därför att få `ediel_original_mailbox_source_required` för dem. Ingen bakåtfyllnad gjord. Medel.
    2. **Mottagningstid skrivs över:** ett nytt intag av en befintlig inkommande kvittens skriver över `message_received_at`, vilket bryter kontrollen av den frysta källan. Timrarna förankras dessutom vid intaget i stället för brevets `received_at` (10:05:53 i stället för 10:03:16). Medel.
    3. **Underadress, möjlig risk:** `routeRegistry` använder aktörens underadress när profilen saknar en. Den atomiska insert-vägen kräver då att underadressen matchar, vilket kan ge `ediel_ack_atomic_route_changed`. Ej verifierat. Låg.
    4. **Svepets budget** är global och liten (`min(limit*2, 100)`) och kan halka efter med många tenanter. Låg.

### T14 Mottagningsslingorna körde bara inkorg och utkorg — övriga cron-jobb stod still i timmar — RÄTTAD, verklighetsvärlden
- **Upptäckt** av F106b-agenten:
  - Senaste svepet av SLA-timrarna i världen gick 10:33:05. Därefter rördes inga timrar, trots att 63 CONTRL skickades 10:40–11:02.
  - `checkAckDeadlines` körs av kundoperationernas cron, som Vercel kör var femte minut. F:s mottagningsslinga (F6) körde bara inkorg och utkorg, och omkörningen F6c körde ingen cron alls.
  - Under flera timmar stod därför kundoperationer, SLA-svep, e-postutkorgar, webhooks, manuell inkorg och 10/15-minuterscron still.
  - Samma lucka fanns i G, H, J2, J3 (insamlingen), J4, K och E.
- **Konsekvens:** att SLA-timrarna inte stängdes var ett mätfel i världen, inte ett produktfel. Det tar bort en falsk signal i F106.
- **Rättning:**
  - `runSlotAfterInbound()` i `world.ts` kör resten av Vercel-sloten efter att slingan läst båda inkorgskanalerna. Utkorgens svar returneras i samma form som förut.
  - Alla listade slingor använder den. H och K tar kundoperationernas svar från sloten i stället för att anropa den igen.
  - F6c kör en hel slot efter var femte fil, ungefär var femte minut, och sparar slotarna i `report.reprocess.slots`.
  - J3:s avsiktliga avbrottsslingor för testbrevlådan lämnas orörda.
- **Verifiering:** typkontroll (`tsconfig.scripts.json`) och eslint utan fel. Byggartesterna 46 av 46.
- **Observation:** en slot motsvarar 5 minuter men anropas varje minut i slingorna, alltså 5 gånger komprimerad tid. Samma konvention som F2-slingan.
- **Gäller från nästa körning.** Körning 26 körs från en äldre checkout.

### F körning 26 (tenant `7b53f121`, 09:49–13:42): F1–F3, F5, F6, F6b gröna; F4, F6c, F7–F10 röda
- **Bytet:**
  - 4 Z01 och 4 Z03 skickades och kvitterades i produktion, vilket verifierar F90.
  - 3 av 4 Z04 tolkades och fick aktiva perioder. Den fjärde strandade (F103).
- **F4** föll, men inte på F103. Det första som föll var anläggningen `…324819`, som hade `atSupplyStart: false`. `market_start_at` är `2026-08-31T23:00Z`, alltså 00:00 i fast normaltid (UTC+1). Testet väntade sig svensk civil midnatt, 22:00Z. Se F108.
- **F6c:** nådde testets tidsgräns på 150 minuter efter cirka 100 av 123 filer (10 000 värden) med 0 misslyckade meddelanden. Långsamheten är P1. Alla knapptryck gav 500 trots lagring (F107).
- **F7:** admins spotprisimport svarade 403 "Ej behörig". Ingen tidigare körning har nått F7. Se F109.
- **F8–F10:** följdfel (inga fakturor och inga spotpriser).
- **Rapport:** `report-f-run26.json` i scratchpad.

### F108 Leveransstartens tidsgräns: Ediel-fast normaltid (23:00Z) mot svensk civil midnatt (22:00Z) — BEKRÄFTAD (världen), hög för debitering; utreds
- **Plattformen** lagrar Z04:ans `DTM+92 202609010000` som `market_start_at = 2026-08-31T23:00Z`. Det följer den godkända ENV-08: payload i fast normaltid, lagra UTC plus offset och affärsdatum.
- **Andra vägar:**
  - Plattformens egen reservväg utan Ediel-tid använder "00:00 svensk tid", alltså 22:00Z sommartid (rad 558 här ovan).
  - Simulatorns E66-dygn är civila Stockholmsdygn.
  - Testet F4 väntar sig civil midnatt.
- **Spår i körning 22:** de 8 värdena som blockerades med `supply_source_unqualified` motsvarar exakt 4 kvartar × 2 anläggningar, alltså första civila timmen den 1 september före 23:00Z.
- **Frågor:**
  - Vilken timme den 1 september tillhör vem vid ett leverantörsbyte?
  - Ska debiteringens dygnsgränser följa Ediels fasta CET-dygn (96 kvartar) eller civila dygn?
  - Gäller premissen i scenario G om 100 kvartar på vintertidsdygnet?
  - ENV-08:s `on_failure` säger "Använd inte … 92/100 kvartar per fast-CET-dygn".
- Utreds av agent mot masterplanen och handboken.

- **UTREDD 2026-10-23 (agent + granskning).** Plattformens `market_start_at = 23:00Z` är RÄTT. Fem debiteringsvägar läste starten som civil midnatt (22:00Z) och stred mot databasens egen kontroll. Startsidan är RÄTTAD. Slutsidan kräver ett ÄGARBESLUT.
  - **Modellen:**
    - **Källor:** PRODAT-fält 206 (`ZZZ:1:805`, "alltid 1 för både normaltid och sommartid") och den godkända ENV-08.
    - **Start och slut:** Z04 `DTM+92 202609010000` blir 2026-08-31T23:00Z, med affärsdatumet 2026-09-01 kvar. Z05 `DTM+93 202610010000` blir 2026-09-30T23:00Z, exklusivt.
    - **Ägarskap av timmen:** civil 1 september 00:00–01:00 tillhör den förra leverantören, och civil 1 oktober 00:00–01:00 efter ett Z05 tillhör oss. `gridex_received_sources.billing_supply_basis_v1` håller redan det fönstret.
    - **En nätägares E66-dygn** är 00:00–24:00 i +0100 och alltid 96 kvartar (§9.4, U-10, ENV-08, UG-122-16). Den godkända `ediel-env08-fixed-normal-time.test.ts:92-111` avvisar 92 eller 100 värden för ett fast CET-dygn med E87.
    - **Spotpriser** är civila leveransdygn med 100 kvartar den 25 oktober, och prissättningen kopplar på tidpunkt.
    - **Faktureringsmånaden** avgörs inte av reglerna.
  - **RÄTTADE (startsidan):**
    - M1 `meterValueBillingMatcher.ts`: de 4 första civila kvartarna skickades som `eligible`. Databasen nekade dem, och de registrerades som `supply_source_unqualified` och öppnade ett vilseledande ärende. I världen har körning 26 12 blockerade värden (4 × 3) och 3 sådana ärenden.
    - M2 `billingGate.ts`: läste civil `start_date`.
    - M3 `underlayEngine.ts`: startade segmentet vid civil midnatt, så varje leveransstart under sommartid fick en mätlucka. Kritiskt för debiteringen.
    - M4 `invoiceReadiness.ts` och `metering/validation.ts`: fullständigheten mättes mot hela civila månaden, vilket gav "1 h saknas" och samma fel vid varje start mitt i månaden.
    - Ny `supplyPeriodStartInstant()` i `supplyPeriodEnd.ts`: använder `market_start_at` och faller bara tillbaka till civil midnatt när den saknas.
  - **Tester:**
    - `f108-supply-window-fixed-normal-time` 7 av 7, där 5 föll före rättningen;
    - 40 relaterade filer, 507 tester;
    - typkontroll utan fel;
    - täckningen 352 av 352 med 0 fallerande;
    - jag körde om F108, ENV-08 och debiteringstesterna: 40 av 40.
  - **ÖPPNA (ägarbeslut om faktureringsmånadens inramning):**
    - **M5:** den sista timmen efter ett Z05 under sommartid debiteras aldrig. TS-spärren och databasens H1 nekar den, medan den kvalificerade leveranskontrollen godtar den. `gridex_store_billing_underlay` avvisar segmentet `[22:00Z, 23:00Z)`, och då rullas tenantens hela oktoberbatch tillbaka. Medel.
    - **M6:** E66-månadsvärden i +0100 kan inte debiteras i civila sommarmånader (`source_interval_requires_finer_data`). Hög.
    - **M7:** de två reservvägarna från datum till tidpunkt skiljer sig åt. Civil midnatt används i åtkomstfönster, spärr och underlag. `Etc/GMT-1` används i 5 funktioner för mottagna källor. Påverkar bara manuella perioder. Kräver förtydligande av F79-beslutet. Låg.
  - **Observation:** produkten godtar `DTM+735 +0200` från en svensk nätägare, eftersom det godkända undantaget för deklarerad utländsk offset finns kvar. Låg.
  - **ÄGARBESLUT 2026-10-23:**
    - Faktureringsmånad för Ediel-leveranser: "Ediel-månad". Debitering per Ediel-månad från 00:00 +0100 den 1:a. Det löser M5 och M6, och fakturan skriver ut perioden exakt.
    - Manuella och äldre perioder utan Ediel-tidpunkt (M7): "Svensk civil midnatt".
    - Implementeras av en agent.
  - **Verklighetsvärldens simulatorer och scenarier är fel.** De sänder civila dygn, och G sänder 100 kvartar. Exakt lista med ändringar per fil och rad finns i agentrapporten. De ska göras av mig och spåras som T15.

- **F108 slutsidan RÄTTAD 2026-10-23 (agent + granskning), enligt ägarbesluten:**
  - **Regel:**
    - En period med `market_start_at` eller `market_end_at` debiteras per Ediel-månad. Andra perioder debiteras per civil månad.
    - Periodens egen start och slut gäller i första och sista månaden. Månadsgränser den löper över följer ramen.
    - Lagrade datum (1 sep – 1 okt) och unikhetsnyckeln är oförändrade, så månadsavgiften och dess proportionering påverkas inte.
  - **M5 rättad:** en mottagen Z05 slutar exakt vid `market_end_at`. TS-spärren, matcharen och databasens spärr följer det, och den sista timmen debiteras i sin Ediel-månad.
  - **M6 rättad:** ett månadsvärde i +0100 blir klart utan `needs_review`.
  - **M7:** ingen ändring. Alla fem `Etc/GMT-1`-funktioner omvandlar Ediel-källor, alltså mottagningstid till affärsdatum och mottagen PRODAT-start till marknadstidpunkt, vilket är rätt enligt ENV-08.
  - **Nytt fel rättat (H2/H3-variant, hög):** `gridex_store_billing_underlay` godtog fortfarande bara perioderna `active`/`confirmed_by_grid_owner` och avtalen `signed`/`active`. Varje slutmånadsunderlag efter ett Z05 nekades med 23514, och då rullades tenantens hela månadsbatch tillbaka. Lagret tillämpar nu samma regel som spärren.
  - **Avtalsslut och prisers `valid_to`:** för Ediel-perioder gäller nu det senare av civil midnatt och 00:00 +0100, aldrig tidigare än förut. Annars hade ett pris giltigt till 30 september fällt hela batchen.
  - **Fakturan** skriver ut den exakta perioden, till exempel "2026-09-01 01:00 – 2026-10-01 01:00 (svensk tid)" med etiketten "September 2026". Fältet `billing_period` finns i `calculation_snapshot` och metadata, i Nordfin-XML (`PeriodLabel`/`PeriodText`/`PeriodStart`/`PeriodEnd`), i CSV/XLSX ("Fakturaperiod", "Leveransperiod (exakt)") och i kundportalen. Äldre filer renderas byte för byte som förut.
  - **Spot:** intervallprissättning kopplar på tidpunkt. Den civila dagen precis utanför Ediel-månaden (1 oktober för september) fylls i utan lås och utan överskrivning (`lib/pricing/engine.ts`), vilket ryms i ägarbeslutet om fyllnad. Portföljens policy `require_locked_period_price` prissätts per leveransmånad och påverkas inte.
  - **Migration `20261023196000_f108_ediel_billing_month.sql`:** fem exakta textbyten, två i spärren och tre i lagret. Ägare, ACL, säkerhetsläge och inställningar kontrolleras.
  - **Tester:**
    - `f108-ediel-billing-month` 18 av 18, där 12 föll med HEAD-koden;
    - SQL-regressionen (PGlite): 4 PASS före migrationen (defekterna bevisade), 20 PASS efter, och H2/H3 har kvar sina 13 PASS. Jag körde om alla tre;
    - 189 relaterade filer, 3 062 tester (agenten). Min omkörning: 37 filer, 291 tester;
    - typkontroll utan fel;
    - täckningen: första körningen gav 350 av 352 (DB-01 och AT-DB-01 föll under parallell last, och DB-01 gav 76 av 76 ensam), omkörningen gav 352 av 352 med 0 fallerande.
  - **Förväntningar i scenarierna:**
    - **F:** underlag 1 sep – 1 okt, tidpunkter 08-31T23:00Z – 09-30T23:00Z, ramen `ediel_fixed_normal_time`, 2 880 värden per hel anläggning.
    - **G:** oktober [09-30T23:00Z, 10-31T23:00Z) med 2 976 värden. Texten "2026-10-01 01:00 – 2026-11-01 00:00".
    - **H:** slutunderlaget lagras nu.
  - **Sidofynd, ÖPPNA:**
    1. **Slutfakturan efter Z05 (H3 längre ned i kedjan, hög):** prismotorns `loadContract`, `gridex_read_interval_pricing_snapshot_v1` och `gridex_persist_pricing_run` godtar bara aktiva och signerade avtal. Slutfakturan efter ett Z05 faller därför med "Aktivt kundavtal saknas".
    2. **Åtkomstfönster (medel):** `gridex_customer_metering_access_windows_v1` behandlar ett manuellt `end_date` som exklusivt och skär därmed bort sista levererade dag, medan debiteringen räknar dagen som sista levererade.
    3. **Månadsmedelspot (låg, kan kräva ägarbeslut):** den civila månadens medelpris tillämpas på Ediel-månadens kWh, vilket ger en timmes förskjutning i varje ände på sommaren.
    4. **Begäran om mätdata (E73, medel):** autopiloten begär fortfarande den civila månaden för Ediel-punkter. Renderaren ligger i `lib/ediel`.
    5. **Övergången (låg):** redan låsta månader med civila gränser bredvid Ediel-månader kan lämna timmen 22:00–23:00Z odebiterad. Produktionen har 0 mätpunkter, så det påverkar bara världen.
    6. **Lås före månadens slut (låg):** `gridex_lock_spot_price_month` saknar kontrollen att månaden har tagit slut, se T15 punkt 2. Förslaget är att neka medan `period_end > now()`.

### F109 Tenantadmin får 403 på `/api/internal/spot/import-month` — BEKRÄFTAD (världen, körning 26), hög; utreds
- Routen kräver `requireAdminApiAccess(['pricing.write'])` och `requireOperationalCompanyId`.
- `company_admin` har `pricing.write` i `lib/admin/accessModel.ts`, men tenantens admin fick ändå "Ej behörig".
- F7 i F, G och J2 använder samma anrop.

### F109 (forts.) — UTREDD: fel i scenariot, inte i produkten
- **Orsak:**
  - "Tenantadmin" i F7 skapas av `configureTenant` (`scripts/helpers/live-chain-fixture.ts:178-200`) med SQL. Användaren får medlemskapet `company_admin`, en `native_actor_*`-roll utan behörigheter och 78 direkta allow-rader i `user_permissions`.
  - Adminkontexten räknar avsiktligt bara rollernas allow, och direkta rader används endast som nekanden (`20261013023000_admin_context_current_permission_deny.sql`).
  - `canonical_authenticated_tenant_context` gav `permissions:[]`, och därmed svarade `apiGuards.ts:153` "Ej behörig" redan före behörighetskontrollen.
  - Redan känt för fixturen (F52). Den gamla native-kedjan använde samma admin.
- **Produktens modell:**
  - Spotpriser är global marknadsdata per elområde. Tabellerna saknar `company_id`, och cron-jobben avvisar `company_id`.
  - `spot-settlement`-cron importerar och låser föregående månad automatiskt varje natt.
  - Manuell import finns för plattformsadmin i UI:t och i `/api/platform/...`.
  - Tenanten väljer bara sin källa.
- **Test:** `__tests__/spot-month-routes-admin-context.test.ts` kör de riktiga routerna mot de kontextformer som syns i världen. Fixturadminen får 403, en `company_admin` med `pricing.write` och en plattformsoperatör får 200, och ett uttryckligt nekande ger 403. 6 tester, och agenten körde 22 av 22 i de relaterade sviterna.
- **Scenarioändring (T15):** F7 och J2 använder produktens automatiska väg, `cron('/api/cron/pricing/spot-settlement?billing_month=…&price_areas=SE3')`. G9 avser oktober, som inte kan låsas före 1 november (409 `market_price_incomplete`).
- **Sidofynd, ÖPPNA:**
  1. **Tenantbehörighet styr global data:** `/api/internal/spot/import-month` och `lock-month` låter vem som helst med tenantens `pricing.write` importera och låsa data som alla tenanter debiterar från. En `company_admin` kan därmed frysa en månad för alla tenanter, även före leverantörens rättelse. Samma import är plattformsexklusiv i UI:t. Hög. Kräver ägarbeslut eftersom det smalnar behörigheten.
     - **ÄGARBESLUT 2026-10-23 "Endast plattformen":** bara plattformsadmin och nattlig cron får importera och låsa spotpriser. Tenanter väljer fortfarande sin priskälla, och plattformsadmin behöver inget tenantmedlemskap. Implementeras av en agent (F109b).
     - **RÄTTAD 2026-10-23 (F109b, agent + granskning):**
       - **Vakt:** ny `requirePlatformAdminApiAccess` i `lib/admin/apiGuards.ts`. Den kräver databasens `is_platform_admin` och respekterar fortfarande uttryckliga nekanden.
       - **Routerna:** `import-month` och `lock-month` använder den, och `requireOperationalCompanyId` är borttagen. En `company_admin` får nu 403, och en plattformsadmin utan medlemskap får 200 i stället för 500.
       - **Databasen nekade redan:** provat i transaktioner som rullades tillbaka som en riktig tenant-`company_admin`. RLS nekar insert på alla `spot_price_*`-tabeller, update och delete påverkar 0 rader, och lås- och claim-RPC:erna är bara för `service_role`. Därför behövdes ingen migration.
       - **Dokumentation och regression:** flödesdokumentet och kommentaren i `lock-month` är rättade, eftersom nattcronen låser. Regressionsskriptet är uppdaterat, inklusive en redan fallerande gammal kontroll av `settlement_locked`.
       - **Tester:** `spot-month-routes-admin-context` 6 av 6, där 3 föll med de gamla routerna. Agenten körde 38 filer med 421 tester, och typkontrollen var utan fel. Täckningen 352 av 352 med 0 fallerande. Jag körde om 50 av 50 och regressionsskriptet med 37 kontroller.
       - Sidofynd 2 och 3 nedan är därmed lösta.
       - **Nya sidofynd, ÖPPNA:**
         - (a) **Plattformsrouten:** `/api/platform/energy/import/spot-prices` ger 500 för en icke-plattformsadmin i stället för 403. Den ignorerar uttryckligt nekande, och `redirect('/login')` anropas i en route handler. Medel.
         - **ÄGARBESLUT 2026-10-23 om (b), "Tillåt fyllnad":** automatisk fyllnad av saknade dagar, utan lås och utan överskrivning, får ske från tenantflöden. Bara medvetna importer och låsningar är plattformsexklusiva.
         - (b) **Tenantdriven fyllnad:** tenantens prisförhandsvisning, omprissättning och debiteringsadaptern anropar `ensureSpotPricesForBillingMonth` (`lib/pricing/engine.ts:498`). Den fyller bara saknade dagar från leverantören, utan force och utan lås. Frågan är om det ryms i ägarbeslutet. Ska tas upp med ägaren.
         - (c) **Anslutningstest:** tenantens knapp "testa anslutning" (`testMarketSourceConnectionAction`) läser `spot_price_intervals` med tenantens session, men läsningen är plattformsexklusiv. Knappen visar därför alltid "Ingen marknadsdata hittades". Medel.
         - (d) **Grants:** `authenticated`, och `anon` på vissa spottabeller och vyer, har fulla tabellprivilegier inklusive TRUNCATE. Plattformsadmin kan skriva spottabellerna direkt via PostgREST och förbi importens validering. Flera policyer har verkningslösa villkor. Låg.
         - (e) **Typmanifest:** `scripts/supabase-types-manifest.json` har sedan tidigare inaktuella hashar. Låg.
  2. **Plattformsadmin utan medlemskap** får 500 `spot_import_failed` på grund av `requireOperationalCompanyId`, fast datan är global. Medel.
  3. **Inaktuell dokumentation:** dokumentet säger att settlement-cron "låser den inte automatiskt", men den låser (`monthly_settlement_cron`). Kommentaren i `lock-month` är också fel. Låg.
  4. **Två behörighetsmodeller:** `gridex_get_user_permissions_in_company` (RLS) räknar fortfarande direkta allow-rader. Adminkontexten och `canonical_actor_is_authorized` gör det inte. Fixturadminen får true i RLS men ingen API-åtkomst. Medel.
  5. **Världens databas saknar rollraden `company_admin`** (F52). Låg för världen.
  6. **Inget UI** anropar de interna spotroutrarna. Låg.
  7. **`LiveTenant` kallar användaren "admin"** fast den saknar rollbaserad adminbehörighet. Låg, testkod.

### T15 Verklighetsvärlden sände civila dygn och sommartid; nätägarens dygn är 00:00–24:00 +0100 med 96 kvartar — RÄTTAD (testkod), agent + granskning
- **Grund:** F108 och ENV-08. Ägarbesluten Ediel-månad, civil midnatt för manuella perioder och spotpriser bara via plattformen gäller.
- **Byggare och simulatorer:**
  - `dailyE66` och `dayE66` (standard `fixed_cet_day`), `utiltsE66`/`utiltsE31` och `septemberMonthE66` sänder alltid `DTM+735:?+0100:406` och 96 kvartar (24 timvärden), med start 23:00Z dagen före.
  - UNB skrivs i svensk lokal tid, enligt ENV-08 "UNB lokal tid".
  - **Rättade fel:** Z05 `DTM+137` (`gridOwnerLeaving.ts`) och APERAK `DTM+137` (`rejectsWire.ts`, harnessfel J4-H1) var skrivna i UTC.
  - **Nya hjälpare:** `edielQuarterStarts`, `edielMonthUtc`, `civilDayTotals` och `storedPerEdielDay`.
- **Scenarierna:**
  - `atSupplyStart` jämförs med `Etc/GMT-1`, och räkning sker per tidpunkt inom Ediel-månaden.
  - **F7, J2 och G9:** spotpriserna hämtas via `spot-settlement`-cron i stället för tenantadmin (F109).
  - **G:** filerna har 96, 96 och 96 kvartar, civila 25 oktober är 100 per tidpunkt, och oktobers Ediel-månad har 2 976 kvartar.
  - **H:** `mEndBoundary` är Z05:ans marknadstidpunkt.
  - **K:** räknar per civilt dygn.
  - **E:** grupperar per Ediel-dygn.
  - Fakturaperiodens fältnamn kontrolleras mjukt i väntan på F108-agenten.
- **Verifiering:** typkontroll (`tsconfig.scripts.json`) utan fel och eslint utan fel (5 gamla varningar i J2). Enhetstesterna 85 av 85 i min omkörning, och agenten körde 150 tester plus en skissad kontroll av dygnen 1 september, 25 oktober och 29 mars. Inget kördes mot världen.
- **Fynd, ÖPPNA:**
  1. **Settlement-cron och 409:** cronen ger 500 `spot_settlement_area_lock_failed` när låset nekas, inte 409 `market_price_incomplete`, eftersom den mappningen bara finns i `lock-month`-routen. Låg.
  2. **Lås före månadens slut:** `gridex_lock_spot_price_month` kontrollerar inte att månaden har tagit slut, bara att sammanfattningen är komplett. En leverantör som returnerar framtida dagar kan alltså låsa månaden i förtid. Medel. Skickat till F108-agenten.
  3. **Spotpris för sista timmen i Ediel-september saknas:** 30 sep 22:00–23:00Z hör till oktobers civila spotdygn, som septembers settlement-cron varken importerar eller låser. Den första timmen ligger i spotmånaden september men inte i Ediel-september. Hög, eftersom fakturering med `require_locked_period_price` påverkas. Skickat till F108-agenten.
  4. **E66 i J4:** `e66TwoPoints` har UNB 0600 i stället för 0700 lokal tid. Låg.
  5. **Framtida registreringstid:** `dailyE66` saknar `notAfter`, så en H-körning före ungefär 07:00 sommartid kan få en registreringstid i framtiden. Låg.
  6. **Kontrafaktisk fil godtas:** plattformen godtar en civil fil med 100 värden i +0100 utan E87, eftersom ENV-08 bara avvisar 92 eller 100 värden per fast CET-dygn. Observation.
  7. **Ej körda native-tester:** native-tester som använder de ändrade hjälparna (`live-metering-billing-chain-native`, `ediel-grid-owner-rejects-native`) är inte körda.

### T16 Tredje containeromstarten (cirka 16:41) — ÅTERSTÄLLD, verklighetsvärlden
- **Upptäckt:** vid appliceringen av F108-migrationen svarade inte Docker. Maskinen hade varit uppe i 16 minuter.
- **Återställning:**
  - Startade om `dockerd` efter att ha tagit bort `docker.pid`.
  - Supabase-containrarna kom upp med sina volymer, och omdirigeringen 54322→55322 lades tillbaka.
  - `gx-mail` togs bort och skapades om av `up.sh` (`SKIP_REPLAY=1`).
- **Data kvar:** 714 bolag fanns kvar, och F102-migrationen syntes på 548 inkommande produktionsrader med `test_flag=0`.
- F108-migrationen applicerades, och världen byggdes på `edd43974a`. F-körning 27 startade 17:03.
- Inga körningar pågick vid omstarten.

### F110 Route-readiness döljer nya tenanters blockerade routes bortom 500 rader — BEKRÄFTAD (världen, F-körning 27), hög; RÄTTAD
- **Utfall:** körning 27 föll i F3. Den riktiga Z03-byggaren nekade alla fyra augustibyten med `production_route_profile_not_ready`, `receiver_ediel_id_missing`, `receiver_certificate_missing`, `security_policy_not_approved` och `missing_receiver_subaddress`.
  - Orsaken var att tenanten bara hade generiska testroutes. Inga produktionsroutes per nätägare var materialiserade.
  - Steget `tenantRoutes` hittade ingen knapp "Materialisera production-route": `forms=0 cards=0`.
- **Orsak:** `/admin/ediel/route-readiness` läser `gridex_company_route_readiness_v` med `.limit(500)`, utan bolagsfilter och utan att visa att listan är avkortad.
  - I världen har nätägare 16700 nu 834 blockerade rader för 282 bolag, efter alla native-tester.
  - Den nya tenantens rader hamnade bortom 500, fast vyn hade dem (3 rader för 16700).
  - I körning 26 fanns färre bolag, och raderna kom med.
- **Konsekvens:** i produktion med hundratals tenanter kan en operatör aldrig hitta en nyare tenants blockerade routes på sidan. Bytena blockeras, och inget säger att listan är kapad.
- **Rättning:**
  - Läsningen är flyttad till `lib/ediel/companyRouteReadinessList.ts`.
  - Ett bolagsfilter `?company=<uuid>` är tillagt i formuläret som "Bolags-ID". Allt som inte är ett UUID ignoreras och interpoleras aldrig.
  - Sorteringen är deterministisk, och en avkortad lista säger "Visar de första 500 raderna … filtrera på bolags-ID".
  - Scenariots materialiseringssteg filtrerar på tenanten.
- **Test:** `route-readiness-company-filter` 3 av 3, med 282 tenanter och 564 rader. Typkontroll och eslint utan fel.
- **Egen miss under rättningen:**
  - Jag skrev först över den befintliga filen `lib/ediel/companyRouteReadiness.ts`, som har en annan export. Den återställdes exakt från HEAD med `git show`, och koden flyttades till en ny fil.
  - Samtidigt försvann konstanten `CONTACT_ACTOR_CHUNK` och F34-kommentaren. Båda återställdes innan typkontrollen.
- **Sidofynd, ÖPPEN:** `loadRouteReadiness` (`gridex_route_readiness_v`) på samma sida har också `.limit(500)` utan markering. Medel.

### F körning 28 (tenant `53d47067`, start 17:25), delresultat 18:20 — F106 verifierad i världen
- **Bytet:**
  - F110-rättningen fungerade: PRODAT Z01 och Z03 materialiserades. UTILTS gav `ediel_route_profile_insert_failed` som tidigare (känt, se rad 280).
  - Alla 4 Z01 och 4 Z03 skickades. Alla 4 Z04 tolkades och fick aktiva perioder, första gången utan strandad Z04.
- **CONTRL till nätägaren (F106 verifierad):** varje inkommande fil har fått en skickad CONTRL:
  - APERAK 4 av 4 (F106b);
  - Z04 4 av 4;
  - E66 123 av 123 (F106a, ingen förlust under last).
  - Inkommande CONTRL kräver ingen CONTRL (`requires_contrl=false`, ACK-01).
- **SLA 18:20:**
  - `contrl_due`: E66 40 resolved och 83 open trots skickad CONTRL. Svepet ligger efter, se F106b sidofynd 4 om liten global budget. Följs upp.
  - `aperak_due`: Z04 4 expired, se F111.
  - `aperak_due`: E66 40 expired och 83 open. E66 hålls för intern granskning tills operatörens omkörning (F6c), så APERAK eller UTILTS-ERR per transaktion hinner inte ut inom 30 minuter.
    - Produktfrågan: inget jobb omvärderar hållna UTILTS (känt sedan scenario E). I produktion blir varje hållen fil ett SLA-brott. Hög, ÖPPEN.

### F111 APERAK på Z04 från en delad nätägare nekas som "främmande resurs" — BEKRÄFTAD (världen, körning 28), hög; utreds av agent
- **Utfall:** alla 4 Z04 har "APERAK skapades inte: ediel_ack_atomic_foreign_source_resource · kod: P0001". Ingen APERAK skickas, i strid med ACK-02, och `aperak_due` gick ut.
- **Orsak (trolig):**
  - Den atomiska kvittensskaparen (senast i `20261010102349`, cirka rad 905–913) ärver källans resurslänkar och kontrollerar dem med `r.company_id = c`, också för `grid_owners`.
  - Registrets nätägare är delade (`company_id IS NULL`, F41).
  - Samma klass som F101 och varianterna. Svarsrouten löstes i F106b, och nu stoppar resurskontrollen.

- **RÄTTAD 2026-10-23 (agent + granskning; migrationen inte applicerad i världen förrän körning 28 är klar):**
  - **Bekräftat:**
    - Felet kastas av `gridex_ediel_ack_replay.create_v1` och `create_scope_v2`. `create_scope_v2` gäller PRODAT APERAK. `create_v1` gäller alla andra kvittenser, bland annat APERAK och UTILTS-ERR för UTILTS/E66.
    - Alla 4 Z04 har `grid_owner_id = d0015158…` (Alingsås 16700, `company_id` NULL). Kund, anläggning och utgående begäran tillhör tenanten. Runtime planerade en positiv APERAK för alla 4.
    - Alla 123 E66 i världen namnger samma delade nätägare och skulle få samma nekande efter omkörningen. Kan hänga ihop med F107.
  - **Migration `20261023197000_ediel_ack_shared_grid_owner_resource.sql`:**
    - Kontrollen blir `r.company_id=$2 OR ($3 AND r.company_id IS NULL)` med `$3 = (tabellen är grid_owners) AND källan tillhör tenanten`.
    - Alla andra resurstabeller förblir strikta, och källor utan bolag förblir strikta.
    - Exakt textbyte med kontroller, och ägare, ACL, `SECURITY DEFINER`, `search_path` och `proconfig` är oförändrade.
    - Torrkörd i världen i en transaktion som rullades tillbaka.
  - **Tester:**
    - Native-testet `reality-f111-ack-shared-grid-owner-native` gav 1 av 1. Med den gamla kroppen uppstår exakt världens händelse. Med rättningen sparas en positiv APERAK, och en annan tenants nätägare nekas fortfarande. Samma två fall testas för `create_v1`.
    - Relaterade kvittenssviter 7 av 7, typkontroll och eslint utan fel.
    - Täckningen 352 av 352 med 0 fallerande. Första körningen föll bara på SC-059 när `app.env` var laddat i skalet, och testet passerade 13 av 13 utan den miljön.
  - **Sidofynd, ÖPPNA:**
    1. `gridex_prodat_object_batch.require_wire_projection_v1` slår upp nätägaren via `owner_code` bara bland tenantens egna rader. Admins godkännande av masterdata efter en Z04 kan därför ge `prodat_object_batch_wire_grid_owner_required` för en delad nätägare. Hög.
    2. `gridex_regulated_supply.scope_v1` kräver `grid_owners.company_id=c` (redan noterat i F101-varianterna). Medel.
    3. En Z04 med mätarställning (`CAV+:::1`) får negativ APERAK ERC 42 fält 214, "Felaktigt Konstant för mätare :::1 / :::1", trots identiska värden. J1-baslinjen faller därför, och texten finns 42 gånger i databasen. Hög. Tidigare noterat som J1-baslinjen under F105.
    4. Den negativa varianten försöker skapa APERAK två gånger med två likadana händelser. Låg.
    5. SLA-händelsernas text anger inte timertypen, så "resolved" (för `contrl_due`) följt av "critical" (för `aperak_due`) ser motsägelsefullt ut. Låg.
    6. `metering_point_id` är NULL på alla 4 Z04 i världen. Kund, anläggning och begäran kopplas först efter det misslyckade APERAK-försöket. Medel.
    7. SC-059 faller när `app.env` är laddat i miljön. Låg, testisolering.

### F111 verifierad live (körning 28) och F112 UTILTS-runtimens kvittenser köas aldrig — BEKRÄFTAD (världen), kritisk för Ediel; utreds av agent
- **F111 live:** migrationen `20261023197000` applicerades i världen 19:16:16, mitt i körning 28:s F6c. Det dokumenteras uttryckligen, eftersom körningen därmed har ett före- och ett efterläge.
  - Före: de första cirka 40 omkörda filerna fick ingen APERAK (`ediel_ack_atomic_foreign_source_resource`).
  - Efter: de två första filerna fick "APERAK hanterad via canonical kernel.", med APERAK `c8b83a21…` och `9067d4af…`.
- **F112:** dessa APERAK står som `draft` utan rad i `ediel_outbox` och skickas därför aldrig till nätägaren, i strid med ACK-02 och UCASE-E66-SUPPLIER-inbound.
  - `createUtiltsRuntimeAcks` → `createAckIfMissing` (`utiltsDataRequest.part-1.ts`) anropar aldrig `createOutboxItem`. Det är samma sak som F106a:s sidofynd 1 (49 CONTRL-utkast för E66 i produktion), nu bekräftat också för APERAK.
  - Test Center-kedjan utesluter avsiktligt sändning på den vägen. Exakt var undantaget hör hemma utreds.

### P1 Mätvärdeslagringen går med ungefär 70 värden i minuten; kvittenshanteringen dominerar databastiden — MÄTT (världen, körning 26), medel; ej åtgärdat
- **Körning 26, F6c:** 126 värden lagrade 11:11 och 475 kl. 11:16, alltså ungefär 70 i minuten. 123 filer à 96 kvartsvärden tar då nästan 3 timmar för en enda kund med 4 anläggningar. I produktion med många kunder räcker det inte.
- **`pg_stat_statements`:** ackumulerat sedan världen startade, alla körningar och native-tester. De dyraste efter total tid:
  | Funktion | Anrop | Snitt | Max | Totalt |
  |---|---|---|---|---|
  | `ediel_create_outbound_ack_atomic_v1` | 180 | 2 623 ms | 7,99 s | 472 s |
  | `gridex_ediel_transport_attempt_v1` | 585 | 796 ms | 4,1 s | 466 s |
  | `gridex_read_outbound_acks_for_source_v2` | 743 | 567 ms | 7,9 s | 421 s |
  | `ediel_registry_route_source_v1` | 3 692 | 88 ms | 1,9 s | 327 s |
  | `gridex_record_utilts_source_validation_v4` | 250 | 842 ms | 7,8 s | 210 s |
  | `ediel_read_outbound_ack_replay_v1` | 311 | 530 ms | 8,0 s | 165 s |
  | `gridex_consume_utilts_metering_v1` | 480 | 274 ms | 0,8 s | 131 s |
  | `ediel_read_persisted_technical_contrl_basis_v2` | 77 | 1 502 ms | 3,4 s | 116 s |
- **Koppling till F103:** flera funktioner närmar sig 8 sekunder. Klientens tidsgräns på 2 sekunder och statement timeouts (J3-12, L1) gör då att långsamma men lyckade skrivningar rapporteras som fel.
- **Nästa steg:** mäta med `EXPLAIN (ANALYZE, BUFFERS)` i en vilande värld och jämföra före och efter. Ingen ändring utan mätt förbättring.

### Observationer i appens logg (körning 26, låg om inget annat anges)
- `production route wizard runs could not be loaded` (PGRST205): tabellen `public.production_route_wizard_runs` finns inte i schemacachen. Antingen saknas migrationen i världen eller används tabellen utan att finnas.
- `[manual-mailbox] imap_secret_reference rejected: not a MANUAL_MAILBOX_* variable` för brevlådan `21a35c21…`. Manuella inkorgen loggar fel varje minut.
- `[tenant-provisioning-cron] failed … invalid response from upstream`.
- `Error: The destination stream closed early` upprepat, och `MaxListenersExceededWarning` för Gzip-strömmar (möjlig läcka).

### F101 UTILTS-förbrukning kräver en tenantägd nätägare, men registermodellens nätägare är plattformsgemensamma — så inga mätvärden kan lagras — BEKRÄFTAD (världen), kritisk för fakturering; utreds
- **Fel:** `P0U01 utilts_consumption_grid_owner_changed` från `gridex_utilts_binding.lock_attribution_v1`, som kräver `grid_owners.company_id = tenant`.
- **Registermodellen (F41):** nätägaren är en plattformsgemensam rad (`company_id IS NULL`). Produktens egen webbväg kopplar tenantens mätpunkter till den raden; alla 8 mätpunkter i scenariot pekar på den gemensamma raden för 16700.
- **Produktion:** 0 mätpunkter ännu, så inga data påverkas (summering, bara läsning).
- **RÄTTAD (migration `20261023140000`, native 3/3):** ingen annan ägde området (kontrollerat mot #840, #766 och coverage). Rättningen anmäldes på #840.
- **Den kanoniska regeln:** nätägaren är tenantens egen rad, eller en gemensam rad som tenantens egen mätpunkt, anläggning eller förfrågan pekar på (för samma kund). En annan tenants rad godtas aldrig.
  - Samma regel används i `document_reference_facts_v1`, `gridex_manual_grid_owner_source_current_v2`, F58-resolvern och RLS på `grid_owners`.
  - `FOR SHARE`, felkoden och låsordningen är oförändrade.
- **Test:** `scripts/ediel-utilts-shared-grid-owner-native.test.ts`.
  - En bunden gemensam nätägare: förbruknings- och faktureringsunderlag lagras, och en omkörning ger samma resultat.
  - En obunden gemensam nätägare nekas.
  - En annan tenants nätägare nekas.
  - Utan migrationen återskapas felet.
- **Övriga kontroller:**
  - SC-046: 137 av 137;
  - ERR-gateway: grön;
  - UTILTS-förbrukning: 140 av 141, där ett test växlade mellan körningar med `utilts_final_canonical_transaction_evidence_unconfirmed`, som uppstår före lagringen. Det testet var grönt när det kördes ensamt.
  - täckningen för masterplanen: 352 av 352.
- **Varianter (samma antagande om tenantägd nätägare, inte rättade):**
  - `gridex_bilateral_prodat.scope_v1` kräver `grid.company_id = point.company_id`.
  - `gridex_rebuild_company_analytics_month` utesluter gemensamma nätägare ur statistiken per nätägare. Det berör scenario K.
  - Uppslagningar i TypeScript med `.eq('company_id', …)`: `replyGridOwnerId` (`routeRegistry.ts`), `receiverGridOwner` (`prodatRequestedChange.ts`) och `getGridOwnerIdByGridArea` (`inboundCases.ts`).
  - Samtliga ÖPPNA, medel.
- **Varianterna RÄTTADE 2026-10-23 (agent + granskning):**
  - **Migration** `20261023170000_shared_grid_owner_variants.sql` byter exakt de textavsnitt som ska ersättas i de installerade funktionskropparna och kräver att K-06-kroppen redan finns. Ägare, behörigheter, säkerhetsläge och inställningar kontrolleras efteråt.
    - Statistiken tar nu med delade nätägare som tenantens egna mätpunkter, anläggningar eller begäranden pekar ut.
    - `scope_v1` godtar en delad nätägare som nås via tenantens egen anläggning.
  - **TypeScript:** `selectTenantUsableGridOwners` i `platformGridOwnerResolver.ts` söker först bland tenantens egna rader och tar delade rader bara när egna saknas. En annan tenants rad returneras aldrig.
    - Alla tre uppslagningarna använder den.
    - **Beteendeändring:** två egna rader för samma nätområde ger i `getGridOwnerIdByGridArea` nu "ingen nätägare" i stället för ett fel från `maybeSingle`, i linje med regeln att aldrig gissa.
  - **Ny variant som hittades och rättades:** `lib/analytics/db.ts` slog bara upp namn bland tenantens egna nätägare. Delade nätägare i de nya statistikraderna skulle då visas som "Saknad nätägare".
    - Rättningen gör två parametriserade frågor: egna rader och `company_id IS NULL`. Inget strängfilter med tenant-id.
    - Test: `statistics-k-analytics-readers` (F101). Det föll med den gamla logiken. En annan tenants nätägare visas aldrig med namn.
    - Testets falska PostgREST-anslutning i `forecast-completed-period-read.test.ts` saknade operatorn `is`. Utan den fastnade sex tester i timeout tills stöd lades till. Det var en brist i testet, inte i produkten.
  - **Verifiering:**
    - native 5 av 5. Den gamla kroppen gav 0 statistikrader för en delad nätägare.
    - enhetstester 13 av 13, där 8 föll utan rättningen;
    - analysläsarna 79 av 79;
    - 104 berörda testfiler, 2 181 tester;
    - tvåpartssviterna `ediel-bilateral-prodat-profile`, `-h-original`, `confirmed-customer-bilateral` och `z08lk` gröna;
    - typkontroll och eslint utan fel, täckningen 352 av 352;
    - migrationen applicerad i världen.
  - **EJ VERIFIERAT:** de godkända sviterna `ediel-at-z03h-z04h-supplier-native` (fel vid critical_negative_208, sedan timeout efter 900 s) och `ediel-z05h-z08h-supplier-native` (7 fel, ändrade utkorgsrader) föll medan verklighetskörning 26 gick.
    - Hypotes: körningens utkorgs-cron behandlar hela utkorgen, alltså också native-testernas köade rader. Deras fixturer har en tenantägd nätägare, så den nya uppslagningen ger samma första träff som förut.
    - Ska köras om i en vilande värld. Faller de, rättas det framåt.
  - **Omkörning i vilande värld 2026-10-23 (HEAD `2577e1097`):** båda sviterna nådde min tidsgräns på 25 minuter och gav ingen utdata före tidsgränsen (standardreportern).
    - I CI körs de mot en färsk databas från en ren replay med 30 minuters jobbtidsgräns inklusive replay (`.github/workflows/ediel-z03h-z04h-supplier-native.yml:32,85`).
    - Världens databas har tusentals meddelanden och hundratals syntetiska tenanter, och tre agenter körde native-tester samtidigt. Timeouten är därför inget giltigt underlag för pass eller fail.
    - Status: **EJ VERIFIERAD lokalt**. Körs om med utförlig reporter och lång tidsgräns när världen är ledig, annars avgör CI på en ren replay.
  - **Kvar, ÖPPNA:**
    - `gridex_regulated_supply.scope_v1` kräver också `company_id = c` och ger NULL för en delad nätägare. Medel. Kräver kontroll av dess godkända tester.
    - Nätägarfiltret i `listAnalyticsFilterOptions` (`lib/analytics/db.ts:67`) listar bara tenantens egna nätägare. Låg.
    - GEN-ägaren behöver fånga om `schema.sql`.

### F100 Produktionsprofiler för UTILTS (och kvittenser till UTILTS) får `encryption_mode='none'`, men produktion kräver S/MIME för alla familjer — BEKRÄFTAD (världen + produktion), kritisk; RÄTTAD (kod + migration)
- **Utfall (körning 21):** 25 CONTRL till nätägarens E66 spärrades i utkorgen med `production_smime_required`. Kvittensprofilen för PRODAT hade `smime` och ett certifikat, men de sex profilerna för UTILTS hade `none`.
- **Orsak:**
  - `evaluateProductionTransportSecurity` (`lib/ediel/config.ts`) kräver S/MIME för varje familj i produktion.
  - Registermaterialiseraren och kvittensmaterialiseraren skrev ändå `smime` bara för PRODAT, och `none` för allt annat.
- **Produktion (summering, bara läsning):**
  - alla 174 aktiva UTILTS-profiler i produktion har `encryption_mode='none'`, så varje UTILTS i produktion spärras;
  - 175 profiler totalt saknar kryptering;
  - bara 2 av 177 PRODAT-profiler har ett bundet certifikat.
- **Rättning:**
  - Båda materialiserarna skriver `smime` för alla familjer i produktionskanalen. Testkanalen är oförändrad.
  - Beredskapskontrollen binder sedan mottagarcertifikatet, vilket F96 gör möjligt.
  - Migrationen `20261023130000_ediel_production_route_profiles_smime.sql` rättar befintliga aktiva produktionsprofiler som saknar kryptering, med markeringen `f100_encryption_from`. Profiler med ett beslutat klartextundantag lämnas orörda.
  - Ingen spärr lättas: en okrypterad profil kunde aldrig skicka, och en S/MIME-profil kräver fortfarande ett giltigt certifikat.
- **Rader:** 175 i produktionen och 6 i världen.
- **Kontroller:**
  - F92/F98-testet 2 av 2;
  - materialiserarens tester 54 av 54 (en körning under belastning gav 13 tidsrelaterade fel, och två omkörningar var gröna);
  - typkontroll och eslint utan fel.

### F99 Indexet från min prestandarättning anropar `wire_v1`, som bara `postgres` får köra, så service-rollens uppdateringar av utgående CONTRL fallerar ibland med 42501 — BEKRÄFTAD (världen), hög; regression från denna gren (inte main, inte produktion); rättning pågår
- **Utfall (körning 21):** en CONTRL skickades via SMTP. Utkorgens efterföljande uppdatering av `ediel_messages` fick ändå `permission denied for function wire_v1`, och posten blev `delivery_uncertain: ediel_smtp_uncertain_cause:42501`.
- **Orsak:**
  - `20261020120200_ediel_ack_original_candidates_indexed.sql` skapade indexet `ediel_messages_contrl_uci_ref_idx` på `gridex_ack_authority.wire_v1(raw_payload)`.
  - Kodbasen återkallar avsiktligt EXECUTE på `wire_v1` från API-rollerna.
  - Indexuttryck beräknas med den skrivande rollens rättigheter. Därför fallerar varje uppdatering utan HOT, och varje insättning från service-rollen. Med HOT behöver indexet inte uppdateras, vilket förklarar att felet bara uppstår ibland.
- **Återskapat:** `SET ROLE service_role` och en uppdatering av `was_smime_encrypted` på en utgående CONTRL ger 42501.
- **Produktionen påverkas inte:** indexet finns inte där (bara läsning av metadata).
- **RÄTTAD (migration `20261023120000`, native gröna):**
  - Det härledda fältet `contrl_uci_ref` fylls i av triggern `a_00_ediel_contrl_uci_ref_derive` (`SECURITY DEFINER`). Den skriver alltid över, så en skribent kan inte förfalska värdet, och den bevarar värdet vid en retentionsövergång.
  - Indexet `ediel_messages_contrl_uci_ref_col_idx` ligger på ett vanligt fält.
  - Läsfunktionens kandidatgren läser fältet, och det ursprungliga villkoret är kvar som filter.
  - Bakfyllnaden körde utan att någon trigger stängdes av: 49 av 49 rader i världen stämmer.
  - Ingen API-roll har EXECUTE på `wire_v1`.
- **Tester:**
  - nytt `scripts/ediel-contrl-uci-ref-service-role-native.test.ts`: service-rollens insättning och uppdatering utan HOT fungerar; förfalskning skrivs över; läsningen ger samma original som den gamla skanningen;
  - skalningstestet: indexet används och färre än 50 rader läses;
  - first-reception, Z09E-received-ack och outbound-ack-replay: gröna;
  - täckningen för masterplanen: 352 av 352.
- **F99b, samma fel i ett annat index från grenen — RÄTTAD:**
  - `ediel_messages_inbound_envelope_uci_idx` (`20261020120300`) anropar `gridex_ediel_technical_ack.envelope()`.
  - F68 gav EXECUTE till `service_role` och `authenticated`, men inte till den interna rollen `gridex_ediel_retention_owner`. Dess uppdateringar utan HOT fick därför 42501, och `ediel-blob-retention-native` fallerade.
  - Migrationen `20261023121000` ger den rollen EXECUTE på de två rena tolkningsfunktionerna, enligt F68:s förebild. Retentionstestet är nu grönt.
  - Indexet finns inte i produktionen.

### F körning 20 (2026-10-23): hela bytesflödet för körningens egen tenant, och våra kvittenser når nätägaren
- **Bytet, i produktion:**
  - 4 Z01 och 4 Z03 skickades och blev `acknowledged`;
  - nätägarens CONTRL, APERAK och Z04 togs emot;
  - 4 leveransperioder blev `active` från 2026-09-01.
- **Våra 4 CONTRL till nätägaren skickades** (`sent`). Därmed är F92, T8 och F96 verifierade i världen.
- **Mätvärden:** 25 E66 togs emot och tolkades. Ingen CONTRL kunde skapas för dem, se F98: 50 försök gav `ediel_technical_ack_route_unavailable`.

### F98 Inga kvittensroutes för UTILTS: registrets UTILTS-routes saknar meddelandekod, så nätägarens E66 kan aldrig kvitteras — BEKRÄFTAD (världen + produktion), kritisk; RÄTTAD (native)
- **Utfall (körning 20):** materialiseringen av UTILTS gav `ediel_route_profile_insert_failed`, med det tekniska felet `utilts_application_reference_message_unsupported:missing`.
  - Registrets UTILTS-route har ingen `metadata.message_code`, så den utgående UTILTS-profilen kan inte skapas.
  - Kvittensroutes (F92) skapades först efter en lyckad affärsroute, så inga UTILTS-kvittensroutes fanns.
- **Produktion (summering, bara läsning):** alla 507 UTILTS-routes i registret saknar meddelandekod, och detsamma gäller alla 493 PRODAT-routes.
- **Rättning:** kvittensroutes för inkommande filer skapas nu direkt efter att avsändaren har lösts upp. De beror bara på den verifierade registerrouten, nätägaren och avsändaren, och aldrig på den utgående affärsrouten. Resultatet följer med i varje svar, även när den utgående profilen hålls.
  - Gäller både `materializeCompanyGridOwnerRoute` och bulkvägen.
- **Test:** native-testet för F92/F98 har fått ett nytt fall, en UTILTS-route utan meddelandekod. Affärsrouten hålls, men 6 kvittensroutes skapas, och väljaren hittar exakt en route för CONTRL och APERAK för E66-T och E66-S. 2 av 2 gröna.
- **Övriga kontroller:**
  - materialiserarens 5 testfiler: 54 av 54;
  - typkontroll och eslint utan fel;
  - täckningen för masterplanen: 352 av 352.
- **Kvar (F94, öppen):** den utgående UTILTS-affärsprofilen kan fortfarande inte materialiseras utan meddelandekod. Det är ett produktbeslut vilket UTILTS leverantören skickar till nätägaren.

### Rättelse till körning 19 (2026-10-23): leveransperioderna tillhörde körning 18:s tenant
- **Vad som hände:** de fyra aktiva perioderna (`completed`) tillhör körning 18:s tenant. Dess Z03 skickades kl. 01:43, och nätägaren svarade innan körningen stoppades. Svaren togs emot i körning 19:s första cron-cykel, efter T9-rättningen.
- **Vad det visar:** den kedja som beskrivs nedan är verklig och gäller körning 18:s tenant. Det första produktionsbytet är alltså bekräftat i världen, med Z04 som källa och perioder från 2026-09-01.
- **Körning 19:s egen Z03 skickades aldrig, på grund av T10:**
  - Certifieringsraderna bands till Z01 kl. 02:05.
  - De fyra Z01 hade redan fallerat i utkorgen. Tre fick `ediel_scoped_capability_evidence_required`, och en fick det oläsliga felet `[object Object]` (F97).
  - Ändå räknades de som väntande.
  - Hjälparens F90-regel ("behåll den bundna typen så länge den väntar") certifierade därför aldrig Z03, och Z03 fallerade och försöks aldrig igen (O1).

### T10 Ersättaren för certifieringen räknade döda utkorgsposter som väntande — RÄTTAD, verklighetsvärlden
- **Rättning:** `scripts/helpers/reality/scopedCertification.ts` räknar inte längre meddelanden vars utkorgspost har fallerat, spärrats eller skickats. Sådana poster försöks aldrig igen (O1/B1).

### F97 En utkorgspost sparar felet som `[object Object]` — ÖPPEN, medel (observation, ej utredd)
- **Utfall (körning 19):** en Z01 i produktion fick `last_error='[object Object]'`, efter certifieringen. Den verkliga orsaken går därför inte att läsa, varken för operatören eller för SLA-hanteringen.

- **RÄTTAD 2026-10-23 (agent):**
  - **Orsak:** supabase-js returnerar fel som vanliga `{code,message,details,hint}`-objekt. `throw error` följt av `String(error)` gav därför `[object Object]`.
    - Vägen till den fallerade Z01: `outboundAttempt.ts:51` kastar vidare, och catch-blocket i `sendOutboxItem` sparar texten som `last_error`.
    - Samma fel fanns i spärren för manuell sändning i `orchestrator.ts`, som skriver till `failure_reason` och händelser.
  - **Rättning:** `lib/ediel/outbox/storedErrorMessage.ts` sparar `code: message`, maskerat med `redactLogText`. `details` och `hint` kopieras aldrig, enligt samma integritetsregel som `smtpOutcome.ts`. Ett oläsbart fel sparas som `ediel_error_unreadable`.
  - **Tester:**
    - `__tests__/ediel-outbox-error-serialization.test.ts` 7 av 7 (alla föll med den gamla logiken);
    - utkorgen 145 av 145;
    - orkestreraren 105 av 105;
    - typkontroll och eslint utan fel;
    - täckningen 352 av 352.
  - **Sidofynd (ÖPPNA):**
    - `lib/ediel/transport/inboundProcessor.ts:53` sparar dead-letter-fel via `formatErrorMessage`, som kopierar `details` och `hint`, alltså möjlig persondata. Medel.
    - `technicalAckRouteMaterializer.ts:349` har en `String(error)`-fallback. Låg.
    - Utkorgens cron-rutt loggar `Unknown error` för fel som inte är `Error`. Gäller bara loggen. Låg.
### F körning 19 (2026-10-23): FÖRSTA BEKRÄFTADE PRODUKTIONSBYTET — leveransen vilar på nätägarens Z04
- **Kedjan, hela vägen i produktionskanalen:** go-live, sedan Z01 och Z03 i produktion, sedan nätägarens CONTRL, APERAK och Z04, därefter `normal_switch_confirm_v1` och 4 leveransperioder.
- **Utfallet:**
  - alla fyra leveransperioder `active`, från `2026-09-01`;
  - källan är `ediel_qualified_source`, med Z04 som källmeddelande;
  - bytena står som `completed`.
- **Rättningarna som tog oss hit:** F92, F95, T6, T7, T8, T9 och RPL-01.

### F96 Expisoft-certifikat sparas med familjen PRODAT, så ingen CONTRL, APERAK eller UTILTS kan krypteras till nätägaren — BEKRÄFTAD (världen + produktion), kritisk för go-live; rättning pågår
- **Utfall (körning 19):** kvittensrouten hittades och våra fyra CONTRL skapades. Utkorgen spärrade dem ändå med `receiver_certificate_message_family_mismatch`.
- **Orsak:**
  - `lib/ediel/security/expisoftCertificateDirectory.ts` sparar varje certifikat från Expisoft-katalogen som `message_family='PRODAT'`, `message_type='PRODAT'`.
  - Katalogen publicerar ett krypteringscertifikat per postlåda, inte per familj.
  - Spärren `certificateMessageScopeBlocker` (TR-06, godkänd) nekar korrekt ett PRODAT-certifikat för en annan familj.
- **Produktion (summering, bara läsning):** alla 168 aktiva Expisoft-certifikat för mottagare är PRODAT/PRODAT, och 78 utgångna likaså. I produktionen skulle alltså varje CONTRL, APERAK och UTILTS till en nätägare spärras.
- **Rättning — RÄTTAD (native 3/3), väntar på verifiering i världen:**
  - `expisoftCertificateDirectory.ts` sparar certifikatet med familj och typ satta till NULL, även i metadata. Läsarna faller annars tillbaka på metadatanycklarna.
  - TR-06-spärren är oförändrad.
  - En ny uppslagning skriver om en gammal rad på plats via fingeravtrycket, så inga dubbletter uppstår.
- **Befintliga rader:** migrationen `20261023110000_expisoft_certificates_mailbox_scope.sql` skriver om de rader uppslagningen själv skapat (`expisoft_ldap`, PRODAT/PRODAT), med markeringen `f96_rescoped_from` för tillbakarullning. Ingen cron hade gjort det: nattjobbet uppdaterar bara spärrade, saknade och utgångna certifikat.
  - Påverkade rader: 168 i produktionen och 5 i världen.
- **Test:** `scripts/ediel-expisoft-certificate-family-scope-native.test.ts`.
  - Ett nytt certifikat släpper igenom PRODAT, CONTRL, APERAK och UTILTS. Fel ägare, underadress eller miljö nekas fortfarande.
  - Ett manuellt UTILTS-certifikat nekar fortfarande andra familjer.
  - En gammal PRODAT-rad nekar CONTRL tills den uppdateras.
  - Testet fallerar mot den gamla koden.
- **Övriga kontroller:**
  - 8 relaterade testfiler: 72 av 72;
  - typkontroll och eslint utan fel;
  - täckningen för masterplanen: 352 av 352.
- **Sidofynd (öppna, inte rättade, utanför F96):**
  - Den befintliga raden matchas på fingeravtryck över alla tenanter och källor. En uppslagning för en tenant kan därför skriva över en annan tenants rad, eller en manuellt importerad rad, inklusive `company_id`. Medel.
  - `actorAutoReadiness` skickar inget `companyId`, så en uppslagning nollar `company_id` men behåller scope. Medel.

### T9 Världens cron-cykel pollade aldrig produktionskanalen — RÄTTAD, verklighetsvärlden
- **Utfall (körning 18, och tidigare körningar som väntade på svar):** nätägaren svarade inom 2 minuter, men produktionsbrevlådan pollades inte i F4. `last_polled_at` stod still.
- **Orsak:** `runOperationalCronSlot` (`scripts/helpers/reality/world.ts`) bytte `?environment=production` mot `?environment=test` i varje Vercel-cron. I körning 17 kom svaren bara in för att jag pollade manuellt.
- **Rättning:** en cron som Vercel kör för produktionskanalen körs nu exakt så, och därefter även för testkanalen.

### T6 Nätägarsimulatorns Z04 saknade avläsningsfälten 214, 218 och 259 — RÄTTAD, verklighetsvärlden
- **Utfall (körning 15):** varje Z04 hölls med `PRODAT_DEPENDENT_CONDITION_UNDETERMINED` (`prodatRegisterPolicy.ts:139`, "Receiver-local readings condition unknown"). Objektet bedömdes `unavailable` med orsaken `source_owner_not_established`, och ingen leveransperiod skapades.
- **Det är avsiktligt i produkten:** det godkända testet `scripts/ediel-at-z03l-z03lk-supplier-native.test.ts:1257` kräver just detta när fält 259 saknas. Dess positiva fall (rad 1405) lägger till `CCI++Z02/Z05/Z16`.
- **Rättning:** simulatorn deklarerar avläsningarna exakt som `withOwnReadings(body, true)` i det godkända testet.

### T7 Produktionssvar hamnade i testkanalen — RÄTTAD, verklighetsvärlden
- **Utfall (körning 15):**
  - Z03 var lagrade som `production`, men Z04, CONTRL och APERAK som `test`.
  - Kvittenserna gav `ack_transport_environment_mismatch:test:production`, och bytena blev kvar som `prepared`.
  - Även en godkänd Z04 hade fått `normal_z04_exact_sent_original_required`, eftersom Z03 och Z04 måste ligga i samma kanal.
- **Orsaker:**
  - Simulatorerna hårdkodade `environment: 'test'` (`gridOwnerWire.ts`, `gridOwner.ts asReceived`, `rejectsWire.ts`). E66 hade alltid testflaggan.
  - Alla svar postades till testbrevlådan. Plattformen lagrar inkommande filer i brevlådans kanal.
  - Världen hade ingen pollad produktionsbrevlåda. Produktionens seedade rad (`ediel@gridex.se`) saknar IMAP-värd.
  - Scenariot pollade bara `?environment=test`, medan Vercel bara pollar `?environment=production` (`vercel.json`).
- **Rättning:**
  - Svaren skickas i förfrågans kanal och till den kanalens brevlåda (`scripts/reality/simulators/platformMailbox.ts`).
  - E66 kan skickas i produktion.
  - Operatören pekar produktionsraden mot världens GreenMail via `/admin/inbound-mail` (`scripts/helpers/reality/productionMailbox.ts`).
  - Scenario F pollar båda kanalerna.

### RPL-01 Den rena replayen saknar fem kolumner i `ediel_mailboxes` som produktionen och koden använder — RÄTTAD (framåtriktad migration `20261022220000`), hög för replay-beroende verifiering
- **Utfall:**
  - I testvärlden misslyckades varje lyckad pollning i `markMailboxPollFinished` med `PGRST204 'last_successful_poll_at'`, och lyckandet registrerades som ett fel.
  - `/admin/inbound-mail` kunde varken lista eller spara en delad brevlåda (`smtp_host`, `smtp_port`).
- **Orsak:**
  - `20260601070000` lägger till kolumnerna, men replayen ersätter filen med den härledda bootstrapartefakten `bootstrap/20260601_ediel_production_readiness_foundation.sql` (`scripts/gridex-aud-003-legacy-foundation.json`). Artefakten saknar dem.
  - `supabase/schema.sql` saknar dem också.
  - Produktionen har alla fem: `smtp_host`, `smtp_port`, `last_poll_at`, `last_successful_poll_at` och `last_poll_status` (bara läsning av metadata, 2026-10-22).
- **F körning 16 (2026-10-23):** operatörens sparning av produktionsbrevlådan gav 500 med `PGRST204 'updated_by'`. Produktionen har också `created_by` och `updated_by` (uuid), och `smtp_port` har standardvärdet 587 där. Migrationen, som aldrig har körts i produktionen, täcker nu alla sju kolumnerna.
- **Rättning:** `add column if not exists`, som inte gör något i produktionen. Ägaren av GEN och replay behöver fånga om `schema.sql`, typerna och artefakten. Det är dokumenterat på #840, och jag har inte rört filerna.

### MIG-01 Krock i migrationsversion med main — RÄTTAD (namnbyte av en ej körd migration)
- F85-migrationen `20261022120000_registry_routes_materialize_supplier_scopes.sql` hade samma 14-siffriga version som `20261022120000_normal_supplier_switch_atomic_enqueue.sql` på main. Main:s migration är körd i produktionen som `20261022230935`.
- Min migration har aldrig körts någonstans utom i testvärlden. Den heter nu `20261022121000_…`, och manifestet och testet pekar på det nya namnet.


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
