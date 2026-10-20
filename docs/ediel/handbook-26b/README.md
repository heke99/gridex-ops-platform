# Handbok 26B: separata rapporterings- och ändringsfrister

Tillägg `ediel-handbook-26b-obligations/2026-10-20.v1`, kopplat till [#847](https://github.com/heke99/gridex-ops-platform/issues/847). De frysta v2-registren och deras 352 godkännanden avser sin ursprungliga kravbas. Detta tillägg ersätter inga historiska register, tekniska meddelandeeditioner eller genererade databasprojektioner.

Den aktuella Elmarknadshandboken är **26B, 2026-10-01**. Dess avsnitt 4.1.14 beskriver en fysisk ändringsfrist från mottagen begäran, med en särskild gren för senare angivet datum. Z06F-tabellen i samma utgåva anger fortfarande giltighetsdatum +40. Källorna beskriver olika effekter och får inte sammanföras till en enda klocka. Den befintliga `TM-METHOD40`-meddelandebevakningen behålls med sin kvalificerade tidsgrund.

`reportingObligationPolicy.ts` skiljer på:

- leverantörsunderrättelse enligt EIFS 2025:1, 11 kap. 11 §: fullständigt mottagande +40 kalenderdagar, med kvarvarande omedelbarhetskrav;
- fysisk ändring enligt handbok 4.1.14: det senare av mottagande +40 och angiven senare startdag, med kvarvarande omedelbarhetskrav;
- rapporteringsstart enligt EIFS 12 kap. 8 §: en kalenderveckas datumsteg från kundens godkännande, respektive senare bekräftad start utan ytterligare vecka. Den vanliga veckogrenen ger ett konservativt internt bevakningsdatum; exakt klockslag, helgförlängning och avräkningsmetodundantagets ankare fastställs inte av detta tillägg.

Ingångsvärden till dessa rena beräkningar är redan kvalificerade semantiska fakta, inte behörigheter eller nya produktionsbevis. Den befintliga serverägda bevakningsprojektionen innehåller inte styrkt fullständigt DSO-mottagande, kundgodkännande eller underlag för metodgrenen. Operationsvyn visar därför **Kan inte fastställas**, separat från meddelandets ursprungliga bevakningsdatum. SMTP-acceptans, lokalt tillämpad Z14, historisk period och godtyckliga metadatafält fyller inte dessa luckor. Ett Z14 eller APERAK bevisar inte faktisk rapporteringsstart eller första UTILTS-leverans.

[Kriterier](requirements.json) binder den avgränsade kod-/visningsändringen till positiva och negativa tester. [Källavstämningen](source-reconciliation.json) anger tillämpliga original, den kvarvarande källskillnaden och det som ännu inte har kvalificerats. Ingen regel i det frysta paketet får nya godkännanden från detta tillägg.

Återstår i #847: exakt kapitelvis 26A–26B-jämförelse utöver ändringssammanställningen, separat kvalificerad modell för avräkningsmetodundantaget samt eventuell beständig per-anläggningsbevakning med verkliga godkännande-/mottagnings- och rapporteringskvitton. Den här leveransen gör inga påståenden om dessa effekter, rättslig överträdelse, marknadsaktivering eller produktionsacceptans.
