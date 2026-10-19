// masterplan: OPS-04, AT-OPS-04
// Declared finite UNIT session/SDK/email-I/O ports only; no real backend or mail.
// Real controller, readiness, lexical sender, registry/route and journal guards.
// MIME archive identifiers below are synthetic UNIT data, not genuine archive proof.
// Ported from donor 2314f603d (codex/final-C-ops04-controlled-send-main6ce-20261015)
// and adapted: the caller supplies only message id, incident id, actor and plan;
// correction, agreement, mandate and relay evidence come from the finite native
// OPS-04 RPC ports below (probe, evidence, single-use consumption).
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createHash,randomUUID} from 'node:crypto'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import type {ControlledLiveSendRequest} from '@/lib/ediel/orchestrator'
const io=vi.hoisted(()=>({from:null as unknown,rpc:null as unknown,provider:null as unknown,session:null as unknown,cookie:null as unknown,sessionReadHook:null as null|(()=>Promise<void>)}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(...a:unknown[])=>(io.from as (...args:unknown[])=>unknown)(...a),rpc:(...a:unknown[])=>(io.rpc as (...args:unknown[])=>unknown)(...a)}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>{await io.sessionReadHook?.();return {data:{user:io.session},error:null}}},rpc:(...a:unknown[])=>(io.rpc as (...args:unknown[])=>unknown)(...a)})}))
vi.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>{if(name!=='gridex_admin_selected_company_id')throw Error('UNDECLARED_COOKIE:'+name);return {value:io.cookie}}})}))
vi.mock('next/navigation',()=>({redirect:(target:string)=>{throw Error('SESSION_REDIRECT:'+target)}}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:(...a:unknown[])=>(io.provider as (...args:unknown[])=>unknown)(...a)}))
import {sendControlledLiveEdielMessage,sendQueuedEdielMessage} from '@/lib/ediel/orchestrator'
import {assessControlledLiveSend,assertControlledLiveSendAllowed,issueControlledLiveBinding,CONTROLLED_FLOW_PROBE_RPC,CONTROLLED_LIVE_CONSUME_RPC,CONTROLLED_LIVE_EVIDENCE_RPC} from '@/lib/ediel/transport/controlledLiveSendGuard'
import * as finalGuard from '@/lib/ediel/transport/controlledLiveSendGuard'
import {SmtpDeliveryUncertainError} from '@/lib/ediel/transport/smtpOutcome'
import {sendCorrectionFencedEmail} from '@/lib/ediel/sources/correctionOutboundDispatch'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Distinct UUID namespaces: PARTY is a configured party UUID, not Ediel21660.
const COMPANY='00000000-0000-4000-8000-000000000001',ACTOR='00000000-0000-4000-8000-000000000002'
const MESSAGE='00000000-0000-4000-8000-000000000003',ROUTE='00000000-0000-4000-8000-000000000004'
const PROFILE='00000000-0000-4000-8000-000000000005',PARTY='00000000-0000-4000-8000-000000000006'
const CERT='00000000-0000-4000-8000-000000000007',PACK='00000000-0000-4000-8000-000000000008'
const RULEPROFILE='00000000-0000-4000-8000-000000000009',OTHER='00000000-0000-4000-8000-000000000010'
const FOREIGN='00000000-0000-4000-8000-000000000011',FP='c'.repeat(64),HASH='a'.repeat(64)
const INC='00000000-0000-4000-8000-000000000021',TPROF='00000000-0000-4000-8000-000000000022',AGR='00000000-0000-4000-8000-000000000023'
const MAN='00000000-0000-4000-8000-000000000024',ORIGINAL='00000000-0000-4000-8000-000000000025'
const DBKEY='UTILTS:E73:25-A-4',VERSION='25-A-4:r4',TO='receiver@example.invalid'
const clone=<T,>(x:T):T=>structuredClone(x),hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex')
type Row=Record<string,unknown>
let f:ReturnType<typeof fixture>,priorEnv:Map<string,string|undefined>
const ENV={EMAIL_PROVIDER:'resend',EDIEL_EMAIL_PROVIDER:'strato',EDIEL_SMTP_FROM:'sender@example.invalid',EDIEL_SMTP_USER:'sender@example.invalid',EDIEL_SMTP_HOST:'smtp.example.invalid',EDIEL_SMTP_PORT:'465',EDIEL_SMTP_SECURE:'true',EDIEL_SMTP_PASS:'SYNTHETIC_UNIT_ONLY_NOT_A_LIVE_CREDENTIAL',EDIEL_SHARED_MAILBOX_ADDRESS:'sender@example.invalid',EDIEL_APP_DKIM_ENABLED:'false'}

function fixture(){
 const now=new Date(),before=new Date(now.getTime()-3600000),after=new Date(now.getTime()+3600000)
 const stamp=now.toISOString().replace(/[-:T]/g,'').slice(0,12),periodStart=new Date(now.getTime()-86400000).toISOString().replace(/[-:T]/g,'').slice(0,12),periodEnd=new Date(now.getTime()-82800000).toISOString().replace(/[-:T]/g,'').slice(0,12)
 const raw=EdifactEnvelopeCodec.encode({sender:'91100',receiver:'21660',senderQualifier:'ZZ',receiverQualifier:'ZZ',applicationReference:'23-DDQ-E66-T',interchangeReference:'SYNOPS04',environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:["BGM+E73::260+SYNOPS04DOC+9+AB",`DTM+137:${stamp}:203`,"DTM+735:?+0100:406","MKS+23+E02::260","RFF+TN:SYNOPS04TX","NAD+MS+91100:SVK:260","NAD+MR+21660:SVK:260","IDE+24+SYNOPS04TX","LOC+172+735999260731000007::9","LOC+239+TES:SVK:260",`DTM+324:${periodStart}${periodEnd}:719`,`DTM+597:${stamp}:203`,"STS+7++E73::260","FTX+AAO+++Request missing E66","FTX+ZZZ+++Consumption","RFF+E66"]}]})
 const message={company_id:COMPANY,environment:'test',message_family:'UTILTS',message_code:'E73',message_standard:'edifact',message_version:'E5SE5A',application_reference:'23-DDQ-E66-T',raw_payload:raw,created_at:now.toISOString(),id:MESSAGE,direction:'outbound',status:'queued',message_received_at:null,communication_route_id:ROUTE,receiver_email:TO,sender_ediel_id:'91100',receiver_ediel_id:'21660',sender_sub_address:null,receiver_sub_address:null,mime_type:'application/edifact',parsed_payload:{},validation_report:{},requires_contrl:false,requires_aperak:false,contrl_status:'not_required',aperak_status:'not_required'} as Row
 message.parsed_payload={requestedMessageCode:'E66',bilateralCapabilityVerified:true}
 const profile={id:PROFILE,company_id:COMPANY,environment:'test',communication_route_id:ROUTE,party_id:PARTY,message_family:'UTILTS',business_code:'E73',application_reference:'23-DDQ-E66-T',is_enabled:true,is_active:true,transport_security_mode:'unencrypted',encryption_mode:'none',receiver_ediel_id:'21660',receiver_certificate_id:CERT,certificate_id:CERT,counterparty_id:PARTY,transport_profile_id:TPROF}
 const runtime={...profile,route_profile_id:PROFILE,communication_route_active:true,target_email:TO,certificate_required:true,subaddress_required:false}
 const certificate={id:CERT,company_id:COMPANY,environment:'test',owner_ediel_id:'21660',owner_subaddress:null,message_family:'UTILTS',message_type:'E73',usage:'outbound_recipient',purpose:'encryption',status:'active',valid_from:before.toISOString(),valid_to:after.toISOString(),fingerprint_sha256:FP,certificate_fingerprint:FP}
 const membership={company_id:COMPANY,user_id:ACTOR,status:'active',is_active:true,accepted_at:before.toISOString(),membership_role:'company_admin',companies:{id:COMPANY,name:'SYNTHETIC UNIT',slug:'synthetic-unit',org_number:null,status:'active'}}
 const store:Record<string,Row[]>={
  ediel_messages:[message,{...clone(message),id:OTHER,raw_payload:'SYNTHETIC PROTECTED SIBLING'},{...clone(message),id:FOREIGN,company_id:FOREIGN,raw_payload:'SYNTHETIC FOREIGN ORIGINAL'}],
  ediel_route_profiles:[profile],ediel_route_runtime_v:[runtime],ediel_certificates:[certificate],
  ediel_transport_profiles:[{id:TPROF,company_id:COMPANY,environment:'test',is_active:true}],
  company_memberships:[membership],user_profiles:[{id:ACTOR,user_status:'active'}],
  ediel_test_run_messages:[{id:OTHER,ediel_message_id:OTHER,test_run_id:OTHER}],ediel_test_runs:[{id:OTHER,company_id:COMPANY,environment_type:'bilateral_test'}],
  ediel_outbox:[{id:MESSAGE,ediel_message_id:MESSAGE,status:'queued'},{id:OTHER,ediel_message_id:OTHER,status:'queued'}],
  ediel_message_events:[{id:OTHER,ediel_message_id:OTHER,payload:{SYNTHETIC_HISTORY:true}}],
  ediel_message_payloads:[{id:OTHER,ediel_message_id:OTHER,raw_payload:'SYNTHETIC RETAINED PAYLOAD'}],
  ediel_exchange_logs:[{id:OTHER,ediel_message_id:OTHER,metadata:{SYNTHETIC_HISTORY:true}}],
 }
 const immutable={message:clone(message),siblings:clone(store.ediel_messages.slice(1)),outbox:clone(store.ediel_outbox[1]),events:clone(store.ediel_message_events[0]),payload:clone(store.ediel_message_payloads[0]),exchange:clone(store.ediel_exchange_logs[0])}
 const queries:Row[]=[],rpcs:Row[]=[],attempts=new Map<string,Row>(),providerCalls:Row[]=[]
 const readCounters={profiles:0}
 const flags={permission:true,controlled:true,consumed:false,wireReserved:false,uncertain:false,readbackFailure:false,hideProjection:false,skipCallback:false,registryMismatch:false,recovery:null as null|Row,beforeProjection:null as null|(()=>Promise<void>),beforeProfileRead:null as null|((readNo:number)=>Promise<void>),afterAttempt:null as null|((lane:'generic_journal'|'sealed_z08',action:string)=>Promise<void>)}
 const consumptions:Row[]=[]
 const allowed:Record<string,string[]>={ediel_messages:['id','company_id','environment'],ediel_route_profiles:['id','company_id','communication_route_id','environment','is_enabled','is_active'],ediel_route_runtime_v:['company_id','communication_route_id','route_profile_id','environment'],ediel_certificates:['id','company_id'],ediel_transport_profiles:['id','company_id'],company_memberships:['company_id','user_id','status','is_active','accepted_at'],user_profiles:['id','user_status'],ediel_test_run_messages:['ediel_message_id'],ediel_test_runs:['id'],ediel_outbox:['ediel_message_id','status'],ediel_message_events:[],ediel_message_payloads:[],ediel_exchange_logs:[]}
 const writes:Record<string,string[]>={ediel_messages:['transport_security_mode','route_transport_security_mode','was_smime_encrypted','expected_receiver_certificate_id','cms_expected_receiver_present','updated_by','updated_at','status','sent_at','failed_at','failure_reason','validation_report'],ediel_outbox:['status','last_error','updated_at','updated_by']}
 function from(table:string){
  if(!Object.hasOwn(store,table))throw Error('UNDECLARED_TABLE:'+table)
  let verb='read',value:Row|Row[]|null=null,single=false,limit=Infinity,done:Promise<unknown>|null=null
  const filters:Array<(row:Row)=>boolean>=[],shape:unknown[]=[]
  function column(key:string){if(!allowed[table].includes(key))throw Error('UNDECLARED_FILTER:'+table+':'+key)}
  async function finish(){
   // Config/route-contract/context may read earlier. Target the actual send-path
   // profile read only after its real preflight and wire reservation completed.
   if(table==='ediel_route_profiles'&&verb==='read'){readCounters.profiles++;if(flags.wireReserved)await flags.beforeProfileRead?.(readCounters.profiles)}
   queries.push({table,verb,shape:clone(shape),value:clone(value)})
   let rows=store[table].filter(row=>filters.every(fn=>fn(row))).slice(0,limit)
   if(verb==='update'){
    if(!filters.length||rows.some(row=>table==='ediel_messages'?row.id!==MESSAGE:row.ediel_message_id!==MESSAGE))throw Error('FORBIDDEN_SIBLING_WRITE')
    for(const key of Object.keys(value as Row))if(!writes[table]?.includes(key))throw Error('UNDECLARED_WRITE:'+table+':'+key)
    rows.forEach(row=>Object.assign(row,clone(value as Row)))
   }
   if(verb==='insert'){
    if(!['ediel_message_events','ediel_message_payloads','ediel_exchange_logs'].includes(table))throw Error('UNDECLARED_INSERT:'+table)
    rows=(Array.isArray(value)?value:[value as Row]).map(row=>({id:randomUUID(),...clone(row)}))
    if(rows.some(row=>row.ediel_message_id!==MESSAGE&&row.message_id!==MESSAGE))throw Error('FORBIDDEN_INSERT_SCOPE')
    store[table].push(...rows)
   }
   if(single&&rows.length>1)throw Error('AMBIGUOUS_FIXTURE_QUERY:'+table)
   return {data:clone(single?rows[0]??null:rows),error:null}
  }
  const q={select:(columns:string)=>{shape.push(['select',columns]);return q},eq:(key:string,val:unknown)=>{column(key);shape.push(['eq',key,val]);filters.push(row=>row[key]===val);return q},in:(key:string,vals:unknown[])=>{column(key);shape.push(['in',key,vals]);filters.push(row=>vals.includes(row[key]));return q},not:(key:string,op:string,val:unknown)=>{column(key);if(op!=='is'||val!==null)throw Error('UNDECLARED_NOT');shape.push(['not',key,op,val]);filters.push(row=>row[key]!=null);return q},order:(key:string,options:unknown)=>{if(key!=='created_at')throw Error('UNDECLARED_ORDER');shape.push(['order',key,options]);return q},limit:(n:number)=>{if(!Number.isInteger(n)||n<1||n>100)throw Error('UNDECLARED_LIMIT');limit=n;return q},update:(v:Row)=>{verb='update';value=v;return q},insert:(v:Row|Row[])=>{verb='insert';value=v;return q},maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},then:(ok:(value:unknown)=>unknown,bad:(error:unknown)=>unknown)=>{done??=finish();return done.then(ok,bad)}}
  return q
 }
 const profileEvidence={family:'UTILTS',messageCode:'E73',guideVersion:'25-A-4',guideRevision:'4',canonicalDirection:'outbound'}
 const registryRow={rule_pack_id:PACK,message_profile_id:RULEPROFILE,market:'electricity',family:'UTILTS',guide_version:'25-A-4',guide_revision:'4',unh_association_code:'E5SE5A',valid_from:'2026-10-01',valid_to:null,source_document:'SYNTHETIC 25-A-4 registry evidence',source_hash:HASH,field_matrix_version:'SYNTHETIC-25A4',profile_key:DBKEY,business_process:'meter_values',phase:null,profile:profileEvidence,parser_ready:true,builder_ready:true,validator_ready:true,ack_ready:true,state_machine_ready:true,original_version:VERSION,original_snapshot:{rulePack:{id:PACK,source_hash:HASH,guide_version:'25-A-4',guide_revision:'4'},messageProfile:{id:RULEPROFILE,rule_pack_id:PACK,profile_key:DBKEY,profile:profileEvidence},guideSources:[]}}
 const snapshot={profileKey:DBKEY,profileVersionId:RULEPROFILE,version:VERSION,checksum:HASH,originalWitness:registryRow.original_snapshot}
 function scope(args:Row){if(args.p_company_id!==COMPANY||args.p_message_id!==MESSAGE||('p_actor_user_id'in args&&args.p_actor_user_id!==ACTOR))throw Error('RPC_SCOPE_MISMATCH')}
 function projection(){
  const a=attempts.get(MESSAGE)
  if(flags.hideProjection||!a?.accepted)return null
  const b=a.binding as Row
  return {status:'accepted_projection',companyId:COMPANY,environment:message.environment,messageId:MESSAGE,attemptId:a.attemptId,lane:'generic_journal',originalHash:b.originalHash,observedAt:a.observedAt,frozenRecipient:b.to,providerReceipt:a.result,businessExpectationPlan:b.businessExpectationPlan??null,authorizesProviderEntry:false,deliveryProven:false,projectionStatus:'sent'}
 }
 async function rpc(name:string,args:Row){
  rpcs.push({name,args:clone(args)})
  if(name==='ediel_read_fresh_business_incident_v1'){
   if(args.p_company_id!==COMPANY||args.p_actor_user_id!==ACTOR||args.p_incident_id!==INC)return {data:null,error:{message:'not found'}}
   return {data:{incidentId:INC,commandId:PACK,companyId:COMPANY,environment:message.environment,sourceMessageId:ORIGINAL,ackMessageId:RULEPROFILE,scope:{scope:'message',reference:'SYNTHETIC-scope',outcome:'positive'},reportedAt:new Date().toISOString(),finding:{code:'late_internal_business_error',summary:'SYNTHETIC'},status:'reported',findingValidated:false,ackHistoryChanged:false,contactStatus:'held',correctionStatus:'held',trafficAuthorized:false},error:null}
  }
  if(name===CONTROLLED_FLOW_PROBE_RPC){
   scope(args);if(args.p_environment!==message.environment||args.p_communication_route_id!==message.communication_route_id)throw Error('PROBE_SCOPE_MISMATCH')
   return {data:{companyId:COMPANY,environment:message.environment,messageId:MESSAGE,controlled:flags.controlled||consumptions.length>0},error:null}
  }
  // Protected PRODAT recovery link of the stored row (server-side resend classification); NULL otherwise.
  if(name==='ediel_prodat_recovery_original_basis_v1'){scope(args);return {data:flags.recovery?clone(flags.recovery):null,error:null}}
  if(name===CONTROLLED_LIVE_EVIDENCE_RPC){
   scope(args);if(args.p_environment!==message.environment||args.p_incident_id!==INC||args.p_route_profile_id!==PROFILE)throw Error('EVIDENCE_SCOPE_MISMATCH')
   return {data:clone(evidence),error:null}
  }
  if(name===CONTROLLED_LIVE_CONSUME_RPC){
   scope(args);const agreement=evidence.counterpartyAgreement as Row|null
   if(!agreement||args.p_agreement_id!==agreement.id||(agreement.consumedByMessageId&&agreement.consumedByMessageId!==MESSAGE))return {data:null,error:{message:'ediel_ops04_authorization_consumed'}}
   const replayed=agreement.consumedByMessageId===MESSAGE;agreement.consumedByMessageId=MESSAGE
   if(evidence.liveMandate&&args.p_mandate_id)(evidence.liveMandate as Row).consumedByMessageId=MESSAGE
   consumptions.push(clone(args));flags.consumed=true
   return {data:{consumptionId:randomUUID(),companyId:COMPANY,environment:message.environment,messageId:MESSAGE,agreementId:args.p_agreement_id,mandateId:args.p_mandate_id??null,replayed},error:null}
  }
  if(name==='canonical_authenticated_tenant_context'){
   if(args.p_selected_company_id!==COMPANY)throw Error('SESSION_COMPANY_MISMATCH')
   return {data:{authorized:true,user_id:ACTOR,user_email:'actor@example.invalid',selected_company_id:COMPANY,permissions:flags.permission?['ediel.send']:[],roles:['company_admin'],is_platform_admin:false},error:null}
  }
  if(name==='gridex_get_user_roles'){if(args.p_user_id!==ACTOR)throw Error('ACTOR_MISMATCH');return {data:['company_admin'],error:null}}
  if(name==='gridex_actor_has_company_permission'){
   if(args.p_actor_user_id!==ACTOR||args.p_company_id!==COMPANY||!['ediel.send','communication.send'].includes(String(args.p_permission)))throw Error('PERMISSION_SCOPE_MISMATCH')
   return {data:flags.permission&&args.p_permission==='ediel.send',error:null}
  }
  if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
   if(args.p_market!=='electricity'||args.p_family!=='UTILTS'||args.p_message_code!=='E73'||args.p_direction!=='outbound'||args.p_transaction_subtype!=='')throw Error('REGISTRY_SCOPE_MISMATCH')
   return {data:[{...clone(registryRow),source_hash:flags.registryMismatch?'b'.repeat(64):HASH}],error:null}
  }
  if(name==='gridex_ediel_negative_fixture_read_v1'||name==='gridex_ediel_positive_fixture_read_v1'){
   const c=args.p_context as Row;if(c.companyId!==COMPANY||c.actorUserId!==ACTOR||c.messageId!==MESSAGE)throw Error('REGISTRATION_SCOPE_MISMATCH');return {data:null,error:null}
  }
  if(name==='ediel_capture_source_rule_pack_basis_v1'||name==='ediel_require_source_rule_pack_basis_v1'){
   scope(args);return {data:{rulePackId:PACK,messageProfileId:RULEPROFILE,profileKey:DBKEY,version:VERSION,sourceHash:HASH,snapshot:clone(snapshot)},error:null}
  }
  if(name==='ediel_metering_method_change_send_basis_v1'){
   scope(args);return {data:{version:1,kind:'not_applicable',companyId:COMPANY,environment:message.environment,messageId:MESSAGE,sourcePayloadHash:hash(String(message.raw_payload)),intentId:undefined},error:null}
  }
  if(name==='ediel_reserve_wire_reference_namespace_v1'){scope(args);flags.wireReserved=true;return {data:null,error:null}}
  if(name==='gridex_ediel_accepted_transport_projection_v1'||name==='gridex_ediel_repair_accepted_transport_projection_v1'){
   scope(args);if(args.p_environment!==message.environment)throw Error('PROJECTION_ENV_MISMATCH')
   if(!providerCalls.length&&flags.beforeProjection){const wait=flags.beforeProjection;flags.beforeProjection=null;await wait()}
   if(flags.readbackFailure&&providerCalls.length) return {data:null,error:new Error('SYNTHETIC_POST_ENTRY_READBACK_FAILURE')}
   const p=projection();if(p&&name.includes('repair_')){message.status='sent';message.sent_at=p.observedAt}
   return {data:clone(p),error:null}
  }
  if(name==='ediel_project_accepted_source_state_v1'){
   scope(args);const p=projection();if(!p||args.p_expected_original_hash!==p.originalHash)throw Error('SOURCE_PROJECTION_WITHOUT_RECEIPT')
   return {data:{status:'source_projection',companyId:COMPANY,environment:message.environment,messageId:MESSAGE,originalHash:p.originalHash,observedAt:p.observedAt,authorizesProviderEntry:false},error:null}
  }
  if(name==='gridex_ediel_business_expectations_v1'){
   const s=args.p_input as Row;if(s.action!=='register'||!projection())throw Error('EXPECTATION_WITHOUT_ACCEPTANCE');return {data:[],error:null}
  }
  // Finite committed-return model for the REAL sealed Z08 fence. No SQL durability claim.
  if(name==='gridex_outbound_dispatch_v1'){
   const s=args.p_input as Row
   if(s.companyId!==COMPANY||s.actorUserId!==ACTOR||s.messageId!==MESSAGE||s.environment!==message.environment)throw Error('SEALED_ATTEMPT_SCOPE_MISMATCH')
   await flags.afterAttempt?.('sealed_z08',String(s.action))
   const old=attempts.get(MESSAGE),eventId='SYNTHETIC-'+String(s.action)
   if(s.action==='witness')return {data:{scoped:true,eventId:s.eventId,witnessed:true},error:null}
   if(s.action==='prepare'){
    if(old)return {data:{scoped:true,proceed:false,state:old.entered?'provider_call_entered':'prepared'},error:null}
    const b=s.binding as Row
    if(b.originalHash!==hash(String(message.raw_payload))||b.to!==TO||!b.mimeArchiveRef||!b.mimeSha256||!b.mimeLength||!b.rfcMessageId)throw Error('SEALED_ORIGINAL_ARCHIVE_MISMATCH')
    attempts.set(MESSAGE,{attemptId:s.attemptId,binding:clone(b),entered:false,lane:'sealed_z08'})
    return {data:{scoped:true,proceed:true,eventId},error:null}
   }
   if(!old||old.attemptId!==s.attemptId)throw Error('SEALED_ATTEMPT_ID_MISMATCH')
   if(s.action==='enter'){old.entered=true;return {data:{scoped:true,proceed:true,eventId},error:null}}
   if(s.action==='release'&&!old.entered){attempts.delete(MESSAGE);return {data:{scoped:true,proceed:true,eventId},error:null}}
   if(s.action==='result'){
    if(!old.entered)throw Error('SEALED_RESULT_WITHOUT_ENTRY')
    const result=s.result as Row;old.result=clone(result);old.observedAt=new Date().toISOString()
    old.accepted=Array.isArray(result.accepted)&&result.accepted.length===1&&result.accepted[0]===TO&&Array.isArray(result.rejected)&&!result.rejected.length
    return {data:{scoped:true,proceed:true,eventId,facts:{classification:old.accepted?'accepted':'uncertain'},observationClock:'database_provider_result_capture',observedAt:old.observedAt},error:null}
   }
   throw Error('UNDECLARED_SEALED_ACTION:'+String(s.action))
  }
  if(name!=='gridex_ediel_transport_attempt_v1')throw Error('UNDECLARED_RPC:'+name)
  const s=args.p_input as Row
  if(s.companyId!==COMPANY||s.actorUserId!==ACTOR||s.messageId!==MESSAGE||s.environment!==message.environment)throw Error('ATTEMPT_SCOPE_MISMATCH')
  const old=attempts.get(MESSAGE)
  await flags.afterAttempt?.('generic_journal',String(s.action))
  if(s.action==='prepare'){
   if(old)return {data:{proceed:false,classification:old.accepted?'accepted':'unknown',providerReceipt:old.result,observedAt:old.observedAt,state:old.entered?'entered':'prepared'},error:null}
   const b=s.binding as Row
   if(b.originalHash!==hash(String(message.raw_payload))||b.to!==TO||!b.mimeArchiveRef||!b.mimeSha256||!b.mimeLength||!b.rfcMessageId)throw Error('ATTEMPT_ORIGINAL_ARCHIVE_MISMATCH')
   attempts.set(MESSAGE,{attemptId:s.attemptId,binding:clone(b),entered:false});return {data:{proceed:true},error:null}
  }
  if(!old||old.attemptId!==s.attemptId)throw Error('ATTEMPT_ID_MISMATCH')
  if(s.action==='enter'){old.entered=true;return {data:{proceed:true},error:null}}
  if(s.action==='release'&&!old.entered){attempts.delete(MESSAGE);return {data:{released:true},error:null}}
  if(s.action==='observe'){
   if(!old.entered)throw Error('OBSERVE_WITHOUT_ENTRY')
   const result=s.result as Row;old.result=clone(result);old.observedAt=new Date().toISOString()
   old.accepted=Array.isArray(result.accepted)&&result.accepted.length===1&&result.accepted[0]===TO&&Array.isArray(result.rejected)&&!result.rejected.length
   return {data:{classification:old.accepted?'accepted':'unknown',observedAt:old.observedAt},error:null}
  }
  throw Error('UNDECLARED_ATTEMPT_ACTION:'+s.action)
 }
 async function provider(input:Row,entry:Row){
  const bytes=Buffer.from(input.raw as Uint8Array),context=entry.archiveContext as Row
  if(input.to!==TO||context.companyId!==COMPANY||context.messageId!==MESSAGE)throw Error('PROVIDER_BINDING_MISMATCH')
  const actual={mode:'raw',from:'sender@example.invalid',to:TO,rfcMessageId:'<synthetic-ops04@example.invalid>',mimeArchiveRef:'synthetic-unit-mime/'+MESSAGE,mimeSha256:hash(bytes),mimeLength:bytes.length,mimePayloadSnapshotId:PACK,rawBase64:bytes.toString('base64')}
  if(!flags.skipCallback){
   await (entry.beforeProviderCall as (...args:unknown[])=>unknown)(actual)
   if(input.finalProviderGate)await (input.finalProviderGate as (actual:Readonly<Row>)=>Promise<void>)(Object.freeze(clone(actual)))
  }
  providerCalls.push({to:input.to,rawHash:hash(bytes),attempt:clone(attempts.get(MESSAGE))})
  if(flags.uncertain)throw Object.assign(new Error('SYNTHETIC DATA timeout'),{code:'ETIMEDOUT',command:'DATA'})
  return {accepted:[TO],rejected:[],messageId:'<synthetic-ops04@example.invalid>',response:'250 SYNTHETIC UNIT ONLY'}
 }
 const tlsHeaders=[
  'Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid',
  'Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n\tby mx.mailbox.example.invalid with ESMTPS id r2; Mon, 12 Oct 2026 12:00:02 +0200',
  'Received: from app.own.example.invalid (app.own.example.invalid [192.0.2.5])\r\n\tby smtp.provider.example.invalid with ESMTPSA id s1; Mon, 12 Oct 2026 12:00:01 +0200',
  'Subject: SYNTHETIC','',
 ].join('\r\n')
 // Server-side native evidence (what the OPS-04 evidence RPC returns); never caller input.
 const evidence:Row={companyId:COMPANY,environment:'test',incidentId:INC,routeProfileId:PROFILE,
  incidentCorrection:{companyId:COMPANY,environment:'test',incidentId:INC,correctionRef:'SYNTHETIC-fix-1'},
  counterpartyAgreement:{id:AGR,companyId:COMPANY,environment:'test',ref:'SYNTHETIC-agr-1',counterpartyId:PARTY,routeId:PROFILE,validFrom:before.toISOString(),validTo:after.toISOString(),consumedByMessageId:null},
  liveMandate:null,
  relayCapture:{companyId:COMPANY,environment:'test',evidenceRef:'SYNTHETIC-retained-relay-reference',routeId:PROFILE,rawHeaders:tlsHeaders}}
 // Caller request: identifiers and the plan only.
 const request:ControlledLiveSendRequest={messageId:MESSAGE,incidentId:INC,actorUserId:ACTOR,plan:{references:[MESSAGE],source:'single_controlled',resend:null}}
 function toProduction(){
  for(const key of ['incidentCorrection','counterpartyAgreement','relayCapture'])(evidence[key] as Row).environment='production'
  evidence.environment='production';store.ediel_transport_profiles[0].environment='production'
 }
 function rebaseSelectedFixture(){immutable.message=clone(message)}
 function protectedUnchanged(){
  expect(store.ediel_messages.slice(1)).toEqual(immutable.siblings)
  for(const key of ['id','company_id','direction','environment','communication_route_id','raw_payload','sender_ediel_id','receiver_ediel_id','receiver_email','application_reference','parsed_payload'])expect(message[key]).toEqual(immutable.message[key])
  expect(store.ediel_outbox[1]).toEqual(immutable.outbox);expect(store.ediel_message_events[0]).toEqual(immutable.events);expect(store.ediel_message_payloads[0]).toEqual(immutable.payload);expect(store.ediel_exchange_logs[0]).toEqual(immutable.exchange)
 }
 return {message,profile,runtime,certificate,evidence,request,consumptions,toProduction,store,queries,rpcs,attempts,providerCalls,flags,readCounters,from,rpc,provider,projection,protectedUnchanged,rebaseSelectedFixture}
}

beforeEach(()=>{
 priorEnv=new Map(Object.keys(ENV).map(key=>[key,process.env[key]]));Object.assign(process.env,ENV)
 f=fixture();io.from=f.from;io.rpc=f.rpc;io.provider=f.provider;io.session={id:ACTOR,email:'actor@example.invalid'};io.cookie=COMPANY;io.sessionReadHook=null
})
afterEach(()=>{for(const [key,value] of priorEnv){if(value===undefined)delete process.env[key];else process.env[key]=value}})
const send=()=>sendControlledLiveEdielMessage(f.request)
const agreement=()=>f.evidence.counterpartyAgreement as Row

it('one actual guarded send consumes the server evidence once and reads the same accepted observation; protected siblings survive',async()=>{
 const result=await send()
 expect(result).toMatchObject({status:'transport_observed',messageId:MESSAGE,productionApproved:false,reasons:[]})
 expect(f.providerCalls).toHaveLength(1);expect(result.observedAt).toBe(f.projection()!.observedAt)
 expect(f.attempts.get(MESSAGE)?.accepted).toBe(true)
 expect(f.rpcs.filter(r=>r.name==='gridex_ediel_transport_attempt_v1').map(r=>(r.args as Row).p_input).map(s=>(s as Row).action)).toEqual(['prepare','enter','observe'])
 expect(f.consumptions).toHaveLength(1)
 expect(f.consumptions[0]).toMatchObject({p_company_id:COMPANY,p_environment:'test',p_actor_user_id:ACTOR,p_message_id:MESSAGE,p_incident_id:INC,p_route_profile_id:PROFILE,p_agreement_id:AGR,p_mandate_id:null,p_resend:false,
  p_binding:{certificateId:CERT,certificateFingerprint:FP,provider:{to:TO,mimePayloadSnapshotId:PACK}}})
 const consumeIndex=f.rpcs.findIndex(r=>r.name===CONTROLLED_LIVE_CONSUME_RPC)
 const enterIndex=f.rpcs.findIndex(r=>r.name==='gridex_ediel_transport_attempt_v1'&&((r.args as Row).p_input as Row).action==='enter')
 expect(consumeIndex).toBeGreaterThan(enterIndex)
 f.protectedUnchanged()
})
for(const [name,patch] of [
 ['incident correction',()=>{f.evidence.incidentCorrection=null}],
 ['agreement scope',()=>{agreement().routeId=OTHER}],
 ['agreement counterparty',()=>{agreement().counterpartyId=OTHER}],
 ['agreement missing',()=>{f.evidence.counterpartyAgreement=null}],
 ['relay scope',()=>{(f.evidence.relayCapture as Row).routeId=OTHER}],
 ['evidence echoed for another tenant',()=>{f.evidence.companyId=FOREIGN}],
 ['route counterparty',()=>{f.profile.counterparty_id=OTHER}],
 ['transport profile inactive',()=>{f.store.ediel_transport_profiles[0].is_active=false}],
 ['certificate revoked',()=>{f.certificate.status='revoked'}],
 ['incident unreadable',()=>{f.request.incidentId=OTHER}],
 ['blank',()=>{f.request.plan.references=[' ']}],
 ['duplicate',()=>{f.request.plan.references=[MESSAGE,MESSAGE]}],
 ['two',()=>{f.request.plan.references=[MESSAGE,OTHER]}],
 ['other message',()=>{f.request.plan.references=[OTHER]}],
 ['bulk',()=>{f.request.plan.source='bulk_import'}],
 ['blind',()=>{f.request.plan.resend={incidentId:null,diagnosis:null}}],
] as const)it('held without provider entry or consumption: '+name,async()=>{
 patch();const r=await send()
 expect(r.status).toBe('held');expect(r.productionApproved).toBe(false);expect(r.reasons.length).toBeGreaterThan(0)
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('a stored recovery row sent through the entry point with plan.resend=null is held as a blind resend',async()=>{
 const operation='00000000-0000-4000-8000-000000000026'
 Object.assign(f.message,{original_message_id:ORIGINAL,source_operation_id:operation});f.rebaseSelectedFixture()
 f.flags.recovery={originalMessageId:ORIGINAL,sourceOriginMessageId:ORIGINAL,operationId:operation,sourceAckMessageId:RULEPROFILE,kind:'contrl_correction',
  correctedPayloadHash:hash(String(f.message.raw_payload)),allowedObjects:[{point:null,identityAgency:null}]}
 const r=await send()
 expect(r).toMatchObject({status:'held',productionApproved:false});expect(r.reasons).toContain('blind_resend_not_a_test_strategy')
 expect(f.rpcs.find(x=>x.name==='ediel_prodat_recovery_original_basis_v1')?.args).toEqual({p_company_id:COMPANY,p_message_id:MESSAGE,p_actor_user_id:ACTOR})
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);expect(f.rpcs.map(x=>x.name)).not.toContain(CONTROLLED_LIVE_CONSUME_RPC);f.protectedUnchanged()
})
it('caller-supplied approvals are never accepted as input',async()=>{
 const forged={...f.request,counterpartyAgreement:{ref:'CALLER',counterpartyId:PARTY,tenantId:COMPANY,environment:'test',routeId:PROFILE,validFrom:new Date(0),validTo:new Date(8.64e15)}}
 f.evidence.counterpartyAgreement=null
 const r=await sendControlledLiveEdielMessage(forged as unknown as ControlledLiveSendRequest)
 expect(r).toMatchObject({status:'held',reasons:['ops04_input_invalid']});expect(f.rpcs).toEqual([]);expect(f.providerCalls).toHaveLength(0)
})
it('foreign selected session company cannot reach the message',async()=>{
 io.cookie=FOREIGN
 await expect(send()).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('a message of another tenant is not loaded and is held',async()=>{
 f.request.messageId=FOREIGN;f.request.plan.references=[FOREIGN]
 const r=await send()
 expect(r).toMatchObject({status:'held',reasons:['ops04_stored_message_scope_mismatch']});expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('a caller-named actor other than the session actor is refused',async()=>{
 f.request.actorUserId=OTHER
 await expect(send()).rejects.toThrow('ops04_actor_session_mismatch')
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('current session permission denial is not caller-overridable',async()=>{
 f.flags.permission=false
 await expect(send()).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('registry/original guard rejection is real and cannot be promoted to success',async()=>{
 f.flags.registryMismatch=true
 await expect(send()).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('actual accepted historical observation replays without another provider entry, consumption or observation clock',async()=>{
 const first=await send(),before=f.providerCalls.length,observed=first.observedAt
 const second=await send()
 expect(second).toMatchObject({status:'already_observed',observedAt:observed,productionApproved:false});expect(f.providerCalls).toHaveLength(before)
 expect(f.consumptions).toHaveLength(1);f.protectedUnchanged()
})
it('DATA uncertainty remains uncertain and never retries automatically',async()=>{
 f.flags.uncertain=true
 await expect(send()).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);expect(f.projection()).toBeNull()
 await expect(send()).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
it('accepted provider return plus failed persisted readback is uncertain, never complete or retried',async()=>{
 f.flags.readbackFailure=true
 await expect(send()).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
it('provider accepted return without a valid accepted journal is not completion',async()=>{
 f.flags.hideProjection=true
 await expect(send()).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})

for(const [name,patch] of [
 ['profile',()=>{f.profile.id=OTHER}],
 ['route disabled',()=>{f.runtime.communication_route_active=false}],
 ['stored recipient',()=>{f.message.receiver_email='different@example.invalid';f.rebaseSelectedFixture()}],
 ['certificate owner',()=>{f.certificate.owner_ediel_id='99999'}],
 ['certificate expired',()=>{f.certificate.valid_to=new Date(Date.now()-1000).toISOString()}],
] as const)it('held by actual stored binding: '+name,async()=>{
 patch();const r=await send()
 expect(r.status).toBe('held');expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
for(const wrong of [null,{id:MAN,companyId:COMPANY,environment:'production',ref:'SYNTHETIC-mandate',incidentId:OTHER,consumedByMessageId:null}] as const)it('production mandate required and same-incident without provider entry',async()=>{
 f.toProduction();f.evidence.liveMandate=wrong
 // Matching modeled production metadata; no actual production send is entered.
 f.message.environment='production';f.profile.environment='production';f.runtime.environment='production';f.certificate.environment='production'
 f.profile.encryption_mode='smime';f.runtime.encryption_mode='smime';f.profile.transport_security_mode='required_encrypted';f.runtime.transport_security_mode='required_encrypted'
 f.rebaseSelectedFixture()
 const r=await send();expect(r.status).toBe('held');expect(r.reasons.join(' ')).toMatch(/live_mandate/)
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('actual stored production shadow is held by the explicit real controller guard; no ordinary sender entry',async()=>{
 f.toProduction();f.evidence.liveMandate={id:MAN,companyId:COMPANY,environment:'production',ref:'SYNTHETIC-mandate',incidentId:INC,consumedByMessageId:null}
 f.message.environment='production';f.message.status='prepared';f.message.validation_report={productionMode:'shadow'}
 f.profile.environment='production';f.runtime.environment='production';f.certificate.environment='production'
 f.profile.encryption_mode='smime';f.runtime.encryption_mode='smime';f.profile.transport_security_mode='required_encrypted';f.runtime.transport_security_mode='required_encrypted'
 f.rebaseSelectedFixture()
 const r=await send();expect(r.status).toBe('held');expect(r.reasons.join(' ')).toMatch(/shadow/);expect(r.productionApproved).toBe(false)
 expect(f.providerCalls).toHaveLength(0);expect(f.attempts.size).toBe(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('ordinary guarded sender on a controlled route is refused: the entry point is the only way in',async()=>{
 await expect(sendQueuedEdielMessage({actorUserId:ACTOR,edielMessageId:MESSAGE})).rejects.toThrow('controlled_flow_entry_point_required')
 expect(f.providerCalls).toHaveLength(0);expect(f.attempts.size).toBe(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('ordinary guarded sender still reaches the same real journal path on a route without server evidence',async()=>{
 f.flags.controlled=false
 await sendQueuedEdielMessage({actorUserId:ACTOR,edielMessageId:MESSAGE})
 expect(f.providerCalls).toHaveLength(1);expect(f.projection()).not.toBeNull();expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('the entry point on a route without server evidence is held by the send-path guard before any effect',async()=>{
 f.flags.controlled=false
 const r=await send()
 expect(r).toMatchObject({status:'held',reasons:['controlled_flow_binding_missing']})
 expect(f.providerCalls).toHaveLength(0);expect(f.attempts.size).toBe(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})

// Runtime-discriminant cases reach the real controller; no TypeScript cast is an admission guard.
for(const [name,change] of [
 ['unknown plan source',(p:Row)=>{(p.plan as Row).source='unknown'}],
 ['non-array references',(p:Row)=>{(p.plan as Row).references=MESSAGE}],
 ['non-string reference',(p:Row)=>{(p.plan as Row).references=[17]}],
 ['non-uuid message id',(p:Row)=>{p.messageId='not-a-uuid'}],
 ['missing incident id',(p:Row)=>{delete p.incidentId}],
 ['caller tenant field',(p:Row)=>{p.tenantId=COMPANY}],
] as const)it('runtime malformed request is held: '+name,async()=>{
 change(f.request as unknown as Row)
 const r=await send()
 expect(r).toMatchObject({status:'held',reasons:['ops04_input_invalid']});expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('caller request mutations after the first await cannot change the captured one-message admission',async()=>{
 let changed=false
 io.sessionReadHook=async()=>{if(changed)return;await Promise.resolve();f.request.plan.references=[OTHER];f.request.incidentId=OTHER;changed=true}
 const result=await send()
 expect(changed).toBe(true);expect(f.request.plan.references).toEqual([OTHER])
 expect(result).toMatchObject({status:'transport_observed',messageId:MESSAGE,productionApproved:false})
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
async function waitPastActualClock(deadline:number){
 while(Date.now()<=deadline)await new Promise<void>(resolve=>setTimeout(resolve,Math.max(1,deadline-Date.now()+1)))
}
it('send-time fresh clock rejects an initially valid server agreement after a real preparation wait crosses expiry',async()=>{
 const deadline=Date.now()+500;agreement().validTo=new Date(deadline).toISOString()
 let entered:number|undefined,left:number|undefined
 f.flags.beforeProjection=async()=>{entered=Date.now();expect(entered).toBeLessThan(deadline);await waitPastActualClock(deadline);left=Date.now()}
 const result=await send()
 expect(entered).toBeDefined();expect(left).toBeGreaterThan(deadline)
 expect(result.status).toBe('held');expect(result.reasons).toContain('counterparty_agreement_not_valid_now')
 expect(f.providerCalls).toHaveLength(0);expect(f.attempts.size).toBe(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('the same real preparation wait still admits a valid agreement without a fake clock',async()=>{
 const started=Date.now(),deadline=started+60_000;agreement().validTo=new Date(deadline).toISOString()
 let entered:number|undefined,left:number|undefined
 f.flags.beforeProjection=async()=>{entered=Date.now();await waitPastActualClock(entered+50);left=Date.now()}
 const result=await send()
 expect(entered).toBeDefined();expect(left!-entered!).toBeGreaterThanOrEqual(50);expect(left).toBeLessThan(deadline)
 expect(result.status).toBe('transport_observed');expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
it('provider return without the required real entry callback cannot complete a transport',async()=>{
 f.flags.skipCallback=true
 await expect(send()).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(1);expect(f.projection()).toBeNull();f.protectedUnchanged()
})
for(const status of [null,'','revoked','expired'] as const)it('server certificate status other than active is held: '+JSON.stringify(status),async()=>{
 f.certificate.status=status
 const result=await send()
 expect(result.status).toBe('held');expect(result.productionApproved).toBe(false)
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})
it('an agreement already consumed by another message is held before consumption',async()=>{
 agreement().consumedByMessageId=OTHER
 const r=await send()
 expect(r.status).toBe('held');expect(r.reasons).toContain('controlled_live_authorization_consumed')
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);f.protectedUnchanged()
})

// Finite concurrent actor changes real stored rows; no success guard mock.
const ALT_ROUTE='00000000-0000-4000-8000-000000000012',ALT_PROFILE='00000000-0000-4000-8000-000000000013',ALT_PARTY='00000000-0000-4000-8000-000000000014'
function installOtherValidRoute(){
 f.store.ediel_route_profiles.push({...clone(f.profile),id:ALT_PROFILE,communication_route_id:ALT_ROUTE,party_id:ALT_PARTY})
 f.store.ediel_route_runtime_v.push({...clone(f.runtime),id:ALT_PROFILE,route_profile_id:ALT_PROFILE,communication_route_id:ALT_ROUTE,party_id:ALT_PARTY})
}
for(const kind of ['route','wire'] as const)it('concurrent valid stored '+kind+' drift between wrapper and sender is refused before consumption or provider entry',async()=>{
 installOtherValidRoute();let changed=false
 f.flags.beforeProjection=async()=>{await Promise.resolve();if(kind==='route')f.message.communication_route_id=ALT_ROUTE;else f.message.raw_payload=String(f.message.raw_payload).replace('SYNOPS04DOC','SYNOPS04DOC2');f.rebaseSelectedFixture();changed=true}
 let failure:unknown;try{await send()}catch(error){failure=error}
 expect(changed).toBe(true);expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0)
 expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toBe('ops04_controlled_message_binding_changed');f.protectedUnchanged()
})
it('same deferred stored-read wait with unchanged admitted row still sends one guarded flow',async()=>{
 installOtherValidRoute();let waited=false
 f.flags.beforeProjection=async()=>{await Promise.resolve();waited=true}
 const result=await send()
 expect(waited).toBe(true);expect(result.status).toBe('transport_observed');expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
for(const kind of ['profile','certificate'] as const)it('late actual transport '+kind+' reread before final consumption stays bound to the controlled admission',async()=>{
 let changed=false
 f.flags.beforeProfileRead=async()=>{if(changed)return;await Promise.resolve();if(kind==='profile'){f.profile.id=ALT_PROFILE;f.profile.party_id=ALT_PARTY;f.runtime.route_profile_id=ALT_PROFILE;f.runtime.party_id=ALT_PARTY}else f.certificate.fingerprint_sha256='d'.repeat(64);changed=true}
 let failure:unknown;try{await send()}catch(error){failure=error}
 expect(changed).toBe(true);expect(f.flags.wireReserved).toBe(true);expect(f.consumptions).toHaveLength(0);expect(f.providerCalls).toHaveLength(0)
 expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toBe('ops04_controlled_transport_binding_changed');f.protectedUnchanged()
})
it('same late transport profile-read wait with unchanged admitted facts remains a valid flow',async()=>{
 let waited=false
 f.flags.beforeProfileRead=async()=>{await Promise.resolve();waited=true}
 const result=await send()
 expect(waited).toBe(true);expect(result.status).toBe('transport_observed');expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})

// Joined application regressions: actual generic or sealed Z08 callback, then
// the same server guard at the final provider seam. The finite RPC ports do
// not stand in for B's separate PostgreSQL binding/uniqueness qualification.
async function sendThroughExistingLane(lane:'generic_journal'|'sealed_z08'){
 if(lane==='generic_journal')return send()
 const message=f.message as unknown as EdielMessageRow
 const selection={incidentId:INC,plan:clone(f.request.plan)}
 const assessment=await assessControlledLiveSend(message,ACTOR,selection)
 expect(assessment.ready).toBe(true)
 const binding=issueControlledLiveBinding({messageSnapshot:JSON.stringify(message),routeProfileSnapshot:JSON.stringify(assessment.routeRow),
  certificateId:assessment.certificateId!,certificateFingerprint:assessment.certificateFingerprint,selection,
  evidenceSnapshot:{agreementId:assessment.agreementId,mandateId:assessment.mandateId,correctionRef:assessment.correctionRef,
   relayEvidenceRef:assessment.relayEvidenceRef,relayHeadersHash:assessment.relayHeadersHash}})
 await finalGuard.assertControlledLiveSendPreflight(message,ACTOR,binding)
 const payload=Buffer.from(message.raw_payload!,'latin1')
 const raw=Buffer.from('Message-ID: <synthetic-ops04@example.invalid>\r\n\r\n'+message.raw_payload,'latin1')
 return sendCorrectionFencedEmail({raw,to:TO,finalProviderGate:actual=>assertControlledLiveSendAllowed(message,ACTOR,binding,{
  ...actual,originalHash:hash(message.raw_payload!),routeId:message.communication_route_id,payloadHash:hash(payload),payloadLength:payload.length,encoding:'latin1',mimeMode:'ediel-singlepart-base64',
 })},{message:{...message,message_code:'Z08'},actorUserId:ACTOR,mimeMode:'ediel-singlepart-base64',payload,encoding:'latin1'})
}
for(const lane of ['generic_journal','sealed_z08'] as const)for(const waitAt of ['prepare','enter'] as const){
 for(const change of ['relay-revocation','agreement-expiry'] as const)it('final '+lane+' authority refuses '+change+' during existing '+waitAt+' wait',async()=>{
  let changed=false
  f.flags.afterAttempt=async(actualLane,action)=>{
   if(changed||actualLane!==lane||action!==waitAt)return
   await Promise.resolve()
   if(change==='relay-revocation')f.evidence.relayCapture=null
   else agreement().validTo=new Date(Date.now()-1000).toISOString()
   changed=true
  }
  const error=await sendThroughExistingLane(lane).then(()=>null,(cause:unknown)=>cause)
  expect(changed).toBe(true);expect(error).toBeInstanceOf(SmtpDeliveryUncertainError)
  expect((error as Error).message).toContain(change==='relay-revocation'?'relay_trace_not_verified':'counterparty_agreement_not_valid_now')
  expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0)
  expect(f.attempts.get(MESSAGE)?.entered).toBe(true)
  const actions=f.rpcs.filter(r=>r.name===(lane==='generic_journal'?'gridex_ediel_transport_attempt_v1':'gridex_outbound_dispatch_v1'))
   .map(r=>((r.args as Row).p_input as Row).action)
  expect(actions).toContain('prepare');expect(actions).toContain('enter');expect(actions).not.toContain('release')
  expect(actions).toContain(lane==='generic_journal'?'observe':'result')
  f.protectedUnchanged()
 })
 it('the same '+lane+' '+waitAt+' wait with unchanged authority admits exactly one selected provider call',async()=>{
  let waited=false
  f.flags.afterAttempt=async(actualLane,action)=>{if(!waited&&actualLane===lane&&action===waitAt){await Promise.resolve();waited=true}}
  await sendThroughExistingLane(lane)
  expect(waited).toBe(true);expect(f.providerCalls).toHaveLength(1);expect(f.consumptions).toHaveLength(1)
  expect(f.attempts.get(MESSAGE)?.accepted).toBe(true)
  const consume=f.rpcs.findIndex(r=>r.name===CONTROLLED_LIVE_CONSUME_RPC)
  const enter=f.rpcs.findIndex(r=>r.name===(lane==='generic_journal'?'gridex_ediel_transport_attempt_v1':'gridex_outbound_dispatch_v1')&&((r.args as Row).p_input as Row).action==='enter')
  expect(consume).toBeGreaterThan(enter);f.protectedUnchanged()
 })
}
for(const changed of ['agreement','relay'] as const)it('a different healthy '+changed+' cannot replace the entry-point authority during journal preparation',async()=>{
 let replaced=false
 f.flags.afterAttempt=async(lane,action)=>{
  if(replaced||lane!=='generic_journal'||action!=='prepare')return
  await Promise.resolve()
  if(changed==='agreement')agreement().id=OTHER
  else (f.evidence.relayCapture as Row).rawHeaders=String((f.evidence.relayCapture as Row).rawHeaders).replace('id r2','id r3')
  replaced=true
 }
 const error=await send().then(()=>null,(cause:unknown)=>cause)
 expect(replaced).toBe(true);expect(error).toBeInstanceOf(SmtpDeliveryUncertainError)
 expect((error as Error).message).toContain('controlled_binding_evidence_changed')
 expect(f.providerCalls).toHaveLength(0);expect(f.consumptions).toHaveLength(0);expect(f.attempts.get(MESSAGE)?.entered).toBe(true)
 f.protectedUnchanged()
})
