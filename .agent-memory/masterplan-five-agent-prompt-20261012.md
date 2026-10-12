# Claude-/Codex-prompter för fem nya agenter

Samma prompt gäller i båda verktygen. Välj en slot per ny agent. Klistra in slotens tre rader följt av hela gemensamma prompten. Läs denna granskade branch innan merge och faktisk main efter merge. Gamla agenter återupptas inte.

## R1 — Datalivscykel och retention

```text
SLOT: R1
ID: DB-05
FÖRSTA ÅTGÄRD: Skapa ny DB05-PR på aktuell main. Återanvänd levererade SQL/HTTP/journalrättningar och bevarat599/718underlag. Bevisa kanoniskt kundavslut→senare same-customer/same-decision due-purge, separata behörigheter, klocka, vägransfall, replay/tombstone och skyddad historik. Legal retentionklass/tidsfrist/raderingsgrund måste vara behörigt beslutad. R1 producerar en enda DB-kedja; C3 använder den för AT-DB-05 och SC-070.
```

## R2 — Transport och kontrollerat motpartsprov

```text
SLOT: R2
ID: TR-08, OPS-04
FÖRSTA ÅTGÄRD: Skapa små nya PR för kvarvarande TR08/OPS04. Återanvänd #761-evaluatorn och relevanta543/545kriterier. Kvalificera autentisk operatorägd provider-/relay-/TLS-/SPF-trace och ett överenskommet verkligt motpartsprov med rätt miljö,tenant,certifikat,rutt,profil,incident och befintligt LIVE-mandat. C3 använder samma underlag; mekanismtest ersätter inte externa beslut.
```

## C1 — Leverantör L/LK/C, Z02 och timing

```text
SLOT: C1
ID: AT-Z01L-SUPPLIER, AT-Z01LK-SUPPLIER, AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER, AT-Z03L-SUPPLIER, AT-Z03LK-SUPPLIER, AT-Z04L-SUPPLIER, AT-Z04LK-SUPPLIER, AT-Z03C-SUPPLIER, AT-Z04C-SUPPLIER, SC-035, SC-037, SC-039
FÖRSTA ÅTGÄRD: Återanvänd frozen771/762/759/755 och C03/C04-underlaget. Börja med Z02:s verkliga job_insert-fel och signing/PDF/current-network-prefixkrav; återskapa från publicerade kriterier om privata utkast saknas. Kontrollera den använda replaymiljöns kapacitet. Kvalificera samma faktiska kedja till Z01/Z03/Z04, timing och cancellation utan extra parallella producenter.
```

## C2 — ESCO, historik, mätvärden och ACK

```text
SLOT: C2
ID: AT-Z13V-ESCO, AT-Z13VH-ESCO, AT-Z14VH-ESCO, AT-Z15V-ESCO, AT-Z15VH-ESCO, SC-023, SC-046, SC-053, SC-054, AT-Z10M-SUPPLIER
FÖRSTA ÅTGÄRD: Återanvänd frozen745/764/744/749/753 samt levererade763/750. Slutför ESCO-V/VH/DDQ-separation, verklig persistens→ACK och Z10-history/effective-boundary. C2 är dessutom den enda seriella GEN-/schema-/types-/manifestskrivaren för alla fem agenter; fortsätt kvarvarande744→753→755→764/qualifiedforwardkällor en åt gången, med ny egen GENclaim och kvalificerade inputs.
```

## C3 — H/F/G/BRP, gemensam intake och externa acceptanser

```text
SLOT: C3
ID: AT-Z05H-SUPPLIER, AT-Z08H-SUPPLIER, AT-Z06F-SUPPLIER, AT-Z09F-SUPPLIER, AT-Z06G-SUPPLIER, AT-Z09G-SUPPLIER, AT-Z09B-SUPPLIER, SC-031, SC-070, AT-DB-05, AT-TR-08, AT-OPS-04
FÖRSTA ÅTGÄRD: Återanvänd frozen768/758, levererad760 och original F/G-bevis. Kvalificera H, F/G, BRP-historik och ignorerade PRODAT-fält med oförändrade affärsdata/syskon/topologi. AT-DB-05/SC-070 och AT-TR-08/AT-OPS-04 prövas mot R1/R2:s enda faktiska kedjor; skapa inga andra DB/transport/LIVEproducenter.
```

## Gemensam prompt

```text
Arbeta i heke99/gridex-ops-platform som en NY agent i SLOT angiven ovan. Användaren har2026-10-12 stoppat alla gamla agenter och överlämnat arbetet till fem nya. Du ska inte hitta gamla agenter, be dem om lov eller invänta deras svar.

Läs faktisk main/AGENTS.md, .agent-memory/README.md och den gemensamma masterplan-five-agent-baseline-20261012.md/.json, masterplan-five-agent-transition-20261012.md, workflow och reservationsprotokoll. Läs dina ordagranna frysta rules.json/acceptance_tests.json-kriterier, coverage.json, relevanta arkiverade donorPR-heads/reviews/felbevis och aktuella#766kvitton. Gamla checkpoints hämtas bara vid relevant behov via retired-memoryindexets immutableGit-länkar. Gamla självval/två-ID-/ägarväntan/producentinstruktioner gäller inte.

Verifiera OWNER_STOP och ADMIN_RELEASE_COMPLETE-kvittona. Alla205 inventerade gamla claims är pensionerade. De gamla13PR-förslagen är bevarade donorkällor med exakta heads och kvarvarande krav; de ska inte mergas eller automatiskt återöppnas. Skapa en egen ny branch/packet/agentidentitet/checkpoint på aktuell main och en ny liten PR. Återanvänd endast relevanta donorändringar och bevis med dokumenterad jämförelse; importera inte en gammal stack eller en okänd privat, opubliceratdraft i sin helhet.

Före kod: claima din unika slot atomiskt, sedan endast nästa sammanhängande pakets ID, exakta files och applicableproducerresurser. Receipt måste ange epoch gridex-five-agent-20261012, slot och nästa konkreta åtgärd. SORTED CREATE_IF_ABSENT→GET_MATCH→CLAIM på#766. Prompt/tilldelning är inte en teknisk claim. En annan NY slot/file/producerclaim är upptagen; samordna den nya överlämningen. Ett gammalt nytillkommet kvitto är en konflikt att dokumentera, inte tillstånd att forceoverwrite.

Om lokal gh ger401 eller tagg/refproxy403: skilj CLIåtkomst från GitHubconnectorns autentiserade läs-/skrivåtkomst. Använd tillgänglig connector för att läsa aktuella refs och publicera ett exakt proxybehov på#766 med ny agent/slot/packet/branch/checkpoint, faktisk main, ID, fulla filvägar och producerresurser. En behörig proxy kan skapa GitDatareceipt och refs för SAMMA nya ägare utan att flytta token eller implementation. Läs proxykvittot och verifiera faktiska receiptmatchade refs via tillgänglig autentiserad läsning före kod. R1/R2/C2:s tidigare401/403 är redan hanterade i6125010625 och C2:s två extra filer i6125274908; börja inte om samma claims eller vänta på att just lokal gh repareras. Om nya scope fortfarande saknar refs fortsätter read-onlyförberedelse medan access ordnas; kommentar ensam är ingen atomisk reservation.

Filer listas och reserveras före FÖRSTA write, även i lokal separat worktree, inte bara före push. Framtida slot-ID är tilldelningar tills ett enda nästa paket har exactID/file/producerrefs. Lokala opublicerade kandidater som uppstått före claim bevaras som underlag; stoppa ytterligare writes/pushes i den delen tills scope/handoff är verifierat. Slutför eller uttryckligen överlämna nuvarande paket före nästa, och håll C2:s GEN-kö seriell.

Extra agenter får gå in som granskare med läsbehörighet direkt. Hjälp varandra att läsa kod/bevis och hitta konkreta fel. Kodrättningshjälp får en exakt filöverlämning inom den nya epoken med source/output, signerad producerpause för justfilerna och egna verifiedrefs. En fil har en skrivare; en native-/GEN-/capture-/artefaktkedja har en producent. Gå inte in och skriv samtidigt i annans worktree/branch. C2 sköter den delade GEN/schema/types/manifestkön seriellt för alla fem; andra får granska output men startar ingen extra GEN-producent.

Privata gamla Claudeprocesser kunde inte tekniskt avslutas från resetvärden. Gamla arbets-/publish-/merge-/producentmandat är återkallade. Skydda därför nytt arbete med egna branches, separata disponibla backends och nya source/input/runepochs. Sen gammal kod eller CI är inte nyepochcredit. För faktiskt delad delad produktionsmiljö krävs verklig quiescence och behörigt mandat innan en ny producent startar.

Implementera och pröva alla condition/on_pass/on_failure och given/when/expected/prohibited på rätt lager, med tenant/actor/object/authoritykontraster, historik,replay,beständig business och physicalACK när kravet säger det. Frozenregister, redan appliedmigrations, negativa assertions och CIgates ändras inte för att få grönt. coverage.json är enda godkännandeledger; baselineJSON är ett daterat överlämningsunderlag.

READY: exactPR/head/base/tree/paths/ownedIDs, kompletta krav, verkligt körda resultat och ärliga begränsningar. Begär två oberoende granskningar av andra som inte medförfattat kandidatens kod/test/fixture/proof/GEN. Om en reviewer hjälper att rätta blir den medförfattare och ersätts i slutgranskningen. Använd ytterligare read-onlypeers om femgruppen saknar två oberoende. Rätta inom owncustody, kvalificera affectedproof och bind granskningarna till finalversionen.

Alla mandatorycurrentheadchecks och relevantgenuinewholeproof krävs före normalexpected-headmerge under role-merge. Verifiera faktisk PR/main/parents/tree/coverage; frigör egen mergeroll först och bara rätt receiptbundna egna resurser därefter. Skriv bara egna aktuellt claimedledgerrows när helaID styrks; serialmerge preservesar andras rader. Delkomponent-PASS, modeled/nativepartial, CI eller deploy är inte fulllegal/provider/LIVE/motpartsacceptans.

Före kod och varje meningsfull ändring/fel/review/publish/merge/paus: eget checkpoint+#766 med taken/done/source+verification/blocker(owner+output+resumption)/next. Gemensamt minne kräver role-memory+exactfiles. Inga dubbla auditnarrativ, oförändrade pollingloopar eller blindreruns.

Kvalificera dagensmainE2EFAILURE genom en ensam loggläsare/fixägare. Den gamla#762värdens Docker-rootENOSPC är inte din värds diskstatus; skapa en ren ny replaymiljö med tillräcklig kapacitet. Saknade privateprefix/forwardinputs rekonstrueras från publicerade krav och provas; gamla agenters svar är inget beroende. Legalretentiongrund, autentisk providertrace, normativa källluckor och överenskommet LIVE/motpartsmandat kvarstår. Syntetiskt mekanismprov ersätter inte dem och #310förblirPAUSED.

Slutför nästa paket inom din slot, dokumentera faktiskleverans/release och fortsätt. Om exakt kriterium är extern-/teknikblockerat: gör oberoende egna delar och relevant granskning med läsbehörighet; lämna ett tydligt aktuellt blockerarkvitto. Rapportera verifierade framsteg och nästa konkreta steg.
```
