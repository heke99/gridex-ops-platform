# SC-044 — intern acceptans 2026-09-30

**PASSED** på `d30fa0203f0499a8e15faeddda7676af81296c86`, draft PR #421; base/main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. Beslutet gäller det frysta SC-044-kontraktet. U-03, ACK-08 och deras bredare AT-kontrakt har egna kvarvarande grindar. Ingen merge eller marknadsaktivering följer av detta beslut.

## Krav och oberoende facit

Originalet är `docs/ediel/masterplan-v2/registers/acceptance_tests.json`, SC-044, och bilaga D §SC-044. Korrekt huvud; IDE1 korrekt; IDE2 anvisningsfel; IDE3 godkänd i anvisningskontrollen men funktionsfel. IDE1 ska lagras och få positiv APERAK, IDE2 negativ APERAK, IDE3 tillämplig UTILTS-ERR. En global felklass får inte skriva över IDE2:s anvisningsfel.

Fryst U-original SHA256 `0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be`, pp101–103/106–107/123/132: kontrollordning och lagring före positivt svar, separata svarsutfall, punktidentifierarens agency och E87 vid fel observationsantal. UE SHA256 `a2f2018077b253bb012ef0255c6dc98dcfffeb65b9e707af5ca131838990a92a` stödjer samma kontrollordning. Filnamnets 25-A-4 och U-originalets footer 25-A-5 är fortsatt dokumenterad källdiskrepans; ingen tyst ändring av originalet.

## Exekverad kriteriematris

Det exakta tre-IDE-provet finns i `scripts/ediel-utilts-err-gateway-native.test.ts`: “SC-044 exact three-IDE consumer stores only accepted data and finalizes independent positive, guide-negative and functional responses on stable retry”.

| Kontraktskriterium | Faktiskt verifierat |
| --- | --- |
| Korrekt huvud och staged kontroll | Syntax godkänd, inga huvudfel, tre egna dispositioner. |
| IDE1 lagras | Exakt en egen actual-serie, QTY136=500, fysisk punkt, källbundet kontrakt och verifierad immutabel raw-hash. |
| IDE1 positiv APERAK | BGM312/ERC100; endast IDE1:s fysiska ACW, egen canonical policy/source-operation och final reservation. |
| IDE2 negativ APERAK | Egen BGM313/ERC42/fält209, endast IDE2:s ACW; ingen serie eller accepterat kontrakt. |
| IDE3 tillämplig UTILTS-ERR | Egen E87, `functional_rejection`, endast IDE3:s TN; ingen serie eller accepterat kontrakt. |
| Förbjuden global överskrivning uteblir | Tre olika svar och rätt finalisering; IDE2 behåller guidefelet trots IDE3:s E87. |
| Retry och käll-/tenantbindning | En receipt med rätt company/source/environment/code/raw-hash; samtliga lagringsrader, reservationer och ACK-id/bytes/tidsstämplar oförändrade efter retry. |

CALL-09 fysisk parser → CALL-11 `resolveCanonicalMessagePolicy`/`runUtiltsRuntimeForMessage` → verklig `processInboundUtiltsMessage` → CALL-13 `prepareUtiltsConsumptionContracts`/service-RPC och privat SQL-lagring → CALL-12 verklig canonical ACK-gateway, writer och finalizer. Sourcecapture-triggern väljer familj/datum; testet fyller inte regelbevis manuellt. Verkliga tenant-, legal-actor-, route- och source-policy-kontroller körs. Inga transportworkers anropas. Endast efterföljande meter/billing/completion-sinks observeras med mocks. Deras befintliga mixed-functional-hold är inte ett kriterium i SC-044 och används inte som bevis för full U-14 eller fakturering.

## Versionslåst slutkvitto

| Obligatoriskt arbetsflöde | Run | Resultat |
| --- | --- | --- |
| Ediel | 36695341379 | SUCCESS |
| Browser/quality | 36695341358 | SUCCESS |
| Full E2E | 36695341472 | SUCCESS |
| Tenant integrity | 36695341489 | SUCCESS |
| OPS | 36695341457 | SUCCESS |

OPS verify `109821852569`, quality-release-gates `109821852531` och clean-migration-replay `109821852700`: SUCCESS. Fullständig replay-logg: SC-044 PASS, **439/439 native**, case-native/browser, tenant-invarianter, paritet, genererade typer och schema PASS.

Authentisk replay-artefakt **11087503506**, från exakt head och OPS-run ovan. ZIP SHA256 `4dc9bd72b854a57e2d2c2d80d206a01d0c1184767f4b7bd80fe3fe5bb93a75d6`; replay-logg SHA256 `9008136f559a4beb2ffc9954fc59f928b547273cf39144143c31bb407e508c64`; genererade typer SHA256 `36e989375ef5313e506a04f7d6e79b4058316ed0f39eb7d9530658fa1cbbed6d`; schema.sql SHA256 `9b47beb9944ee2fa0909cec1caa6cd8629877f8b1ce39c32fa162ae2641000c6`; schemafingerprint `8f922c97a546bec643e201d4c295705285b10f6d34c89f78e6d08a4cd68d9d93`.

Oberoende käll-/facit-/callgraph-/orakelgranskning `/root/acceptance_ack08`: **PASSED, high confidence**, efter inspektion av exekverad artefakt. Oberoende differentialgranskning `/root/review_err_policy_facade`: APPROVE, inga introducerade Critical/Important/Minor. Root registrerar beslutet i den separata implementation-ledgern; det frysta originalets historiska importstatus ändras inte.

Kvitto återanvänds så länge dessa beroenden är oförändrade. Ändrad relevant parser/policy/konsument/SQL/ACK kräver påverkningsbedömning och ny tillämplig verifiering. Full masterplan, extern retention/historik, positiv LOC175, full E035 och produktionsgodkännande är fortsatt separata öppna grindar. #310 orörd; ingen staging/TGT/AGT/motpartsprov/verklig sändning.
