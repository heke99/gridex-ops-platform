# Produktions- och exportslutförande

Datum: 2026-07-16

## Fastställda affärsregler

- Månadspris, timpris och kvartspris är separata avtalsmodeller. Ett avtal byter inte upplösning mitt i en månad. Byte sker med ny låst version från nästa månadsgräns.
- Portföljpris är ett månadspris. Mix = månadens spotmedel × spotandel + månadens portföljpris × portföljandel.
- Fastpris är ett gemensamt pris per kWh för alla prisområden där avtalet säljs.

## Produktion och negativa mätvärden

- `production`: separat positiv energimängd med negativ ekonomisk ersättningsrad och `credit_invoice` eller `self_billing`. Ersättning och moms hämtas från exakt låst prissnapshot.
- `consumption_correction`: separat positiv korrigeringsmängd med kredit av endast energiberoende komponenter. Månads-, start-, administrations- och fakturaavgifter krediteras inte automatiskt.
- Konsumtion, produktion och korrigering kan inte blandas i samma underlag eller prisrun.

## Export

- `billing_export_readiness_v` är enda exportreadiness.
- Tim-/kvartspris kräver komplett låst intervallevidens.
- Partnerkö, retry och partnerkvittens är atomiska och idempotenta.
- Samma partner-outboxrad återanvänds vid retry.

## Databasdrift

Kör migrationerna i ordning:

1. `20260716010000_contract_billing_end_to_end_completion.sql`
2. `20260716090000_production_settlement_export_completion.sql`

Den andra migrationen:

- rättar pgcrypto-`search_path`,
- lägger till produktions-/kreditflöden,
- slutför canonical exportreadiness och atomisk partnerexport,
- raderar den verifierade orphan-prisboken endast om den fortfarande är referensfri,
- utökar integritetsrapporten.
