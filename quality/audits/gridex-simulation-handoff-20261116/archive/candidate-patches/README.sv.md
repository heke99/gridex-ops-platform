# Kandidatpatchar för granskad överföring till Main

Sju separata lokala commits har exporterats med `git format-patch --stdout -1`. Ingen patch har applicerats på Main. Manifestet anger exakt commit, förälder/bas, träd, patchhash, storlek och befintlig verifieringsnivå.

Observerad Main är `bf32b7e01fbd0511972ba8977c61d412a018e416`. Dokumentcommitten `f0d4f308` är direkt barn till denna Main. Övriga kandidaters fullständiga ancestry är inte fastställd i inventeringen. Filnamnens nummer är en förteckning, inte en godkänd appliceringsordning.

Granska varje patch mot färsk Main och dess angivna bas. Kundlisteändringen och den slutliga kundraderingsändringen kan behöva jämföras med tidigare korrigeringar och Main:s kund-UI; historiska stackar ska inte massimporteras. Framer- och header-migrationerna kräver exakt native förutsättnings-/kroppskontroll och komponerad migrationsverifiering. Rapporterna om dead code ger ingen rätt att ta bort alla 187 ej nådda kandidater; 33 poster är 24 lokalt borttagna och 9 behållna. Dashboard-writer-kandidaten är separat och dess relevanta typ/lint/build/regression är inte körda.

Komponent- eller isolerade native tester bevisar inte Main-adoption eller ett fullständigt scenario. Kör relevant regression, typkontroll, lint/build och migrationskontroller för den slutliga sammansättningen och lämna ändringarna i avgränsade granskbara PR:er. Denna leverans ger ingen automatisk merge- eller driftsättningsklarhet.

Privata exportpatchen `209dd`, privata rårapporter, credentials och databaser ingår inte. Exportpatchen måste först få normal ägaröverlämning; främmande claim ska inte skrivas över. Patcharna innehåller endast de exporterade Git-diffarna, inklusive redan committade sanerade rapporter.

En offline regexkontroll för vanliga tokenformat, credential-tilldelningar och privata PEM-nycklar gav inga träffar i patcharna. Inga eventuella hemliga värden skrivs ut. Kontrollen är en begränsad heuristik och ersätter inte normal säkerhetsgranskning.

Ursprunglig status är 43 godkända, 1 GAP och 61 återstående. De 46 blandade fyndposterna är inte 46 öppna buggar. Ingen ny scenarioverifiering görs genom att överföra kod.
