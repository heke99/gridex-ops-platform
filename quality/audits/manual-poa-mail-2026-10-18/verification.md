# Fullmaktsmejl, verifikat och dokumentarkiv

Datum: 2026-10-18. Ursprunglig arbetsgren: `work`, bas `dbbfee16`. Användaren har därefter uttryckligen godkänt produktionsdriftsättning. Releasegren `codex/manual-poa-mail-production-20261018` bygger på senaste produktions-/main-bas `3034e14d`, med senare Ediel- och staff-rättningar bevarade. Detta är ett avgränsat användaruppdrag för manuella fullmaktsmejl/API/admin; inga Ediel-masterplanregler eller LIVE-bevis tilldelas av detta underlag.

## Levererat

- Stabilt systemverifikatsnummer, signer-IP skild från API-anropar-IP, sparad accepterad juridik och exakta scopes. Formulärgodkännande påstås inte vara BankID. Systemverifikatet kan inte ensamt skapa juridiskt godkännande.
- Privat, innehållsadresserat PDF-arkiv för API-godkännanden och byteidentiska uppladdade original, inklusive äldre partneroriginal inom verifierad tenant. Tidigare versioner bevaras. Konkurrerande bevisändringar och fel tenant/kund/dokument stoppas.
- Fullmakter-flik med tenant-/kund-/verifikatsökning, autentiserad PDF-åtkomst och behörig rättelse med anteckning. Skrivkontroll görs mot måltenantens operativa status. Samtidigt inkommet nytt svar kan inte raderas av en äldre granskning.
- Ämnen och mejl identifierar ärende, ombud, organisationsnummer och verifikat. Nät- och handelsuppgifter hålls separata, även i påminnelse/eskalering.
- Nekanden/kompletteringskrav sparas som granskningsbehov och blockerar utskick. Citerad historik får inte tillämpas som nytt svar. Mottagna kommersiella svar sparas för granskning och stoppar påminnelser; de godkänner inte leveransstart.
- Aktiva OpenAPI-beskrivningar, utvecklarguidens exempel och integrationsguider uppdaterade utan nya obligatoriska requestfält eller ändrad wire-version. Historiska utgåvor orörda. Driftanvisningar i `docs/manual-poa-mail-runbook.md`.
- Begränsad AI-läsare för trovärdigt matchade nya manuella svar, separat diagnostikförslag med källstycken, atomisk reservation per inkommande rad och plattformsadmin-test med syntetisk text. Ingen affärslogik använder AI-resultatet. Avstängd tills serverflaggan aktiveras. Nyckeln har verifierats enbart via Vercel-metadata som Secret/Production i rätt projekt; värdet har inte hämtats.

## Utförd verifiering

Alla kommandon nedan kördes med Node **22.23.3**, installerad i tillfällig npm-cache, enligt projektets Node 22-krav.

| Kontroll | Resultat |
| --- | --- |
| Vitest, 23 berörda sviter efter AI-tillägget | **274/274 passerade** |
| `tsc --noEmit -p tsconfig.app.json` | Passerade |
| `tsc --noEmit -p tsconfig.tests.json` | Passerade |
| `npm run api:docs` | Samtliga delkontroller passerade: kontrakt, runtime/OpenAPI, versioner, exempel, ansvarsfördelning och kontrakträttningar |
| ESLint, ändrade/nya TS/TSX-filer | 0 fel; 7 unused-var-varningar i befintliga import-/testdeklarationer. Sista ändringarnas riktade lint passerade utan anmärkning. |
| `npm run tenant:service-role-ratchet` | Passerade den befintliga statiska kontrollen; inte bevis för körd RLS i databas |
| `git diff --check` | Passerade |
| Oberoende kodgranskning | Arkiveringsrace, partnerkompatibilitet, måltenantbehörighet, granskningsrace och systemverifikat/samtycke granskade och rättade; den sista samtyckesreproduktionen bekräftat spärrad |
| `npm run build` | **Blockerad:** Next.js kunde inte parsa TypeScripts `--showConfig` |

AI-tillägget verifierades med först observerat röda beteendetester för läsargränsen, engångsreservation och skyddat anslutningstest. De tre nya sviterna är `manual-mail-ai-reader`, `manual-mail-ai-recording` och `manual-mail-ai-connection`. En ny replay-regression verifierar att reservationen bevaras även när normalisering körs om efter att AI stängts av. De ursprungliga 20 sviterna kördes om därför att in-memory-databasporten och normaliseringsskrivningen berördes. App- och testtypkontroll samt riktad ESLint kördes om och passerade; service-role-ratchet passerade med 2 328 anropsställen. Produktionsbygget kördes om med Node 22 och stoppades av samma `--showConfig`-fel. Inga build-gates försvagades.

AI-kontrollen ersätter bara HTTP-transport och databasport med syntetiska svar/rader. Den verifierar inte verklig modellkvalitet, aktuell nyckelbehörighet, produktions-RLS eller Strato-transport. Per-anropstak och en reservation per rad testas; inget hårt månadsbudgettak påstås. Ingen ny migration skapades och ingen produktionsdatabas ändrades.

Oberoende slutgranskning av AI-diffen: inga konkreta viktiga fynd. Granskaren kontrollerade bevarad reservation vid replay, scope före lagring, separat förslagsanvändning och plattformsbehörighet/säker textåtergivning. Inte heller granskaren körde verkligt API-anrop.

## Produktionsrelease, pågående

Releasekopian är `/workspace/gridex-ops-release-20261018`. Den ursprungliga arbetskopian bevaras. Patchen applicerades utan konflikter på `3034e14d`; de senare main-filerna överlappar inte uppgiftens filer. Releasekopians omkörning ger 274 passerade tester och ett avsiktligt avstängt live-test. Det opt-in-testet kräver build-flaggan `GRIDEX_VERIFY_PRODUCTION_AI=1`, kör ett enda syntetiskt riktigt AI-anrop och stoppar bygget vid fel. Oberoende releasegranskning hittade inga viktiga fynd i runner, test eller Vercel-byggkommando. Ingen migration eller databasändring ingår.

Mål: Vercel `div3rsa/gridex-ops-platform`, projekt `prj_xA3EDI1xztkkyx21e3LY4UhgYrWt`, team `team_e3htkJPyBNSw3Ix1KQLlf180`. Befintliga Secret-referenser för OpenAI och manuell Strato-IMAP har verifierats som metadata, aldrig lästs. Release byggs först med `--prod --skip-domain`; domänen flyttas efter godkänt bygge, verkligt syntetiskt AI-prov och HTTP-/behörighetskontroll. Ingen Force Promote eller försvagad deployment protection används.

Första releasen `b7807852` byggdes och promoterades normalt till `app.gridex.se`. Vercels fulla Next/TypeScript-bygge samt ett verkligt syntetiskt AI-prov passerade: 392 input-/45 output-token. Publik login/dokumentation gav 200; privat PDF-rutt 401 och adminvy 307 till login. Skyddad staging-HTTP stoppades av automatisk säkerhetsgranskning av CLI:ns möjliga bypass-token; kontrollerna slutfördes via publik produktion utan bypass. Ett separat marknadsjobb hade `permission_execution_actor_unqualified` både före och efter releasen; den befintliga spärren bevaras.

En andra oberoende slutgranskare reproducerade P1: en återförsökande begäran kunde skriva över ett nekande som anlände under PDF-IO. Rättningen använder metadata-CAS på köstatus och granskningsdiagnostik, bevarar det nya svaret och avbryter endast operationens egen nya ännu oklaimade köpost vid konflikt. Befintliga köposter behåller den aktuella svarsspärren. Granskningsdiagnostik begränsas också till öppna tillstånd så att en samtidig status-only completion/cancellation inte återöppnas vid arkiveringsfel. Fem regressionsfall observerades röda och blev gröna; hela de 23 berörda sviterna ger därefter **279/279**. Båda granskarna kontrollerade hold-rättningen; den andra återkörde också sin ursprungliga reproduktion oberoende och bekräftade att nekandet inte kan raderas och att ingen köad audit-händelse skapas vid konflikten. Rättningen byggs/promoteras i en andra vanlig Vercel-release.

Skill-routing för AI-tillägget: OpenAI Platform API Key (redan uttryckligen godkänd nyckel och Production-destination; ingen ny fråga), agent-email-inbox (obetrodd text och inga verktyg), Supabase (befintlig JSONB/RLS och atomisk reservation), TDD, requesting-code-review, verification-before-completion och React/web-interface-guidelines. Ingen verktygsagent/Agents SDK, gateway, ny databas eller Ediel-masterplanändring behövs för den avgränsade läsfunktionen. Delat Ediel-minne och producerade typer/schema lämnas orörda; detta dokument är uppgiftens checkpoint.

De 20 sviterna: `poa-storage-and-access`, `manual-poa-document-contract`, `poa-mail-evidence`, `poa-mail-review-request-core`, `poa-mail-review-outbox-worker`, `poa-mail-review-follow-ups`, `poa-mail-review-manual-mailbox-config`, `inbound-review-manual-inbound-retry`, `inbound-review-manual-correlation`, `main-baseline-pr204-manual-inbound`, `website-poa-exact-accepted-document-ts`, `website-poa-exact-accepted-document`, `customer-sync-profile-patch`, `customer-sync-authenticated-reference`, `admin-navigation-tenant-visibility`, `admin-navigation-match`, `manual-inbound-retired-source-retry`, `poa-lifecycle-status`, `poa-mail-review-resend-idempotency`, `customer-poa-site-readiness`.

Byggdiagnostik: direkt `tsc --showConfig` returnerade giltig JSON. Next.js `runTypeScriptCli` returnerade exit 0 men **0 stdout-bytes**. En isolerad `child_process.spawnSync(process.execPath, ['-e', 'process.stdout.write("CHILD_OUTPUT")'])` gav också exit 0 och tom stdout. Det reproducerar underprocessproblemet utan projektkod. Ingen Next-/TypeScript-gate eller byggkonfiguration försvagades. Produktionsbygge är inte godkänt av detta underlag.

## Kvar till driftverifiering

Ingen faktisk Resend-leverans, Strato-inloggning, verklig RLS-/storagepolicykörning eller browserinloggning har verifierats. Vercel-autentisering användes för projekt-/nyckelmetadata; själva OpenAI-nyckeln hämtades inte och inget live-inferensanrop kördes. Databas-, transport- och sessionportar ersätts i de lokala testerna; parser, dokumentrendering, livscykel, korrelation och berörda kontrollflöden körs där respektive test täcker dem. Syntetiska fixtures används, inga kunduppgifter från konversationen sparas.

Nästa steg är att få produktionsbygget verifierat i en miljö med fungerande underprocessutdata och därefter köra ett syntetiskt godkännande/utskick/svar/nekande/rättelse med tenant A/B och superadmin enligt runbooken. Äldre dokument arkiveras vid åtkomst; ingen fullständig historisk produktionsinventering eller backfill har körts. Ingen faktisk BankID-integration är aktiverad. Villkorade kommersiella datum behöver fortsatt granskning. PDF-renderaren stöder WinAnsi; annan Unicode kräver uppladdat original eller en framtida Unicode-renderare.
