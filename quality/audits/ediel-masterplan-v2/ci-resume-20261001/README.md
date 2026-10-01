# Fortsättning efter genomförd publicering

Publiceringen i användarens citat lyckades. `47f4ed18` och den lokalt kontrollerade källan `c02deec2` har samma tree `2fa50c61`. Kvittot anger 67 filer, vanlig fast-forward och endast egen draft #424. Senare publicerat head är `c8f666d9`, tree `667be5ad`.

GitHub visar #424 som `mergeable:false`, `mergeable_state:dirty`, med **noll Actions-körningar** på `c8f666d9`. Jämförelsen mot #421 `3c7342c6` är +16/-143 commits, med mergebase `8052ebff`. Relevant `pull_request`-konfiguration utesluter inte basgrenen. [GitHub dokumenterar att vanliga PR-workflows inte körs när PR:en har mergekonflikter](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows).

Isolerad `git merge-tree --write-tree --name-only` reproducerar **114 konfliktfiler** mellan de publicerade heads. Preview mot den senare lokala kandidaten `536cdc16`, tree `b4e7386c`, ger **116**. Dessa konfliktträd innehåller konfliktmarkörer och får aldrig publiceras som kod.

Den befintliga integratorn och flera ägare fortsatte commita under kontrollen. Deras arbetskopior, index, refs och databas lämnades orörda. WIP-hashar i `observed-state.json` är observationer, inte en backup eller frysning.

## Den första historiksammanfogningen är verifierad

Publicerad `c8f666d9` är inte Git-förfader till lokal `536cdc16`. Däremot sammanfogas dessa heads **utan konflikt**, till exakt det befintliga lokala trädet `b4e7386c65c6b8d22d135e33770d56dfe52761be`.

En isolerad, lokal tvåförälders bridge `bba3163741c513a94938c63ffe88cf6089be78d1` bevarar båda historikerna. Båda ancestry-kontrollerna ger exit 0 och antalet ändrade källfiler mot `536cdc16` är noll. Den är en förberedelse, inte en release. På en senare kandidat ska samma sammanfogning räknas om; använd inte denna commit för att ersätta senare arbete.

## Konflikterna kräver faktisk komposition

230 av 369 gemensamt ändrade filer har redan identiska slutliga blobbar. De 143 inkommande commitsen motsvarar därför inte 143 saknade paket. Samtidigt finns verkligt olika funktioner på båda sidor.

| Gränssnitt | Beteenden att bevara tillsammans |
| --- | --- |
| `core/kernel.ts` | Skyddad ACK-replay och requested-change-basis samt faktiska kundhändelser och färsk registry-dispatchkontroll. |
| `transport/index.part-2.ts` | Requested-change-källa, kompletta kontrollargument och transportundantag samt inkommande transportfunktioner. |
| `receivedProdatFinalResponsePlan.ts` | Verkliga supply-/permission-effekter med effect-receipt och facts-hash samt strukturell och kundversionskontroll. |
| `receivedSourceValidationLedger.ts` | Komplett V6-bindning av object/application/response/source-function får inte backas till V4/V5. |
| `aiListHistory.ts` | Kvalificerad kundfacet och exakt punkt-/periodbundna deltaepoker samt juridisk/teknisk partisammansättning. |
| `services/permissionOrigin.ts` | Terminal återställningskälla och prepare/send-faser samt captured request timing och faktisk behörighetskatalog. |

De publicerade konfliktfilerna fördelas på 41 lib, 2 app, 35 tester, 20 scripts, 9 auditfiler och 7 minnesfiler. Migrationernas filinnehåll har inga konflikter; deras samlade ordning och RPC-/wrapperkontrakt måste ändå kvalificeras med verklig clean- och uppgraderingsreplay.

## Bevisnivå och nästa handling

Detta paket innehåller Git-/GitHub-kontroller och läsande källjämförelse. Inga runtime-, UI-, SQL- eller workflowfiler har ändrats. Inga nya native- eller browserprov har körts. Äldre autentiska `0373d6d`-artefakter behåller sin ursprungliga omfattning. Masterplanens acceptansstatus är oförändrad.

Nästa handling är att den befintliga integrationsägaren bevarar aktuella ägarpaket, sammanfogar publicerad och lokal historik och sedan komponerar en riktig merge med fryst #421 genom ensamägare. Först därefter: riktade regressioner, exakt tree-publicering som bevarar föräldrar, ny autentisk replay och aktuellt exakt-head CI.

Använd [NEXTCHAT.md](NEXTCHAT.md). `conflicts.json` innehåller varje konfliktfil och dess blob-SHA i de fyra observerade versionerna. Previewloggarna och `observed-state.json` gör kontrollen reproducerbar.
