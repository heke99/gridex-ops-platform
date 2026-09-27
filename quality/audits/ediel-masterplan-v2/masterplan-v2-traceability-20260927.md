# Ediel masterplan v2: kod- och kontraktsavstämning

## Uppföljning efter #415: fält 206-kandidat

#415:s sluthead `eee4a3fe` klarade fyra tillämpliga CI-flöden; OPS native
371/371, ren replay och samma schema-/typhash. Mergen `bd3e131e` är remote
`main` och Vercel-produktion är READY på exakt denna SHA. Det avgränsade
205-huvudfelet har nu lagrad negativ ACK/outbox, noll affärseffekt och stabil
retry i native. Fält 206 (`DTM+ZZZ:1:805`) är nästa källstyrda huvudkriterium:
missing/invalid offset reproducerade BGM34 trots ERC41/42 och har nu lokal
RED/GREEN genom slutlig ACK och konsument. Native och exakt PR-CI för 206
återstår. De berörda rad-ID:n är fortfarande `partial_code`; formell status
är oförändrad. Se [`f3-prodat-header-206-whole-message-20260927.md`](f3-prodat-header-206-whole-message-20260927.md).

## Historisk kandidat efter #414: draft #415

#413 mergades som `2e4eeb65` med ren replay/native 368/368. #414:s exakta
sluthead `32866bc4` klarade fyra tillämpliga CI-flöden, OPS native 369/369,
ren replay samt schema-/typparitet. Den mergades som remote `main` `62ca24a1`;
Vercel-produktion var READY på samma SHA. Dess källstyrda P-17 LIN/314 ger
`BGM+++27`, originalets ACW och ingen otillåten affärseffekt. Inkommande 27
klassas negativt och ACW-matchning kräver en tenantbunden utgående BGM-rad.
Se [`f3-prodat-aperak-message-rejection-20260927.md`](f3-prodat-aperak-message-rejection-20260927.md).

Draft #415 på ny `main` avgränsar nationellt obligatoriskt PRODAT-huvudfält
205. Syntaxgiltigt saknat DTM+137 reproducerade BGM34 och sedan otillåtna
ärende-/affärseffekter; ett ogiltigt levererat datum reproducerade utebliven
slutlig APERAK och fortsatt affärsväg. Lokal korrigering kvalificerar båda via
samma käll- och konsumentkontroll till 27/ERC41 respektive 27/ERC42 med original
ACW, ett negativt lagrat svar, noll affärseffekter och stabil retry. Den publicerade
native-kandidaten `1badf5c2` exponerade äldre syntetiska positiva P-fixturer utan
205 i Ediel/full E2E; de är lokalt rättade med riktigt huvud och egen UNT-räknare.
Detta var kandidatläget före #415:s slutkvitto ovan.
Se [`f3-prodat-header-205-whole-message-20260927.md`](f3-prodat-header-205-whole-message-20260927.md).

JSON-registrets åtta berörda P-17/ACK-rader har nu #414:s faktiska kvitto;
ACK-02/ACK-10 och tillhörande kontrakt hade här #415:s ännu okvalificerade 205-väg.
Alla åtta förblir `partial_code`. Den frysta formella bevisstatusen och den
daterade #413-klassningen nedan ändras inte av en partiell korrigering.

Avstämning 2026-09-27 på `main` `07a93a5eed775b6fd3c02545c9fb7662956503fa` plus draft-PR #413, branch `codex/ediel-v2-f3-prodat-field-composition-20260927`, head `fc823c12658a6fad8cd3e9d1aabd33d4df96d542`. Den fullständiga radvisa klassningen och dess kod- och testvägar finns i [JSON-registret](masterplan-v2-traceability-20260927.json). Det frysta kravregistret ändras inte av denna kodgranskning.

## Mått och gränser

`complete_code` betyder att hela det **avgränsade kortets** villkor och tillåtna/förbjudna effekter har en identifierad produktionsväg och meningsfulla kodprov. `partial_code` betyder att relevant kod finns men att en namngiven delkedja eller verifiering saknas. `no_implementation` betyder att nyckelförmågan saknar hittad verkställande ägare, även om närliggande kod finns. Dessa är granskade kodverdict, inte exekverade frysta acceptans-ID:n, exakta PR-gates eller marknadsgodkännande.

| Nämnare | Helt kodat i detta avgränsade mått | Delvis kodat | Nyckelförmåga utan implementation | Minst någon kod, **inte** färdiggrad |
| --- | ---: | ---: | ---: | ---: |
| 121 regelkort | 3 (2,5 %) | 110 (90,9 %) | 8 (6,6 %) | 113/121 (93,4 %) |
| 231 acceptanskontrakt | 10 (4,3 %) | 203 (87,9 %) | 18 (7,8 %) | 213/231 (92,2 %) |

För regelkort är endast `ENV-04`, `P-01` och `P-04` kodklara på sitt uttryckliga scope. De tio kontrakten med full kod- och testväg är `AT-ENV-04`, `SC-024`–`SC-030`, `SC-032` och `SC-033`. Frysta register har fortfarande 121/121 `Ej verifierad` och 231/231 `Inte körd mot systemet` med tom evidens. Alltså är **0/231 formellt avbockade acceptanskontrakt och 0/8 hela faser godkända**. Att 93,4 % har någon kod är en spårbarhetsandel, inte att 93,4 % av arbetet eller produktionen är klar. Vi sätter ingen viktad totalprocent på delvis byggda krav.

| Regelgrupp | Totalt | Helt kodat | Delvis | Utan nyckelimplementation |
| --- | ---: | ---: | ---: | ---: |
| GOV | 8 | 0 | 7 | 1 |
| TEN | 14 | 0 | 9 | 5 |
| IMP | 5 | 0 | 5 | 0 |
| ENV | 10 | 1 | 9 | 0 |
| P | 17 | 2 | 15 | 0 |
| ESCO | 11 | 0 | 9 | 2 |
| ACK | 10 | 0 | 10 | 0 |
| U | 19 | 0 | 19 | 0 |
| TR | 11 | 0 | 11 | 0 |
| AI | 5 | 0 | 5 | 0 |
| DB | 6 | 0 | 6 | 0 |
| OPS | 5 | 0 | 5 | 0 |

Det som redan fungerar inom sina begränsningar omfattar 110/110 PRODAT D-villkor och 10/10 föräldraförekomster med tidigare avgränsade PR-bevis; vissa källstyrda UTILTS-/PRODAT-fält, fysisk IDE-kopplad negativ disposition, tenantbunden lagring, ACK och retry; samt utgående UNB/0031-beslut. Detta innebär inte att alla 74 fältkombinationer, F3 eller en meddelandeförmåga är godkända. Under denna inventering kördes fem fokuserade PRODAT-filer (196/196) och `scripts/test-ediel-unb-ack-request.cjs` med Node VM modules (64/64). Ett försök utan erforderlig Node-flagga gav enbart `SyntheticModule is not a constructor`; samma test kördes därefter korrekt. Övriga hänvisade testfiler finns, men kördes inte på nytt för inventeringen.

## Var faserna står

| Fas | Kodspår och första öppna godkännandegräns |
| --- | --- |
| F0 miljö/incident | Readiness och transportloggar finns; faktisk runtime↔DB/SMTP-bindning och historiskt Z01-utfall G05 saknar instansbevis. |
| F1 källor/profiler | Källmanifest och avgränsade aktuella/prior profiler finns; full G01-priorjämförelse, G02-produkt/exempel och G07-konflikter återstår per förmåga. |
| F2 tenant/ESCO | Egen tenant/aktor har skydd; TEN-03/08/09/10/14 saknar provider→beneficiary-uppdrag, versionerade grants, distribution och återkallelse. Ingen cross-tenant ESCO-aktivering. |
| F3 parser/fält/ACK | D110/110 och parent 10/10 är avgränsat styrkta. F3C-02/04/05/06/07 är ännu delvisa; fält 203 historisk unikhet, IDE505:s separata historik och positiv LOC+175 har ingen styrkt beständig ägare. Full G06-grammatik saknas. |
| F4 import/rutt/transport | Import, arkiv, SMTP/DSN och certifikatskydd finns delvis; autentisk rutt, giltighet/överlapp och spårbara försöksutfall behöver full säkerhets- och kontraktsverifiering. |
| F5 tillstånd/tider | Vissa switch- och permission-transitioner finns; 42 övergångars fulla käll-/datum-/ordningsprov, ESCO-delat tillstånd, kompensation och samtidighet saknas. |
| F6 mätdata/AI/BI | Transaktionslagring och E035-delar finns; pre-ledger-historik, retention/radering, auktoriserade E66-projektioner, aggregat och fakturasyfte är öppna. |
| F7 release | Mergade avgränsade paket har tidigare exakta CI-bevis, men #413:s rena replay/native/schema- och typparitet stoppades före DB-start av `public.ecr.aws`-kvot. G03 formella prov, live-bindning och kapabilitetsvis aktivering saknas. |

## Aktuell beslutspunkt

PR #414 är mergad på `main` som `62ca24a16298f14a32fe39b78ab93fdf6f05cbe3` och dess Vercel-produktion var READY på samma SHA. PR #415 är draft och får bara mergas efter granskning av hela diffen och alla tillämpliga jobb gröna på exakt sluthead, inklusive native, ren replay och genererad schema-/typparitet. Första #415-head `1badf5c2` har konstaterade fixturfel; dess resultat kvalificerar inte den lokala senare korrigeringen.

Efter en enda merge: kontrollera ny `main` och Vercel; ta nästa sammanhängande F3-krav på ny branch. Historisk täckning och juridisk utgivare för fält 203 och IDE505, samt positiv LOC+175:s objektregister, mandat och egen sink, saknas ännu. E035:s historik/retention och G06:s grammatik är separata öppna krav. Första namngivna marknadskandidat är kontrollerad inkommande E66/DDQ-mottagning och karantän enligt 25-A-4, utan positiv mät-/fakturakonsumtion. Den kräver separat live schema, tenant/aktör, mandat, objekt, rutt, certifikat/transport, formella prov och ett uttryckligt aktiveringsbeslut. Ingen sådan trafik eller sådana prov kördes här. #310 förblir pausad.

Detta är en inventering på angiven trädversion. Efter kodändringar måste berörda rader och testbevis uppdateras; full kod hos ett kort innebär aldrig att hela fasen eller marknadsrollen är godkänd.
