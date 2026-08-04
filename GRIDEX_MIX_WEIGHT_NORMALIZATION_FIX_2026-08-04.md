# Gridex OPS — mixvikter och quote-kalkyl, 2026-08-04

## Felbild

Website quote svarade:

`quote_calculation_failed: Mixpris måste summera till 100 %. Nuvarande summa är 400 %.`

Det publicerade avtalet var korrekt konfigurerat som 50 % spot och 50 % portfölj. Den äldre snapshotskaparen lade däremot in båda baskomponenterna en gång per publicerat elområde. För SE1-SE4 blev snapshoten därför:

- SE1: 50 + 50
- SE2: 50 + 50
- SE3: 50 + 50
- SE4: 50 + 50

Total rå snapshotsumma: 400 %.

## Korrigering

1. `lib/pricing/contractPricingVersioning.ts`
   - spot- och portföljandel skapas nu en gång globalt
   - endast fastprisbenet skapas per elområde, eftersom priset kan skilja mellan SE1-SE4

2. `lib/pricing/priceSourceResolver.ts`
   - väljer först baskomponenter för kundens lösta elområde
   - deduplicerar identiska legacy-komponenter om en äldre serializer har tappat områdesmarkören
   - distinkta vikter, fasta priser och giltighetsperioder bevaras

3. Regressionstester
   - verifierar att 50/50 över SE1-SE4 skapar två globala komponenter och summerar till 100
   - verifierar områdesurval för legacy-snapshot
   - verifierar deduplicering när legacy-snapshot saknar områdesmarkör

## Kalkylregel

För ett 50/50-avtal beräknas energi-prisbasen:

`0,50 × spotpris + 0,50 × portföljpris`

Därefter läggs avtalets tillämpliga komponenter på, exempelvis påslag per kWh, månadsavgift, fakturaavgift och elcertifikat. Moms läggs på sist enligt snapshotens momssats.

## Databas

Ingen migration krävs. Korrigeringen är runtime- och snapshotskapande kod.

## Verifiering i leveransmiljön

- TypeScript/Node syntaxkontroll: godkänd för samtliga ändrade filer
- TypeScript transpile-kontroll: godkänd
- isolerad körning av `normalizeContractPricing` med 50/50 och SE1-SE4: två komponenter, totalsumma 100
- full `npm ci` kunde inte köras i artifactmiljön eftersom intern npm-proxy saknade `zod-validation-error@4.0.2`; kör projektets fulla test/build lokalt
