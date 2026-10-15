# Reservationer — aktuell receiptbunden custody

Epoch: `gridex-five-agent-20261012`. [Owner STOP](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122223028) och [205verifierade adminreleases](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122307591) ersätter oldowner-onlyhandoff-waits endast för den utförda reseten. Alla framtida nya reservations-/releaseoperationer följer samma kvittobundna protokoll. Nya kvitton endast[#766](https://github.com/heke99/gridex-ops-platform/issues/766).

## Ny start

Läs [masterplan-current-start.md](masterplan-current-start.md), faktisk main/frysta krav/ledger/donorhead, senaste [#766](https://github.com/heke99/gridex-ops-platform/issues/766) och aktuella refs. Baslinje/transition är historik. Befintliga slots, filrefs och producenter återclaimas inte från en äldre prompt. Läs modellneutralt deltagande nedan för skillnaden mellan en ledig scope och en aktiv ägares handoff. En existerande ref är upptagen; konflikter avstäms före write. Ett sent gammalt kvitto ger ingen rätt till force-overwrite.

## Modellneutralt deltagande

Claude, Codex och andra behöriga agenter får reservera och claima samma slags regler och kontrakt. Agentnamn och branchprefix är identiteter, inte behörighetslistor. `CLAUDE.md` läser samma `AGENTS.md`.

- **Ledig scope:** välj endast ett ID som ännu inte är VERIFIED/PASSED på faktisk main. Verifiera senaste #766, öppna PR:er och autentiserade exakta ID-/fil-/relevanta producentrefs. Oklar auth, saknat underlag eller en aktiv ägare betyder inte ledigt. Inom aktuellt användarmandat får agenten sedan skapa egen atomisk claim enligt stegen nedan; ingen tidigare ägares handoff krävs när ingen ägare finns.
- **Aktivt ägd scope:** begär positiv avgränsad exact-ID/file/source/output-handoff och paus för tidigare skrivare inom exakt scope. Verifiera egen custody före write och invänta separat FIRSTWRITE_GO om handoffen kräver det. Ägarskap upphör inte av tystnad, tid eller en 404.
- **Extra session:** behåll aktuell epoch och den gemensamma resursnamespacen. Använd en unik `slot` som `session-<packetUUID>` och resursen `slot-session-<packetUUID>`. R1/R2/C1/C2/C3 får bara användas enligt aktuell verifierad tilldelning. En session-slot ersätter aldrig ID-/fil-/producentlås eller utsedd serial-, minnes- eller producentroll.
- **Åtkomst:** använd agentens egna behöriga GitHub-verktyg. Dokumentationen skapar inga GitHub-behörigheter eller credentials. Vid 401/403 används endast den nedan beskrivna behöriga proxyn med exakt eget claimbehov och ägarens readback; ingen token delas och ett nekat innehålls-/publiceringsbeslut kringgås inte.

## Atomic masterplan-reservation-v1

Samma GitHub REST-operationer eller motsvarande behöriga verktyg används i Claude och Codex. Byt ut platshållare mot verifierad egen scope. Spara JSON lokalt och använd strukturerade argument eller `--input <fil>`; inga credentials eller privata underlag i receiptmeddelandet.

1. Läs `GET /repos/heke99/gridex-ops-platform/git/ref/heads/main` och `GET /repos/heke99/gridex-ops-platform/git/commits/<mainSHA>`. Bind faktisk mainSHA/treeSHA. Välj unikt agent/sessionnamn, packetUUID, egen ny branch, eget checkpoint och exakta IDs/filer. Repo-/auth-404 är ingen frisläppning.
2. Förbered receiptJSON med `protocol: "masterplan-reservation-v1"`, `packet` (UUID), `agent`, `branch`, `checkpoint`, `ids`, `files`, `base: <mainSHA>`, tidszonsatt `createdAt`, `nextAction`, aktuell `epoch` och egen `slot`. Validera IDs mot frysta register; expandera kataloger till exakta UTF-8 POSIX-relativa filvägar. Filresursen är `file-<sha256>` av exakt path utan newline. Own unique checkpoint behöver inget delat fillås.
3. `POST /repos/heke99/gridex-ops-platform/git/commits` med `{ "message": <receiptJSON som sträng>, "tree": <treeSHA>, "parents": [<mainSHA>] }`. Spara receiptSHA och GET-verifiera full JSON, exakt en parent och oförändrat main-tree. Detta skapar ett neutralt kvitto, ingen main-ändring.
4. Resurserna är egen `slot-<slot>`, varje `id-<ID>`, varje `file-<sha256>` och endast uttryckligt tillämplig `producer-*`, under `refs/tags/agent-claims/masterplan/`. Sortera dem lexikografiskt. För varje resurs: `POST /repos/heke99/gridex-ops-platform/git/refs` med `{ "ref": "refs/tags/agent-claims/masterplan/<resurs>", "sha": <receiptSHA> }`. Create-if-absent är enda acquire; aldrig update/force. Vid konflikt eller tvetydigt svar: `GET /repos/heke99/gridex-ops-platform/git/ref/tags/agent-claims/masterplan/<resurs>`. Annat SHA stoppar paketet; återställ bara kvittomatchade egna refs som just förvärvats. Delvis förvärv ger ingen skrivrätt.
5. GET-verifiera samtliga resurser mot rätt kvitto; utökningar bevarar tidigare giltiga kvittobindningar. Publicera CLAIM på #766 med agent/epoch/slot/packet/branch/IDs/files/resources/receipt/checkpoint/next och autentiserad readback; verifiera full body. Vid proxy/handoff gör mottagaren egen CLAIM_ACK. Första sourcewrite sker först efter full egen custody och eventuella separata handoff-GO. Ytterligare IDs/filer/producentresurser kräver verified acquire före motsvarande write/push.

Coverage använder ID-lås, endast egna rader och seriell reconciliation mot aktuell ledger. En sourceclaim aktiverar inte native/GEN/backend/LIVE, tar inte producent-/mergerollen och ger ingen VERIFIED/PASSED-status. Dessa separata mandat och aktuella receipts krävs före motsvarande steg.

## Producenter och helpers

BaslinjeJSON producerSlots listar producer-z01/z02/z03/cancellation,esco/z10m/utilts/gen,h/fg/brp,db05,tr08/ops04. En producent/källa/inputepoch i taget; automatisknative/capture påpush måste redan vara scoped. Producerref hålls tills faktisk körning/insamling är terminal och qualified eller avslutad med checkpoint, sedan receiptmatchingrelease före ny producent.

Befintlig enligt senaste verifierade handoff GEN-ägare är enda delade GEN-service; historiskt C2-slot utser ingen ny producent: fem exactpaths från baselineJSON, producer-gen, en källunion/capture/import åtgången. Nya canonical inputepoch/checksum/replay/appliedhistory gäller; source-bound gamla outputs återanvänds bara efterfullapplicability. GENmedförfattare är inte slutgranskare för egna output.

Extrahelpers får granskning med läsbehörighet utan implementationclaim. Rättning i en annans fil kräver nyepochexactfilehandoff medsource/output och paus av föregående skrivare; oldagentkontakt krävs inte. Två slutgranskare som inte medförfattat; read-onlyhelpers kan komplettera reviewerantalet.

## Proxy vid401/403 och release

En behörig proxy kan utföra GitDataförfarandet för en NY ägares publicerade exakta claimbehov när dennes lokala gh ger401 eller refproxy403. receipt.agent är samma nya Claude-/Codexägare, delegatedBy anger proxy, epoch/slot/packet/branch/checkpoint/base/exactscope och nästa steg binds. Samma sortedcreate-if-absent/GET_MATCH/CLAIM; verifiera även slotens aktuella ägarbindning före en fileextension. Om ett giltigt originalreceipt redan finns får proxy spegla exakt det SHA:t med delegationen i körkvittot; annars skapas ett nytt giltigt GitDatareceipt. En lokal commit som ger remote404 kan inte vara refmål. Inga gamla mandates/ref-identiteter återupptas; credentials överförs eller printas inte.

Ägaren verifierar proxykvittot och faktiska refs genom tillgänglig autentiserad läsning, även om lokal gh fortfarande saknar åtkomst. Bara det exactverifiedscope kan då fortsätta; nya files/IDs/producers kräver ytterligare verifiedrefs före första write, även lokalt. En kommentar utan ref eller ett framtida tilldelat slot-ID är ingen claim. [R1/R2/C2åtkomstkvitto](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6125010625) och [C2:s tillagda två filer](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6125274908) är utförda operationer, inte tillstånd att claima om samma resurser eller retroaktivt godkänna tidigare unreservedwrites.

role-memory och role-merge är singleatomicresources med ownreceipts. Gemensamt minne kräver role-memory+exactfiles. Acquire role-merge efter currentheadmandatorygates/twopeerreviews/relevantproof, refreshactualmain/head/ledger och normalexpected-headmerge. Verifyactualdelivery. Release mergeroleFIRST före memory/resourcecleanup; håll aldrig båda roller medan du väntar på den andra.

GETownedref, kräv exakt originalreceiptSHA, DELETEbara match och verifieraabsence. Ambiguousfail staysunresolved. Proxyrelease behöver nyaownerns exakta request. Helpers/nyaslotägare överlåter bara documentedboundedresources; ingen futureglobalunlock, silentexpiry ellerforeignbranchcleanup.

Originalauthority och tidigare receipts ligger i [Git-historik](https://github.com/heke99/gridex-ops-platform/blob/95bb437137ce3bc0b0246bed6cf1d149493c92b9/.agent-memory/masterplan-reservations.md). Gamla205claims är redan administrativt avslutade; deras historiska producer-/owner-waittext är inte en ny startgrind.
