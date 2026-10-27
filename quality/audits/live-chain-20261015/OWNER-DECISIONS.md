# Ägarbeslut — verklighetssimuleringen (live-chain-20261015)

Ett register över alla frågor som Claude har ställt till ägaren under simuleringen och svaren på dem, så att Codex och andra granskare kan hitta besluten utan att leta i chatten.
Varje rad hänvisar till avsnittet i [FINDINGS.md](FINDINGS.md), där bevis, rättning och tester finns. Sök på fynd-ID:t eller citatet.
Nya beslut läggs till sist, och inget tas bort. Ett beslut som ersätts markeras "ERSATT av …".

| # | Datum | Fynd | Fråga (kort) | Ägarens svar | Följd / status |
|---|---|---|---|---|---|
| 1 | 2026-10-22 | F79 | Vilka mätvärden får kunden se på Mina sidor och i API:t? | Bara mätvärden som kunden har verifierad rätt till. Kopplingen till en anläggning ger inte hela anläggningens historik. | RÄTTAD (F79) |
| 2 | 2026-10-22 | F51 | Vem anger kundens folkbokföringsadress för Z01? | Webbkunden anger den själv i formuläret och API:t (obligatoriskt direkt). Vid manuellt intag anger operatören eller personalen den. | RÄTTAD (F51, `3f172f1d`) |
| 3 | 2026-10-22 | F44, F46 | Varifrån kommer BRP (fält 262) och den granskade källan för Z03? | "Automatiskt": BRP från onboarding och automatisk källa för mätmetod och nätregister. | RÄTTAD (F44, F46) |
| 4 | 2026-10-22 | F45, F59, F62, F66, F67 | Avtalsversion, registrering av signerat avtal, auktorisering av byte, fullmakt och nätägarförfrågan utan webb | Ägarbesluten i respektive FINDINGS-avsnitt. | RÄTTADE |
| 5 | 2026-10-22 | GOR-04 | Ska en negativ CONTRL (vårt eget fel) ge ett besked till kunden? | Nej, bara ett tekniskt ärende. En negativ APERAK ger ett kundbesked. | RÄTTAD (`64829c21`) |
| 6 | 2026-10-23 | F89, F90, F91 | Vilken certifiering bär produktionssändning? | "Vår certifiering samt krypteringen vi har", därefter "Automatiska bevis": plattformen registrerar själv beviset per aktiverad meddelandetyp utifrån bolagets egen certifiering. Masterplanreglerna lämnas orörda. | RÄTTAD (F89/F90/F91) |
| 7 | 2026-10-23 | H2, H3 | Spelar det någon roll vilken månad en churn sker i? | "Månad i churn spelar inte roll." | Gäller |
| 8 | 2026-10-23 | F108 (M5, M6) | Faktureringsmånad för Ediel-leveranser? | "Ediel-månad": från 00:00 +0100 den 1:a. Fakturan skriver ut perioden exakt. | RÄTTAD (F108, migration `20261023196000`) |
| 9 | 2026-10-23 | F108 (M7) | Gränser för manuella och äldre perioder utan Ediel-tidpunkt? | "Svensk civil midnatt". | RÄTTAD (F108) |
| 10 | 2026-10-23 | F109 | Vem får importera och låsa spotpriser? | "Endast plattformen": plattformsadmin och nattlig cron. Tenanter väljer sin priskälla. | RÄTTAD (F109b) |
| 11 | 2026-10-23 | F109 (b) | Får tenantflöden fylla i saknade spotdagar? | "Tillåt fyllnad": bara saknade dagar, utan lås och utan överskrivning. | Gäller |
| 12 | 2026-10-23 | H3, sidofynd 1 (H3b) | Ska slutmånaden faktureras när en kund flyttar ut manuellt (`move_out`)? | "Fakturera slutmånaden", med samma regel som efter Z05. | RÄTTAD (H3b, `f732be9f9`, migration `20261023200000`) |
| 13 | 2026-10-23 | F115 | Får en tenant gå live utan vald fakturaleverantör? | "Spärra go-live": beredskapen kräver leverantör, och tenantens administratör ser åtgärden. | RÄTTAD (F115, `c2f6aba56`) |
| 14 | 2026-10-23 | H3c | En Ediel-kund flyttar ut manuellt utan Z05: vilken grund gäller för slutfakturan? | "Ediel-start + manuellt slut": starten kvalificeras av det mottagna bytet. Ett manuellt slut får korta perioden men aldrig förlänga den. Ett senare Z05 rättar perioden. | RÄTTAD (H3c, migration `20261023201000`) |
| 15 | 2026-10-23 | H3c (förtydligande) | Vad betyder "manuellt"? | Kunden meddelar flytt, byte eller uppsägning via e-post eller telefon, och operatören avslutar leveransen i plattformen. Motsatsen är ett Ediel-meddelande från nätägaren. Uppsägningstid ska beaktas, även för kunder utan uppsägningstid och för privatpersoner med högst 14 dagar. | Utredd som H3d |
| 16 | 2026-10-23 | H3d B1 | Uppsägningstid vid flytt? | "Avtalet avslutas enligt uppsägningstid", för alla kundtyper. Hänsyn ska tas till att en person eller ett företag kan säga upp sitt nätavtal: då finns ingen elleverans, och leveransen och energidebiteringen upphör även om avtalet löper vidare. | RÄTTAD i H3d del 2 (migrationer `20261023203000`–`206000`) |
| 17 | 2026-10-23 | H3d B2 | Brytavgift vid flytt inom bindningstid? | "Avgiftsgranskning för alla" kundtyper, både vid manuell flytt och Z05 LK. Operatören beslutar. | RÄTTAD i H3d del 1 (migration `20261023202000`) |
| 18 | 2026-10-23 | H3d B3 | Uppsägning utan flytt, när uppsägningstiden löper ut? | "Vänta på nytt byte, sedan ev. Z08": leveransen fortsätter tills Z05 kommer. Har inget byte skett skapas en operatörsuppgift att skicka Z08. | RÄTTAD i H3d del 2 (migrationer `20261023203000`–`206000`) |
| 19 | 2026-10-23 | H3d B4 | Den fasta månadsavgiften i slutmånaden? | "Per dag": fördelas på dagarna med leverans. | RÄTTAD i H3d del 1 (migration `20261023202000`) |
| 20 | 2026-10-23 | H3d (följdfråga till B1/B4) | Ska fasta avgifter tas ut under uppsägningstid som löper efter att leveransen har upphört? | **Nej.** De fasta elhandelsavgifterna upphör vid det faktiska leveransslutet och fördelas per kalenderdag. En eventuell brytavgift och separat avtalade tjänster hålls utanför den vanliga månadsdebiteringen. | RÄTTAD i H3d del 1 (migration `20261023202000`); separata tjänster saknar markör |
| 21 | 2026-10-24 | H3d B5 | Uppsägning utan flytt inom bindningstid: när slutar avtalet? | "Uppsägningstid + avgiftsgranskning": avtalet slutar efter uppsägningstiden. Inom bindningstid skapas en avgiftsgranskning, och operatören beslutar om brytavgift. | RÄTTAD (migration `20261024100000`) |
| 22 | 2026-10-24 | H3d B6 | När skapas operatörsuppgiften att skicka Z08 vid uppsägning utan flytt? | "I god tid före slutet": så att Z08 kan skickas inom Ediels fönster för leveransslut, till exempel 14 dagar före uppsägningstidens slut. Uppgiften stängs automatiskt om en ny leverantörs Z05 kommer först. | RÄTTAD (14 dagar före, migration `20261024100000`) |
| 23 | 2026-10-24 | H3d B7 | Uppsägning med uppsägningstid och byte bort (Z05 L) före slutet: behåller avtalet sitt planerade slut? | "Ja, behåll planerat slut": leveransen och debiteringen stoppar vid bytet, och avtalet löper formellt till uppsägningstidens slut. Avgiftsgranskning sker om bytet ligger inom bindningstid. | Implementerat i del 2 |
| 27 | 2026-10-25 | GOR-06 | Ska dispatchvakten skilja nytt utskick från fortsatt hantering? | **Ja.** Spärren ska skilja nytt utskick från behandling av svar och uppdatering av ett redan skickat ärende. Den får inte hindra kvittenser, bekräftelser, avvisningar eller annulleringar för befintliga ärenden. Skilj på skickat, tekniskt kvitterat, applikationskvitterat, bekräftat av nätägaren (Z04 L/LK med kontroll av ärendereferens, anläggning, aktörer och startdatum) och aktiv leverans (följer den bekräftade perioden). Positiv CONTRL/APERAK är aldrig ensam ett bekräftat byte. Övergången ska vara atomisk och idempotent, utan nytt utskick eller dubbla sidoeffekter; behörighet, tenant och giltiga övergångar behålls. Den exakta övergången ska visas före ändring. | Se GOR-06 i FINDINGS |
| 28 | 2026-10-25 | H3d D11 | Hur debiteras en granskad brytavgift? | **Separat, spårbart underlag** efter granskning och godkännande, som standard en egen faktura genom befintlig fakturamotor (ingen parallell fakturering). Spara avtalsversion, kundkategori, avtalsgrund, beräkning, förlustunderlag och godkännare. Engångsfakturering; kreditering spårbar. Konsument och småföretag: kontroll av tidsbestämt avtal, fastprisdel och tillåten ersättning. Ingen automatisk brytavgift för rörligt pris eller portfölj utan fastprisdel. Inga återstående månadsavgifter eller administrativa bytesavgifter. Större företag: separat uttrycklig avtalsregel. Moms och kontering enligt verifierad klassificering. | Se D11 i FINDINGS |
| 29 | 2026-10-25 | Beslut 20 (separata tjänster) | Markör för separat avtalade tjänster? | **Ja, per tjänst eller avtalspost**, aldrig en generell kundmarkering. Registrera innehåll, pris, avtalsreferens och version, kundens accept, start, uppsägningsvillkor och slut, samt om tjänsten är beroende av elleveransen. Markeringen ger ensam ingen rätt till fortsatt debitering: efter leveransslut krävs giltigt avtal och faktiskt tillhandahållande. Som standard stoppas leveransanknutna avgifter vid leveransslut; avvikelser kräver dokumenterad avtalsgrund och granskning. En elhandelsavgift får inte göras om till "separat tjänst". | Se SEP-01 i FINDINGS |
| 30 | 2026-10-25 | F113 | Överlämning av den skyddade objektbatchen | Respektera objektlåsen. Dokumentera exakt berörda funktioner, migrationer, ansvarig, ändring och tester för överlämning. Fortsätt med oberoende arbete. Är ansvarig inte längre aktiv ska ägarskapet överlämnas uttryckligen innan någon annan ändrar. F113 är öppen tills ändringen är integrerad och verifierad. | Se F113 i FINDINGS |
| 24 | 2026-10-24 | F117 | Ska månadsförberedelsen av fakturor för granskning kräva att utskick till en testad fakturaleverantör är aktiverat? | "Separera förberedelse och utskick": förberedelsen körs så snart en leverantör är vald och faktureringsautomationen är på. Utskicket kräver fortfarande en testad anslutning och aktivering. Go-live-beredskapen visar båda stegen. | RÄTTAD |
| 25 | 2026-10-24 | G-6b | Får underlagen för en månad lagras i delar i stället för i en enda transaktion per tenant och månad? | "OK, per del": om en körning fallerar ligger redan lagrade delar kvar, och nästa körning fyller i resten. Fakturor skapas först när hela månaden är komplett. | RÄTTAD (migration `20261024140000`) |

## Öppna frågor till ägaren
- **F115:** räcker en fakturaleverantör vald i miljön `test` för go-live, eller ska `production` krävas?
- **F114:** ska envägsläget `link_existing_only` skriva värden som meddelandet bär, eller bara identitet, som objektvägen gör?
- **F113:** överlämningen av den skyddade objektbatchen (`require_wire_projection_v1`, DB-05/SC-031) väntar på kroppsägarna.
- **26 (2026-10-25, H6):** båda: scenariot levererar S:s hela (förflutna) oktober, och en ofullständig månad lagras som underlag i granskning (`needs_review`/`blocked`) i stället för att kastas. Den faktureras aldrig. Ägaren tillåter också nätverket för SVK (`services2.arcgis.com`) och spotpriser (`www.elprisetjustnu.se`).
- **GOR-06:** besvarad, beslut 27.
- **Stående godkännande (2026-10-25):** ägaren godkänner att simuleringen alltid fortsätter och att överlämningsbegäranden för låsta objekt postas i #840.

- **J1-14 (2026-10-27):** Z06 E/F läggs i källbunden granskning och APERAK väntar på personalens godkännande, men APERAK-fristen (30 min) löper ut innan dess. Ska en godkänd Z06 få positiv APERAK direkt, med separat masterdatagranskning, eller ska granskningen hålla Ediels svarstid?
- **J1-01 (påminnelse):** godta nätägarens avvikande startdatum, eller avvisa med APERAK 42/210?

- **A-B5 (2026-10-27):** ska befintliga mätpunkter som saknar `grid_owner_ediel_id` fyllas i från sin bundna, aktiva nätägare (engångsbackfill; varje rad registreras av e035-fångsten)? Nya och ändrade mätpunkter fylls redan i av triggern.

## Förslag 31–34 (2026-10-25, utredda av en agent från kod, schema och FINDINGS) — BESLUTADE, se ägarbeslut 31–34 nedan

### Förslag 31 — K-W1b: SVK-importen binder om ett mappat nätområde till en omappad ägare vid stavningsskillnad
- **Fråga:** hur ska `gridex_import_grid_area_master_row` välja plattformsägare när SVK:s ägarnamn ger en annan `gridex_grid_owner_name_key` än registret? I dag skapas då en ny ägare, och `platform_grid_areas.grid_owner_id` skrivs över.
- **A, ompekning vägras:** ett område som pekar på en mappad ägare behåller den när den nya kandidaten är omappad, och avvikelsen loggas för granskning. En förbildsomskrivning av funktionen; liten insats och risk. Inga lås berörs.
- **B, matchning på stabil identitet:** träffen avgörs av Ediel-id eller organisationsnummer före namnnyckeln. Kräver en översättningstabell från SVK-ägare till Ediel-id; medelstor insats.
- **C, som i dag:** alla exakta adresser i området kan tappa nätägaren, och då stoppas inga byten.
- **Rekommendation: A nu**, B senare vid behov.

### Förslag 32 — I-B2d: tenanten saknar UI-väg för att återskapa ett misslyckat byte
- **Fråga:** ska tenantens operatör kunna starta om ett misslyckat byte? Bytespanelen visas bara för `isPlatformAdmin` på fliken `switch-operations`, trots att `allowTenantStartSwitch` finns.
- **A, tenanten får panelen:** bara `CustomerSwitchCreatePanel`, när `allowTenantStartSwitch` gäller. Serveråtgärden prövas för `switching.write`. Liten–medel insats.
- **B, "Försök igen" på det misslyckade bytet:** åtgärden köar om `start_supplier_switch` via automationen. Medel insats.
- **C, bara plattformsadministratören:** I9 körs som plattformsadmin, och tenanten får ringa supporten.
- **Rekommendation: B.**

### Förslag 33 — D11-G1: ingen produktväg krediterar en fakturerad brytavgift
- **Fråga:** hur ska en fakturerad brytavgift krediteras? `gridex_record_break_fee_credit_v1` kräver ett `billing_adjustment_cases`-ärende som ingen kod skapar, och `POST /api/internal/invoices/[id]/credit` svarar alltid 409.
- **A, ett avgränsat kreditflöde för brytavgift:** en RPC skapar justeringsärendet och ett negativt underlag. Underlaget går genom den vanliga prissättningen, låsningen och exporten och binds sedan av `gridex_record_break_fee_credit_v1`. Medel insats.
- **B, det allmänna kreditflödet först:** större insats, med eget beslut om kreditregler.
- **C, manuell kreditering utanför Gridex:** spårbarheten går förlorad.
- **Rekommendation: A.**

### Förslag 34 — J2-13: ingen avstämning mellan uppmätt, fakturerat och E31/S03
- **Fråga:** ska plattformen stämma av egna mätvärden och fakturerade kWh mot nätägarens E31 och S03? De tolkas i dag men jämförs inte med något.
- **A, kontrollvy och avvikelseuppgift:** per nätområde och månad, med en tröskel. Ingen automatisk ändring. Medel insats.
- **B, A plus spärr:** fakturering spärras vid avvikelse. Risk för fakturastopp vid sena E31.
- **C, ingen avstämning.**
- **Rekommendation: A först**, B när trösklarna är kända.

## Ägarbeslut 31–34 (ägaren, 2026-10-25), med krav

### Ägarbeslut 31 — K-W1b: A, behåll kopplad nätägare vid namnkonflikt
- En skillnad i stavning eller företagsnamn ska inte ensam ändra nätområdets nätägarkoppling.
- Matcha i första hand mot verifierade, stabila identifierare och dokumenterade kopplingar.
- Logga konflikten med källa, befintlig koppling och importerad uppgift, för granskning.
- Ett verkligt ägarbyte ska kunna genomföras genom en separat, verifierad ändring med historik.

### Ägarbeslut 32 — I-B2d: B, "Försök igen" genom befintlig automation
- Personalen ska kunna försöka igen från ärendet, utan att fylla i det tekniska bytesformuläret.
- Återförsöket kontrollerar felorsak, avtalsgiltighet, behörighet, datum och befintlig meddelandestatus.
- Om utskicket kan ha nått mottagaren ska systemet först utreda det befintliga ärendet. Det får inte blint skicka en ny bytesanmälan.
- Ett redan bekräftat byte får inte startas om.
- Avtalat startdatum ändras inte automatiskt.
- Dubbla köjobb och utskick förhindras.
- Det loggas vem som initierade återförsöket.

### Ägarbeslut 33 — D11-G1: A, avgränsat kreditflöde för brytavgifter via befintlig fakturamotor
- **Omfattning:** hel- och delkreditering, med behörighetskontroll, orsak, låsning och revisionsspår.
- **Kreditfakturan** hänvisar till ursprungsfakturan och de berörda avgiftsraderna.
- **Beräkning:** krediten utgår från den ursprungliga debiteringen och dess moms- och konteringsbehandling. Den räknas inte om med dagens priser.
- **Tak:** sammanlagd kreditering får inte överstiga det ursprungligen debiterade beloppet.
- **Avgränsning:**
  - Den generella kreditfunktionen förblir stängd i denna etapp.
  - Ingen separat teknisk faktureringslösning.
  - En eventuell återbetalning hanteras och spåras separat från krediteringen.

### Ägarbeslut 34 — J2-13: A, avstämning med korrekt uppdelning
- **Två separata kontroller:**
  1. egna mätvärden mot nätägarens jämförbara summerade mätvärden;
  2. nettofakturerade kWh, inklusive krediteringar och rättelser, mot motsvarande faktureringsgrundande mätvärden.
- **Avgränsning:** per tenant/elhandelsaktör, nätavräkningsområde, leveransperiod och relevant serietyp.
- **Hantera:** leveransstarter, avslut, enheter, tidsupplösning och rättade filversioner.
- **S03** är preliminära andelstal/planvärden, inte slutligt uppmätt förbrukning.
- **Saknade eller ofullständiga data** får en egen avvikelsestatus. De räknas aldrig som noll eller som godkänd avstämning.
- **Tidpunkter:** en månadsvis sammanställning är första etapp, plus kontroll vid nya eller korrigerade mätvärdesunderlag.
- **Toleranser:** dokumenterade, i både kWh och procent.
- **Vid avvikelse:** ett spårbart personalärende, med ansvarig och underlag för kontakt med nätägaren.
- **Inte i denna etapp:** inga automatiska rättelser och ingen ny generell faktureringsspärr. Befintliga faktureringskontroller fortsätter gälla.

**Gemensamt:** besluten dokumenteras, och berörda scenarier verifieras innan fynden markeras som lösta.
