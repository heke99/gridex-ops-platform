// Real national application diagnostics, preparation, rendering and physical
// correlation run here. Database identity/original reads are declared IO only.
import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {prodatAckObjectScopes} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import {prepareSourceAckDraft} from '@/lib/ediel/ack/prepareSourceAckDraft'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {findExistingAckForSource} from '@/lib/ediel/core/ackPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({source:{} as EdielMessageRow,originals:[] as EdielMessageRow[],reads:0}))
const company='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000050'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 rpc:async(name:string,args:Record<string,unknown>)=>{
  if(name==='gridex_actor_has_company_permission')return {data:args.p_company_id===company&&args.p_actor_user_id===actor&&args.p_permission==='communication.write',error:null}
  if(name!=='gridex_read_outbound_acks_for_source_v2')throw Error('UNEXPECTED_NATIVE_PORT:'+name)
  io.reads++;expect(args).toEqual({p_source_message_id:io.source.id,p_ack_family:'APERAK',p_actor_user_id:actor,p_phase:expect.stringMatching(/^(prepare|read)$/)})
  return {data:{version:2,executionActorUserId:actor,executionPhase:args.p_phase,sourceMessageId:io.source.id,sourcePayloadHash:createHash('sha256').update(io.source.raw_payload!).digest('hex'),companyId:company,environment:'test',
   originals:io.originals.map(message=>({status:'qualified',message,payloadHash:createHash('sha256').update(message.raw_payload!).digest('hex')}))},error:null}
 },
 from:(table:string)=>{const q={select:()=>q,eq:()=>q,not:()=>q,maybeSingle:async()=>({error:null,data:table==='company_memberships'
  ?{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}:{id:actor,user_status:'active'}})};return q}
}}))

function source(reason='Z96',identity='',duplicateLi=false,alternate=false){
 const body=(n:string,status:string)=>[`LIN+${n}${identity?'++'+identity:''}`,'CCI++Z13',`CAV+${reason}`,'CCI++Z23',`CAV+${status}`,`RFF+LI:REQUEST-${duplicateLi?'1':n}`]
 const rawPayload=EdifactEnvelopeCodec.encode({sender:'12345',senderQualifier:'14',receiver:'54321',receiverQualifier:'14',environment:'test',applicationReference:'23-DGI-PRODAT',interchangeReference:'SOURCE',acknowledgementRequest:true,createdAt:new Date('2026-09-30T12:00:00Z'),
  ...(alternate?{una:{componentDataElementSeparator:';',dataElementSeparator:'*',releaseCharacter:'?',segmentTerminator:'!'}}:{}),
  messages:[{messageReference:'M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:['BGM+Z14+D+9+AB','DTM+137:202609301200:203','DTM+ZZZ:1:805',
   'NAD+FR+12345:160:SVK+++++++SE','NAD+DO+54321:160:SVK+++++++SE',...body('1','A76'),...body('2','INVALID')]}]})
 return {id:'00000000-0000-4000-8000-000000000001',company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z14',
  raw_payload:rawPayload,message_received_at:'2026-09-30T12:00:00Z',created_at:'2026-09-30T12:00:00Z',status:'received',sender_ediel_id:'12345',receiver_ediel_id:'54321',
  application_reference:'23-DGI-PRODAT',parsed_payload:{},validation_report:{}} as EdielMessageRow
}
function errors(message:EdielMessageRow){return resolveCanonicalRuntimeDecision(message).responsePlan.flatMap(plan=>plan.applicationErrors??[]).filter(error=>error.fieldCode==='322')}
function own(message=io.source){const wire=tokenizeEdifact(message.raw_payload!);return {objectId:null,identityAgency:null,
 firstLineIndex:wire.segments.filter(segment=>segment.tag==='LIN')[1].index,lineItemReference:'REQUEST-2'}}
beforeEach(()=>{io.source=source();io.originals=[];io.reads=0})

it.each([false,true])('a genuine own N322 diagnostic prepares and renders only its nullable physical LIN/LI scope (alternate UNA %s)',async alternate=>{
 io.source=source('Z96','',false,alternate)
 const applicationErrors=errors(io.source)
 expect(applicationErrors).toMatchObject([{ercCode:'42',fieldCode:'322',referenceNumber:null,referenceQualifier:null,lineItemReference:'REQUEST-2'}])
 expect(prodatAckObjectScopes({sourceWire:tokenizeEdifact(io.source.raw_payload!),messageCode:'Z14',outcome:'negative',applicationErrors})).toEqual([own()])
 const prepared=await prepareSourceAckDraft({actorUserId:actor,sourceMessage:io.source,ackFamily:'APERAK',outcome:'negative',applicationErrors})
 expect(prepared.kind).toBe('draft');if(prepared.kind!=='draft')return
 expect(prepared.draft.parsedPayload?.ackScope).toBe('object')
 const wire=tokenizeEdifact(prepared.draft.rawPayload!),refs=wire.segments.filter(segment=>segment.tag==='RFF').map(segment=>segmentComposite(segment,1,wire.una))
 expect(refs).toContainEqual(['LI','REQUEST-2']);expect(refs.some(ref=>ref[0]==='Z07'||ref[1]==='REQUEST-1')).toBe(false)
 const ack={...io.source,id:'00000000-0000-4000-8000-000000000088',direction:'outbound',message_family:'APERAK',raw_payload:prepared.draft.rawPayload} as EdielMessageRow
 expect(readPhysicalAckSourceCorrelation(ack,io.source).prodatObjectOutcomes).toEqual([{...own(),outcome:'negative'}])
})
it('retains an old failed physical negative before fresh rendering, preserving its exact nullable tuple',async()=>{
 const applicationErrors=errors(io.source),draft=await prepareSourceAckDraft({actorUserId:actor,sourceMessage:io.source,ackFamily:'APERAK',outcome:'negative',applicationErrors})
 if(draft.kind!=='draft')throw Error('expected real draft')
 const retained={...io.source,id:'00000000-0000-4000-8000-000000000088',direction:'outbound',message_family:'APERAK',raw_payload:draft.draft.rawPayload,status:'failed',ack_outcome:'positive'} as EdielMessageRow
 io.originals=[retained]
 expect(await prepareSourceAckDraft({actorUserId:actor,sourceMessage:io.source,ackFamily:'APERAK',outcome:'negative',applicationErrors})).toMatchObject({kind:'existing',message:{id:retained.id,status:'failed',raw_payload:retained.raw_payload,ack_outcome:'negative'}})
 await expect(prepareSourceAckDraft({actorUserId:actor,sourceMessage:io.source,ackFamily:'APERAK',outcome:'positive',relatedTransactionReference:'REQUEST-2'})).rejects.toThrow('blocked_final_ack_exists')
 const input={actorUserId:actor,phase:'read' as const,sourceMessageId:io.source.id,ackFamily:'APERAK' as const,ackScope:'object' as const,expectedSource:io.source}
 expect(await findExistingAckForSource({...input,acknowledgedProdatObjects:[{...own(),firstLineIndex:own().firstLineIndex-1}]})).toBeNull()
 expect(await findExistingAckForSource({...input,acknowledgedProdatObjects:[{...own(),lineItemReference:'REQUEST-1'}]})).toBeNull()
})
it('distinct omitted identities retain their own physical indices rather than becoming one null object',()=>{
 // The actual validator owns both independent received invalid status values.
 const both=source();both.raw_payload=both.raw_payload!.replace('CAV+A76','CAV+INVALID')
 const scopes=prodatAckObjectScopes({sourceWire:tokenizeEdifact(both.raw_payload!),messageCode:'Z14',outcome:'negative',applicationErrors:errors(both)})
 expect(scopes.map(scope=>[scope.objectId,scope.identityAgency,scope.lineItemReference])).toEqual([[null,null,'REQUEST-1'],[null,null,'REQUEST-2']])
 expect(new Set(scopes.map(scope=>scope.firstLineIndex)).size).toBe(2)
})
it.each([['forbidden reason','S17',''],['partial identity','Z96',':::9'],['register chain','Z96','']])('holds %s instead of borrowing valid omission scope',(_title,reason,identity)=>{
 const message=source(reason,identity)
 if(_title==='register chain')message.raw_payload=message.raw_payload!.replace('LIN+2','LIN+2+++1:1')
 const applicationErrors=errors(message);expect(applicationErrors.length).toBeGreaterThan(0)
 expect(()=>prodatAckObjectScopes({sourceWire:tokenizeEdifact(message.raw_payload!),messageCode:'Z14',outcome:'negative',applicationErrors})).toThrow('requested_scope_unqualified')
})
it('holds duplicate own LI and forged sibling occurrence rather than selecting a null identity',()=>{
 const duplicated=source('Z96','',true)
 expect(()=>prodatAckObjectScopes({sourceWire:tokenizeEdifact(duplicated.raw_payload!),messageCode:'Z14',outcome:'negative',applicationErrors:errors(duplicated)})).toThrow('requested_scope_unqualified')
 const applicationErrors=errors(io.source),error=applicationErrors[0]
 expect(()=>prodatAckObjectScopes({sourceWire:tokenizeEdifact(io.source.raw_payload!),messageCode:'Z14',outcome:'negative',applicationErrors:[{...error,prodatOccurrence:{...error.prodatOccurrence!,lineIndex:0}}]})).toThrow('requested_scope_unqualified')
})
