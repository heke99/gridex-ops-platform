# Canonicalt spotpris-, resolver-, quote- och faktureringsflöde

Version: `2026-07-24.1`

## Syfte

Denna implementation etablerar en enda spårbar kedja:

```text
Elpriset just nu
→ providerimport per område och kalenderdygn
→ validerad intervalldata
→ indikativ preview
→ tenantbunden områdesresolution
→ immutable quote
→ canonical kundansökan
→ kundavtalets pricing snapshot
→ leverantörsbytesprocess
→ verifierad och låst settlement
→ faktureringsunderlag
```

## Marknadsdata

`spot_price_intervals` är rå canonical intervalldata. Ett dygn valideras mot svensk kalenderdag i `Europe/Stockholm`, faktisk UTC-duration, luckor, överlapp, dubletter, område, datum och upplösning. Normala kvartdygn har 96 intervall; DST-dygn kan ha 92 eller 100. Statuskedjan är `incomplete → complete → verified → locked`.

`market_price_previews` innehåller endast indikativt underlag. En aktiv preview publiceras atomiskt genom `gridex_publish_market_price_preview`, har källa, period, as-of, stale-gräns, checksum och fallbackmetadata och kan aldrig markeras som settlement.

`spot_price_monthly_summaries.status=locked` är det enda giltiga månatliga settlementunderlaget. Låsning sker explicit genom den behörighetskontrollerade operatörsrutten `POST /api/internal/spot/lock-month`, som anropar service-role-RPC `gridex_lock_spot_price_month` med `price_area`, `billing_month`, valfri `provider` och revisionsorsak. RPC:n tar ett distribuerat transaktionslås och verifierar full täckning innan audit-eventet `market_price.period.locked` skapas. Triggern `gridex_reject_locked_market_price_mutation` gör låsta perioder immutable. En låst historisk period blir inte stale.

## Importjobb

`spot_price_import_jobs` har unik nyckel `provider + price_area + calendar_date`. RPC `gridex_claim_spot_price_import_job` använder advisory transaction lock och återanvänder samma jobb vid retry. Statusar: `queued`, `running`, `retry_wait`, `completed`, `failed`.

Providerklienten har timeout, begränsade retries, exponential backoff, jitter, `Retry-After`, content-type- och payloadvalidering. Dubbla croninstanser kan inte importera samma område/dygn samtidigt.

Previewcron importerar senaste kompletta svenska dygn och återbygger rolling-30-days-preview. Settlementcron importerar/verifierar föregående fakturamånad men låser den inte automatiskt.

## SVK-geometri och atomisk publicering

Varje ArcGIS-sida skrivs först till `energy_geodata_features_staging` under en unik `energy_geodata_versions`-version. Resolverns aktiva polygoner ändras inte förrän full pagination är klar, coverage är `complete` och hela versionen kan promoveras i en enda databastransaktion. Vid promotion versionstämplas alla nya polygoner och features som saknas i den nya SVK-versionen inaktiveras atomiskt. Ett partiellt importfel kan därför aldrig blandas in i aktiv resolverdata.

## Områdesresolver

`customer_site_resolution` är tenantbunden. Resolvern använder adress/geokodning, polygon, nätområdesmasterdata och nätägar-readiness. Klientens nätområdeskod är ett påstående. Adress/kod-konflikt ger `grid_area_address_mismatch`, `needs_review` och `automation_allowed=false`.

Resolutionen sparar `resolver_version`, `geodata_version`, `resolved_at`, `expires_at`, source claims och conflict code. Quote och kundansökan läser resolutionen genom `company_id + resolution_id`; fel tenant, expiry eller blockerad automation stoppas.

## Quote och acceptans

Quote väljer price area från resolutionen. Motstridigt klientfält avvisas. `website_contract_quotes` sparar resolver- och geodataversion, marknadsreferens, immutable snapshot och SHA-256-hash. Databastrigger blockerar mutation av affärsunderlaget. Validering räknar om hash och kontrollerar publicerad version, kundtyp, område, förbrukning, startdatum och resolution.

Kundansökan kräver `quote_reference` och samma `resolution_id`. Canonical onboarding-RPC återanvänder kund och kundnummer atomiskt, skapar site/mätpunkt/avtal och returnerar samma entity-ID:n vid idempotent retry. Mätpunkten patchas med full områdesproveniens när verifierad resolution finns.
Kundmatchning använder i första hand vald canonical kund, tenantens externa kundreferens, person-/organisationsnummer, verifierad portalidentitet, anläggnings-ID eller mätpunkts-ID. Normaliserad e-post är endast en svag granskningssignal; den tidigare unika e-postbegränsningen tas bort så att en delad adress inte tvingar fram felaktig sammanslagning.

## Fakturering

Kundavtalets `contract_price_snapshot_id` och immutable snapshot är historisk sanning. Fakturering använder faktisk förbrukning, rätt mätpunkt, avtalsversion, avgifter, rabatter, moms och en separat låst settlementperiod. Previewkällan väljs endast när `purpose=quote_preview`; standard/billing använder endast `locked` settlement.

## Audit och observability

`canonical_energy_flow_events` binder events till company, customer, site, metering point, resolution, quote, contract och correlation ID. Centrala event är import start/slut/fel, day completed, period verified/locked, area resolved/needs review, quote created/validated, contract created, billing snapshot created och invoice created.

Databas-RPC:er skriver kritiska events i samma transaktion. Applikationsnivåns event använder stabilt event-ID, tre begränsade försök och eskalerar ett kvarstående insertfel till `canonical_energy_remediation_queue` med hela eventraden, så att affärsoperationen inte behöver upprepas och auditluckan kan repareras deterministiskt.

Read-only views visar senaste pris, luckor, överlapp, ofullständiga dygn, verifierade olåsta perioder, stale previews, fastnade jobb, gammal geodata, resolutioner för review, mätpunkter med saknad kontext, quotes utan resolution, avtal utan snapshot och möjliga kunddubletter.

## Driftordning

1. Kör migrationen.
2. Kör `scripts/canonical-energy-flow-readiness.sql`.
3. Kör kontrollerad backfill i staging.
4. Kör readiness igen och granska remediation queue.
5. Importera SE1–SE4 previewdata.
6. Importera/verifiera avslutad månad.
7. Lås settlement explicit efter kvalitetsgodkännande.
8. Kör resolver → quote → validate → application → billing smoke test.
