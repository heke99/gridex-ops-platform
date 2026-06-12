# Batch M — OPS master, juridik, fullmakt och kundkort

Den här batchen gör OPS till master för kundens juridiska och operativa grunddata innan hemsida, Mina sidor, mail och Ediel-flöden får gå vidare.

## Byggt

- `legal_text_versions` för tenant-specifika juridiska textversioner: allmänna villkor, integritetspolicy, ångerrätt, fullmakt och prisvillkor.
- `customer_legal_acceptances` för immutabla kundgodkännanden med snapshot, källa, application/contract-koppling och metadata.
- Kompletteringar på fullmakt, kundavtal, dokument, kommunikationsloggar och interna noteringar så de kan användas som masterdata i kundkortet.
- Readiness-vyer för kund och tenant-hemsida så systemet kan visa blockeringar i vanliga ord.
- Kundkortets nya juridiksektion visar leverantörsbytes-readiness, anläggningsbegäran, mail-readiness, juridiska godkännanden, dokument och tidslinje.
- Bolagskortet har platform admin-yta för juridiska versioner och hemside-readiness.
- Hemsidans publicerade avtal blockeras om tenant saknar publicerade juridiska versioner.
- Website customer applications kräver separata kundgodkännanden för villkor, integritet, ångerrätt, fullmakt och prisvillkor och sparar kundens godkännanden i OPS.

## Produktionsregler

- Publicerade juridiska texter ska inte ändras bakåt. Skapa ny version i stället.
- Hemsidan ska hämta publicerade avtal från OPS och inte skapa egna priser eller villkor som sanning.
- Kundens godkännanden sparas som snapshot och får inte uppdateras i efterhand.
- Fullmakt måste ha scope och aktiv status innan anläggningsförfrågan eller leverantörsbyte kan gå vidare.
- Kundkortet visar nästa åtgärd och blockerare i vanliga ord, inte tekniska råstatusar.

## Regression

Kör:

```bash
npm run gridex:batch-m-ops-master-regression
```

Kör därefter vanlig typkontroll/build enligt projektets pipeline.
