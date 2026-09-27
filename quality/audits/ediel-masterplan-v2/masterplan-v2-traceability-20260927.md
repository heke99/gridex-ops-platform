# Ediel masterplan v2: kod- och kontraktsavstämning

## Uppföljning efter #413: draft #414

PR #413 mergades som `2e4eeb65af719bcb370d619727d300618a97cb1e` efter
grön ren replay, native 368/368 och schema-/typparitet. Nedanstående ursprungliga
inventering är dess daterade bas, inte nuvarande PR-status. Ny branch från denna
`main`: `codex/ediel-v2-f3-aperak-whole-message-20260927`, draft #414. Första
kodhead `22d284dd` rättar källstyrkt P-17 LIN/314 så slutlig P-APERAK bär
`BGM+++27`, originalets ACW och inget otillåtet fallutfall. Bearbetat meddelande
med lokalt fältfel behåller `34`. RED före rättning, riktade 25/25 och app-/test-
typkontroll är verifierade. Native-provet för beständig ACK/outbox/retry finns i
nästa delsteg men väntar på exakt-head CI. Se
[`f3-prodat-aperak-message-rejection-20260927.md`](f3-prodat-aperak-message-rejection-20260927.md).

JSON-registrets åtta berörda rader (`P-17`, `ACK-02`, `ACK-10`, `SC-034`,
`SC-042`, `AT-P-17`, `AT-ACK-02`, `AT-ACK-10`) har nya kod-/testvägar och
preciserade luckor. De förblir `partial_code`; totalsiffror och frysta formella
bevisstatusar är oförändrade tills en full radkvalifikation kan styrkas.

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

## Nästa beslut och åtgärd

PR #413 är fortfarande draft och **får inte mergas** på nuvarande head: ordinarie Ediel/browser/E2E och OPS verify/quality är gröna, men ren OPS replay och native nådde aldrig databasen när Supabase-images gav `toomanyrequests: Data limit exceeded` på `public.ecr.aws`. Ett diagnostiserat samma-head-jobbomförsök gav samma fel. Undersök en källstyrd bildkälla/cache för just workflow-steget; ändra bara en granskad CI-konfiguration om den verkligen kringgår kvoten. På ny exakt head: kör samtliga obligatoriska gates inklusive ren migrationsreplay, native och genererad schema-/typparitet, granska hela diffen och merga det sammanhängande paketet en gång. Utan sådan verifiering består blockeraren och #413 ligger kvar som draft.

Därefter från faktiskt ny `main`: bevisa separat juridisk utgivare och historisk täckning/retention för 203 och IDE505 innan atomär unikhetsreservation konstrueras; etablera verkligt objektregister, mandat och sink innan positiv LOC+175. Fortsätt parallellt genomförbar källstyrd F3/E035-grammatik och per-kapabilitetskrav utan att gissa dubblettregler. Första namngivna marknadskandidat är kontrollerad inkommande E66 DDQ-mottagning/karantän enligt 25-A-4 från 2026-10-01, utan positiv mät-/fakturakonsumtion. Den kräver separat live aktör/tenant/rutt/certifikat/transportbindning, tillämplig G03 TGT/AGT och motparts-/stagingbevis och ett uttryckligt aktiveringsbeslut. Ingen sådan trafik eller sådana prov kördes här. #310 förblir pausad.

Detta är en inventering på angiven trädversion. Efter kodändringar måste berörda rader och testbevis uppdateras; full kod hos ett kort innebär aldrig att hela fasen eller marknadsrollen är godkänd.
