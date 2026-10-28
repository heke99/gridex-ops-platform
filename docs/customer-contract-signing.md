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
