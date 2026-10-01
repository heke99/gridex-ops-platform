# Separat API-spår: mätvärdesläsning, kandidat 2026-09-29.7

Detta är ett avgränsat API-checkpoint på #422 ovanpå #418. Före arbetet var
remote head för #422 `99c7327430d5f6adefeded8bf2973b306154f112` och för
#418 `750510b81bb4ff98e20723ae3f97a0e1bbb6d34f`; lokal HEAD motsvarade
#422, status och diff var rena. Remote kontrolleras igen före push. Slutlig
publicerad SHA och automatiska exact-head CI-resultat redovisas i #422. Ingen
SQL-migration, masterplanfil, OPS/UI-ändring eller kanonisk kravmatris skrivs här.

## Vald faktisk gräns

Inventering av externa kundroutes och route-registret visade ännu inget
sammanhängande kund-API för supportärende, meddelande och bilaga. Den existerande
`GET /api/v1/customer/metering-values` har däremot faktisk runtime. Den kräver
maskinnyckelscope `customer_metering.read` och en separat signerad assertion
för exakt GET-path. Read-only-frågan mot `normalized_metering_values` binder
`company_id` och `customer_id`, sorterar `period_start`/ID och hämtar
`limit + 1`. AES-GCM-kursorn binder organisation, kund och filtrerad resurs.
`publicPortalMeteringValue` projicerar bara publika värden och opaka referenser.

Föregående OpenAPI beskrev ett generiskt svar utan dessa queryparametrar,
sidmetadata eller konkret mätvärdes-DTO. En ogiltig `from`/`to` skickades före
ändringen till databasen; en angiven `facility_id` utan siffror tappade filtret
och blev en bredare kundfråga. Riktade route- och kontraktstester visade först
**RED** för dessa fall. API:t returnerar nu 400 `invalid_time_filter` respektive
400 `invalid_facility_id` innan databasfrågan. ISO-datum utan klockslag
normaliseras till midnatt UTC; fulla tidsstämplar behåller sin offset.

`__tests__/customer-api-metering-routes.test.ts` kör den faktiska GET-funktionen
mot syntetiska service-rader och prövar scope, nekad delegation, tenant- och
kundfilter, facility/datum, `limit + 1`, nästa sida, annan kund/tenant/filter,
trasig cursor, publik allowlist och negativa indata. Den fångade även datum
utan tidsdel som separat RED före UTC-rättningen. Kontraktstestet
`__tests__/customer-api-metering-parity.test.ts` jämför route/scope/parametrar,
`data`/`page` och de nio publika DTO-fälten med faktiskt projekterat objekt,
inklusive nullable `quantity_kwh`. Den lokala syntetiska HTTP-klienten signerar
med temporär in-memory RSA-utfärdare, följer två filtrerade mätvärdessidor och
kontrollerar 400 för en ogiltig cursor. Den når ingen produktionsmiljö.

Paret `2026-09-29.7` materialiseras med den gemensamma releaseprocessen.
29.6:s versionslåsta filer förblir byteoförändrade: customer SHA-256
`9a9bcb31e3a7b9312562d7edd98489da8b934a3a13fc68c0f6eb8765adfda5c4`,
website `8f5c8c880fbf0ef8a67abfad8e1a110944047cb703acb20bf4100be456bebc23`.
29.7: customer `746f80bc11ad83bbef926545af46896067efb5b5d666384ee94d911d62a8a720`,
website `282fc7587bd91e54298b659b8c74e0267cca0600c0eff45b58deef645e3e6061`.
Generator och materialiserare gav samma bytes vid omkörning. Lokal
releaseverifiering läser filer, inte distribuerade bytes.

## Verifiering och öppna beroenden

Nio riktade Vitest-filer/31 fall, app-/test-/script-typecheck, scoped lint,
`api:docs`, `api:compatibility`, `api:release:verify` och
`api:runtime:parity` passerade lokalt på kandidatträdet. Den syntetiska
HTTP-klienten passerade med `meteringPages=2` och
`foreignMeteringCursor=400`. Första lokala Next-build kompilerade men dess
separata TypeScript-arbetare nådde standardgränsen kring 2 GB. Samma bygge
passerade med `NODE_OPTIONS=--max-old-space-size=4096`, inklusive TypeScript,
sidgenerering och de nya versionslåsta routes. Tillagda fixtures har syntetiska
ID:n, tidpunkter och värden; inga verkliga kunddata eller hemligheter tillförs.

Detta ger endast **PARTIAL** käll-/kontrakt-/klientevidens för T48/P6. Den
syntetiska frågebyggaren är inte ett native SQL-prov med två kunder eller ett
driftsatt kundflöde. P4:s externa ärende/meddelande/bilaga, T26 och T53
kvalificeras inte. T01–T55 och U01–U20 behåller sina tidigare betydelser och
masterplanens acceptansbeslut. `portal_customer_events_page_v1` levererar inte
lagrad `domain_events.event_version`; 29.6/29.7 returnerar fortsatt null när
version saknas i projektionen. Byte till masterplanagentens service-role-
begränsade v2 väntar på migration och native prov med version >1, båda källor,
två kunder, lika tidsstämplar och cursor-replay. Ingen faktisk lagrad version
påstås från v1.
