# Elklart-demo i Gridex

Ingången är `https://demo.gridex.se`. Kundportalen använder `https://mina-sidor-demo.gridex.se` för en separat kundsession i en annan flik. De två värdarna behöver varsin deployment. Demot använder den vanliga inloggningen och befintliga behörigheter. Portföljövningen visas bara för den konfigurerade Elklart-tenanten med åtkomst till analys.

## Starta en isolerad miljö

1. Sätt upp dedikerade databaser för OPS och Gridex Web med respektive repos migreringar. Verifiera projekt-ID, Auth-URL och databasmigreringar före varje första skrivning. Koppla båda deploymentprojekten till de nya databaserna. Begränsa åtkomst till båda värdarna och låt portalens server nå OPS-API:t. Använd ett eget API-klientkonto kopplat till demobolaget.
2. Skapa det fiktiva demobolaget Elklart via ordinarie bolagsprovisionering i OPS. Sätt upp demokonton för presentatör, kund, handläggare och bolagsadmin. Använd befintliga roller och verifiera rättigheter med varje konto. Ge användarna individuella lösenord via säker distribution.
3. Sätt `ELKLART_DEMO_ENABLED=true` på de två dedikerade deploymentprojekten. OPS kräver `ELKLART_DEMO_COMPANY_ID`. Kundportalen kräver `NEXT_PUBLIC_SITE_URL=https://mina-sidor-demo.gridex.se` och `GRIDEX_OPS_API_URL=https://demo.gridex.se/api/v1`. Använd testhemligheter för Auth, webb-API, signerade tillstånd, interna jobb och eventuella supportanrop. Publicera ett demoerbjudande genom ordinarie publiceringsväg före kontroll av Teckna avtal.
4. Ge Ediel enbart testkonfiguration och anslut utskick till en lokal eller privat testmottagare. Kontrollera att transport, leverantörsuppslag och fakturaexport bara använder testsystem. Använd OPS Ediel Test Center eller ordinarie testimport med fiktiva nyttolaster för genomgången av nätägarhändelser.
5. Förbered testkunderna nedan genom ordinarie OPS- och kundflöden. Spara ett komplett startläge för miljön och ett separat läsläge för genomförda scenarier inför mötet. Kontrollera återställning av tillhörande autentisering, dokument och köer tillsammans med data.

## Testkunder och kontroller inför visning

| Kund | Förberett startläge | Förväntat resultat |
| --- | --- | --- |
| Anna Lind | Publicerat demoerbjudande och testanläggning. Ny kund i huvudgenomgången. | Ansökan i portal och OPS har samma referens. Godkänd testhändelse ger rätt leveransstart. |
| Samir Ek | Testanläggning med äldre mätserie och planerad inflyttning. | Samir ser endast förbrukning inom sin leveransperiod. |
| Sjövik Verkstad AB | Två anläggningar, demoavtal och provserie för förbrukning. | Serier och korrigering kopplas till rätt anläggning. Fakturaunderlaget kan följas till fakturan i kundvyn. |
| Karin Holm | Faktura och demokonto. | Registrerat samtal och internt meddelande syns för personal. Kunden ser endast kundsvaret. |
| Bergdala Fastigheter AB | Ett leverantörsbyte med förberett testavslag. | Orsaken syns i OPS. Nytt försök får spårbar status och skapar högst ett nytt försök. |
| Jonas Vik | Aktiv leverans och planerat avslut. | Slutdatum, slutfaktura och historik kan följas med rätt behörighet. |
| Elklarts roller | Individuella demokonton. | Kund, handläggare och bolagsadmin ser sina arbetsytor. Ett kontrollkonto från en annan testtenant saknar åtkomst. |

## Visa på 20 minuter

1. Öppna ingången och Mina sidor i varsin flik. Teckna ett testavtal för Anna och öppna ansökan i OPS.
2. Visa leverantörsbytet och förberedd nätägarhändelse. Växla från **Planerad leverans** till **Bekräftad leverans** i portföljövningen. För SE4 kl. 12.00 flyttas 3 kWh från planerad volym till prognosen. Resultatet blir 0,600 MWh och 2,4 MW för kvarten.
3. Välj **Kvällsskift** och **Mätvärden inkomna** för att visa hur behov respektive prognosavvikelse ändras. Följ Sjöviks två anläggningar till mätvärdes- och fakturavyerna. **Efter utflyttning** visar bortfallet i framtida prognos med samma tidigare intervall.
4. Visa Bergdalas avvikelse. Använd genvägarna för övriga kundscenarier. **Återställ övningen** återställer portföljens vyval. För en helt ny huvudgenomgång återställs även demodatabasernas startläge och de tillhörande tjänsterna.

Portföljövningen använder ett simulerat dygn. Scenariovalet påverkar endast exempelvolymerna på den sidan. Den ordinarie portföljen hämtar månadsprognosen från OPS och visar medeleffekt för hela den svenska kalendermånaden. För att verifiera en automatisk koppling från en OPS-leveranshändelse till kvartprognosen krävs en faktisk intervallserie kopplad till leveransperioderna och en separat verifiering av detta flöde.
