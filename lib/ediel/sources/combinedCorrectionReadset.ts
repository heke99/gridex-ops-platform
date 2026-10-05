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
const processTables=new Set(['customer_contract_events','customer_contracts','customer_sites','metering_points',
  'customer_supply_periods','supplier_switch_requests','supplier_switch_events','customer_cases',
  'customer_case_events','customer_operation_jobs','customer_operation_tasks','customer_operation_events'])
function validProcessOwner(value:Record<string,unknown>,companyId:string,cutoffAt:string):boolean{
  const {factCount,gapCount,witnessCount,facts}=value
  if(value.complete!==false||value.authority!=='none'||value.historyCoverage!=='before_epoch_unknown'
    ||value.reason!=='before_epoch_unknown'||!Array.isArray(facts)
    ||![factCount,gapCount,witnessCount].every(count=>typeof count==='number'&&Number.isSafeInteger(count)&&count>=0)
    ||(factCount as number)>1000||(gapCount as number)>(factCount as number)
    ||facts.length+(gapCount as number)!==factCount)return false
  const seen=new Set<number>()
  let witnessed=0
  for(const fact of facts){
    if(!isEvidenceRecord(fact)||typeof fact.id!=='number'||!Number.isSafeInteger(fact.id)||fact.id<=0
      ||seen.has(fact.id)||!processTables.has(String(fact.table))||!isEvidenceUuid(fact.rowId)
      ||!['INSERT','UPDATE','DELETE'].includes(String(fact.operation))
      ||!digest(fact.factsHash)||instant(fact.capturedAt)===null
      ||instant(fact.capturedAt)!>instant(cutoffAt)!
      ||(fact.old!==null&&!isEvidenceRecord(fact.old))
      ||(fact.new!==null&&!isEvidenceRecord(fact.new))
      ||(fact.old===null&&fact.new===null)||fact.gapReason!==null
      ||[fact.old,fact.new].some(side=>isEvidenceRecord(side)
        &&side.company_id!==null&&side.company_id!==undefined&&side.company_id!==companyId))return false
    seen.add(fact.id)
    if(fact.witnessId===null){if(fact.witnessAt!==null)return false}
    else {
      if(!isEvidenceUuid(fact.witnessId)||instant(fact.witnessAt)===null
        ||instant(fact.witnessAt)!>instant(cutoffAt)!)return false
      witnessed++
    }
  }
  return witnessed===witnessCount
}
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
      ||!isEvidenceRecord(body.outbound)||!isEvidenceRecord(body.document)
      ||body.source.visibilitySnapshot!==body.visibilitySnapshot||body.process.visibilitySnapshot!==body.visibilitySnapshot
      ||body.correction.visibilitySnapshot!==body.visibilitySnapshot
      ||body.outbound.visibilitySnapshot!==body.visibilitySnapshot||body.document.visibilitySnapshot!==body.visibilitySnapshot
      ||typeof body.source.readsetText!=='string'||!digest(body.source.readsetHash)
      ||evidenceHash(body.source.readsetText)!==body.source.readsetHash
      ||!validProcessOwner(body.process,expected.companyId,expected.cutoffAt)
      ||!Array.isArray(body.correction.items)
      ||body.correction.complete!==true||body.correction.count!==body.correction.items.length
      ||body.correction.count>1000
      ||body.outbound.complete!==false||body.outbound.authority!=='none'
      ||body.outbound.historyCoverage!=='before_epoch_unknown'||!Array.isArray(body.outbound.originals)
      ||typeof body.outbound.originalCount!=='number'||!Number.isSafeInteger(body.outbound.originalCount)||body.outbound.originalCount<0
      ||body.outbound.originalCount>1000||body.outbound.originalCount!==body.outbound.originals.length
      ||body.document.complete!==false||body.document.authority!=='none'
      ||body.document.historyCoverage!=='before_epoch_unknown'||!Array.isArray(body.document.attempts)
      ||typeof body.document.attemptCount!=='number'||!Number.isSafeInteger(body.document.attemptCount)||body.document.attemptCount<0
      ||body.document.attemptCount>1000||body.document.attemptCount!==body.document.attempts.length)return null
    const sourceReceipt={snapshotId:receipt.snapshotId,readsetText:body.source.readsetText,readsetHash:body.source.readsetHash}
    const base=inspectStructuralReadset(expected,sourceReceipt)
    if(base.timeline.status!=='inspected'||!base.timeline.boundedReadComplete)return null
    const sourceBody=JSON.parse(body.source.readsetText) as {sources:{sourceMessageId:string;payloadHash:string;rawPayload:string;messageCode:string}[]}
    const outboundIds=new Set<string>()
    for(const row of body.outbound.originals){
      if(!isEvidenceRecord(row)||!isEvidenceUuid(row.messageId)||outboundIds.has(row.messageId)
        ||typeof row.rawPayload!=='string'||Buffer.byteLength(row.rawPayload)>262144
        ||typeof row.payloadHash!=='string'||row.payloadHash!==evidenceHash(row.rawPayload)
        ||typeof row.instrumented!=='boolean'||!isEvidenceRecord(row.scope)
        ||!Array.isArray(row.attempts)||!Array.isArray(row.events))return null
      outboundIds.add(row.messageId)
      const attempts=new Set<string>(),events=new Set<string>()
      for(const attempt of row.attempts){
        if(!isEvidenceRecord(attempt)||!isEvidenceUuid(attempt.id)||attempts.has(attempt.id)
          ||!isEvidenceRecord(attempt.owner)||!isEvidenceRecord(attempt.binding)
          ||instant(attempt.createdAt)===null||instant(attempt.createdAt)!>instant(expected.cutoffAt)!)return null
        attempts.add(attempt.id)
      }
      for(const event of row.events){
        if(!isEvidenceRecord(event)||!isEvidenceUuid(event.id)||events.has(event.id)
          ||!isEvidenceUuid(event.attemptId)||!attempts.has(event.attemptId)
          ||typeof event.kind!=='string'||!isEvidenceRecord(event.facts)
          ||instant(event.observedAt)===null||instant(event.observedAt)!>instant(expected.cutoffAt)!
          ||(event.witnessId!==null&&(event.witnessId!==event.id
            ||instant(event.witnessAt)===null||instant(event.witnessAt)!>instant(expected.cutoffAt)!))
          ||(event.witnessId===null&&event.witnessAt!==null))return null
        events.add(event.id)
      }
    }
    const documentIds=new Set<string>()
    for(const row of body.document.attempts){
      if(!isEvidenceRecord(row)||!isEvidenceUuid(row.id)||documentIds.has(row.id)
        ||!isEvidenceUuid(row.sourceMessageId)||!isEvidenceUuid(row.documentId)
        ||!sourceBody.sources.some(source=>source.sourceMessageId===row.sourceMessageId)
        ||!isEvidenceRecord(row.facts)||!digest(row.factsHash)||instant(row.recordedAt)===null
        ||instant(row.recordedAt)!>instant(expected.cutoffAt)!)return null
      documentIds.add(row.id)
      if(row.outcome!==null){
        const outcome=row.outcome
        if(!isEvidenceRecord(outcome)||!isEvidenceUuid(outcome.id)
          ||!['verified_at_observation','unavailable'].includes(String(outcome.status))
          ||!isEvidenceRecord(outcome.observation)||!digest(outcome.factsHash)
          ||instant(outcome.recordedAt)===null||instant(outcome.recordedAt)!>instant(expected.cutoffAt)!
          ||(outcome.witnessId!==null&&(!isEvidenceUuid(outcome.witnessId)
            ||instant(outcome.witnessAt)===null||instant(outcome.witnessAt)!>instant(expected.cutoffAt)!))
          ||(outcome.witnessId===null&&outcome.witnessAt!==null))return null
      }
    }
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
