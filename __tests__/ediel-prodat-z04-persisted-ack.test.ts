// masterplan: ACK-10, AT-ACK-10
import {expectOwnReferencePair} from './helpers/p16bHold'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {qty} from './fixtures/prodat-register'
import {guideOrderedFixtureRaw as rawFixture} from './helpers/prodatGuideOrderedFixture'
import {source} from './fixtures/prodat-identity'
import {mixedZ04Parts} from './helpers/mixedZ04Fixture'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {createHash} from 'node:crypto'
import {contrlSourceEnvelope} from '@/lib/ediel/contrlEngine'
import {originalRuleWitnessFixture} from './helpers/originalRuleWitnessFixture'
import {withProdatFixtureInsertContext,prodatFixtureSourceRpc} from './helpers/prodatInboundSourceFixture'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'

// The persisted test lane declares test_flag=1. Its physical UNB must carry
// that same indicator, requested technical ACK and explicit transport agency;
// the legal NAD identities remain separate from these synthetic endpoints.
const raw:typeof rawFixture=(body,code='Z04',alphabet=[':', '+', '?', "'"])=>{
 const [component,element,,terminator]=alphabet
 const before=['UNB',`UNOC${component}3`,'S','R',`260917${component}1200`,'I','','23-DDQ-PRODAT'].join(element)+terminator
 const after=['UNB',`UNOC${component}3`,`S${component}ZZ`,`R${component}ZZ`,`260917${component}1200`,'I','','23-DDQ-PRODAT','','1','','1'].join(element)+terminator
 return rawFixture(body,code,alphabet).replace(before,after)
}

// The message writer, ACK builder, canonical ACK gateway and outbox helper are
// real. Only the external database transport and unrelated business adapters
// are replaced. This synthetic adapter does not prove native SQL/RLS constraints;
// the native companion must run in the separate fixed-candidate test phase.
const state=vi.hoisted(()=>({source:null as EdielMessageRow|null,original:null as EdielMessageRow|null,actorActive:true,protectedSourceAvailable:true,syntaxFacetAvailable:true,authorityCalls:[] as {name:string;args:Record<string,unknown>}[],ownerWitnesses:new Map<string,{raw:string;source:string}>(),messages:[] as Record<string,unknown>[],outbox:[] as Record<string,unknown>[],events:[] as Record<string,unknown>[],effects:[] as string[],routeAvailable:true,sourceReads:[] as Record<string,unknown>[],
 messageReads:[] as {columns:string;conditions:Record<string,unknown>;memberships:Record<string,readonly unknown[]>;order:{column:string;ascending:boolean}|null}[]}))
// This declared DB adapter keeps an immutable prospective original separate
// from mutable processor metadata. The synthetic protected syntax port derives
// its declared owner result from the real syntax owner over those exact bytes.
// Missing owner rows remain explicit; this adapter is not native persistence proof.
const fixtureCompany='00000000-0000-4000-8000-000000000002'
const fixtureActor='00000000-0000-4000-8000-000000000009'
const payloadHash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
function storedOriginal():EdielMessageRow {
 if(!state.original){state.source=withProdatFixtureInsertContext(state.source!);state.original=structuredClone(state.source)
  const witness=originalRuleWitnessFixture({profileKey:String(state.original.rule_profile_key),messageProfileId:String(state.original.rule_profile_version_id),rulePackId:String(state.original.canonical_rule_pack_id),sourceHash:String(state.original.rule_pack_checksum)})
  state.original.rule_pack_snapshot={...witness.snapshot,...state.original.rule_pack_snapshot,rulePack:{...witness.snapshot.rulePack,family:'PRODAT'}}
 }
 return state.original
}
function sourcePack(message:EdielMessageRow){return {
 rulePackId:message.canonical_rule_pack_id,messageProfileId:message.rule_profile_version_id,
 profileKey:message.rule_profile_key,version:message.rule_profile_version,sourceHash:message.rule_pack_checksum,
 snapshot:structuredClone(message.rule_pack_snapshot),
}}
function syntaxBasis(){
 const original=storedOriginal(),envelope=contrlSourceEnvelope(original.raw_payload)
 const result=validateEdifactSyntax({...original,status:'received',validation_report:{},syntax_check_status:'not_checked',failure_reason:null})
 return {kind:'technical_syntax_ack',version:1,companyId:original.company_id,environment:original.environment,
  sourceMessageId:original.id,sourceHash:payloadHash(original.raw_payload!),observedAt:original.message_received_at,
  syntaxAssessmentId:'00000000-0000-4000-8000-000000000040',syntaxDecision:result.ok?'accepted':'rejected',
  transportActorId:'00000000-0000-4000-8000-000000000041',transportEdielId:envelope.receiverComponents[0],
  originalUNB:{sender:[...envelope.senderComponents],receiver:[...envelope.receiverComponents],interchangeReference:envelope.interchangeReference,
   uciReference:envelope.uciReference,applicationReference:original.application_reference,testIndicator:envelope.testIndicator}}
}
/** Finite native transport shape derived from actual immutable source and ACK
 * bytes by the real physical correlation reader. No parsed alias selects scope;
 * this model does not prove the native owner, legal facts, locks or RLS. */
function physicalAckScopes(ack:Record<string,unknown>){
 const source=storedOriginal(),result=readPhysicalAckSourceCorrelation(ack as never,source)
 if(result.wholeSourceOutcome){
  const wire=tokenizeEdifact(source.raw_payload),bgm=wire.segments.find(s=>s.tag==='BGM')
  const documentId=segmentComposite(bgm,2,wire.una)[0]
  if(!documentId)throw Error('declared_physical_source_document_required')
  return [{scope:'message',reference:documentId,physicalReference:{documentId},outcome:result.wholeSourceOutcome}]
 }
 if(!result.prodatObjectOutcomes?.length)throw Error('declared_physical_source_object_required')
 return result.prodatObjectOutcomes.map(own=>({scope:'object',reference:String(own.firstLineIndex),
  physicalReference:{lineIndex:own.firstLineIndex,id:own.objectId,li:own.lineItemReference},outcome:own.outcome}))
}
function physicalReceipt(requested:string,ack:Record<string,unknown>){
 const requestedScopes=physicalAckScopes({...ack,raw_payload:requested}),ackScopes=physicalAckScopes(ack)
 return {version:2,requestedPayloadHash:payloadHash(requested),requestedScopes,ackScopes,
  requestedScopesHash:payloadHash(JSON.stringify(requestedScopes)),ackScopesHash:payloadHash(JSON.stringify(ackScopes))}
}
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'configured@example.invalid',host:'smtp.example.invalid',port:465})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>{
 state.authorityCalls.push({name,args:structuredClone(args)})
 if(name==='gridex_actor_has_company_permission'){
  expect(args.p_actor_user_id).toBe(fixtureActor);expect(args.p_company_id).toBe(fixtureCompany)
  return {data:state.actorActive&&['communication.write','communication.read','ediel_testing.write'].includes(String(args.p_permission)),error:null}
 }
 const message=storedOriginal()
 if(name==='ediel_require_source_bytes_available_v1'){
  expect(args).toEqual({p_company_id:fixtureCompany,p_source_message_id:message.id})
  return {data:null,error:state.protectedSourceAvailable&&message.raw_payload?null:new Error('ediel_source_original_bytes_unavailable')}
 }
 if(['gridex_record_prodat_source_validation_v6','gridex_record_source_validation_v1','gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1'].includes(name))return prodatFixtureSourceRpc(name,args)
 if(name==='ediel_probe_source_rule_pack_capture_v1'){
  expect(args).toEqual({p_company_id:fixtureCompany,p_message_id:message.id})
  return state.protectedSourceAvailable?{data:{status:'captured',evidence:sourcePack(message)},error:null}:{data:null,error:new Error('protected original unavailable')}
 }
 if(name==='ediel_read_prodat_mixed_reply_v1'){
  expect(args).toEqual({p_company_id:fixtureCompany,p_source_message_id:message.id,p_actor_user_id:fixtureActor})
  // No sent original, qualified own market object or native commit exists in
  // this held fixture. It must not manufacture ERC100 for the sibling.
  return {data:null,error:null}
 }
 if(name==='ediel_create_outbound_ack_atomic_v1'||name==='ediel_create_outbound_ack_scope_atomic_v2'){
  const draft=args.p_draft as Record<string,unknown>,family=String(args.p_ack_family)
  expect(args).toMatchObject({p_company_id:fixtureCompany,p_environment:message.environment,p_source_message_id:message.id,p_source_payload_hash:payloadHash(message.raw_payload!),p_actor_user_id:fixtureActor})
  if(name==='ediel_create_outbound_ack_atomic_v1')expect(args).toMatchObject({p_sequence_field:null,p_sequence_value:null})
  else{expect(family).toBe('APERAK');expect(args).not.toHaveProperty('p_sequence_field');expect(args).not.toHaveProperty('p_sequence_value')}
  expect(typeof draft.rawPayload).toBe('string')
  for(const key of ['companyId','environment','actorUserId','relatedMessageId','sourceOperationId','canonicalRulePackId','rulePackSnapshot','executionContextSnapshot','customerId','siteId','meteringPointId'])expect(draft).not.toHaveProperty(key)
  if(!state.actorActive||!state.protectedSourceAvailable)return {data:null,error:new Error('protected atomic original unavailable')}
  const tokens=tokenizeEdifact(String(draft.rawPayload)).segments,erc=tokens.filter(t=>t.tag==='ERC')
  const outcome=family==='CONTRL'?syntaxBasis().syntaxDecision==='accepted'?'positive':'negative':erc.length&&erc.every(t=>t.raw==='ERC+100::260')?'positive':'negative'
  expect(args.p_outcome).toBe(outcome)
  if(family==='CONTRL'){expect(state.syntaxFacetAvailable).toBe(true);expect(args.p_common_smtp).toEqual({from:'configured@example.invalid',host:'smtp.example.invalid',port:465})}
  else expect(args.p_common_smtp).toBeNull()
  // Declared atomic DB boundary only. Real source/ACK guide validation already
  // ran above this call; the native companion proves its actual SQL transaction.
  const mapped=Object.fromEntries(Object.entries(draft).map(([key,value])=>[key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value]))
  const ack={...mapped,id:`00000000-0000-4000-8000-${String(state.messages.length+100).padStart(12,'0')}`,company_id:fixtureCompany,environment:message.environment,direction:'outbound',message_standard:'edifact',message_family:family,message_code:family,related_message_id:message.id,source_operation_id:`ediel_ack:${message.id}:${family}:message`,ack_outcome:outcome,status:'draft',test_flag:message.test_flag,created_at:new Date(Date.parse('2026-09-30T12:00:00Z')+state.messages.length).toISOString(),parsed_payload:{...(draft.parsedPayload as Record<string,unknown>),ackOutcome:outcome},customer_id:null,site_id:null,metering_point_id:null}
  Object.assign(ack,{canonical_rule_pack_id:family==='CONTRL'?null:message.canonical_rule_pack_id,
   rule_profile_version_id:family==='CONTRL'?null:message.rule_profile_version_id,
   rule_profile_key:family==='CONTRL'?null:message.rule_profile_key,
   rule_profile_version:family==='CONTRL'?null:message.rule_profile_version,
   rule_pack_checksum:family==='CONTRL'?null:message.rule_pack_checksum,
   rule_pack_snapshot:family==='CONTRL'?null:structuredClone(message.rule_pack_snapshot)})
  const receipt=name==='ediel_create_outbound_ack_scope_atomic_v2'?physicalReceipt(String(draft.rawPayload),ack):{version:1}
  state.messages.push(ack)
  return {data:{...receipt,sourceMessage:structuredClone(message),ackMessage:structuredClone(ack),replayed:false},error:null}
 }
 if(name==='gridex_read_outbound_acks_for_source_v2'){
  expect(args.p_source_message_id).toBe(message.id)
  return {data:{version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,sourceMessageId:message.id,companyId:message.company_id,environment:message.environment,
   sourcePayloadHash:payloadHash(message.raw_payload!),originals:state.messages.filter(ack=>ack.message_family===args.p_ack_family).map(ack=>({status:state.actorActive&&state.protectedSourceAvailable?'qualified':'held',message:structuredClone(ack),payloadHash:payloadHash(String(ack.raw_payload))}))},error:null}
 }
 if(name==='ediel_read_outbound_ack_replay_v1'||name==='ediel_read_outbound_ack_scope_replay_v2'){
  expect(args).toMatchObject({p_company_id:fixtureCompany,p_environment:message.environment,p_source_message_id:message.id,p_actor_user_id:fixtureActor})
  if(!state.actorActive||!state.protectedSourceAvailable)return {data:null,error:new Error('protected original unavailable')}
  const ack=state.messages.find(row=>row.company_id===fixtureCompany&&row.environment===message.environment&&row.direction==='outbound'&&row.related_message_id===message.id&&row.message_family===args.p_ack_family)
  if(!ack)return {data:null,error:null}
  if(args.p_ack_family==='CONTRL'&&!state.syntaxFacetAvailable)return {data:null,error:new Error('ediel_historical_technical_ack_basis_unavailable')}
  const receipt=name==='ediel_read_outbound_ack_scope_replay_v2'?physicalReceipt(String(args.p_ack_raw_payload),ack):{version:1}
  return {data:{...receipt,sourceMessage:structuredClone(message),ackMessage:structuredClone(ack)},error:null}
 }
 if(name==='ediel_read_prodat_common_header_rejection_v1'){
  expect(args).toEqual({p_company_id:fixtureCompany,p_environment:message.environment,p_source_message_id:message.id})
  // These unresolved guide fixtures intentionally have no separately persisted
  // common-family rejection authority. They may diagnose but cannot enqueue it.
  return {data:null,error:new Error('common_header_original_owner_unavailable')}
 }
 if(name==='ediel_read_technical_source_endpoint_v2'){
  expect(args).toEqual({p_source_message_id:message.id,p_actor_user_id:fixtureActor,p_phase:'prepare'})
  if(!state.protectedSourceAvailable)return {data:null,error:new Error('protected original unavailable')}
  const b=syntaxBasis();return {data:{executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,kind:'technical_endpoint_only',companyId:b.companyId,environment:b.environment,sourceMessageId:b.sourceMessageId,sourceHash:b.sourceHash,transportEdielId:b.transportEdielId,originalUNB:b.originalUNB,authorizesBusinessEffect:false},error:null}
 }
 if(name==='ediel_record_technical_syntax_facet_v2'){
  const actual=validateEdifactSyntax({...message,status:'received',validation_report:{},syntax_check_status:'not_checked',failure_reason:null})
  expect(args).toEqual({p_actor_user_id:fixtureActor,p_phase:'prepare',p_company_id:fixtureCompany,p_source_message_id:message.id,p_source_payload_hash:payloadHash(message.raw_payload!),p_facts_text:JSON.stringify({version:1,owner:'canonical-runtime-syntax-v1',syntaxDecision:actual.ok?'accepted':'rejected',reasonCodes:actual.issues.filter(issue=>issue.severity==='error').map(issue=>issue.code)})})
  return state.syntaxFacetAvailable?{data:{assessmentId:syntaxBasis().syntaxAssessmentId},error:null}:{data:null,error:new Error('declared technical commit failure')}
 }
 if(name==='ediel_require_technical_syntax_ack_basis_v2'||name==='ediel_capture_technical_syntax_ack_basis_v2'){
  expect(args).toEqual({p_company_id:fixtureCompany,p_message_id:message.id,p_actor_user_id:fixtureActor,p_phase:'prepare'})
  return state.protectedSourceAvailable&&state.syntaxFacetAvailable?{data:syntaxBasis(),error:null}:
   {data:null,error:new Error('ediel_historical_technical_ack_basis_unavailable')}
 }
 if(name==='ediel_read_technical_syntax_ack_route_v1'){
  expect(args).toEqual({p_company_id:fixtureCompany,p_actor_user_id:fixtureActor,p_source_message_id:message.id,
   p_smtp_from:'configured@example.invalid',p_smtp_host:'smtp.example.invalid',p_smtp_port:465})
  if(!state.routeAvailable)return {data:null,error:new Error('no qualified ACK route')}
  const basis=syntaxBasis(),sender=basis.originalUNB.receiver,receiver=basis.originalUNB.sender
  return {data:{kind:'technical_syntax_ack_route',companyId:fixtureCompany,environment:message.environment,
   sourceMessageId:message.id,sourceHash:basis.sourceHash,authorizesBusinessEffect:false,
   route:{id:'00000000-0000-4000-8000-000000000030',company_id:fixtureCompany,is_active:true},
   routeRuntime:{route_profile_id:'00000000-0000-4000-8000-000000000031',company_id:fixtureCompany,communication_route_id:'00000000-0000-4000-8000-000000000030',environment:message.environment,is_enabled:true},
   senderEdielId:sender[0],senderQualifier:sender[1]||null,senderSubAddress:sender[2]||null,
   receiverEdielId:receiver[0],receiverQualifier:receiver[1]||null,receiverSubAddress:receiver[2]||null,receiverMessageSubAddress:receiver[2]||null,
   applicationReference:basis.originalUNB.applicationReference,senderEmail:'configured@example.invalid',receiverEmail:'counterparty@example.invalid',
   mailbox:'configured@example.invalid',routeKey:'synthetic-configured-technical-route',smtpHost:'smtp.example.invalid',smtpPort:465},error:null}
 }
 if(name==='ediel_prepare_outbound_owner_witness_v1'){
  const input=args.p_input as {companyId:string;environment:string;actorUserId:string;rawPayload:string;relatedMessageId:string;rulePackEvidence:unknown}
  expect(input).toMatchObject({companyId:fixtureCompany,environment:message.environment,actorUserId:fixtureActor,relatedMessageId:message.id})
  expect(input.rulePackEvidence).toEqual(sourcePack(message))
  expect(tokenizeEdifact(input.rawPayload).segments.find(row=>row.tag==='UNH')?.raw).toContain('APERAK:')
  if(!state.actorActive||!state.protectedSourceAvailable)return {data:null,error:new Error('outbound original owner unavailable')}
  const witnessId=`00000000-0000-4000-8000-${String(state.ownerWitnesses.size+50).padStart(12,'0')}`
  state.ownerWitnesses.set(witnessId,{raw:input.rawPayload,source:message.id})
  return {data:{version:1,witnessId,evidence:sourcePack(message)},error:null}
 }
 if(name!=='ediel_read_source_rule_pack_basis_v1')throw Error(`unexpected protected RPC:${name}`)
 expect(args).toEqual({p_company_id:fixtureCompany,p_message_id:message.id})
 state.sourceReads.push({...args})
 return state.protectedSourceAvailable?{data:{version:1,sourceMessage:structuredClone(message),sourceRulePackEvidence:sourcePack(message)},error:null}:
  {data:null,error:new Error('protected original unavailable')}
},from:(table:string)=>{
 if(table==='company_memberships'||table==='user_profiles'){
  const conditions:Record<string,unknown>={};let acceptedRequired=false
  return {select(){return this},eq(key:string,value:unknown){conditions[key]=value;return this},
   not(key:string,operator:string,value:unknown){expect([key,operator,value]).toEqual(['accepted_at','is',null]);acceptedRequired=true;return this},
   maybeSingle:async()=>{
    const row=table==='company_memberships'?{company_id:fixtureCompany,user_id:fixtureActor,status:state.actorActive?'active':'inactive',is_active:state.actorActive,accepted_at:'2026-01-01T00:00:00Z'}:
     {id:fixtureActor,user_status:state.actorActive?'active':'inactive'}
    if(table==='company_memberships')expect(acceptedRequired).toBe(true)
    return {data:Object.entries(conditions).every(([key,value])=>row[key as keyof typeof row]===value)?row:null,error:null}
   }}
 }
 if(table==='ediel_messages')return {insert(row:Record<string,unknown>){return {select(){return {single:async()=>{const witness=state.ownerWitnesses.get(String((row.execution_context_snapshot as {outboundOwnerWitnessId?:string})?.outboundOwnerWitnessId));if(row.message_family==='APERAK'){expect(witness).toEqual({raw:row.raw_payload,source:storedOriginal().id});expect(row.related_message_id).toBe(storedOriginal().id)}const saved={...row,id:`00000000-0000-4000-8000-${String(state.messages.length+100).padStart(12,'0')}`,created_at:new Date(Date.parse('2026-09-30T12:00:00Z')+state.messages.length).toISOString()};state.messages.push(saved);return {data:saved,error:null}}}}}},
   select(columns:string){const conditions:Record<string,unknown>={},memberships:Record<string,readonly unknown[]>={}
    const read={columns,conditions,memberships,order:null as {column:string;ascending:boolean}|null};state.messageReads.push(read)
    const matches=(item:Record<string,unknown>)=>Object.entries(conditions).every(([k,v])=>item[k]===v)&&Object.entries(memberships).every(([k,v])=>v.includes(item[k]))
    return {eq(k:string,v:unknown){conditions[k]=v;return this},in(k:string,v:readonly unknown[]){memberships[k]=[...v];return this},
     async order(column:string,options:{ascending:boolean}){read.order={column,ascending:options.ascending};return {data:state.messages.filter(matches).sort((a,b)=>String(a[column]).localeCompare(String(b[column]))*(options.ascending?1:-1)),error:null}},
     maybeSingle:async()=>({data:state.messages.find(matches)??null,error:null})}
   }}
 if(table==='ediel_message_events')return {insert(row:Record<string,unknown>){return {select(){return {single:async()=>{state.events.push(row);return {data:row,error:null}}}}}}}
 if(table==='ediel_outbox')return {
   upsert(row:Record<string,unknown>,options:{ignoreDuplicates?:boolean}){return {select(){return {maybeSingle:async()=>{const old=state.outbox.find(item=>item.lock_key===row.lock_key);if(old&&options.ignoreDuplicates)return {data:null,error:null};const saved={...row,id:`00000000-0000-4000-8000-${String(state.outbox.length+200).padStart(12,'0')}`};state.outbox.push(saved);return {data:saved,error:null}}}}}},
   select(){const conditions:Record<string,unknown>={};const matches=(item:Record<string,unknown>)=>Object.entries(conditions).every(([k,v])=>item[k]===v);return {eq(k:string,v:unknown){conditions[k]=v;return this},limit:async(count:number)=>({data:state.outbox.filter(matches).slice(0,count),error:null}),maybeSingle:async()=>({data:state.outbox.find(matches)??null,error:null})}},
   update(patch:Record<string,unknown>){const conditions:Record<string,unknown>={};let allowed:string[]=[];return {eq(k:string,v:unknown){conditions[k]=v;return this},in(_k:string,v:string[]){allowed=v;return this},select(){return {maybeSingle:async()=>{const old=state.outbox.find(item=>Object.entries(conditions).every(([k,v])=>item[k]===v)&&allowed.includes(String(item.status)));if(!old)return {data:null,error:null};Object.assign(old,patch);return {data:old,error:null}}}}}},
 }
 throw Error(`unexpected external table ${table}`)
}}}))
vi.mock('@/lib/ediel/db',async original=>{
 const actual=await original<typeof import('@/lib/ediel/db')>()
 return {...actual,getEdielMessageById:async(id:string)=>id===state.source?.id?(storedOriginal(),state.source):state.messages.find(row=>row.id===id)??null,
  updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.source={...state.source!,status:p.status,parsed_payload:p.parsedPayload??{},validation_report:p.validationReport??{}} as EdielMessageRow;return state.source},
  createEdielMessageEvent:async(event:Record<string,unknown>)=>{state.events.push(event);return null},linkEdielMessage:async()=>{state.effects.push('link')},
  listAckMessagesForSource:async({sourceMessageId,ackFamily}:{sourceMessageId:string;ackFamily?:string})=>state.messages.filter(row=>row.related_message_id===sourceMessageId&&(!ackFamily||row.message_family===ackFamily)),
  getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}
})
vi.mock('@/lib/ediel/core/kernelLegacy',async original=>({...await original<Record<string,unknown>>(),resolveCanonicalOutboundContext:async({companyId,environment}:{companyId:string;environment:string})=>{if(!state.routeAvailable)throw Error('no qualified ACK route');return {route:{id:'00000000-0000-4000-8000-000000000030',company_id:companyId,route_name:'synthetic ACK route'},routeRuntime:{route_profile_id:'00000000-0000-4000-8000-000000000031',environment},environment}}}))
vi.mock('@/lib/ediel/rulebook/validator',async original=>{
 const actual=await original<typeof import('@/lib/ediel/rulebook/validator')>()
 return {...actual,validateRulebookMessageWithRegistry:async(input:Parameters<typeof actual.validateRulebookMessageWithRegistry>[0])=>
  // Keep the isolated inbound registry port. ACK send admission uses the real
  // canonical guide and the protected reader's branded frozen source basis.
  input.mode==='send'?actual.validateRulebookMessageWithRegistry(input):
   {issues:[],fieldRuleSource:'registry',rulePackSnapshot:{profileKey:'PRODAT:Z04:L:26.A:r3',profileVersionId:'00000000-0000-4000-8000-000000000032',version:'26.A:r3',checksum:'a'.repeat(64)}}}
})
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async original=>({...await original<Record<string,unknown>>(),resolveCanonicalRulePack:async()=>{const m=storedOriginal(),pack=originalRuleWitnessFixture({profileKey:String(m.rule_profile_key),sourceHash:String(m.rule_pack_checksum),messageProfileId:String(m.rule_profile_version_id),rulePackId:String(m.canonical_rule_pack_id)});return {...pack,originalVersion:pack.version,originalSnapshot:pack.snapshot}}}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',companyId:state.source?.company_id,message:state.source,evidence:{companyId:state.source?.company_id}})}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>{state.effects.push('actor');return null}}))
vi.mock('@/lib/ediel/inbound/inboundFacilityRecognition',()=>({recognizeInboundFacilityData:async()=>{state.effects.push('facility');return null}}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:async()=>null,matchSiteAndCustomerForMeteringPoint:async()=>null,findMatchingSupplierSwitchRequest:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',async original=>({...await original<Record<string,unknown>>(),createOrUpdateInboundProdatCase:async()=>{state.effects.push('case');return null}}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>{state.effects.push('z02')},applyInboundProdatZ14ToMeteringPermission:async()=>{state.effects.push('z14')}}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>{state.effects.push('business')}}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))

import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {classifyCanonicalInboundAck} from '@/lib/ediel/ack/inboundAckOutcome'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatHeaderFieldRejection} from '@/lib/ediel/prodat/prodatHeaderDateRejection'

beforeEach(()=>{state.original=null;state.actorActive=true;state.protectedSourceAvailable=true;state.syntaxFacetAvailable=true;state.authorityCalls=[];state.ownerWitnesses.clear();state.messages=[];state.outbox=[];state.events=[];state.effects=[];state.messageReads=[];state.sourceReads=[];state.routeAvailable=true;state.source={...source(raw(mixedZ04Parts(),'Z04'),'Z04'),company_id:'00000000-0000-4000-8000-000000000002',status:'received',
 canonical_rule_pack_id:'00000000-0000-4000-8000-000000000033',rule_profile_key:'PRODAT:Z04:L:26.A:r3',rule_profile_version_id:'00000000-0000-4000-8000-000000000032',rule_profile_version:'26.A:r3',rule_pack_checksum:'a'.repeat(64),rule_pack_snapshot:{profileKey:'PRODAT:Z04:L:26.A:r3',profileVersionId:'00000000-0000-4000-8000-000000000032',version:'26.A:r3',checksum:'a'.repeat(64)},parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow})
afterEach(()=>{for(const read of state.messageReads.filter(item=>item.order)){
 expect(read.columns).toBe('*')
 expect(read.memberships).toEqual({related_message_id:[state.source!.id],message_family:['CONTRL','APERAK','UTILTS_ERR']})
 expect(read.conditions).toEqual({message_family:expect.stringMatching(/^(CONTRL|APERAK)$/)})
 expect(read.order).toEqual({column:'created_at',ascending:false})
}})

it.each([
 ['missing','BGM++D+9+AB'],
 ['unlisted','BGM+Z99+D+9+AB'],
])('holds a %s field 202 code without common-header or separate syntax owner authority',async(_kind,bgm)=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,message_received_at:'2026-09-28T09:00:00Z',raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB',bgm)} as EdielMessageRow
 state.syntaxFacetAvailable=false
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',policy:null})
 expect(decision.responsePlan.find(item=>item.family==='APERAK')?.applicationErrors).toEqual(expect.arrayContaining([
  expect.objectContaining({fieldCode:'202',ercCode:_kind==='missing'?'41':'42'})]))
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.events).toEqual(expect.arrayContaining([
  expect.objectContaining({payload:expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'})}),
  expect.objectContaining({payload:expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'})}),
 ]))
 const first={messages:state.messages.map(row=>row.id),outbox:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({messages:state.messages.map(row=>row.id),outbox:state.outbox.map(row=>row.lock_key)}).toEqual(first)
 expect(state.effects).toEqual([])
})

it.each([
 ['missing','BGM++D+9+AB','41'],
 ['unlisted','BGM+Z99+D+9+AB','42'],
])('diagnoses %s field 202 but permits only independently qualified syntax CONTRL without common-header authority',async(_kind,bgm,erc)=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,message_received_at:'2026-09-28T09:00:00Z',raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB',bgm)} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',policy:null})
 const errors=decision.responsePlan.find(item=>item.family==='APERAK')?.applicationErrors
 expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:erc,fieldCode:'202',
  prodatOccurrence:expect.objectContaining({scope:'header',messageReference:'M',lineIndex:null}),
  prodatFieldDiagnostic:expect.objectContaining({sourceRule:'PRODAT26A:§2.2:ALL:202'})})]))
 const draft=buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:errors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain(`ERC+${erc}::260`)
 expect(draft.rawPayload).toContain('FTX+AAO++202::260')
 expect(draft.rawPayload).toContain('RFF+ACW:D')
 expect(draft.rawPayload).not.toContain('RFF+Z07:')
 expect(draft.rawPayload).not.toContain('ERC+40::260')
 await expect(createCanonicalAckMessage({actorUserId:'00000000-0000-4000-8000-000000000009',sourceMessage:state.source!,
  ackFamily:'APERAK',outcome:'negative',draft})).rejects.toThrow('ediel_common_header_rejection_basis_required')
 expect(state.messages).toEqual([])
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_202_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:erc,fieldCode:'202',text:'invented'}]}))
  .toThrow('aperak_prodat_header_202_response_unqualified')
 const foreign={...state.source!,raw_payload:state.source!.raw_payload!.replace('UNH+M+','UNH+OTHER+').replace('+M\'UNZ','+OTHER\'UNZ')} as EdielMessageRow
 const foreignErrors=resolveCanonicalRuntimeDecision(foreign).responsePlan.find(item=>item.family==='APERAK')?.applicationErrors
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:foreignErrors}))
  .toThrow('aperak_prodat_header_202_response_unqualified')
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 expect(state.messages).toEqual([expect.objectContaining({message_family:'CONTRL',ack_outcome:'positive',
  company_id:fixtureCompany,environment:state.source!.environment,related_message_id:state.source!.id,
  communication_route_id:'00000000-0000-4000-8000-000000000030',route_profile_id:'00000000-0000-4000-8000-000000000031',
  sender_ediel_id:'R',receiver_ediel_id:'S',canonical_rule_pack_id:null})])
 const contrl=String(state.messages[0].raw_payload)
 expect(contrl).toContain('UCI+I+S:ZZ+R:ZZ+1')
 expect(contrl).not.toContain('ERC+')
 expect(state.outbox).toEqual([expect.objectContaining({company_id:fixtureCompany,environment:state.source!.environment,
  ediel_message_id:state.messages[0].id,source_message_id:state.source!.id,message_family:'CONTRL',ack_outcome:'positive',status:'queued',
  lock_key:`${fixtureCompany}:${state.source!.environment}:ack:${state.messages[0].id}`})])
 expect(state.ownerWitnesses.size).toBe(0)
 expect(state.events).toEqual(expect.arrayContaining([
  expect.objectContaining({payload:expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'})}),
 ]))
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('holds an unresolved field 202 source without a tenant-qualified ACK route',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,message_received_at:'2026-09-28T09:00:00Z',raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z99+D+9+AB')} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
 expect(state.events).toEqual(expect.arrayContaining([
  expect.objectContaining({payload:expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'})}),
  expect.objectContaining({payload:expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'})}),
 ]))
})

it('holds forbidden C002 syntax before application authority or business effects',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04:BOGUS+D+9+AB')} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'rejected',applicationDecision:'not_applicable'})
 expect(decision.issues).toContainEqual(expect.objectContaining({code:'UNSM_ELEMENT_LENGTH_INVALID'}))
 // The bounded field rule still detects its physical defect. The refused
 // full wire cannot mint an application response from that bounded fact.
 expect(prodatHeaderFieldRejection({field:'202',sourceWire:tokenizeEdifact(state.source.raw_payload),errors:[]})).toMatchObject({defect:'invalid',qualified:false})
 const input={actorUserId:fixtureActor,edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','negative']])
 expect(state.outbox).toHaveLength(1)
 expect(state.effects).toEqual([])
 const retained=structuredClone({messages:state.messages,outbox:state.outbox})
 await processInboundEdielMessage(input)
 expect({messages:state.messages,outbox:state.outbox}).toEqual(retained)
 expect(state.effects).toEqual([])
})

it('accepts an ordinary field 202 code and holds a malformed header when the tenant has no ACK route',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04')
 const ordinary={...state.source!,raw_payload:wire} as EdielMessageRow
 expect(prodatHeaderFieldRejection({field:'202',sourceWire:tokenizeEdifact(wire),errors:[]})).toMatchObject({defect:null,qualified:false})
 expect(resolveCanonicalRuntimeDecision(ordinary).applicationDecision).toBe('accepted')
 expectOwnReferencePair([String((buildAperakDraft({sourceMessage:ordinary,outcome:'positive'})).rawPayload)])
 state.source={...state.source!,raw_payload:wire.replace('BGM+Z04+D+9+AB','BGM+Z04:BOGUS+D+9+AB')} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
})

it('rejects invalid optional header 204 as one routed whole-message ACK with stable retry and no business effect',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04+D+7+AB')} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(row=>row.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([expect.objectContaining({fieldCode:'204',ercCode:'42',prodatOccurrence:expect.objectContaining({scope:'header'})})])})
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_204_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'204',text:'invented'}]}))
  .toThrow('aperak_prodat_header_204_response_unqualified')
 const other={...state.source,raw_payload:state.source.raw_payload!.replace('UNH+M+','UNH+OTHER+').replace('+M\'UNZ','+OTHER\'UNZ')} as EdielMessageRow
 const foreign=resolveCanonicalRuntimeDecision(other).responsePlan.find(row=>row.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:foreign})).toThrow('aperak_prodat_header_204_response_unqualified')
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome]),JSON.stringify(state.events)).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(state.messages.every(row=>row.company_id===state.source!.company_id&&row.related_message_id===state.source!.id&&row.communication_route_id==='00000000-0000-4000-8000-000000000030')).toBe(true)
 const aperak=String(state.messages[1].raw_payload)
 expect(aperak).toContain('BGM+++27')
 expect(aperak).toContain('ERC+42::260')
 expect(aperak).toContain('FTX+AAO++204::260')
 expect(aperak).toContain('RFF+ACW:D')
 expect(aperak).not.toContain('RFF+Z07:')
 expect(state.outbox).toHaveLength(2)
 expect(state.outbox.every(row=>row.company_id===state.source!.company_id)).toBe(true)
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('keeps optional missing 204 and documented 9/5 outside header rejection, and holds no-route invalid 204',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04')
 for(const value of ['', '9','5']){
  const candidate=wire.replace('BGM+Z04+D+9+AB',`BGM+Z04+D+${value}+AB`)
  expect(prodatHeaderFieldRejection({field:'204',sourceWire:tokenizeEdifact(candidate),errors:[]})).toMatchObject({defect:null,qualified:false})
  const message={...state.source!,raw_payload:candidate} as EdielMessageRow
  expect(resolveCanonicalRuntimeDecision(message).applicationDecision).toBe('accepted')
  expectOwnReferencePair([String((buildAperakDraft({sourceMessage:message,outcome:'positive'})).rawPayload)])
 }
 state.source={...state.source!,raw_payload:wire.replace('BGM+Z04+D+9+AB','BGM+Z04+D+7+AB')} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
})

it('holds an incomplete two-object BGM34 response without inventing a sibling outcome or changing the physical original',async()=>{
 const original=structuredClone(state.source!)
 const decision=resolveCanonicalRuntimeDecision(state.source!)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan.applicationErrors).toEqual([expect.objectContaining({ercCode:'41',fieldCode:'213',
  prodatOccurrence:expect.objectContaining({objectId:'735123456789012345',registerPosition:2})})])
 expect(() => buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:plan.applicationErrors})).toThrow('APERAK_PRODAT_OBJECT_OUTCOME_MISSING')
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source!.id}
 await processInboundEdielMessage(input)
 // The sibling was never applied by this safe-stop path. A processed BGM34
 // cannot omit its outcome or fabricate success; the real send validator holds it.
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome]),JSON.stringify(state.events)).toEqual([['CONTRL','positive']])
 expect(state.events,JSON.stringify(state.events)).toEqual(expect.arrayContaining([expect.objectContaining({
  message:expect.stringContaining('APERAK_PRODAT_OBJECT_OUTCOME_MISSING'),
  payload:expect.objectContaining({blockedBy:'canonical_inbound_ack_guard',ackFamily:'APERAK',sourceMessageId:original.id}),
 })]))
 expect(state.outbox).toHaveLength(1)
 expect(state.outbox[0]).toMatchObject({status:'queued',company_id:original.company_id,environment:'test',source_message_id:original.id})
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.source).toMatchObject({id:original.id,company_id:original.company_id,direction:original.direction,
  raw_payload:original.raw_payload,message_family:original.message_family,message_code:original.message_code,
  environment:original.environment,test_flag:original.test_flag,sender_ediel_id:original.sender_ediel_id,
  receiver_ediel_id:original.receiver_ediel_id,canonical_rule_pack_id:original.canonical_rule_pack_id,
  rule_profile_version_id:original.rule_profile_version_id,rule_pack_checksum:original.rule_pack_checksum,
  rule_pack_snapshot:original.rule_pack_snapshot})
 expect(state.effects).toEqual(['actor','actor'])
})

it('retains own two-register 213 diagnosis while full APERAK grammar holds the reply',async()=>{
 const parts=mixedZ04Parts(),sibling=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='3')
 state.source={...state.source!,raw_payload:raw(parts.slice(0,sibling),'Z04')} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source!)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const errors=decision.responsePlan.find(item=>item.family==='APERAK')!.applicationErrors
 expect(errors).toEqual([expect.objectContaining({ercCode:'41',fieldCode:'213',
  prodatOccurrence:expect.objectContaining({objectId:'735123456789012345',registerPosition:2,lineItemReference:'CASE-735123456789012345'})})])
 expectOwnReferencePair([String((buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:errors})).rawPayload)])
 const input={actorUserId:fixtureActor,edielMessageId:state.source!.id}
 await processInboundEdielMessage(input)
 // P16B resolved: the own negative APERAK (Z07+LI) is persisted and queued.
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(state.outbox).toHaveLength(2)
 expect(state.events).not.toContainEqual(expect.objectContaining({message:expect.stringContaining('UNSM_MESSAGE_STRUCTURE_INVALID')}))
 const retained=structuredClone({messages:state.messages,outbox:state.outbox})
 await processInboundEdielMessage(input)
 expect({messages:state.messages,outbox:state.outbox}).toEqual(retained)
 expect(state.effects).toEqual(['actor','actor'])
})

it('retains whole-message P-17 diagnosis and sends its own-reference negative reply (P16B resolved)',async()=>{
 const all=mixedZ04Parts(),sibling=all.findIndex(part=>part[0]==='LIN'&&part[1]==='3'),parts=all.slice(0,sibling)
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[second]=[...parts[second].slice(0,1),'4',...parts[second].slice(2)]
 parts.splice(second+1,0,qty('20'),['RFF',['LI','CASE-735123456789012345']],['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'])
 state.source={...state.source!,raw_payload:raw(parts,'Z04')} as EdielMessageRow
 const plan=resolveCanonicalRuntimeDecision(state.source).responsePlan.find(item=>item.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([expect.objectContaining({ercCode:'42',fieldCode:'314'})])})
 expectOwnReferencePair([String((buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:plan.applicationErrors})).rawPayload)])
 const input={actorUserId:fixtureActor,edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(state.messages.map(row=>row.raw_payload).join('')).not.toContain('ERC+100')
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
 const retained=structuredClone({messages:state.messages,outbox:state.outbox})
 await processInboundEdielMessage(input)
 expect({messages:state.messages,outbox:state.outbox}).toEqual(retained)
 expect(state.effects).toEqual([])
})

it('holds both ACKs when the tenant has no qualified outbound route',async()=>{
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source!.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.events.filter(event=>String(event.message).includes('skapades inte')).map(event=>event.payload),JSON.stringify(state.events)).toEqual(expect.arrayContaining([
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'}),
 ]))
 expect(state.effects).toEqual([])
})

it.each(['first LIN 2','duplicate LIN 1'] as const)('retains physical %s diagnosis with the actual full-response gate',defect=>{
 const parts=mixedZ04Parts()
 const index=defect==='first LIN 2'?parts.findIndex(part=>part[0]==='LIN'):parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[index]=[...parts[index].slice(0,1),defect==='first LIN 2'?'2':'1',...parts[index].slice(2)]
 const sourceMessage={...state.source!,raw_payload:raw(parts,'Z04')} as EdielMessageRow
 const plan=resolveCanonicalRuntimeDecision(sourceMessage).responsePlan.find(item=>item.family==='APERAK')!
 expect(plan.applicationErrors).toContainEqual(expect.objectContaining({fieldCode:'314',ercCode:'42'}))
 if(defect==='first LIN 2')expectOwnReferencePair([String((buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:plan.applicationErrors})).rawPayload)])
 else{const draft=buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:plan.applicationErrors});expect(draft.rawPayload).toContain('BGM+++27');expect(draft.rawPayload).toContain('FTX+AAO++314::260')}
})

it('holds a sequence rejection without a source-qualified 314 finding, including a positive shortcut',()=>{
 const parts=mixedZ04Parts()
 const index=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[index]=[...parts[index].slice(0,1),'4',...parts[index].slice(2)]
 const sourceMessage={...state.source!,raw_payload:raw(parts,'Z04')} as EdielMessageRow
 expect(()=>buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'314',text:'invented'}]}))
  .toThrow('aperak_prodat_sequence_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage,outcome:'positive'})).toThrow('aperak_prodat_sequence_response_unqualified')
})

it('does not borrow a qualified 314 finding from another physical object',()=>{
 const own=mixedZ04Parts(),other=mixedZ04Parts()
 for(const parts of [own,other]) {
  const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
  parts[second]=[...parts[second].slice(0,1),'4',...parts[second].slice(2)]
 }
 const second=other.findIndex(part=>part[0]==='LIN'&&part[1]==='4')
 other[second]=[...other[second].slice(0,3),['735123456789012352','','','9'],...other[second].slice(4)]
 const sourceMessage={...state.source!,raw_payload:raw(own,'Z04')} as EdielMessageRow
 const otherMessage={...state.source!,raw_payload:raw(other,'Z04')} as EdielMessageRow
 const otherError=resolveCanonicalRuntimeDecision(otherMessage).responsePlan.find(item=>item.family==='APERAK')!
  .applicationErrors!.find(error=>error.fieldCode==='314')!
 expect(otherError.referenceNumber).toBe('735123456789012352')
 expect(()=>buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:[otherError]}))
  .toThrow('aperak_prodat_sequence_response_unqualified')
})

it.each([['missing','', '41'],['invalid','ZZ','42'],['lowercase','ab','42']] as const)(
 'rejects %s required header 313 as a whole message with a routed, retry-stable ACK and no business effects',async(_defect,value,erc)=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04').replace('BGM+Z04+D+9+AB',`BGM+Z04+D+9${value?`+${value}`:''}`)
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([
  expect.objectContaining({ercCode:erc,fieldCode:'313',prodatOccurrence:expect.objectContaining({scope:'header'})})
 ])})
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 const draft=buildAperakDraft({sourceMessage:state.source,outcome:'negative',applicationErrors:plan.applicationErrors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain('RFF+ACW:D')
 expect(draft.rawPayload).toContain('FTX+AAO++313::260')
 expect(draft.rawPayload).not.toContain('RFF+Z07:')
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome]),JSON.stringify(state.events)).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(state.messages.every(row=>row.company_id===state.source!.company_id&&row.related_message_id===state.source!.id)).toBe(true)
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('does not treat the optional missing Z01 request as a header rejection',()=>{
 const wire=raw(mixedZ04Parts(),'Z01').replace('BGM+Z01+D+9+AB','BGM+Z01+D+9')
 expect(prodatHeaderFieldRejection({field:'313',sourceWire:tokenizeEdifact(wire),errors:[]}))
  .toMatchObject({defect:null,qualified:false,hasHeaderError:false})
 const na=raw(mixedZ04Parts(),'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04+D+9+NA')
 expect(prodatHeaderFieldRejection({field:'313',sourceWire:tokenizeEdifact(na),errors:[]})).toMatchObject({defect:null})
})

it('holds a required 313 rejection without source-bound evidence or a qualified route',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04+D+9')} as EdielMessageRow
 const plan=resolveCanonicalRuntimeDecision(state.source).responsePlan.find(item=>item.family==='APERAK')!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'}))
  .toThrow('aperak_prodat_header_313_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:'41',fieldCode:'313',text:'invented'}]}))
  .toThrow('aperak_prodat_header_313_response_unqualified')
 const other={...state.source!,raw_payload:state.source!.raw_payload!.replace('UNH+M+','UNH+OTHER+').replace('+M\'UNZ','+OTHER\'UNZ')} as EdielMessageRow
 const foreign=resolveCanonicalRuntimeDecision(other).responsePlan.find(item=>item.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:foreign}))
  .toThrow('aperak_prodat_header_313_response_unqualified')
 expect(plan.applicationErrors).toEqual([expect.objectContaining({fieldCode:'313'})])
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
 expect(state.events.filter(event=>String(event.message).includes('skapades inte')).map(event=>event.payload),JSON.stringify(state.events)).toEqual([
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'}),
 ])
})

it('persists one whole-message rejection for missing required header 205, correlated without business effects, and reuses it on retry',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04').replace('DTM+137:202609171200:203\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 const sourceMessage={...state.source!,raw_payload:wire} as EdielMessageRow
 state.source=sourceMessage
 const decision=resolveCanonicalRuntimeDecision(sourceMessage)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([
  expect.objectContaining({ercCode:'41',fieldCode:'205',prodatOccurrence:expect.objectContaining({scope:'header'})})
 ])})
 expect(plan.applicationErrors).toHaveLength(1)
 const draft=buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:plan.applicationErrors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain('FTX+AAO++205::260')
 expect(draft.rawPayload).toContain('RFF+ACW:D')
 expect(draft.rawPayload).not.toContain('RFF+Z07:')
 expect(buildAperakDraft({sourceMessage:{...sourceMessage,message_code:'Z01'},outcome:'negative',applicationErrors:plan.applicationErrors}).rawPayload)
  .toContain('BGM+++27')
 expect(classifyCanonicalInboundAck(parseEdifactPayload(draft.rawPayload!))).toMatchObject({profile:'PRODAT_16_B',outcome:'negative'})
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:sourceMessage.id}
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome]),JSON.stringify(state.events)).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(state.messages.every(row=>row.company_id===sourceMessage.company_id&&row.related_message_id===sourceMessage.id)).toBe(true)
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('does not accept a supplied 205 error or positive ACK as authority for a whole-message response',()=>{
 const sourceMessage=state.source!
 const wire=raw(mixedZ04Parts(),'Z04').replace('DTM+137:202609171200:203\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 const defective={...sourceMessage,raw_payload:wire} as EdielMessageRow
 const plan=resolveCanonicalRuntimeDecision(defective).responsePlan.find(item=>item.family==='APERAK')!
 expect(()=>buildAperakDraft({sourceMessage:defective,outcome:'positive'})).toThrow('aperak_prodat_header_205_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:defective,outcome:'negative',applicationErrors:[{ercCode:'41',fieldCode:'205',text:'invented'}]})).toThrow('aperak_prodat_header_205_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:plan.applicationErrors})).toThrow('aperak_prodat_header_205_response_unqualified')
})

it('rejects a malformed supplied header date as ERC42/205 for the whole P message before business writes',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('DTM+137:202609171200:203','DTM+137:202613171200:203')} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan.applicationErrors).toEqual([expect.objectContaining({ercCode:'42',fieldCode:'205',prodatOccurrence:expect.objectContaining({scope:'header'})})])
 // PostgreSQL jsonb persists object keys in a different order. A source-owned
 // finding must survive that round trip without accepting altered evidence.
 const error=plan.applicationErrors![0]
 if(error.prodatFieldDiagnostic?.kind!=='field' || !error.prodatFieldDiagnostic.failureEvidence) throw Error('expected source-owned field evidence')
 const persistedError={...error,prodatFieldDiagnostic:{...error.prodatFieldDiagnostic,
  failureEvidence:error.prodatFieldDiagnostic.failureEvidence.map(item=>({content:item.content,locator:item.locator,raw:item.raw}))}}
 expect(buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[persistedError]}).rawPayload).toContain('BGM+++27')
 const alteredError={...persistedError,prodatFieldDiagnostic:{...persistedError.prodatFieldDiagnostic,
  failureEvidence:persistedError.prodatFieldDiagnostic.failureEvidence.map(item=>({...item,content:'202614171200'}))}}
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[alteredError]}))
  .toThrow('aperak_prodat_header_205_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_205_response_unqualified')
 const other={...state.source!,raw_payload:state.source.raw_payload!.replace('202613171200','202614171200')} as EdielMessageRow
 const otherError=resolveCanonicalRuntimeDecision(other).responsePlan.find(item=>item.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:otherError}))
  .toThrow('aperak_prodat_header_205_response_unqualified')
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome]),JSON.stringify(state.events)).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(String(state.messages[1].raw_payload)).toContain('FTX+AAO++205::260')
 expect(state.effects).toEqual([])
})

it('rejects a duplicate header date as one whole message before business writes',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04').replace('DTM+137:202609171200:203\'',"DTM+137:202609171200:203'DTM+137:202609181200:203'")
  .replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)+1}+M`)
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages.map(row=>row.message_family)).toEqual(['CONTRL','APERAK'])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(String(state.messages[1].raw_payload)).toContain('FTX+AAO++205::260')
 expect(state.effects).toEqual([])
})

it.each(['missing','invalid'] as const)('rejects %s required header offset 206 as one whole P message before business writes',async defect=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 let wire=raw(parts,'Z04')
 if(defect==='missing') wire=wire.replace('DTM+ZZZ:1:805\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 else wire=wire.replace('DTM+ZZZ:1:805','DTM+ZZZ:2:805')
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan.applicationErrors).toEqual([expect.objectContaining({ercCode:defect==='missing'?'41':'42',fieldCode:'206',prodatOccurrence:expect.objectContaining({scope:'header'})})])
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_206_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:defect==='missing'?'41':'42',fieldCode:'206',text:'invented'}]}))
  .toThrow('aperak_prodat_header_206_response_unqualified')
 const draft=buildAperakDraft({sourceMessage:state.source,outcome:'negative',applicationErrors:plan.applicationErrors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain('FTX+AAO++206::260')
 expect(draft.rawPayload).toContain('RFF+ACW:D')
 expect(draft.rawPayload).not.toContain('RFF+Z07:')
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome]),JSON.stringify(state.events)).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
})

it('holds a header rejection without a qualified tenant ACK route and never enters business processing',async()=>{
 const wire=raw(mixedZ04Parts(),'Z04').replace('DTM+137:202609171200:203\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.events.filter(event=>String(event.message).includes('skapades inte')).map(event=>event.payload),JSON.stringify(state.events)).toEqual([
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'}),
 ])
 expect(state.effects).toEqual([])
})


it('rechecks current tenant membership before any retained ACK/outbox replay effect',async()=>{
 const parts=mixedZ04Parts(),second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04+D+7+AB')} as EdielMessageRow
 const input={actorUserId:fixtureActor,edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>row.message_family)).toEqual(['CONTRL','APERAK'])
 const retained=structuredClone({messages:state.messages,outbox:state.outbox})
 state.actorActive=false
 await processInboundEdielMessage(input)
 expect({messages:state.messages,outbox:state.outbox}).toEqual(retained)
 expect(state.events.filter(row=>String(row.message).includes('ediel_tenant_actor_forbidden')).map(row=>(row.payload as {ackFamily:string}).ackFamily)).toEqual(['CONTRL','CONTRL','APERAK'])
 expect(state.effects).toEqual([])
})

it('a failed actual syntax-owner commit cannot fabricate a technical reply',async()=>{
 state.syntaxFacetAvailable=false
 await processInboundEdielMessage({actorUserId:fixtureActor,edielMessageId:state.source!.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
 expect(state.authorityCalls.some(row=>row.name==='ediel_require_technical_syntax_ack_basis_v2')).toBe(true)
 expect(state.authorityCalls.some(row=>row.name==='ediel_record_technical_syntax_facet_v2')).toBe(true)
 expect(state.authorityCalls.some(row=>row.name==='ediel_capture_technical_syntax_ack_basis_v2')).toBe(false)
})

it('refuses absent protected actual-original authority before any application ACK write',async()=>{
 state.protectedSourceAvailable=false
 await expect(processInboundEdielMessage({actorUserId:fixtureActor,edielMessageId:state.source!.id})).rejects.toThrow('ediel_source_rule_pack_basis_required')
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
 expect(state.ownerWitnesses.size).toBe(0)
 expect(state.authorityCalls.some(row=>row.name==='ediel_probe_source_rule_pack_capture_v1')).toBe(true)
 expect(state.sourceReads).toEqual([])
})
