import {createHash} from 'node:crypto'
import {expect,it} from 'vitest'
import {closureFixture} from './helpers/closureWireFixtures'
import {inspectCombinedCorrectionReadset} from '@/lib/ediel/sources/combinedCorrectionReadset'

const company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const message='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const sourceId='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const witness='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const cutoff='2026-10-20T00:00:00Z'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const expected={companyId:company,environment:'test' as const,cutoffAt:cutoff}
function receipt(change?:(body:Record<string,unknown>)=>void){
 const rawPayload=closureFixture({reason:'Z24'}).wire
 const source={version:1,companyId:company,environment:'test',cutoffAt:cutoff,capturedAt:cutoff,
  complete:true,sourceCount:1,historyCoverage:'before_ledger_unknown',ledgerStartedAt:'2026-09-22T00:00:00Z',
  sources:[{sourceMessageId:sourceId,payloadHash:hash(rawPayload),rawPayload,
   receivedAt:'2026-10-01T00:00:00Z',capturedAt:'2026-10-01T00:00:01Z',messageCode:'Z05',assessments:[]}]}
 const readsetText=JSON.stringify(source)
 const facts={owner:'sealed-z05-concern-v1',sourceMessageId:sourceId,sourcePayloadHash:hash(rawPayload),
  sourceReceivedAt:'2026-10-01T00:00:00Z',scope:{companyId:company,environment:'test',customerId:null,
   supplyPeriodId:null,objectId:'735123456789012345',identityAgency:'9',legalSender:'12345',legalReceiver:'54321'},
  oldStop:{kind:'unknown'},proposedStop:{kind:'not_asserted'}}
 const body:Record<string,unknown>={version:1,companyId:company,environment:'test',subjectMessageId:message,
  cutoffAt:cutoff,visibilitySnapshot:'1:2:',source:{readsetText,readsetHash:hash(readsetText),visibilitySnapshot:'1:2:'},
  process:{complete:false,authority:'none',historyCoverage:'before_epoch_unknown',factCount:0,facts:[],visibilitySnapshot:'1:2:'},
  correction:{complete:true,count:1,items:[{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',sourceMessageId:sourceId,
   sourcePayloadHash:hash(rawPayload),factsHash:hash('synthetic'),facts,capturedAt:'2026-10-01T00:00:02Z',
   witnessId:witness,witnessHash:hash('synthetic'),witnessAt:'2026-10-01T00:00:03Z'}],visibilitySnapshot:'1:2:'},
  outbound:{complete:false,authority:'none',historyCoverage:'before_epoch_unknown',originalCount:0,originals:[],visibilitySnapshot:'1:2:'},
  document:{complete:false,authority:'none',historyCoverage:'before_epoch_unknown',attemptCount:0,attempts:[],visibilitySnapshot:'1:2:'}}
 change?.(body)
 const serialized=JSON.stringify(body)
 return {snapshotId:'ffffffff-ffff-4fff-8fff-ffffffffffff',readsetText:serialized,readsetHash:hash(serialized)}
}
it('projects a witnessed raw C as a scoped hold from its exact source in the combined snapshot',()=>{
 const inspected=inspectCombinedCorrectionReadset(expected,message,receipt())
 expect(inspected?.source.timeline.status).toBe('inspected')
 expect(inspected?.source.unresolvedSources).toBe(false)
 expect(inspected?.source.closures).toEqual([])
 expect(inspected?.source.correctionContextBlockers).toMatchObject([{sourceId,lowerBoundUtc:null,
  scope:{companyId:company,objectId:'735123456789012345'}}])
})
it('holds a missing witness without treating the raw C as a scoped exclusion',()=>{
 const r=receipt(body=>{const correction=body.correction as {items:{witnessId:string|null;witnessAt:string|null}[]}
  correction.items[0].witnessId=null;correction.items[0].witnessAt=null})
 const inspected=inspectCombinedCorrectionReadset(expected,message,r)
 expect(inspected?.source.correctionContextBlockers).toEqual([])
 expect(inspected?.source.unresolvedSources).toBe(true)
})
it('keeps an unsupported wildcard Z05 visible even if its concern has a witness',()=>{
 const r=receipt(body=>{const correction=body.correction as {items:{facts:{scope:{objectId:string|null}}}[]}
  correction.items[0].facts.scope.objectId=null})
 const inspected=inspectCombinedCorrectionReadset(expected,message,r)
 expect(inspected?.source.correctionContextBlockers).toMatchObject([{scope:{objectId:null},lowerBoundUtc:null}])
 expect(inspected?.source.unresolvedSources).toBe(true)
})
it('rejects mismatched visibility, source hash, tenant and subject without releasing comparison',()=>{
 for(const change of [
  (b:Record<string,unknown>)=>{b.visibilitySnapshot='different'},
  (b:Record<string,unknown>)=>{b.companyId='00000000-0000-4000-8000-000000000000'},
  (b:Record<string,unknown>)=>{b.subjectMessageId='00000000-0000-4000-8000-000000000000'},
  (b:Record<string,unknown>)=>{(b.source as {readsetHash:string}).readsetHash='0'.repeat(64)},
  (b:Record<string,unknown>)=>{(b.correction as {items:{sourcePayloadHash:string}[]}).items[0].sourcePayloadHash='0'.repeat(64)},
  (b:Record<string,unknown>)=>{(b.outbound as {visibilitySnapshot:string}).visibilitySnapshot='different'},
  (b:Record<string,unknown>)=>{(b.document as {attemptCount:number}).attemptCount=1},
 ])expect(inspectCombinedCorrectionReadset(expected,message,receipt(change))).toBeNull()
})
it('rejects inconsistent populated outbound and document owner relationships',()=>{
 const outboundId='11111111-1111-4111-8111-111111111111'
 const attemptId='22222222-2222-4222-8222-222222222222'
 const eventId='33333333-3333-4333-8333-333333333333'
 const documentId='44444444-4444-4444-8444-444444444444'
 const populated=(mutate?:(body:Record<string,unknown>)=>void)=>receipt(body=>{
  const outbound=body.outbound as {originalCount:number;originals:unknown[]}
  outbound.originalCount=1
  outbound.originals=[{messageId:outboundId,instrumented:true,rawPayload:'Z08 original',payloadHash:hash('Z08 original'),scope:{point:'735123456789012345'},
   attempts:[{id:attemptId,owner:{kind:'direct'},binding:{},createdAt:'2026-10-01T00:00:04Z'}],
   events:[{id:eventId,attemptId,kind:'provider_result',facts:{classification:'accepted'},observedAt:'2026-10-01T00:00:05Z',witnessId:eventId,witnessAt:'2026-10-01T00:00:06Z'}]}]
  const document=body.document as {attemptCount:number;attempts:unknown[]}
  document.attemptCount=1
  document.attempts=[{id:documentId,sourceMessageId:sourceId,documentId,predecessorId:null,
   facts:{owner:'context_document_reference_v1'},factsHash:hash('document'),recordedAt:'2026-10-01T00:00:07Z',
   outcome:{id:'55555555-5555-4555-8555-555555555555',status:'verified_at_observation',
    observation:{sha256:hash('PDF')},factsHash:hash('outcome'),recordedAt:'2026-10-01T00:00:08Z',
    witnessId:'66666666-6666-4666-8666-666666666666',witnessAt:'2026-10-01T00:00:09Z'}}]
  mutate?.(body)
 })
 const inspected=inspectCombinedCorrectionReadset(expected,message,populated())
 expect(inspected?.source.correctionContextBlockers).toHaveLength(1)
 for(const mutate of [
  (body:Record<string,unknown>)=>{const row=(body.outbound as {originals:{events:{attemptId:string}[]}[]}).originals[0];row.events[0].attemptId=sourceId},
  (body:Record<string,unknown>)=>{const row=(body.outbound as {originals:{events:{witnessAt:string}[]}[]}).originals[0];row.events[0].witnessAt='2026-10-21T00:00:00Z'},
  (body:Record<string,unknown>)=>{const row=(body.document as {attempts:{outcome:{factsHash:string}}[]}).attempts[0];row.outcome.factsHash='bad'},
  (body:Record<string,unknown>)=>{const row=(body.document as {attempts:{outcome:{witnessAt:string}}[]}).attempts[0];row.outcome.witnessAt='2026-10-21T00:00:00Z'},
 ])expect(inspectCombinedCorrectionReadset(expected,message,populated(mutate))).toBeNull()
})
