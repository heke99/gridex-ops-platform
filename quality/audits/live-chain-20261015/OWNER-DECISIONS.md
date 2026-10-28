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
| 35 | 2026-10-28 | J1-01 | Godta nätägarens avvikande startdatum eller avvisa? | **b, APERAK 42/210** som huvudregel. Ett oväntat startdatum som strider mot skickad Z03 och avtalad start ändrar inte avtalet och aktiverar inte leveransen; ett operatörsärende för avstämning skapas. En dokumenterad, behörigt överenskommen datumändring hanteras separat. | GENOMFÖRT (`d7ccf01eb`, migration `20261028100000`, applicerad); överlämning J1 i #840; världsverifiering pågår |
| 36 | 2026-10-28 | J1-02 | Kod för negativ APERAK på en Z04 utan vår Z03, och eget hållskäl? | **c, ERC 42 på fält 226** (inte schablonmässigt även 209). **Ja** till ett separat hållskäl. 40/105 = anläggningen kan inte identifieras entydigt med nätområdet; 40/107 = aktören saknar relation till anläggningen; orsakerna hålls isär. Kravet på egen Z03 gäller inte Z04A vid verifierad anvisning. | GENOMFÖRT (`d7ccf01eb`, migration `20261028101000`, applicerad); 40/105 och 40/107 hålls isär; Z04A undantagen |
| 37 | 2026-10-28 | J1-03 | Svar på dubbletter? | Inga nya affärseffekter, men inget generellt positivt dubblettsvar. Intern omkörning av samma sparade mottagning återanvänder beslut och svar. Ny protokolldubblett med samma meddelande-id: ERC 40/103. Ärendedubblett med nytt meddelande-id: 40/104 när kriterierna är uppfyllda. Original och kopplingar bevaras (ACK-09). | DELVIS: 40/104 och omkörning genomförda (`d7ccf01eb`, migration `20261028102000`); **40/103 öppen**, kräver ACK-09-ägarens beslut (två skyddade hinder, se handover-J1.md) |
| 38 | 2026-10-28 | J1-10 | Fält 259 i Z04? | **a** när villkoret inte gäller: fältet krävs när mätarställningar rapporteras i MSCONS/UTILTS; annars godtas en i övrigt giltig Z04 utan fältet. Test för båda fallen. | GENOMFÖRT (`f649ece0a`): fält 259 krävs bara vid rapporterade mätarställningar; båda fallen testade |
| 39 | 2026-10-28 | J1-14 | Z06-granskning mot 30-minutersfristen? | **b**: godkänd behandling, föreskriven lagring och APERAK inom 30 min från mottagarens tillhanda. Prioritering, intern tidsbudget och eskalering med marginal. Positiv APERAK först efter godkänt, beständigt resultat; aldrig för att stoppa timern. CONTRL ersätter inte APERAK och startar ingen ny frist. | GENOMFÖRT (`5231eaaab`): budget 20 av 30 min, prioritet, eskalering; ingen automatisk APERAK |
| 40 | 2026-10-28 | J2-02 | Korrigering av redan fakturerad månad? | **b** som normal kundhantering, med spårbara rättelse- och kreditunderlag (regler nedan). | GENOMFÖRT (`22ac29587`, migration `20261028120000`, applicerad); överlämning i #840; ersättningsfaktura och operatörsgränssnitt återstår |
| 41 | 2026-10-28 | F9/T48 | Månadsprisets medelvärde? | **a för befintliga avtal**: behåll avtalad kalendermånad och aritmetiskt medel. Avtal som anger annan metod följer den. Ingen generell övergång till Ediel-månad. Tim- och kvartsavtal matchar levererat prisintervall exakt. | BEKRÄFTAT (`af52dcad9`): dagens beteende, regressioner tillagda |
| 42 | 2026-10-28 | A-B5 | Engångsbackfill av `grid_owner_ediel_id`? | **Ja, avgränsad**: fyll bara saknade värden från redan bunden, verifierad, giltig nätägare; tenant, entydighet och giltighet kontrolleras; konflikter till granskning; uttryckliga värden skrivs inte över; före-/efterbild och källspårning (e035); historiska mottagningsoriginal skrivs inte om. | GENOMFÖRT (`b6ab5795e`, migration `20261028140000`, applicerad): 32 ifyllda, 465 till granskning |
| 43 | 2026-10-28 | F48 (J2-13) | Utgående UTILTS? | **E73 och föreskrivna UTILTS-ERR** som första produktionsomfattning. E73 för saknade E66-värden; S02-begäran bara med rätt roll, överenskommelse och datarätt. E73:s Application Reference anger begärd typ (E66, S02) enligt verifierad profil. E74 och S07 aktiveras inte generellt. Elhandlaren originerar inte nätägarens E66. CONTRL och APERAK är separata kvittensfamiljer. | GENOMFÖRT (`340fb6a62`, migration `20261028130000`, applicerad); överlämning i #840; E73 i världen kräver verifierad E66-referens |

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

## Öppen fråga (2026-10-27): J1-02 — svar på en Z04 för ett byte vi aldrig begärt
En Z04 för en anläggning där vi inte har skickat någon Z03 hålls i dag tyst, med samma skäl som J1-01. Nätägaren får inget svar.
- **Fråga 1:** vilken nationell kod ska den negativa APERAK:en bära? ERC 40/105 ("Anläggningen kan inte identifieras"), 107, eller ERC 42 på fält 226/209?
- **Fråga 2:** godkänner ägaren att den låsta SQL-ägaren (`normal_switch_scope_effect_v1`) får ett eget hållskäl för "ingen skickad Z03 alls", skilt från J1-01? Det kräver en överlämning från ägarna av de godkända ID som pinnar kroppen.

## Öppen fråga (2026-10-27): J2-02 — korrigering av en redan fakturerad månad
Nätägaren skickar en korrigering för en månad som redan är fakturerad (i J2: +0,288 kWh). I dag rörs fakturan inte, och inget faktureras två gånger, men skillnaden når aldrig kunden. Den syns bara i avstämningskontrollen `metering_corrections_after_billing`.
- **Fråga:** ska skillnaden (a) krediteras och faktureras om i sin helhet, (b) faktureras som en tilläggs- eller kreditrad på nästa faktura, eller (c) bara gå till manuell granskning över en beloppsgräns? Finns en beloppsgräns eller en tidsgräns (t.ex. preskription) som ska gälla?

## Öppen fråga (2026-10-27): månadsprisavtalets spotpris (F9, T48)
Ett `variable_monthly`-avtal faktureras i dag med månadens aritmetiska medelspotpris ("Medelspotpris") gånger kundens kWh. I F gav det 687,92 kr för 1 432,223 kWh. Ett förbrukningsviktat pris (varje kvarts kWh × kvartens pris) hade gett 712,47 kr.
- **Fråga 1:** ska månadspriset vara det aritmetiska medelvärdet (i dag), ett förbrukningsviktat medelvärde för kunden, eller ett profilviktat medelvärde för elområdet?
- **Fråga 2 (F108-3):** medelvärdet räknas på den civila månaden, men kWh avser Ediel-månaden (en timmes förskjutning i varje ände). Ska medelvärdet räknas på samma period som kWh?


## Ägarbeslut 35–43 (ägaren, 2026-10-28), med krav

**Gemensamt villkor (ordagrant):** "Ändringar i skyddad kod och godkända tester ska genomföras med avgränsad överlämning, bevarade skydd och nya positiva och negativa regressioner."
Källor ägaren hänvisar till: `docs/ediel/masterplan-v2/annex/source_tables.json:4992`, `annex/B_PRODAT_falt_och_villkor.md:462`, `registers/rules.json:1083` (ACK-09), `MASTERMASTERPLAN_v2.md:289` (§10–11, §15.4), `supabase/migrations/20260716223000_legal_defaults_readiness_and_profile_repair.sql:74`, `lib/billing/underlayEngine.ts:535`.
De öppna frågorna J1-01, J1-02, J1-14, A-B5, J2-02 och månadspriset ovan är därmed **BESVARADE**.

### Ägarbeslut 35 — J1-01: APERAK 42/210 vid avvikande startdatum
- Ett startdatum i Z04 som strider mot skickad Z03 och kundens avtalade start ändrar inte avtalet och aktiverar inte leveransen.
- Negativ APERAK med ERC 42, nationell kod 210.
- Ett operatörsärende för avstämning skapas.
- En dokumenterad och behörigt överenskommen datumändring hanteras i ett separat flöde.

### Ägarbeslut 36 — J1-02: ERC 42 på fält 226, eget hållskäl
- Normalt ERC 42 på fält 226 (inte schablonmässigt även 209).
- Ett separat hållskäl för "ingen egen Z03", skilt från J1-01.
- 40/105 när anläggningen inte kan identifieras entydigt tillsammans med nätområdet; 40/107 när aktören saknar relation till anläggningen. Orsakerna hålls isär.
- Kravet på egen Z03 gäller inte generellt: Z04A vid verifierad anvisning har ett eget tillåtet förlopp utan egen Z03.

### Ägarbeslut 37 — J1-03: dubbletter enligt ACK-09
- Intern omkörning av samma sparade mottagning: återanvänd tidigare beslut och svar.
- Ny mottagen protokolldubblett med samma meddelande-id: ERC 40, nationell kod 103.
- Ärendedubblett med nytt meddelande-id: 40/104, när kriterierna för ärendedubblett är uppfyllda.
- Original och kopplingar bevaras. Ingen leveransperiod, faktura eller annan affärseffekt skapas igen.

### Ägarbeslut 38 — J1-10: fält 259 villkorat
- I Z04 krävs fält 259 när mätarställningar rapporteras i MSCONS/UTILTS.
- När sådan rapportering inte gäller godtas en i övrigt giltig Z04 utan fältet.
- Testerna täcker både när fältet krävs och när det inte ska finnas.

### Ägarbeslut 39 — J1-14: 30 minuter till godkänd behandling och APERAK
- Godkänd behandling, föreskriven lagring och APERAK ryms inom 30 minuter från mottagarens tillhanda.
- Prioritering, intern tidsbudget och eskalering med marginal.
- Positiv APERAK först efter faktiskt godkänt och beständigt behandlingsresultat, aldrig enbart för att stoppa timern.
- CONTRL ersätter inte APERAK och startar ingen ny 30-minutersfrist.

### Ägarbeslut 40 — J2-02: rättelse på nästa faktura, spårbart
- Den ursprungliga skickade fakturan ändras inte.
- Rättelsen binds till ursprungsfakturan, perioden, mätvärdesrevisionen och de ursprungliga avtals- och prisreglerna.
- En negativ rättelse hanteras med korrekt kreditfaktura.
- Inga nya månads- eller fakturaavgifter tas ut för samma rättelse; samma rättelse debiteras aldrig två gånger.
- Avslutad kund eller ingen nästa faktura: separat rättelse-/kreditflöde (hel kredit och ersättningsfaktura enligt a vid behov).
- Ingen generell beloppsgräns som får rättelser att försvinna; en gräns får styra manuellt godkännande.
- Ingen godtycklig tidsgräns; preskription och avtalsregler hanteras per kundkategori.

### Ägarbeslut 41 — månadspris: avtalad kalendermånad
- Befintliga `variable_monthly`-avtal: aritmetiskt medel över avtalad kalendermånad (dagens beteende).
- Avtal som redan anger annan metod följer den.
- Ingen generell övergång till Ediel-månad.
- Tim- och kvartsavtal matchar respektive levererat prisintervall exakt.

### Ägarbeslut 42 — A-B5: avgränsad engångsbackfill
- Fyll endast saknade `grid_owner_ediel_id` från den redan bundna, verifierade och giltiga nätägaren.
- Kontrollera tenant, entydighet och giltighet; motstridiga eller tvetydiga kopplingar går till granskning.
- Befintliga uttryckliga värden skrivs inte över.
- Varje ändring får före-/efterbild och källspårning enligt e035.
- Historiska mottagningsoriginal skrivs inte om och tillskrivs inte retroaktivt dagens nätägare.

### Ägarbeslut 43 — F48: E73 och föreskrivna UTILTS-ERR
- E73 används för saknade E66-värden. S02-prognosbegäran bara där rätt roll, överenskommelse och datarätt finns.
- UTILTS-ERR skapas när föreskriven funktionskontroll kräver det.
- E73:s Application Reference anger den begärda typen (t.ex. E66 eller S02) enligt verifierad profil.
- E74 och S07 aktiveras inte generellt. Elhandlaren originerar inte nätägarens E66.
- CONTRL och APERAK hanteras som separata kvittensfamiljer.

## Öppna frågor (2026-10-28 kväll), uppkomna vid genomförandet av beslut 35–43
- **J1-03 / 40/103 (beslut 37):** svaret på en ny protokolldubblett av en Z04 hålls av två skyddade ACK-09-hinder:
  1. formkontrollen `require_wire_v1` tillåter bara en referens, men Z04 behöver både Z07 och LI;
  2. unika indexet `ux_ediel_ack_related` tillåter bara en APERAK per mottaget meddelande, och originalet har redan sin.
  - **Förslag till ACK-09-ägaren:** tillåt Z07+LI i formen och ge 103-svaret en egen nyckel, till exempel mottagnings-id som transaktionsreferens. **Godkänner ägaren en avgränsad överlämning av ACK-09-kroppen för detta?**
- **J1-01/J1-02, tolkningar att bekräfta:**
  - "kundens avtalade start" = `customer_contracts.requested_start_date`;
  - 40/105 = anläggnings-id känt men inte exakt en gång i nätområdet;
  - 40/107 = entydig anläggning utan eget signerat eller aktivt avtal och utan öppen leveransperiod;
  - en helt okänd anläggning får 42/226.
- **J1-14, avvisning i granskning:** en Z06 som personalen avvisar får i dag ingen APERAK, så fristen löper ut. Ska en avvisning ge negativ APERAK, och i så fall med vilken ERC/nationell kod?
- **F48, världen:** E73 kräver en verifierad E66-referens (`23-DDQ-E66-S` eller `-T`). Världens bolag har bara `23-DDQ-PRODAT`, och masterplanen anger ingen S/T-regel. Vilken ska simuleringens nätägarprofiler bära?
- **A-B5:** 464 mätpunkter gick till granskning, eftersom nätägarens identitet inte är verifierad i aktörsregistret (`under_review`). Ska registreringen verifieras i världen (och hur i produktion), eller räcker en lägre verifieringsnivå?
- **J2-02, återstår:** varje rättelse blir en egen faktura, eftersom motorn gör en faktura per underlag. Ska rättelsen i stället bli en rad på nästa ordinarie faktura (kräver samfakturering)? Alternativ a (hel kredit och ersättningsfaktura) och ett operatörsgränssnitt för godkännande är inte byggda.
