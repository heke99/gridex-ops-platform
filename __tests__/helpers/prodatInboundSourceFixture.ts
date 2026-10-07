import {createHash} from 'node:crypto'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {originalRuleWitnessFixture} from './originalRuleWitnessFixture'
import {contrlSourceEnvelope} from '@/lib/ediel/contrlEngine'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'

export const PRODAT_FIXTURE_COMPANY='00000000-0000-4000-8000-000000000002'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
const originalWitness=originalRuleWitnessFixture({profileKey:'DECLARED:PRODAT:FIXTURE',messageProfileId:id(32),rulePackId:id(33),sourceHash:'a'.repeat(64)})
const original={...originalWitness,snapshot:{...originalWitness.snapshot,rulePack:{...originalWitness.snapshot.rulePack,family:'PRODAT'}}}
/** Declared synthetic registry transport response; not authentic source approval. */
export const prodatFixtureRegistryResolution={...original,originalVersion:original.version,originalSnapshot:original.snapshot}
const originals=new Map<string,EdielMessageRow>()
const recorded=new Map<string,string>()
const syntaxFacets=new Map<string,string>()
const applicationFacets=new Map<string,Record<string,unknown>>()
const protectedBasis={rulePackId:original.rulePackId,messageProfileId:original.messageProfileId,profileKey:original.profileKey,
 version:original.version,sourceHash:original.sourceHash,snapshot:{...original.snapshot,profileKey:original.profileKey,profileVersionId:original.messageProfileId,
 version:original.version,checksum:original.sourceHash}}

/** Models the prospective protected INSERT context for these unit probes.
 * No persisted report or parsed-payload approval is promoted into authority. */
export function withProdatFixtureInsertContext(row:EdielMessageRow):EdielMessageRow {
 if(typeof row.raw_payload!=='string')throw Error('fixture_raw_required')
 const received='2026-09-20T00:00:00.000000Z'
 const original={...row,company_id:PRODAT_FIXTURE_COMPANY,message_received_at:received,created_at:received,
  execution_context_snapshot:{receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:row.id,
   companyId:PRODAT_FIXTURE_COMPANY,environment:row.environment,messageCode:row.message_code,payloadHash:hash(row.raw_payload),
   sourceReceivedAt:received,capturedAt:received}}} as EdielMessageRow
 originals.set(original.id,structuredClone(original));recorded.delete(original.id)
 syntaxFacets.delete(original.id)
 applicationFacets.delete(original.id)
 return original
}

/** Declared persisted transport result for units that replace the kernel IO.
 * The actual draft builder has already run; every returned pointer uses that
 * source and wire. This provides no native witness or persistence proof. */
export function prodatFixtureAckResult(input:{ackFamily:string;sourceMessage:EdielMessageRow;draft:Record<string,unknown>}){
 const stored=originals.get(input.sourceMessage.id)
 if(!stored||stored.raw_payload!==input.sourceMessage.raw_payload)throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
 return {id:input.ackFamily,status:'sent',company_id:stored.company_id,environment:stored.environment,
  direction:'outbound',message_family:input.ackFamily,related_message_id:stored.id,raw_payload:input.draft.rawPayload}
}

/** Only the named prospective owner ports are modelled. Every response is
 * checked against exact request fields by the real production adapters. */
export function prodatFixtureSourceRpc(name:string,args:Record<string,unknown>) {
 let data:Record<string,unknown>
 const original=originals.get(String(args.p_source_message_id??args.p_message_id)),primary=name==='gridex_record_prodat_source_validation_v6'||name==='gridex_record_source_validation_v1'
 // This declared unit fixture has no immutable ESCO service origin. Model only
 // the named protected READ's explicit unrelated result, never private facts.
 if(name==='gridex_ediel_received_z14_reporting_source_basis_v1'){
  if(!original||original.company_id!==PRODAT_FIXTURE_COMPANY||args.p_actor_user_id!==id(2))throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
  const result=Promise.resolve({data:null,error:null})
  return Object.assign(result,{abortSignal:()=>result})
 }
 if(name==='gridex_actor_has_company_permission')return Promise.resolve({data:args.p_company_id===PRODAT_FIXTURE_COMPANY&&args.p_actor_user_id===id(2)&&['communication.read','communication.write','ediel_testing.write'].includes(String(args.p_permission)),error:null})
 if(primary){
  if(!original||args.p_company_id!==original.company_id||args.p_environment!==original.environment||args.p_source_payload_hash!==hash(original.raw_payload!))throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
  data={version:name==='gridex_record_prodat_source_validation_v6'?6:1,companyId:args.p_company_id,environment:args.p_environment,
   sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,factsHash:hash(String(args.p_facts_text)),sourceDisposition:'not_established',assessmentId:id(34)}
  if(name==='gridex_record_prodat_source_validation_v6')for(const [field,arg]of [['ignoredFieldsHash','p_ignored_fields_text'],['objectFactsHash','p_object_facts_text'],['responseFactsHash','p_response_facts_text'],['applicationFactsHash','p_application_facts_text'],['sourceFunctionFactsHash','p_source_function_facts_text']]as const)data[field]=typeof args[arg]==='string'?hash(args[arg] as string):null
  recorded.set(original.id,hash(original.raw_payload!))
  if(typeof args.p_application_facts_text==='string')applicationFacets.set(original.id,JSON.parse(args.p_application_facts_text))
 }
 else if(name==='ediel_probe_source_rule_pack_capture_v1'){
  if(!original||args.p_company_id!==original.company_id||recorded.get(original.id)!==hash(original.raw_payload!))throw Error('DECLARED_CANONICAL_PRIMARY_REQUIRED')
  data={status:'captured',evidence:protectedBasis}
 }
 else if(name==='ediel_read_source_rule_pack_basis_v1'){
  if(!original||args.p_company_id!==original.company_id||recorded.get(original.id)!==hash(original.raw_payload!))throw Error('DECLARED_CANONICAL_PRIMARY_REQUIRED')
  data={version:1,sourceMessage:structuredClone(original),sourceRulePackEvidence:protectedBasis}
 }
 else if(name==='gridex_read_outbound_acks_for_source_v2'){
  if(!original)throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
  data={version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,sourceMessageId:original.id,companyId:original.company_id,environment:original.environment,sourcePayloadHash:hash(original.raw_payload!),originals:[]}
 }
 else if(name==='ediel_read_prodat_application_objects_v1'){
  const facet=original&&applicationFacets.get(original.id)
  if(!original||args.p_company_id!==original.company_id||!facet||facet.sourcePayloadHash!==hash(original.raw_payload!))throw Error('DECLARED_CANONICAL_APPLICATION_REQUIRED')
  data={...structuredClone(facet),assessmentId:id(34)}
 }
 else if(name==='ediel_read_technical_source_endpoint_v2'){
  if(!original)throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
  const envelope=contrlSourceEnvelope(original.raw_payload)
  data={executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,kind:'technical_endpoint_only',companyId:original.company_id,environment:original.environment,sourceMessageId:original.id,sourceHash:hash(original.raw_payload!),transportEdielId:envelope.receiverComponents[0],authorizesBusinessEffect:false,
   originalUNB:{sender:envelope.senderComponents,receiver:envelope.receiverComponents,interchangeReference:envelope.interchangeReference,uciReference:envelope.uciReference,applicationReference:original.application_reference,testIndicator:envelope.testIndicator}}
 }
 else if(name==='ediel_record_technical_syntax_facet_v2'){
  if(!original||args.p_source_payload_hash!==hash(original.raw_payload!))throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
  const syntax=validateEdifactSyntax({...original,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null})
  if(args.p_facts_text!==JSON.stringify({version:1,owner:'canonical-runtime-syntax-v1',syntaxDecision:syntax.ok?'accepted':'rejected',reasonCodes:syntax.issues.filter(i=>i.severity==='error').map(i=>i.code)}))throw Error('DECLARED_ACTUAL_SYNTAX_REQUIRED')
  syntaxFacets.set(original.id,String(args.p_facts_text))
  data={assessmentId:id(40)}
 }
 else if(name==='ediel_require_technical_syntax_ack_basis_v2'||name==='ediel_capture_technical_syntax_ack_basis_v2'){
  if(!original||args.p_company_id!==original.company_id||!syntaxFacets.has(original.id))throw Error('DECLARED_ACTUAL_SYNTAX_REQUIRED')
  const e=contrlSourceEnvelope(original.raw_payload),syntax=JSON.parse(syntaxFacets.get(original.id)!)
  data={kind:'technical_syntax_ack',version:1,companyId:original.company_id,environment:original.environment,sourceMessageId:original.id,sourceHash:hash(original.raw_payload!),observedAt:original.message_received_at,syntaxAssessmentId:id(40),syntaxDecision:syntax.syntaxDecision,transportActorId:id(41),transportEdielId:e.receiverComponents[0],originalUNB:{sender:e.senderComponents,receiver:e.receiverComponents,interchangeReference:e.interchangeReference,uciReference:e.uciReference,applicationReference:original.application_reference,testIndicator:e.testIndicator}}
 }
 else if(name==='ediel_read_technical_syntax_ack_route_v1'){
  if(!original||args.p_company_id!==original.company_id||args.p_actor_user_id!==id(2)||!syntaxFacets.has(original.id))throw Error('DECLARED_ACTUAL_SYNTAX_REQUIRED')
  const e=contrlSourceEnvelope(original.raw_payload),sender=e.receiverComponents,receiver=e.senderComponents
  data={kind:'technical_syntax_ack_route',companyId:original.company_id,environment:original.environment,sourceMessageId:original.id,sourceHash:hash(original.raw_payload!),authorizesBusinessEffect:false,route:{id:id(42),company_id:original.company_id,is_active:true},routeRuntime:{id:id(43),company_id:original.company_id,communication_route_id:id(42),environment:original.environment,is_enabled:true},senderEdielId:sender[0],senderQualifier:sender[1]||null,senderSubAddress:sender[2]||null,receiverEdielId:receiver[0],receiverQualifier:receiver[1]||null,receiverSubAddress:receiver[2]||null,receiverMessageSubAddress:receiver[2]||null,applicationReference:original.application_reference,senderEmail:args.p_smtp_from,receiverEmail:'synthetic@example.invalid',mailbox:args.p_smtp_from,routeKey:'finite syntax fixture',smtpHost:args.p_smtp_host,smtpPort:args.p_smtp_port}
 }
 else if(name==='ediel_list_business_acks_for_source_v1'){
  // Declared native list: same company/source scope, no prior business ACKs.
  if(!original||args.p_company_id!==original.company_id||args.p_source_message_id!==original.id||!args.p_actor_user_id)throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
  data={version:1,companyId:original.company_id,sourceMessageId:original.id,environment:original.environment,ackFamily:args.p_ack_family??null,messages:[]}
 }
 else if(name==='ediel_apply_permission_source_v1'){
  // The native permission executor is out of unit scope: it reports no effect
  // rather than fabricating an applied permission state.
  if(!original||args.p_company_id!==original.company_id||args.p_source_message_id!==original.id||!args.p_actor_user_id)throw Error('DECLARED_SOURCE_ORIGINAL_REQUIRED')
  data={applied:false,permissionId:null,status:null,reason:'declared_unit_fixture_native_permission_effect_out_of_scope',idempotent:false}
 }
 else if(name==='gridex_record_source_object_decisions_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,
  sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,canonicalAssessmentId:args.p_canonical_assessment_id,
  factsHash:hash(String(args.p_facts_text)),assessmentId:id(35)}
 else if(name==='gridex_witness_source_objects_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,
  assessmentId:args.p_assessment_id,factsHash:args.p_facts_hash,witnessId:id(36),availableAt:new Date().toISOString()}
 else throw Error(`UNEXPECTED_SOURCE_RPC:${name}`)
 const result=Promise.resolve({data,error:null})
 return Object.assign(result,{abortSignal:()=>result})
}

/** Finite current membership/profile IO; native permission results are scoped
 * to the same explicit unit actor. This does not establish native RBAC proof. */
export const prodatFixtureSourceDatabase={rpc:prodatFixtureSourceRpc,from:(table:string)=>{
 if(!['company_memberships','user_profiles'].includes(table))throw Error(`UNEXPECTED_FIXTURE_TABLE:${table}`)
 const row=table==='user_profiles'?{id:id(2),user_status:'active'}:{company_id:PRODAT_FIXTURE_COMPANY,user_id:id(2),status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}
 const filters:Record<string,unknown>={}
 const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q},not:()=>q,maybeSingle:async()=>({data:Object.entries(filters).every(([key,value])=>row[key as keyof typeof row]===value)?row:null,error:null})}
 return q
}}
