import {parseSourceReceiptInstant as instant} from '@/lib/ediel/utilts/receivedSourceInventory'

export type CorrectionScopeV1={
  companyId:string;environment:'test'|'production';customerId:string|null;objectId:string|null;
  identityAgency:string|null;legalSender:string|null;legalReceiver:string|null;supplyPeriodId:string|null
}
export type BoundaryObservation={kind:'known';utc:string}|{kind:'not_asserted'}|{kind:'unknown'}
export type CorrectionContextBlockerV1={
  version:1;sourceId:string;observedAt:string;scope:CorrectionScopeV1;
  oldStop:BoundaryObservation;proposedStop:BoundaryObservation;lowerBoundUtc:string|null;reason:string
}

function identifier(value:unknown):value is string{
  return typeof value==='string'&&value.length>0&&value.length<=128&&value.trim()===value
    &&Array.from(value).every(char=>{const code=char.codePointAt(0)!;return code>=32&&code!==127&&!(code>=0xd800&&code<=0xdfff)})
}
function observation(value:BoundaryObservation):void{
  if(value?.kind==='known'&&instant(value.utc)!==null)return
  if(value?.kind==='unknown'||value?.kind==='not_asserted')return
  throw new TypeError('invalid correction boundary observation')
}

/** A received correction concern is only a hold hint. It cannot authorize a
 * closure or prove a proposed stop. Unknown earlier candidates defeat a safe
 * lower bound, including when the other candidate has a known date. */
export function projectCorrectionContextBlocker(input:{rawC:string|null;oldStop:BoundaryObservation;proposedStop:BoundaryObservation;
  observedAt:string;sourceId:string;scope:CorrectionScopeV1}):CorrectionContextBlockerV1{
  if(!identifier(input.sourceId)||instant(input.observedAt)===null||
    (input.rawC!==null&&(typeof input.rawC!=='string'||input.rawC.length>256*1024)))
    throw new TypeError('invalid correction context receipt')
  const scope=input.scope
  if(!scope||!identifier(scope.companyId)||!['test','production'].includes(scope.environment)
    ||!(['customerId','objectId','identityAgency','legalSender','legalReceiver','supplyPeriodId'] as const)
      .every(key=>scope[key]===null||identifier(scope[key])))throw new TypeError('invalid correction scope')
  observation(input.oldStop);observation(input.proposedStop)
  const candidates=[input.oldStop,input.proposedStop]
  const known=candidates.filter((candidate):candidate is Extract<BoundaryObservation,{kind:'known'}>=>candidate.kind==='known')
  const lowerBoundUtc=candidates.some(candidate=>candidate.kind==='unknown')||known.length===0?null:
    known.reduce((earliest,candidate)=>instant(candidate.utc)!<instant(earliest)!?candidate.utc:earliest,known[0].utc)
  return {version:1,sourceId:input.sourceId,observedAt:input.observedAt,scope:{...scope},
    oldStop:{...input.oldStop},proposedStop:{...input.proposedStop},lowerBoundUtc,reason:'correction_context_unconfirmed'}
}
