# Oberoende granskning av SC-011 och SC-023

Granskad PR: #603. HEAD `d05b479a8c960f148fe2da9ac3304c593161e17c`, tree `5bdac72c571844394f4be4117287cd4155edf388`. Lokal Git och GitHub API överensstämmer. GitHub-delta är exakt de fyra ägda filerna; arbetskatalogen var ren. Granskningen ändrar inga repo-, kod-, schema-, coverage- eller approvalfiler och startar inga dubbla testkörningar.

**Beslut: APPROVE SC-011:s hela implementationbeteende på denna frysta version. SC-023 förblir HELD.** Detta är inte native-kvalificering, original marknadsadmission, juridiskt godkännande, slutlig CI eller mergebeslut. Root äger coverage, aktuell bas och leverans.

Originalregistret har acceptans-ID `SC-011` och `SC-023`; det har inte separata `AT-SC-011` eller `AT-SC-023`. De bredare `ESCO-09`/`AT-ESCO-09`, `TEN-10`/`AT-TEN-10` och `ESCO-07`/`AT-ESCO-07` får ingen ny helgodkännandegrund enbart genom detta scenarioomdöme.

## SC-011: hela givna scenariot

Original kontrakt: Market permission återställs men beneficiary-grant har annan giltig återkallelse. Ta emot korrekt Z15C. Återställ market permission; beneficiary-grant förblir spärrat tills ny grund finns. Alla beneficiaries återaktiveras inte automatiskt.

| Effekt | Konkret bevis |
| --- | --- |
| Rätt Z15C-källa och ursprung | Äkta bevarat P-original har SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`, 140 sidor. Fysisk p139 visar DGI, BGM Z15, CCI Z13/CAV Z24, A74 samt samma DTM164, LI och tillstånds-ID som det kancellerade Z15. Fryst annex fält223 stöder Z24→Z15C. Det är inte en påhittad bokstavlig BGM Z15C eller en S17-alias. |
| Marknadstillstånd återställs via verklig producent | `ediel-service-grant-set-sql-regression.mjs:140–181` utför Z13/Z14 → verkligt Z15-slut → verklig Z15/Z24-kancellering genom de installerade produktfunktionerna. Parsern ger Z15/Z24; aktuell källkontroll lyckas, parent blir active och permission_end_at rensas. Ingen direkt UPDATE ersätter marknadsövergångarna. |
| Separat återkallelse har en verklig grund | `:161–166` använder det riktiga revoke_grant-kommandot. Första grant är revoked, version3, med återkallelsedatum; den andra är självständigt active, version2. |
| Felutfall för kvarvarande återkallelse | `:183–190` läser med den återkallade grantens AKTUELLA version3 och avvisas som grant_not_current. En gammal version maskerar alltså inte orsaken. Verkligt publish_grant med current version3 avvisas som revoked_grant_requires_new_basis. |
| Giltig separat rätt återställs utan massaktivering | `:167–191`: den andra grantens quality-läsning stoppas av det verkligt avslutade marknadstillståndet före kancelleringen och återkommer efteråt. Kompletta grant-rader är byteidentiska före/efter marknadsåterställningen och replay; revoked grant återupplivas inte. |
| Egen scope, bytes/hash och replay | `:192–197` kontrollerar ett eget effect receipt med exakt fysisk scope och hash av den faktiska källtexten; replay är idempotent. Provet är medvetet en rollback-transaktion och den slutliga committed-effect-attestern ger därför []. |
| Genuint committad återställning, separat från rollback-provet | `ediel-partial-permission-source-sql-regression.mjs:94–103` ger sju kontroller av DGI/Z15/Z24 genom verklig source apply, och läser efteråt ett faktiskt committat effect med samma scope/hash, aktuell ursprungskälla och rensat avslut. Det komplementet får inte förväxlas med det atomiska rollback-provet ovan. |

Produktens nuvarande apply-group kontrollerar ursprungligt Z15, dess payloadhash, samma ursprungliga Z13, tillstånd, LI, objekt, datum och aktuell sitesnapshot innan återställningsskrivningen. Den riktiga filtrerade beneficiary-läsaren kontrollerar separat grantens version/status/återkallelse, aktuellt marknadstillstånd, egen källa, purpose, objekt, fält och period. Alla åtta berörda funktionskroppar jämfördes oberoende med migrationskällan, faktisk captured schema och ägarens lagrade kroppsdigests: samtliga lika. Ingen ny produktändring eller bekräftad kodblocker hittades i SC-011-scope.

TS-filen bevisar den verkliga caller-gränsens tenant/actor/source/parent-partition och felpropagering med en typad RPC-dependency; den är inte själva grant-racet eller autentisk native. Den nya SC-011-databaskedjan bevisas av de två direkta SQL-proven. Befintliga oförändrade supported CJS-consumers når också dessa scripts: TEN-07 → scoped projection → provenance → service-grant-set; ESCO-04/07 → partial-permission. Tagged green i sig är inte hela scenariobeviset.

## SC-023: exakt kvarvarande begränsning

Original kontrakt: separata V och VH finns på samma objekt; Z15VH ska avsluta historikjobbet och granska täckningen, medan giltigt V och DDQ fortsätter.

Femton tillagda kontroller bevisar verklig S18/VH-källa, stängning av just dess permission/site, egen scope/hash/receipt/replay och helt oförändrad separat V-parent/sites samt daterad supplier-sentinel. S18→Z1xVH har stöd i det frysta annexet. Detta är en giltig komponentförbättring.

Följande hela effekter saknar fortfarande bevis:

1. Faktiskt historikjobb avslutas genom sin riktiga konsument.
2. Täckningen granskas genom sin riktiga konsument.
3. Faktisk behörighetskvalificerad DDQ-leverans fortsätter efter VH-slutet. En oförändrad daterad supplier-sentinel är inte den leveransen.

Narrow read-only seam review: `prodatPermissionLifecycle.ts` anropar `applyPermissionMarketSource`, som anropar durable permission source RPC. Den granskade apply-group-kroppen uppdaterar det berörda permission/site-slutet och sparar dess effekt; den utför inte någon granskad historikjobb-/täckningskonsument. `services/reporting.ts` bygger källkvalificerad Z13-kontext med S17/S18; det är inte en Z15VH-jobbslut-/täckningsadapter. Captured `ediel_service_history_record_v1` är en audittrigger för före/efter-rader, inte historikjobbtäckning. Denna begränsade granskning påstår inte att en sådan seam saknas överallt i produkten. Nästa konkreta bevisfråga ska återgå till den behållna ESCO-07-ägaren; ingen ny workflow uppfinns och ingen redan ägd kod repareras parallellt.

## Verifiering och källbegränsningar

Ny oberoende verifiering här: exakt HEAD/tree/API/fyra filer, P-PDF SHA/140 sidor, bevarad extraction SHA `901992f0524cc7f226198aca39274bfdb3fcea279bc97661f1aa17e0c679bce6` och fysisk p139, frysta literals, åtta migrationskroppar lika captured schema/bodySHA och ren arbetskatalog. Captured schema SHA `df4a353f3f2bb1bfd4eb0f4be99c76ee89a65ffb98bdc345f78c6924e5e65df6` stämmer.

Återanvända och hashkontrollerade ägarkvitton, inte dubbla reviewer-körningar:

- Direkt source83: log SHA `0cdf113722f9b874eab248fddf8aaaad310c20cf3ebbe5a9a0e2b3e65907f132`.
- Atomiskt SC-011-grant/source-prov plus bevarade 23 ACK/21 grant-set/48 administration: log SHA `2f88c00bf2452d34e7c0ceb71efe6ef04dc795bd1e86597d56649388fc75dddf`.
- Scoped TS29: log SHA `9ae39fc8b53fb2a01e54258f92bf194e2857a436e84e4c180386a82e971f21d4`.
- Bevarad ESCO-04/07-wrapper16: log SHA `69259b4a2ded5f040befc1fa53619f91c395af4c25ecc88ae1242ec05f030c0d`.
- Supported tagged gate: 233 approved, 270 green, 0 failing; log SHA `def69299b192a99efe1b6366b00ded550406febcd44545105fbc8f6d675688c5`.
- Current-body comparison receipt SHA `04993d65c55dc93e84dd8edfe580b08ef5e2030cb6f90c06838b2f236ea4fe16`.

App/test types, scoped lint och fryst integrity har gröna ägarkvitton. SQL-proven använder verkliga produktfunktioner i embedded PostgreSQL med uttalade finite canonical/legal/accepted-source/review/storage och actor-dependency-fixtures. Inget autentiskt GoTrue/native, marknadsoriginal, issuer/legal-admission eller live DDQ påstås. Approval/coverage är oförändrat av denna reviewer. Slutlig aktuell CI och main-komposition hanteras av root.
