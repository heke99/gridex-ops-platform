# Reservationer — aktuell receiptbunden custody

Epoch: `gridex-five-agent-20261012`. Faktisk main, frysta krav/coverage, [aktuell start](masterplan-current-start.md) och senaste relevanta [#766](https://github.com/heke99/gridex-ops-platform/issues/766) styr. [Owner STOP](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122223028) och [verifierad reset](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122307591) är utförd historik, inte rätt att återclaima gamla resurser.

## Ny start

Verifiera aktuella PR-heads och autentiserade exakta ID-/fil-/relevanta producentrefs. Gamla prompts, slotnamn, tystnad, ålder och repo-/auth-404 ger inget ägarskap. Följ [workflow](masterplan-agent-workflow.md) för bevis, granskning och leverans. Read-only review behöver ingen implementationclaim.

## Modellneutralt deltagande

Claude, Codex och andra behöriga agenter har samma claimväg inom aktuellt användarmandat. Agentnamn och branchprefix är identiteter, inte behörighetslistor. `CLAUDE.md` läser samma `AGENTS.md`.

- **Ledig scope:** välj ännu ej VERIFIED/PASSED ID och verifierat lediga berörda resurser efter läsning av senaste #766, öppna PR:er och kopplade handoffs. Ingen tidigare ägares handoff behövs när ingen ägare finns. En saknad ID-ref räcker inte ensam.
- **Aktivt ägd scope:** positiv bounded exact-ID/file/source/output-handoff, paus för tidigare skrivare inom exakt scope och egen verifierad custody krävs före write. Eventuellt separat FIRSTWRITE_GO i handoffen ska vara givet. Ingen force-overwrite eller samtidig write i annans workspace.
- **Ny session:** använd unik `session-<packetUUID>` och `slot-session-<packetUUID>` i samma epoch/namespace. Upptagna R1/R2/C1/C2/C3 blockerar inte nya unika sessioner och är inga automatiskt lediga uppdrag. Sessionen ersätter inte ID-/fil-/producent-/rollås.

## Atomic masterplan-reservation-v1

För NYA fria sourceclaims används det gemensamma verktyget `.agents/tools/masterplan-claim.py`. Det reserverar endast exakta ID:n/filer och en egen unik session. Det gör inga source-/branchändringar, roll-/producentacquires, releases eller meddelanden. Bedöm först kopplat ägarskap enligt ovan; CLI:s GET404 är en kollisionskontroll.

Skapa en privat planmall och fyll i verklig mainSHA/treeSHA, egen ren worktree/branch, exakt sorterade IDs/filer, faktisk GitHub-login och redan givet lokalt användarmandat med filhash:

```text
python3 .agents/tools/masterplan-claim.py --example-plan > /tmp/egen-plan.json
python3 .agents/tools/masterplan-claim.py --plan /tmp/egen-plan.json
```

Plan, mandat, checkpoint och journal hålls LOKALT utanför alla Git-worktrees. Mallens platshållare måste ersättas; `ids: []` gäller paket utan regeltilldelning. Bevara genererat packet/session och journalnamnet `<packetUUID>.claim-journal.json`. Första kommandot skapar bara en mall; andra gör lokal validering utan API-anrop. Använd den exakta planhash som valideringen skriver ut:

```text
python3 .agents/tools/masterplan-claim.py --plan /tmp/egen-plan.json --journal /tmp/<packetUUID>.claim-journal.json --expect-plan-sha256 <planSHA256> --execute
```

Verktyget autentiserar aktör/repo/main/tree, skapar ett neutralt receipt på samma main-tree med ensam main-parent och gör sorted CREATE_IF_ABSENT + GET_MATCH för HELA egna resurssetet. Filrefs är `file-<sha256>` av exakt UTF-8 POSIX-path utan newline; inga katalog-, symlink- eller `..`-claims. Orelaterade samtidiga CREATEs tolereras. Upptagen resurs, drift, delvis förvärv eller tvetydigt svar stoppar utan skrivrätt och utan automatisk mutation-retry/rollback. Behåll journalen; använd inte ny journalpath/packet för att återköra ett oklart utfall. En trasig befintlig journal kräver avstämning och ger ingen omkörningsrätt.

Publik Gitreceipt-JSON innehåller ENDAST `{base, files, operation}`. `operation` binder SHA256 av exakt sorterade publika resursrefs inklusive unik session, så separata paket får distinkta receipts. Full `masterplan-reservation-v1`-identitet, mandat, branch, checkpoint, proxydelegation och körjournal stannar lokalt. Exportera inga privata värden eller credentials. CLI skickar inga #766-kommentarer; en uttryckligen auktoriserad kvittens hålls teknisk/publiceringssäker med scope, receipt och autentiserad ref-readback.

**Befintliga maskinbindningar:** `staff-api-schema-capture.yml`, `ediel-db05-native.yml` och `ediel-z02-supplier-native.yml` behåller sina egna exakta legacyreceipts, refs och mandat. Source-only-formatet ersätter inte deras full-v1-producentbindningar. Det [äldre femstegsförfarandet](https://github.com/heke99/gridex-ops-platform/blob/ae25d6d3144fe9828bc00f51af43e607dc76d370/.agent-memory/masterplan-reservations.md#atomic-masterplan-reservation-v1) är referens för dessa redan särskilt bundna kedjor, inte en parallell ny sourceclaimväg.

## Producenter och helpers

En skrivare per fil och en producent per källa/inputepoch. Sourcecustody aktiverar inte native/GEN/backend/LIVE, producent-/mergeroll eller VERIFIED/PASSED. Producentref hålls tills faktisk körning/insamling är terminal och qualified eller avslutad med checkpoint; receiptmatchingrelease föregår ny producent. Befintlig GEN-service enligt senaste verifierade handoff sköter delad schema/types/manifest seriellt. Gamla slotnamn utser ingen ny producent. Oförändrat bevis återanvänds endast med verifierad applicability.

Helpers kan granska read-only. Ändring i annans scope kräver exact filhandoff och paus; en medförfattare ersätts som slutgranskare. Frysta krav, verkliga negativa effekter och två oberoende slutgranskningar enligt workflow kvarstår.

## Proxy vid401/403 och release

Använd egen behörig GitHub-åtkomst. Vid lokal gh401/refproxy403 får behörig proxy utföra exakt samma lokalt bundna sourceplan; ägaren gör egen autentiserad receipt-/ref-readback före write. Full privat ägar-/delegationsbindning stannar lokalt. Dela inga tokens och kringgå inget nekat innehålls-/publiceringsbeslut. För befintliga legacykedjor gäller deras redan särskilt bundna protokoll. En lokal commit med remote404 kan inte vara refmål. Kommentar utan ref är ingen claim; [tidigare åtkomstkvitton](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6125010625) ger ingen ny tilldelning.

Om ägarens lokala plan inte kan verifieras i proxymiljön får proxyn inom redan givet exakt mandat skapa ett eget nytt källpaket på egen ren aktuell main/tree, med ny UUID/session och lokal mandatbindning, enligt samma officiella claimväg ovan. Det oanvända ägarförsöket pausas uttryckligen; oklara journalutfall avstäms först. Ägarens gamla plan/UUID/journal återanvänds inte. Efter verifierad claim ges separat framåtriktad exact-file-handoff med en skrivare. Den faktiska skrivaren verifierar själv kvittot och HELA målsetet (filer/ID och unik session) till samma receipt och lämnar ALL-target-ACK före write. Befintlig FIRSTWRITE_GO och producent-/roll-/publiceringsgräns kvarstår.

Gemensamt minne kräver egen role-memory + exactfiles; håll rollen kort. Normal expected-head-merge kräver aktuell relevant proof, mandatory gates, två applicable reviews och egen role-merge. Verifiera faktisk leverans och släpp mergerollen FÖRST före minnes-/resurscleanup; håll aldrig båda roller medan du väntar på den andra.

Release: GETownedref, kräv exakt ursprungligt eget receiptSHA, DELETE endast match och verifiera autentiserad absence. Tvetydigt utfall förblir olöst. Proxyrelease kräver exakta ägarens request eller ett separat uttryckligt bounded adminmandat. Ingen silentexpiry, generell foreignunlock eller foreignbranchcleanup. Coverage använder egna ID-rader och seriell reconciliation; ingen approval från adminstädning. Pensionerade agenter eller pausade automationer/#310 återupptas inte.
