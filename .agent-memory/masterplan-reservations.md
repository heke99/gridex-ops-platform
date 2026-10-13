# Reservationer — aktuell receiptbunden custody

Epoch: `gridex-five-agent-20261012`. [Owner STOP](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122223028) och [205verifierade adminreleases](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122307591) ersätter oldowner-onlyhandoff-waits endast för den utförda reseten. Alla framtida nya reservations-/releaseoperationer följer samma kvittobundna protokoll. Nya kvitton endast[#766](https://github.com/heke99/gridex-ops-platform/issues/766).

## Ny start

Läs [masterplan-current-start.md](masterplan-current-start.md), faktisk main/frysta krav/ledger/donorhead, senaste [#766](https://github.com/heke99/gridex-ops-platform/issues/766) och aktuella refs. Baslinje/transition är historik. Befintliga slots, filrefs och producenter återclaimas inte från en äldre prompt; ny skrivscope kräver uttrycklig avgränsad överlämning. Nya agenter behöver inte kontakta gamla ägare. Slotlistan ger ingen technicalclaim. En existerande ny ref är upptagen; konflikter inom nyepok avstäms innanwrite. Ett sent gammaltkvitto dokumenteras som resetkonflikt och får inte forceoverwrites.

## Atomic masterplan-reservation-v1

1. Uniqueagent/session, packetUUID, nybranch, owncheckpoint, actualmainSHA, exactIDs/exactUTF8POSIXrelativefiles och nextAction. ReceiptJSON anger protocol,packet,agent,branch,checkpoint,ids,files,base,createdAt,nextAction samt **epoch och slot**.
2. POSTgit/commits med actualmain's exacttree och enparentmain; JSONmessage ovan. No change påmain. Spara receiptSHA.
3. Resurser ligger under `refs/tags/agent-claims/masterplan/`: `slot-R1`/`slot-R2`/`slot-C1`/`slot-C2`/`slot-C3`, `id-<ID>`, `file-<sha256>` och relevant `producer-*`. Filhash är SHA256 av exactUTF8POSIXpath utannewline. Expandera directories; Coverage använder IDlocks, ownedrows-only och serialmergereconciliation.
4. Sorteraresurser; POSTgit/refs CREATE_IF_ABSENT medreceiptSHA. Existingref occupied; neverforce/update. Ambiguousresponse kräverexactGET. På conflict rollbackas bara egna acquiredref medmatchedreceipt; partialacquisition ger ingen clearance. AdditionalIDs/files/producer ska acquired förewrite/push som aktiverar producent.
5. GETalla resurser och kräv exactreceiptSHA. CLAIM/#766 binder agent/epoch/slot/packet/branch/IDs/files/resources/receipt/checkpoint/next och readback. Kod först efterfullverification. Ownuniquecheckpoint behöver ingen sharedfilelock.

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
