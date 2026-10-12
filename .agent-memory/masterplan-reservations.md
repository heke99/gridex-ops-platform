# Reservationer — ny femagentsepok

Epoch: `gridex-five-agent-20261012`. [Owner STOP](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122223028) och [205verifierade adminreleases](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6122307591) ersätter oldowner-onlyhandoff-waits endast för den utförda reseten. Alla framtida nya reservations-/releaseoperationer följer samma kvittobundna protokoll. Nya kvitton endast[#766](https://github.com/heke99/gridex-ops-platform/issues/766).

## Ny start

Läs [masterplan-five-agent-baseline-20261012.md](masterplan-five-agent-baseline-20261012.md), [masterplan-five-agent-transition-20261012.md](masterplan-five-agent-transition-20261012.md), faktisk main/frysta krav/ledger/donorhead och aktuella refs. Nya agenter behöver inte kontakta gamla ägare. Slotlistan ger ingen technicalclaim. En existerande ny ref är upptagen; konflikter inom nyepok avstäms innanwrite. Ett sent gammaltkvitto dokumenteras som resetkonflikt och får inte forceoverwrites.

## Atomic masterplan-reservation-v1

1. Uniqueagent/session, packetUUID, nybranch, owncheckpoint, actualmainSHA, exactIDs/exactUTF8POSIXrelativefiles och nextAction. ReceiptJSON anger protocol,packet,agent,branch,checkpoint,ids,files,base,createdAt,nextAction samt **epoch och slot**.
2. POSTgit/commits med actualmain's exacttree och enparentmain; JSONmessage ovan. No change påmain. Spara receiptSHA.
3. Resurser ligger under `refs/tags/agent-claims/masterplan/`: `slot-R1`/`slot-R2`/`slot-C1`/`slot-C2`/`slot-C3`, `id-<ID>`, `file-<sha256>` och relevant `producer-*`. Filhash är SHA256 av exactUTF8POSIXpath utannewline. Expandera directories; Coverage använder IDlocks, ownedrows-only och serialmergereconciliation.
4. Sorteraresurser; POSTgit/refs CREATE_IF_ABSENT medreceiptSHA. Existingref occupied; neverforce/update. Ambiguousresponse kräverexactGET. På conflict rollbackas bara egna acquiredref medmatchedreceipt; partialacquisition ger ingen clearance. AdditionalIDs/files/producer ska acquired förewrite/push som aktiverar producent.
5. GETalla resurser och kräv exactreceiptSHA. CLAIM/#766 binder agent/epoch/slot/packet/branch/IDs/files/resources/receipt/checkpoint/next och readback. Kod först efterfullverification. Ownuniquecheckpoint behöver ingen sharedfilelock.

## Producenter och helpers

BaslinjeJSON producerSlots listar producer-z01/z02/z03/cancellation,esco/z10m/utilts/gen,h/fg/brp,db05,tr08/ops04. En producent/källa/inputepoch i taget; automatisknative/capture påpush måste redan vara scoped. Producerref hålls tills faktisk körning/insamling är terminal och qualified eller avslutad med checkpoint, sedan receiptmatchingrelease före ny producent.

C2 är enda delade GEN-service: fem exactpaths från baselineJSON, producer-gen, en källunion/capture/import åtgången. Nya canonical inputepoch/checksum/replay/appliedhistory gäller; source-bound gamla outputs återanvänds bara efterfullapplicability. GENmedförfattare är inte slutgranskare för egna output.

Extrahelpers får granskning med läsbehörighet utan implementationclaim. Rättning i en annans fil kräver nyepochexactfilehandoff medsource/output och paus av föregående skrivare; oldagentkontakt krävs inte. Två slutgranskare som inte medförfattat; read-onlyhelpers kan komplettera reviewerantalet.

## Claudeproxy och release

En capableproxy kan använda det tidigare ownergodkända GitDataförfarandet för en NY dokumenteradClaudeclaim. receipt.agent är nyClaudeowner, delegatedBy proxy, epoch/slot/exactscope angivna. Samma sortedcreate-if-absent/GET_MATCH/CLAIM; inga gamla mandates eller ref-identiteter återupptas. Tokenaccess får inte antas, credentials aldrig printas.

role-memory och role-merge är singleatomicresources med ownreceipts. Gemensamt minne kräver role-memory+exactfiles. Acquire role-merge efter currentheadmandatorygates/twopeerreviews/relevantproof, refreshactualmain/head/ledger och normalexpected-headmerge. Verifyactualdelivery. Release mergeroleFIRST före memory/resourcecleanup; håll aldrig båda roller medan du väntar på den andra.

GETownedref, kräv exakt originalreceiptSHA, DELETEbara match och verifieraabsence. Ambiguousfail staysunresolved. Proxyrelease behöver nyaownerns exakta request. Helpers/nyaslotägare överlåter bara documentedboundedresources; ingen futureglobalunlock, silentexpiry ellerforeignbranchcleanup.

Originalauthority och tidigare receipts ligger i [Git-historik](https://github.com/heke99/gridex-ops-platform/blob/95bb437137ce3bc0b0246bed6cf1d149493c92b9/.agent-memory/masterplan-reservations.md). Gamla205claims är redan administrativt avslutade; deras historiska producer-/owner-waittext är inte en ny startgrind.
