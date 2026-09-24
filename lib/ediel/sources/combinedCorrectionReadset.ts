import {evidenceHash,isEvidenceRecord,isEvidenceUuid,type ReceivedSourceScope} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant as instant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {inspectStructuralReadset,type StructuralReadset} from './structuralSourceReadset'
import {projectCorrectionContextBlocker,type BoundaryObservation,type CorrectionScopeV1} from './correctionContextImpact'

type CombinedReadset={snapshotId:string;readsetHash:string;source:StructuralReadset}
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const same=(a:unknown,b:unknown)=>instant(a)!==null&&instant(a)===instant(b)
const boundary=(value:unknown):value is BoundaryObservation=>isEvidenceRecord(value)&&
  (value.kind==='known'&&typeof value.utc==='string'&&instant(value.utc)!==null
   ||(value.kind==='unknown'||value.kind==='not_asserted')&&Object.keys(value).length===1)
function scope(value:unknown,expected:ReceivedSourceScope):value is CorrectionScopeV1{
  if(!isEvidenceRecord(value)||value.companyId!==expected.companyId||value.environment!==expected.environment)return false
  return (['customerId','supplyPeriodId','objectId','identityAgency','legalSender','legalReceiver'] as const)
    .every(key=>value[key]===null||typeof value[key]==='string'&&value[key].length>0&&value[key].length<=128)
}

/** Validate one service-only saved receipt before applying any source or
 * correction. Invalid, overflowing or unwitnessed owners remain unavailable. */
export function inspectCombinedCorrectionReadset(expected:ReceivedSourceScope,subjectMessageId:string,receipt:unknown):CombinedReadset|null{
  try{
    if(!isEvidenceRecord(receipt)||!isEvidenceUuid(receipt.snapshotId)||typeof receipt.readsetText!=='string'
      ||!digest(receipt.readsetHash)||Buffer.byteLength(receipt.readsetText)>20*1024*1024
      ||evidenceHash(receipt.readsetText)!==receipt.readsetHash)return null
    const body:unknown=JSON.parse(receipt.readsetText)
    if(!isEvidenceRecord(body)||body.version!==1||body.companyId!==expected.companyId
      ||body.environment!==expected.environment||body.subjectMessageId!==subjectMessageId
      ||!same(body.cutoffAt,expected.cutoffAt)||typeof body.visibilitySnapshot!=='string'
      ||!isEvidenceRecord(body.source)||!isEvidenceRecord(body.process)||!isEvidenceRecord(body.correction)
      ||body.source.visibilitySnapshot!==body.visibilitySnapshot||body.process.visibilitySnapshot!==body.visibilitySnapshot
      ||body.correction.visibilitySnapshot!==body.visibilitySnapshot
      ||typeof body.source.readsetText!=='string'||!digest(body.source.readsetHash)
      ||evidenceHash(body.source.readsetText)!==body.source.readsetHash
      ||body.process.complete!==false||body.process.authority!=='none'
      ||body.process.historyCoverage!=='before_epoch_unknown'||!Array.isArray(body.process.facts)
      ||typeof body.process.factCount!=='number'||!Number.isSafeInteger(body.process.factCount)||body.process.factCount<0
      ||body.process.factCount>1000||!Array.isArray(body.correction.items)
      ||body.correction.complete!==true||body.correction.count!==body.correction.items.length
      ||body.correction.count>1000)return null
    const sourceReceipt={snapshotId:receipt.snapshotId,readsetText:body.source.readsetText,readsetHash:body.source.readsetHash}
    const base=inspectStructuralReadset(expected,sourceReceipt)
    if(base.timeline.status!=='inspected'||!base.timeline.boundedReadComplete)return null
    const sourceBody=JSON.parse(body.source.readsetText) as {sources:{sourceMessageId:string;payloadHash:string;rawPayload:string;messageCode:string}[]}
    const handled=new Set<string>(),blockers:StructuralReadset['correctionContextBlockers']=[]
    let unresolvedConcern=false
    for(const item of body.correction.items){
      if(!isEvidenceRecord(item)||!isEvidenceUuid(item.id)||!isEvidenceUuid(item.sourceMessageId)
        ||!digest(item.sourcePayloadHash)||!digest(item.factsHash)||!isEvidenceRecord(item.facts)
        ||instant(item.capturedAt)===null||instant(item.facts.sourceReceivedAt)===null
        ||!scope(item.facts.scope,expected)||item.facts.owner!=='sealed-z05-concern-v1'
        ||item.facts.sourceMessageId!==item.sourceMessageId||item.facts.sourcePayloadHash!==item.sourcePayloadHash
        ||!boundary(item.facts.oldStop)||!boundary(item.facts.proposedStop))return null
      const source=sourceBody.sources.find(row=>row.sourceMessageId===item.sourceMessageId)
      if(!source||source.messageCode!=='Z05'||source.payloadHash!==item.sourcePayloadHash
        ||item.facts.sourceReceivedAt===null||!same(item.facts.sourceReceivedAt,
          base.timeline.sources.find(row=>row.sourceMessageId===item.sourceMessageId)?.receivedAt)
        ||instant(item.capturedAt)!>instant(expected.cutoffAt)!)return null
      if(item.witnessId===null||item.witnessAt===null){unresolvedConcern=true;continue}
      if(!isEvidenceUuid(item.witnessId)||!digest(item.witnessHash)||item.witnessHash!==item.factsHash
        ||instant(item.witnessAt)===null||instant(item.witnessAt)!>instant(expected.cutoffAt)!)return null
      if(handled.has(item.sourceMessageId))return null
      // The owner only supplies an exact C scope for its supported Z24 wire.
      // A wildcard concern may also describe unsupported Z05 grammar, so
      // retain the raw source's ordinary fail-closed projection.
      if(item.facts.scope.objectId!==null)handled.add(item.sourceMessageId)
      else unresolvedConcern=true
      blockers.push(projectCorrectionContextBlocker({rawC:source.rawPayload,sourceId:item.sourceMessageId as string,
        observedAt:item.capturedAt as string,scope:item.facts.scope,oldStop:item.facts.oldStop,proposedStop:item.facts.proposedStop}))
    }
    const selected=inspectStructuralReadset(expected,sourceReceipt,handled)
    selected.correctionContextBlockers=blockers
    if(unresolvedConcern)selected.unresolvedSources=true
    return {snapshotId:receipt.snapshotId,readsetHash:receipt.readsetHash,source:selected}
  }catch{return null}
}
