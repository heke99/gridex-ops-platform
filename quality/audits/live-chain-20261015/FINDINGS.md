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
- **Rättning:** migrationen `20261015130000_ediel_wire_tokenizer_linear_time.sql`. Test: `__tests__/ediel-wire-tokenizer-linear-time.test.ts`.
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
- **Rättning:** migrationen `20261015231500_ediel_technical_ack_original_lookup_by_uci.sql`. Ingen annan agent eller öppen PR arbetade med funktionerna (kontrollerat i #766 och PR-filerna), så rättningen gjordes här.
  - `retained_source_v1` filtrerar den kopplade (unika) repliken på `originalUNB.uciReference = uciRef`, med index.
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

### O1 Misslyckade utkorgsposter försöks inte igen automatiskt — avsiktligt
`claim_ediel_outbox_items` hämtar bara `prepared` och `queued`. En post som fallerat före SMTP, till exempel för att arkivlagringen var nere, blir `failed` och kräver att en operatör köar om den. Det stämmer med TR-10 (fail-closed), men ett känt-ej-skickat fel skulle kunna köas om automatiskt. Det noteras som driftobservation.

## Tidsgränser i verkligheten (kontrollerat 2026-10-15, bara läsfrågor)

| Inställning | Lokal replay | gridex-ops-dev (drift) | gridex-ops-staging |
|---|---|---|---|
| `authenticator` statement_timeout / lock_timeout | 8 s / 8 s | 8 s / 8 s | 8 s / 8 s |
| `authenticated` / `anon` | 8 s / 3 s | 8 s / 3 s | 8 s / 3 s |
| `service_role` egen inställning | ingen | ingen | ingen |
| `deadlock_timeout` | 1 s | 1 s | – |
| `max_connections` | 100 | 60 | – |

Appen går via PostgREST som `authenticator` och växlar till `service_role`. Tidsgränserna i testet är alltså desamma som i drift. Drift har färre anslutningar, vilket gör parallell belastning tuffare, inte lättare.

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
