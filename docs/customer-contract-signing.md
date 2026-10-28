# Säker redigering av kundavtal

Avtalets vanliga redigeringsformulär skapar inget signeringsbevis. Signerat
statusval är spärrat innan en verklig signering har registrerats. Backendens
kontroller kvarstår även för manipulerade eller äldre formulär. Det kända
`customer_contract_signature_evidence_incomplete` visas som ett återställbart
meddelande via samma behörighetskontrollerade avtalskommando,
medan okända fel och Next-kontrollflöde bevaras. Signeringsdatumet visas
skrivskyddat och den fullständiga ursprungliga tidsstämpeln skickas oförändrad
när andra avtalsfält sparas; den kortas inte till kalenderdatum.

Efter en lyckad redigering monteras avtalsformuläret om från den sparade
radens identitet, ändringstid, anläggningskoppling och status. Det hindrar
React från att återställa okontrollerade fält till gamla standardvärden:
ett andra Spara får inte ta bort den anläggning som just sparats. Befintlig
`customer_site_id` visas även om det äldre `site_id` saknas. Övriga delar av
kundkortet behåller sitt visningsläge.


### Prisändringar i kundkortets avtalsformulär

Förväntade valideringsfel vid Spara visas i formuläret utan att användarens inmatade avgifter, anläggning eller kommentar återställs. Otillåten ändring innebär inte att avtalet har sparats. Behörighetskontroll, tenant-/kund-/avtalskoppling, signeringsbevis och databasens låsregler gäller fortsatt.

Priser som är kopplade till erbjudande, publicerad avtalsversion, prisversion, prissnapshot, låsning eller signering visas skrivskyddade. En manuell kommentar kan inte ändra den prisversion som signering och fakturering använder. Ändrade villkor kräver ordinarie ny avtalsversion och kundavtal; kundkortets Spara skapar ingen ny kanonisk prisversion. Ett obundet utkast kan fortfarande redigeras. Serveråtgärden kontrollerar även manipulerade avgiftsfält, ogiltiga belopp och försök att tömma låsta avgifter.

Webbläsarregressionen omfattar avvisad inmatning följd av två sparningar med bibehållna avgifter och anläggningsval. Ett komponentprov med syntetiskt serversvar är inte ett autentiserat produktionsprov eller bevis för hela fullmakts-/Ediel-kedjan.

Äldre konsumtionsutkast som endast har prissnapshot/prisversion och historisk eller saknad moms stoppas före skrivning när den befintliga avtalsåtgärden inte kan bevara momsen. Det är ett uttryckligt stödglapp med manuell ny versionshantering, inte ett lyckat sparande eller en automatisk datarättning.
