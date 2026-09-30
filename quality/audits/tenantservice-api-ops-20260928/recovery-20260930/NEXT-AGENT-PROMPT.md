# Ny agent: återta och slutför hela Gridex tenantservice/API/OPS

Du är integrationsansvarig i `heke99/gridex-ops-platform`. Användaren vill att du tar över efter en agent som fastnat och genomför hela återstående uppdraget, inte bara CI-status eller ett nytt litet paket.

## 1. Mandat och prioritet

Läs README.md och verification.json i detta recovery-paket. Läs därefter befintliga `quality/audits/tenantservice-api-ops-20260928/masteruppdrag.md`, `requirements.csv` och relevant nyare evidens. Behåll alla T01–T55 och U01–U20 oförändrade. Detta är en återstarts- och genomförandestyrning, inte en ersättningsplan som stryker funktioner.

AGENTS.md och tillämpliga skills gäller, men starta inte en ny repository-wide inventering eller en kedja av orelaterade skills när motsvarande underlag redan finns. Använd aktuella källor för versionsspecifika beslut. Ändra inte andra agenters Ediel-minne.

Fortsätt tills alla genomförbara P0–P8-delar är implementerade och verifierade eller har en konkret dokumenterad extern blockerare. Ett grönt delpaket är en checkpoint. Du behöver inte ett nytt 'fortsätt' efter varje paket. Kodklart, verifierat och produktionsaktiverat är olika statusar. Ingen merge, produktionsmigration, riktig kommunikation, nyckelrotation eller marknadsaktivering utan separat tillstånd. #310 och #421 lämnas orörda.

## 2. Rädda rätt arbetsläge innan implementation

Senast kontrollerat: OPS #418 `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8`, API #422 `cc90678d45602d37db7f8edf9713597c66fee28a`, main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. OPS har två senare notifieringscommits än basen i API:s tidigare verifiering. Läs direkt remote-ref, inte enbart PR:ens äldre rubrik.

Båda publicerade replay-jobben är gröna: OPS run 36737320079 / clean 109962310742; API run 36716141163 / clean 109889422728. De bevisar inte senare lokalt arbete eller den nya kombinerade kandidaten. Återskapa inte gamla timeout- eller snapshoträttningar utan ny evidens.

Recovery-grenen är dokumentation, inte en ny utvecklingsgren. Behåll #418 `codex/tenantservice-api-ops-20260928` och dess API-fortsättning #422 `codex/tenantservice-api-structure-20260929`. Backup-refsen är fasta återställningspunkter och ska inte flyttas.

Kontrollera lokal HEAD, status, diff, worktrees, lokala grenar/opushat och tillgängliga delagenter. Tidigare integratör hade sex filägare. Samla deras filer/testresultat, stoppa konkurrerande skrivning säkert och utse en ensam publicerare. En kommentar på GitHub är inte bevis på att en agent faktiskt har slutat arbeta.

Den föregående agentens arbetskopia var INTE tillgänglig för denna recovery. Nästaagenten måste därför återfinna och bevara den där den finns. Säkra spårade ändringar, index, ospårade relevanta källfiler och lokal historik utan reset, clean eller force-push. Granska hemligheter innan något publiceras; dumpa inte miljöfiler, token eller råloggar. Bevara inte privat kunddata i ett publikt repo.

Om arbetskopian inte finns: ange exakt vilka uppgivna lokala ändringar som inte återfanns. Kalla dem inte räddade. Upprepa inte samma sökning obegränsat. När konkurrerande skrivning är utesluten fortsätter du från tillgänglig remote och markerar eventuell omskapad implementation som ny, inte återfunnen. Förstör inte den gamla agentmiljön.

## 3. Första konkreta leverans

Jämför först OPS ae56ee0a, API cc90678d och återfunnet senare arbete. Återanvänd redan existerande kunddelegering, atomiska kontaktkommandon och event-v2. Följ notifieringsmigrationen `20260930142815_customer_notification_read_atomic_command.sql` och dess befintliga native-/samtidighetsprov.

Integrera det redan publicerade notifieringsberoendet i API-kandidaten efter ägarskapskontroll och diffgranskning. Bevara båda historierna och migrationsordningen. Skapa inte dubbletter av samma SQL, index, register eller genererade typer. Ingen blind import av OPS-snapshot om API har ytterligare migrationer.

Återfinn eller slutför API-adaptern och verifiera verklig HTTP GET → POST markera läst → samma-key replay → GET → native efterläsning. Bevisa atomisk mutation, korrekt first-read-tid, audit/completion, oförändrade externa referenser och nekad åtkomst för fel kund/tenant/roll. SQL-test ensam ersätter inte HTTP-/kundmandatsbevis.

Samla därefter de redan rapporterade sessions-/RPC-/låsrättningarna, UI- och faktureringsändringarna till ett granskat paket. En säkerhetsrättning får inte tappas för att den inte var pushad; om den saknas reproduceras den på nytt innan den klassas som fixad.

## 4. Stäng rapporterade säkerhetsluckor systematiskt

Inventera relevanta äldre RPC-overloads, wrappers, routes, Server Actions och Data API-grants för den ändrade operationen. Lita inte på klientvald actor_user_id, tenant, verified-flagga eller roll. Kontrollera faktisk session, klient, mandat, resurs och fält.

Använd två verkliga DB-anslutningar för verifiering av väntan på lås och samtidig återkallelse/ägarändring. Definiera när beslutet blir bindande och kontrollera den aktuella auktoriteten före skrivning eller utlämning efter väntan. Idempotensreplay ska inte lämna ut ett tidigare resultat till någon som förlorat åtkomsten. Bevisa noll otillåtna sidoeffekter. Lägg inte in service-role som låtsas vara en lågprivilegierad kund i negativa slutprov.

Patchversionen Next.js 16.3.8 är endast rapporterad i agenttexten. Kontrollera advisory/CVE/GHSA, officiell källa, berört intervall och faktiskt tillgänglig rättad version mot package.json, låsfil och installerad version. Återanvänd en korrekt återfunnen patch, men välj inte version på gissning och nedgradera inte automatiskt till den äldre remote-versionen. Ingen bred audit fix --force. Noll kända dependency-fynd är inte ett bevis för applikationens egen auktorisering.

## 5. Avsluta OpenAPI-genereringen, inte en oändlig finaliseringsloop

En ägare styr kontraktsregister, versioner och generatorer. Bestäm runtime/fält-/felkontrakt för den sammanställda kandidaten först. Kör generation/materialisering i avsedd ordning, granska semantisk diff och kontrollera determinism med samma indata. Därefter ska verifieringskommandon vara skrivskyddade.

Kontrollera instabila klockslag, sortering, scripts som skriver över varandra och manifest som försöker ange sin egen framtida commit. Skilj bytes som ingår i kontraktet från externa byggkvitton. En självrefererande commit får inte skapa ett nytt ändringsvarv för alltid. Bevara historiska immutable-releaser och versionera verkliga kontraktsändringar enligt befintlig policy. Ändra inte version bara för att en byggtid ändras.

Generera typer och schema autentiskt från exakt migrationsuppsättning. Jämför aldrig en kandidats runtime med en annan grens godtyckliga snapshot. Samordna tabellklassificering, unika nycklar, RLS/grants, function search_path, migration manifest och alla relevanta tenantinvarianter före tung replay.

## 6. Genomför HELA återstående funktionaliteten

Fortsätt enligt ursprunglig P0–P8-matris, med praktiska beroenden:

- P0: komplettera befintlig inventering och klassificera riktiga UI-åtgärder, inte en ny full skanning vid varje ändring.
- P1/P2: korrekt aktör/tenant/kund/mandat/roll och en gemensam atomisk ändringsväg för OPS, kundportal och API; revision, audit, idempotens/outbox, säkra gamla vägar.
- P3: en gemensam effektiv faktureringsresolver för readiness, preview och export. Standard/ärvning och avtalsundantag ska vara uttryckliga. Visa vilka avtal som påverkas. Lås profilrevision. Ändra inte utfärdade fakturor eller signerade dokument; omleverans är separat. Hantera partnersynk och sena events utan att skriva tillbaka gammal data.
- P4: tenantens egen support via API, samma ärende i OPS, kundsynliga meddelanden och privata interna anteckningar, säkra bilagor/notiser/webhooks. Telefoninteraktion fortsätter ärendet; verifierad kund utan portalkonto kan få behörig hjälp. Medarbetare agerar under egen identitet, även vid direkt OPS-rättelse utan fabricerat samtal. Skilj kontaktuppgift, inloggning, fakturering och juridisk part. Ny kontaktadress bevisar inte ägande av gammalt konto. Ombud kräver rätt mandat. Plattformssupport är separat och tids-/behörighetsavgränsad.
- P5: enkel UI i HELA OPS: kundkort, listor, support, avtal, anläggningar, fakturering, importer/exporter, arbetsköer, användare/roller och inställningar. Få knappar, gemensamma komponenter, inga onödiga dubletter eller trasiga länkar. Samma ändringspanel används överallt. Bevara nödvändiga arbetsfunktioner. En primär och normalt högst två sekundära huvudhandlingar; inte en knapp per tabell. Verifiera varje verklig åtgärds handler, serverrättighet, databasresultat, återläsning, fel/pending/dubbelklick, navigation, mobil, tangentbord och zoom. Klassificera gemensamma handlingar så att testtäckning inte blir tusentals identiska manuella klick. Kontextspecifik rättighet får inte hoppas över.
- P6: API-register, OpenAPI, guider, klienttyper och körbar syntetisk tenantreferens ska stämma med runtime, inklusive operationstatus och fel.
- P7: säkerhet och uppmätt effektivitet genom hela kedjan. RLS/grants/RPC/Storage, MFA/återställning/återkallelse, XSS/CSRF/injektion, SSRF, privata skannade bilagor, signerade webhooks, kvoter, tenantbunden cache/realtime, säker audit och hemligheter. Befintlig ASVS-matris är mål, inte certifiering. Mät före optimering.
- P8: additiv migration, säker backfill, tvetydiga historiska undantag till granskningslista, clean+upgrade-prov, återställning och införandeberedskap. Produktionsaktivering ingår inte i mandatet.

En extern issuer, partner eller scanner som saknas får en exakt blockerare. Implementera säkert avvisande beteende och ärligt märkta isolerade tester; fejka inte verifiering. Fortsätt med oberoende koddelar, inte ett nytt stopp för hela projektet.

## 7. Effektivt utförande och testning

Använd riktade regressioner/typecheck/lint under utveckling. Samla kod, schema, UI och kontrakt per sammanhängande affärsflöde innan logisk push. Behåll ordinarie CI-grindar och inga skip-undantag.

Frys paketets indata, granska hela diffen och kör därefter faktisk DB/HTTP/browser/native/paritet på kandidaten. Notera head, bas och faktiskt checkat Git-träd. Två separata gröna PR:er är inte godkännande av en ny kombinerad runtime.

Återkör inte grön oförändrad kandidat utan ny orsak. GitHub-rerun behåller ursprungligt SHA/ref och verifierar inte ny lokal kod. Vid fel: läs första faktiska felet, skilj setup/migration/RPC/browser/post-browser/schema. Mät tidsgränser och lås, höj inte timeout på gissning. En motiverad begränsad retry av ett bevisat tillfälligt installationsfel är möjlig; upprepa inte samma misslyckande utan ny diagnos.

Återanvänd inte en muterad fixture som om ett nytt försök började från samma tillstånd. Säkerställ kontrollerad reset eller separat fixture. Under CI kan oberoende underlag granskas; undvik tät polling och nya orelaterade ändringar i den frysta kandidaten.

## 8. Bevis, checkpoints och faktisk fortsättning

Uppdatera samma matris och en aktuell sammanfattning. Gamla röda körningar är historik när nyare prov är gröna; samtidigt får gamla gröna resultat inte täcka ny kod. Dela breda T/U-krav i spårbara underfall utan att ändra originalkravet. Skriv inte att allt är klart från ett totalt testantal.

Efter varje sammanhängande paket: granska, testa, committa, pusha, uppdatera PR och fortsätt nästa genomförbara paket. Skapa inte en ny lång statusfil för varje småändring. Första avstämningen ska ange återfunnet/opublicerat arbete, ensam publicerare och nästa konkreta implementation, inte bara 'granskar finalisering'.

Slutresan ska fungera: tenantens webbärende → telefonsamtal → verifierad behörig OPS-ändring → samma ärende och kundsynligt svar → korrekt Mina sidor → korrekt nästa fakturaunderlag. Annan kund/tenant och otillåten roll nekas genom hela kedjan; historiska dokument bevaras.

Om sessionen måste avslutas tidigare: säkra alla relevanta ändringar utan hemligheter, redovisa exakt testad/publicerad head, saknat arbete och nästa fil/kommando. Lova inte bakgrundsarbete och kalla inte en ofullständig masterplan klar. Fortsätt inte skriva samtidigt som en ny integratör tar över.
