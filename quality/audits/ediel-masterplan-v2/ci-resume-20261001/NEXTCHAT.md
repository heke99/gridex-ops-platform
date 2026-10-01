GRIDEX — fortsätt och slutför hela Ediel masterplan v2 från faktiskt aktuellt läge

Arbeta i `heke99/gridex-ops-platform` som integrationsansvarig. Detta är ett implementationsuppdrag. Genomför återstående arbete i hela F0–F7 och samtliga 352 ursprungliga ID:n, med deras egna kriterier och ursprungliga betydelser. Fortsätt självständigt med sammanhängande verifierade paket. Stanna inte efter ännu en inventering, plan eller ett enskilt grönt delprov.

## Börja vid den verkliga blockeraren

Den citerade GitHub-publiceringen lyckades. Recovery-kontrollen finns i `quality/audits/ediel-masterplan-v2/ci-resume-20261001/`. Läs `README.md`, `observed-state.json`, `conflicts.json`, previewloggarna och `history-bridge.json`. Dessa är daterade observationer, inte tillstånd att skriva över senare arbete.

Senast verifierade remote:

- Draft #424: `codex/ediel-master-v2-integration-20261001`, head `c8f666d9bf61f84816c2f295dc44442167f0b75a`, tree `667be5ad06e31ed4bb22caf92844505b225d8eed`.
- Dess bas är #421: `codex/ediel-v2-identity-e035-owner-20260928`, head `3c7342c64c83b705e85c18f300705166a1732ad6`.
- GitHub visar #424 `mergeable:false`, `mergeable_state:dirty`. Det finns noll workflow-körningar på detta head. Vanliga `pull_request`-workflows körs inte på PR:er med mergekonflikter. Triggerreglerna utesluter inte denna basgren.
- Jämförelse: #424 +16/-143 commits, mergebase `8052ebff1dd3746d0b4664b5f2533164a3497ae7`. Isolerad merge-preview reproducerar 114 konfliktfiler.
- #423: `604e339922b9fa0eb449dbd1ef720c49a8b5cafa`.
- Separata tenantservice-spår: #418 `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8`, #422 `0778df202b8b46d4ae92a51ffcc24cc25176edaa`. Behåll dem separata; Ediel v2 ersätter inte tenantservice T01–T55/U01–U20.

Den tidigare integratorn visade faktisk fortsatt aktivitet. Senaste fångade lokala kandidat var `536cdc16fcae4b7bb073229540f7e6718ca7e78d`, tree `b4e7386c65c6b8d22d135e33770d56dfe52761be`. Den ger 116 konflikter mot samma #421-bas. Ny kod kan redan ha tillkommit. Kontrollera aktuella heads innan du använder dessa siffror.

## Bevara och samordna först

1. Kontrollera aktuellt remote main, #421/#423/#424 samt separata #418/#422. Kontrollera lokal HEAD/tree, gren, status, staged/unstaged diff, opushade commits, aktiva processer/agenter, ensamägare och senaste faktiska CI-körningar/artefakter.
2. Återanvänd den befintliga integrationsägaren och dess team där de fortfarande arbetar. Starta inte ett konkurrerande skrivteam på samma filer, index, ref eller testdatabas. Om du arbetar från en ny session, gör oberoende komposition i egen arbetskopia och publicera enbart på en egen avgränsad gren tills integrationsägarskapet faktiskt har lämnats över. Fortsätt med oberoende arbete under tiden.
3. Bevara verifierade commits och WIP genom respektive ensamägare. En lista med hashvärden är inte en backup. Låt inga återställningar, squashningar eller breda kopieringar radera senare arbete.
4. Läs AGENTS.md, hela aktuella projektminnet och senaste verkliga receipts. Följ relevanta installerade skills och den lokalt installerade ramverksdokumentationen för faktisk version. Behandla äldre minnesavsnitt som historik när de motsägs av verklig kod/CI.
5. Lägg exklusivt filägarskap för varje konflikt och återstående paket. Integrationsägaren äger workflowändringar, gemensamma gränssnitt, versionskällor, genererade DB-artefakter, checksumregister, gemensamt minne och publicering.

De observerade arbetskopiorna låg under `/workspace/scratch/29079c3a4297/`: `gridex-integration`, `gridex-native-owner-restored`, `gridex-mixed-recovered`, `gridex-ack-owned-recovery`, `gridex-transport-retention-restored`, `gridex-requested-customer-e`, `gridex-recovery-lineage-restored`. Sök dem om miljön har ändrats. Tilldela inte bort deras befintliga filer medan de fortsätter skriva.

Ingen force-push, main-merge, produktionsmigration, riktig kundkommunikation, marknadsaktivering eller Ediel-/motparts-/TGT-/AGT-trafik utan separat uttryckligt tillstånd. Pausad #310 lämnas orörd. Behåll befintliga draft-PR:er och deras syften.

## Rätta historiken och lös integrationen

Publicerad `c8f666d9` var inte Git-förfader till den senare lokala kandidaten. Recovery-provet visar däremot att publicerad och lokal `536cdc16` sammanfogas utan konflikt, till exakt det redan befintliga lokala trädet `b4e7386c`.

En isolerad lokal tvåförälders bridge `bba3163741c513a94938c63ffe88cf6089be78d1` har föräldrarna `c8f666d9` och `536cdc16`, samma tree som `536cdc16`, och båda ancestry-kontrollerna ger exit 0. Det är en förberedelse med noll ändrade källfiler, inte en kvalificerad release. Räkna om motsvarande merge för det nya aktuella headet efter att ägarpaketen bevarats.

Gör sedan en riktig merge med aktuellt fryst #421. Bevara båda föräldrahistorikerna och båda sidors korrekta funktioner. Använd inte generell `ours`/`theirs`. 230 gemensamt ändrade filer var redan blob-identiska, medan 139 överlappande filer faktiskt skilde sig. De 143 commitsen är därför varken 143 helt saknade paket eller bara mekaniska SHA-alias.

Lås dessa gränssnitt tidigt och låt ensamägarna komponera dem:

- `core/kernel.ts`: behåll skyddad ACK-replay/requested-change-basis samt faktiska kundhändelseproducenter och aktuell registry-dispatchkontroll.
- `transport/index.part-2.ts`: behåll requested-change-källa, kompletta kontrollargument och transportundantag samt senare transportfunktioner.
- `receivedProdatFinalResponsePlan.ts`: kombinera verkliga supply-/metering-permission-effekter och deras effect-receipt/facts-hash med strukturell och kundversionskontroll.
- `receivedSourceValidationLedger.ts`: bevara komplett V6-bindning av object/application/response/source-function. Återgå inte till äldre V4/V5-dispatch.
- `aiListHistory.ts`: bevara kvalificerad full kundfacet och exakt punkt-/periodbundna deltaepoker samt juridisk/teknisk partisammansättning.
- `services/permissionOrigin.ts`: kombinera terminal återställningskälla/prepare/send-faser med captured request timing. Kontrollera den verkliga behörighetskatalogen; ett inkommande anrop till saknad `communication.write` får inte behållas som ett fungerande tillstånd.

Migrationsfilerna hade inga direkta innehållskonflikter. Bevara publicerade byte. Kvalificera den sammansatta ordningen, wrappers, triggerfält och aktuella RPC-resultatformer med tomdatabas och verklig uppgradering. Konfliktfri SQL-import är inte databasbevis.

Lös och verifiera avgränsade paket. Publicera först efter färsk kontroll att remote fortfarande är förfader till kandidaten, båda avsedda historiker ingår och hela Git-trädet är exakt den verifierade kandidatens. Om GitHub-anslutningen används måste den bevara verkliga mergeföräldrar; säkerställ att nödvändiga parent-/tree-/blobobjekt finns. En omskapad en-förälders commit som tappar det sammansatta ursprunget kan återskapa blockeraren. Uppdatera endast egen integreringsref med `force:false`.

Verifiera därefter att PR:en kan skapa sin merge-ref och att faktiska nya Actions-körningar startar på exakt publicerat head. Saknade körningar är NOT_RUN. Gör inte fler tomma receipt-/synchronize-commits, öppna/stäng-loopar, gamla reruns eller workflowförsvagningar för att försöka få grönt.

## Genomför hela kvarvarande masterplanen

Läs `docs/ediel/masterplan-v2/MASTERMASTERPLAN_v2.md`, README, källmanifest, amendments, alla annex/register och den senaste 352-ID-reconciliationen/arbetsmatrisen. Behåll de 121 regel-ID:na och 231 acceptanskontrakten med deras egna kriterier. Bevara frysta originalfiler och historiska immutable bevis. En avgränsad recovery-plan ersätter inte hela masterplanen.

Återapplicera inte recovery-bundlen `ed3f5159` eller tidigare redan integrerade paket. Återstarta inte verifierade utredningar utan ett nytt faktiskt fel. Behåll deras regressioner i slutkandidaten. Håll isär återanvänt äldre bevis och ny kvalificering av sammansatt kod.

Arbeta med upp till sex arbetsagenter och integrationsansvarig, om miljön stödjer det och utan att duplicera aktiva ägare. Fördela de kvarvarande original-/aktörs-/ACK-reglerna, PRODAT/mixed/life-events, UTILTS/mätvärden, native källa/RPC/recovery, kund-/process-/transport-/retention-/AI-kedjor samt verifiering/UI/kontrakt efter faktisk inventering och exklusiva filer. Gemensamma gränssnitt låses av integrationsägaren före parallella ändringar.

Följ den verkliga hela kedjan för varje tillämpligt ID: autentisk källa → tenant/aktör/roll/mandat/undertyp → aktuell auktorisering → parser/nationella regler → kanoniskt kommando → atomisk DB-mutation/revision/idempotens/audit/outbox → beständig transport-/ACK-/processstatus → konsument/läsmodell/UI. Klientvalda IDs och flaggor är inte behörighetsbevis. Replay och direkt DB/RPC får inte kringgå aktuell policy.

Bevara de senaste mixed-Z04-, H-slut-, kundägarskaps- och F/G-processbevakningsrättelserna. Slutför de verkliga kvarvarande producent-, konsument-, legal-/technical-party-, lineage-, originalkopie-, återställnings- och retentionkedjorna enligt deras källkontrakt. Interna simulatorer och syntetisk provenance ersätter inte riktig källa eller issuer.

Bevara UTILTS E30:s källbelagda villkor för implicit kWh och NULL-energi med föreskriven status. Håll juridisk aktör, teknisk transportpart, tenant, kund, mätpunkt, tidsperiod och undertyp korrekt separerade och bind dem även vid direkt RPC. Mixed-objekt, negativa svar och headeravvisningar ska behålla sina egna effekter och gränser.

Inventera kvarvarande direktanrop, äldre actions, import-, cron-, sync-, transport- och recoveryvägar. Prova aktuellt aktörstillstånd, delegation, återkallelse, avbrott efter commit, retry, dubbelklick, parallella kommandon, sena audit-/completion-fel och externa partnerfel. Bevisa beständig effekt, rollback och frånvaro av förbjudna sidoeffekter.

UI-arbetet ska ge riktiga kontrollerade operatörsflöden: status, pending/read-only/blockering, begriplig konflikt, Spara/Avbryt där relevant, återläsning efter omladdning, tangentbord/fokus/mobil/zoom och korrekt tenant-/rollkontext. Kvalificera varje relevant unik UI-åtgärds handler, serverkontroll, resurs, effekt och återläsning. En toast eller API200 räcker inte.

För varje återstående ID: återstående konkret kriterium, ensamägare, implementation, berörd regression och faktisk verifieringsnivå. Formell acceptans ändras bara när just det ID:ts egna kriterier har nytt eller uttryckligt återanvändbart tillräckligt bevis. Testantal och grönt CI är inte en masterplangodkänning.

## Verifiera och avsluta på en fryst sammansatt kandidat

Kör riktade kontroller efter relevanta ändringar. Vid fel: reproducera första verkliga orsak, skilj trasig fixture från runtimefel, rätta utan att försvaga kontrakt eller behörigheter och kör berörd regression. Ingen upprepad körning utan ny hypotes. Rätta typstatus ärligt för app, tests och scripts var för sig.

Frys sedan en kandidat där kod, migrationsordning, databas, UI, API/runtime-kontrakt och bevis hör ihop. Kräv:

- Relevanta unit-/kontrakts-/säkerhetsregressioner, lint, samtliga tillämpliga typkontroller och build.
- Autentisk tomdatabasreplay och verklig uppgraderingsreplay från angiven förfader, med byte-paritet för genererade typer, schema och fingerprint. Generera från faktisk databas; skriv inte generatorartefakter för hand.
- Native/HTTP-prov av persistens, sena rollback-fel, samtidighet, retry, aktuell behörighet, tenantisolering, riktiga source tuples och direkt DB/RPC. Använd schema-giltiga fixtures. Håll legacy-schemafall och reset separata från andra ägares replaydatabas.
- Riktiga interaktiva browserklick, formulär, navigation och beständig återläsning med skärmbilder. Playwrights direkta API-anrop räknas som API-prov, inte interaktiv UI-verifiering.
- OpenAPI/runtime/guide/referensklientparitet där relevant, migrationschecksums och komplett spårbar ID-/evidensmatris.
- Samtliga tillämpliga obligatoriska workflows på exakt aktuellt publicerat head. Läs verkliga jobbloggar och artefakter, kontrollera deras hashvärden och commit/tree-provenance.

De autentiska clean-/upgrade-/independent-clean-artefakterna för `0373d6d` är historiska. De kvalificerar inte senare runtime/migrationer. En ny sammansatt kandidat kräver ny slutverifiering och nya artefakter. Bevara de gamla filerna immutable.

Om Docker, lokal DB, issuer, scanner, policy, extern konfiguration eller separat tillstånd saknas: redovisa den konkreta blockeraren och håll berörd funktion fail-closed. Fortsätt oberoende arbete. Efter att mergekonflikterna rättats kan autentisk CI-replay ge native-bevis; påstå inte att den körts innan riktiga resultat finns.

Ge korta regelbundna uppdateringar med senaste faktiska head, vad som bevisats, kvarvarande fel och nästa utförbara handling. Commita verifierade delpaket och publicera sammanhängande leveranser utan att invänta ett nytt ”kör” varje gång. Kör inte hela slutkedjan efter varje fil.

Slutredovisa exakta grenar/draft-PR:er/SHA/tree, genomförda funktioner, varje verifierat respektive öppet ID, UI-åtgärder av inventerat totalantal, faktiska tester/native/browser/CI, migrations-/backfill-/kompatibilitets-/rollbackhantering, säkerhetsfynd, externa obevisade integrationer och nästa konkreta genomförandesteg. Om hela masterplanen inte kvalificerats, ange exakt vilka kriterier och bevis som fortfarande saknas.

Börja nu med aktuell ägarskapskontroll och den verkliga historiksammanfogningen. Genomför därefter konfliktkomposition och återstående masterplan; lämna inte användaren vid ännu en publiceringsförberedelse.
