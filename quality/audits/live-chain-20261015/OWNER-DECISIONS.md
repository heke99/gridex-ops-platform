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
| 21 | 2026-10-24 | H3d B5 | Uppsägning utan flytt inom bindningstid: när slutar avtalet? | "Uppsägningstid + avgiftsgranskning": avtalet slutar efter uppsägningstiden. Inom bindningstid skapas en avgiftsgranskning, och operatören beslutar om brytavgift. | Att implementera; ersätter regeln "det senare av uppsägning och bindning" i del 2 |
| 22 | 2026-10-24 | H3d B6 | När skapas operatörsuppgiften att skicka Z08 vid uppsägning utan flytt? | "I god tid före slutet": så att Z08 kan skickas inom Ediels fönster för leveransslut, till exempel 14 dagar före uppsägningstidens slut. Uppgiften stängs automatiskt om en ny leverantörs Z05 kommer först. | Att implementera; i del 2 skapas den på slutdagen |
| 23 | 2026-10-24 | H3d B7 | Uppsägning med uppsägningstid och byte bort (Z05 L) före slutet: behåller avtalet sitt planerade slut? | "Ja, behåll planerat slut": leveransen och debiteringen stoppar vid bytet, och avtalet löper formellt till uppsägningstidens slut. Avgiftsgranskning sker om bytet ligger inom bindningstid. | Implementerat i del 2 |
| 24 | 2026-10-24 | F117 | Ska månadsförberedelsen av fakturor för granskning kräva att utskick till en testad fakturaleverantör är aktiverat? | "Separera förberedelse och utskick": förberedelsen körs så snart en leverantör är vald och faktureringsautomationen är på. Utskicket kräver fortfarande en testad anslutning och aktivering. Go-live-beredskapen visar båda stegen. | Att implementera |

## Öppna frågor till ägaren
- **F115:** räcker en fakturaleverantör vald i miljön `test` för go-live, eller ska `production` krävas?
- **F114:** ska envägsläget `link_existing_only` skriva värden som meddelandet bär, eller bara identitet, som objektvägen gör?
- **F113:** överlämningen av den skyddade objektbatchen (`require_wire_projection_v1`, DB-05/SC-031) väntar på kroppsägarna.
