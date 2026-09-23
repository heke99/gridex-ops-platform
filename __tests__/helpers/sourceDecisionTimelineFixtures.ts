import {ownerSource, ownerId, OWNER} from './sourceOwnerFixtures'
import {tokenizeEdifact, segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

export const timelineScope = {companyId:OWNER.company,environment:'test' as const,cutoffAt:'2026-09-22T12:00:00.000001Z'}
export function timelineFacts(raw=ownerSource().raw_payload!) {
  const tokens=tokenizeEdifact(raw), groups=prodatRegisterGroups(tokens.segments,tokens.una).groups
  const references=new Map<number,string|null>();let index=-1
  for(const t of tokens.segments)if(t.tag==='UNH')references.set(++index,segmentComposite(t,1,tokens.una)[0]||null)
  const objects=new Map<string,{object:Record<string,unknown>;disposition:string;reasons:string[];business:unknown;party:unknown}>()
  for(const g of groups){
    const key=JSON.stringify([g.messageIndex,g.itemId,g.identityAgency,g.itemId?null:g.lineIndex])
    let entry=objects.get(key)
    if(!entry){entry={object:{messageIndex:g.messageIndex,messageReference:references.get(g.messageIndex)??null,objectId:g.itemId,identityAgency:g.identityAgency,registers:[]},disposition:'unavailable',reasons:['source_owner_not_established'],business:null,party:null};objects.set(key,entry)}
    ;(entry.object.registers as unknown[]).push({lineIndex:g.lineIndex,lineNumber:g.lineNumber,registerIndex:g.registerIndex,registerPosition:g.registerPosition,segmentIndex:g.segments[0].index})
  }
  // These are explicitly unavailable observations, NEVER a fabricated accepted owner oracle.
  return {version:1,owner:'received-source-object-decisions-v1',ruleVersion:'1',canonicalFactsHash:evidenceHash('synthetic unavailable canonical facet'),objects:[...objects.values()]}
}
export function timelineAssessment(n=101,previousAssessmentId:string|null=null, overrides:Record<string,unknown>={}) {
  const factsText=JSON.stringify(timelineFacts())
  return {id:ownerId(n),previousAssessmentId,canonicalAssessmentId:ownerId(n+1000),assessedAt:'2026-09-22T11:00:00Z',availableAt:'2026-09-22T11:00:01Z' as string|null,availabilityWitnessId:ownerId(n+2000) as string|null,factsText,factsHash:evidenceHash(factsText),...overrides}
}
export function timelineSource(overrides:Record<string,unknown>={}) {
  const rawPayload=ownerSource().raw_payload!
  return {sourceMessageId:OWNER.source,payloadHash:evidenceHash(rawPayload),rawPayload,receivedAt:'2026-09-22T10:00:00Z' as string|null,capturedAt:'2026-09-22T10:00:00.001Z',messageCode:'Z04' as string|null,assessments:[timelineAssessment()],...overrides}
}
export function timelineBody(sources=[timelineSource()],overrides:Record<string,unknown>={}) {
  return {version:1,...timelineScope,capturedAt:'2026-09-22T12:00:01Z',complete:true,sourceCount:sources.length,historyCoverage:'before_ledger_unknown',ledgerStartedAt:'2026-09-22T08:00:00Z',sources,...overrides}
}
export function timelineReceipt(body=timelineBody()) {
  const readsetText=JSON.stringify(body)
  return {snapshotId:ownerId(9000),readsetText,readsetHash:evidenceHash(readsetText)}
}
export function rewriteTimelineFacts(a:ReturnType<typeof timelineAssessment>, mutate:(facts:ReturnType<typeof timelineFacts>)=>void){
  const facts=JSON.parse(a.factsText) as ReturnType<typeof timelineFacts>;mutate(facts)
  a.factsText=JSON.stringify(facts);a.factsHash=evidenceHash(a.factsText)
}
