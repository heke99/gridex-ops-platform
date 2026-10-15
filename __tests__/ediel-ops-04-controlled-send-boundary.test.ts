// masterplan: OPS-04, AT-OPS-04
// Declared finite UNIT session/SDK/email-I/O ports only; no real backend or mail.
// Real controller, readiness, lexical sender, registry/route and journal guards.
// MIME archive identifiers below are synthetic UNIT data, not genuine archive proof.
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {createHash,randomUUID} from 'node:crypto'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import type {ControlledLiveInput} from '@/lib/ediel/transport/controlledLiveReadiness'
const io=vi.hoisted(()=>({from:null as unknown,rpc:null as unknown,provider:null as unknown,session:null as unknown,cookie:null as unknown,sessionReadHook:null as null|(()=>Promise<void>)}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(...a:unknown[])=>(io.from as (...args:unknown[])=>unknown)(...a),rpc:(...a:unknown[])=>(io.rpc as (...args:unknown[])=>unknown)(...a)}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>{await io.sessionReadHook?.();return {data:{user:io.session},error:null}}},rpc:(...a:unknown[])=>(io.rpc as (...args:unknown[])=>unknown)(...a)})}))
vi.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>{if(name!=='gridex_admin_selected_company_id')throw Error('UNDECLARED_COOKIE:'+name);return {value:io.cookie}}})}))
vi.mock('next/navigation',()=>({redirect:(target:string)=>{throw Error('SESSION_REDIRECT:'+target)}}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:(...a:unknown[])=>(io.provider as (...args:unknown[])=>unknown)(...a)}))
import {sendControlledLiveEdielMessage,sendQueuedEdielMessage} from '@/lib/ediel/orchestrator'
import {evaluateControlledLiveReadiness} from '@/lib/ediel/transport/controlledLiveReadiness'
import {evaluateRelayTrace} from '@/lib/ediel/transport/relayTrace'
import {SmtpDeliveryUncertainError} from '@/lib/ediel/transport/smtpOutcome'

// Distinct UUID namespaces: PARTY is a configured party UUID, not Ediel21660.
const COMPANY='00000000-0000-4000-8000-000000000001',ACTOR='00000000-0000-4000-8000-000000000002'
const MESSAGE='00000000-0000-4000-8000-000000000003',ROUTE='00000000-0000-4000-8000-000000000004'
const PROFILE='00000000-0000-4000-8000-000000000005',PARTY='00000000-0000-4000-8000-000000000006'
const CERT='00000000-0000-4000-8000-000000000007',PACK='00000000-0000-4000-8000-000000000008'
const RULEPROFILE='00000000-0000-4000-8000-000000000009',OTHER='00000000-0000-4000-8000-000000000010'
const FOREIGN='00000000-0000-4000-8000-000000000011',FP='c'.repeat(64),HASH='a'.repeat(64)
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
 const profile={id:PROFILE,company_id:COMPANY,environment:'test',communication_route_id:ROUTE,party_id:PARTY,message_family:'UTILTS',business_code:'E73',application_reference:'23-DDQ-E66-T',is_enabled:true,is_active:true,transport_security_mode:'unencrypted',encryption_mode:'none',receiver_ediel_id:'21660',receiver_certificate_id:CERT,certificate_id:CERT}
 const runtime={...profile,route_profile_id:PROFILE,communication_route_active:true,target_email:TO,certificate_required:true,subaddress_required:false}
 const certificate={id:CERT,company_id:COMPANY,environment:'test',owner_ediel_id:'21660',owner_subaddress:null,message_family:'UTILTS',message_type:'E73',usage:'outbound_recipient',purpose:'encryption',status:'active',valid_from:before.toISOString(),valid_to:after.toISOString(),fingerprint_sha256:FP,certificate_fingerprint:FP}
 const membership={company_id:COMPANY,user_id:ACTOR,status:'active',is_active:true,accepted_at:before.toISOString(),membership_role:'company_admin',companies:{id:COMPANY,name:'SYNTHETIC UNIT',slug:'synthetic-unit',org_number:null,status:'active'}}
 const store:Record<string,Row[]>={
  ediel_messages:[message,{...clone(message),id:OTHER,raw_payload:'SYNTHETIC PROTECTED SIBLING'},{...clone(message),id:FOREIGN,company_id:FOREIGN,raw_payload:'SYNTHETIC FOREIGN ORIGINAL'}],
  ediel_route_profiles:[profile],ediel_route_runtime_v:[runtime],ediel_certificates:[certificate],
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
 const flags={permission:true,uncertain:false,readbackFailure:false,hideProjection:false,skipCallback:false,registryMismatch:false,beforeProjection:null as null|(()=>Promise<void>),beforeProfileRead:null as null|((readNo:number)=>Promise<void>)}
 const allowed:Record<string,string[]>={ediel_messages:['id','company_id','environment'],ediel_route_profiles:['id','company_id','communication_route_id','environment','is_enabled','is_active'],ediel_route_runtime_v:['company_id','communication_route_id','route_profile_id','environment'],ediel_certificates:['id'],company_memberships:['company_id','user_id','status','is_active','accepted_at'],user_profiles:['id','user_status'],ediel_test_run_messages:['ediel_message_id'],ediel_test_runs:['id'],ediel_outbox:['ediel_message_id','status'],ediel_message_events:[],ediel_message_payloads:[],ediel_exchange_logs:[]}
 const writes:Record<string,string[]>={ediel_messages:['transport_security_mode','route_transport_security_mode','was_smime_encrypted','expected_receiver_certificate_id','cms_expected_receiver_present','updated_by','updated_at','status','sent_at','failed_at','failure_reason','validation_report'],ediel_outbox:['status','last_error','updated_at','updated_by']}
 function from(table:string){
  if(!Object.hasOwn(store,table))throw Error('UNDECLARED_TABLE:'+table)
  let verb='read',value:Row|Row[]|null=null,single=false,limit=Infinity,done:Promise<unknown>|null=null
  const filters:Array<(row:Row)=>boolean>=[],shape:unknown[]=[]
  function column(key:string){if(!allowed[table].includes(key))throw Error('UNDECLARED_FILTER:'+table+':'+key)}
  async function finish(){
   if(table==='ediel_route_profiles'&&verb==='read'){readCounters.profiles++;await flags.beforeProfileRead?.(readCounters.profiles)}
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
  if(name==='ediel_reserve_wire_reference_namespace_v1'){scope(args);return {data:null,error:null}}
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
  if(name!=='gridex_ediel_transport_attempt_v1')throw Error('UNDECLARED_RPC:'+name)
  const s=args.p_input as Row
  if(s.companyId!==COMPANY||s.actorUserId!==ACTOR||s.messageId!==MESSAGE||s.environment!==message.environment)throw Error('ATTEMPT_SCOPE_MISMATCH')
  const old=attempts.get(MESSAGE)
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
  if(!flags.skipCallback)await (entry.beforeProviderCall as (...args:unknown[])=>unknown)({mode:'raw',from:'sender@example.invalid',to:TO,rfcMessageId:'<synthetic-ops04@example.invalid>',mimeArchiveRef:'synthetic-unit-mime/'+MESSAGE,mimeSha256:hash(bytes),mimeLength:bytes.length,mimePayloadSnapshotId:PACK,rawBase64:bytes.toString('base64')})
  providerCalls.push({to:input.to,rawHash:hash(bytes),attempt:clone(attempts.get(MESSAGE))})
  if(flags.uncertain)throw Object.assign(new Error('SYNTHETIC DATA timeout'),{code:'ETIMEDOUT',command:'DATA'})
  return {accepted:[TO],rejected:[],messageId:'<synthetic-ops04@example.invalid>',response:'250 SYNTHETIC UNIT ONLY'}
 }
 const tlsTrace=evaluateRelayTrace({rawHeaders:[
  'Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid',
  'Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n\tby mx.mailbox.example.invalid with ESMTPS id r2; Mon, 12 Oct 2026 12:00:02 +0200',
  'Received: from app.own.example.invalid (app.own.example.invalid [192.0.2.5])\r\n\tby smtp.provider.example.invalid with ESMTPSA id s1; Mon, 12 Oct 2026 12:00:01 +0200',
  'Subject: SYNTHETIC','',
 ].join('\r\n')})
 const packet:ControlledLiveInput={now:new Date('2000-01-01'),tenantId:COMPANY,environment:'test',incident:{id:'SYNTHETIC-inc-1',tenantId:COMPANY,status:'corrected',correctionRef:'SYNTHETIC-fix-1'},route:{id:ROUTE,tenantId:COMPANY,environment:'test',counterpartyId:PARTY,profileId:PROFILE,permittedCertificateFingerprints:[FP]},certificate:{fingerprint:FP,tenantId:COMPANY,environment:'test',notBefore:before,notAfter:after,revoked:false},profile:{id:PROFILE,tenantId:COMPANY,environment:'test'},counterpartyAgreement:{ref:'SYNTHETIC-agr-1',counterpartyId:PARTY,tenantId:COMPANY,environment:'test',routeId:ROUTE,validFrom:before,validTo:after},liveMandate:null,plan:{references:[MESSAGE],source:'single_controlled',resend:null},relayEvidence:{verdict:tlsTrace,evidenceRef:'SYNTHETIC-retained-relay-reference',routeId:ROUTE,tenantId:COMPANY,environment:'test'}}
 function rebaseSelectedFixture(){immutable.message=clone(message)}
 function protectedUnchanged(){
  expect(store.ediel_messages.slice(1)).toEqual(immutable.siblings)
  for(const key of ['id','company_id','direction','environment','communication_route_id','raw_payload','sender_ediel_id','receiver_ediel_id','receiver_email','application_reference','parsed_payload'])expect(message[key]).toEqual(immutable.message[key])
  expect(store.ediel_outbox[1]).toEqual(immutable.outbox);expect(store.ediel_message_events[0]).toEqual(immutable.events);expect(store.ediel_message_payloads[0]).toEqual(immutable.payload);expect(store.ediel_exchange_logs[0]).toEqual(immutable.exchange)
 }
 return {message,profile,runtime,certificate,packet,store,queries,rpcs,attempts,providerCalls,flags,readCounters,from,rpc,provider,projection,protectedUnchanged,rebaseSelectedFixture}
}

beforeEach(()=>{
 priorEnv=new Map(Object.keys(ENV).map(key=>[key,process.env[key]]));Object.assign(process.env,ENV)
 f=fixture();io.from=f.from;io.rpc=f.rpc;io.provider=f.provider;io.session={id:ACTOR,email:'actor@example.invalid'};io.cookie=COMPANY;io.sessionReadHook=null
})
afterEach(()=>{for(const [key,value] of priorEnv){if(value===undefined)delete process.env[key];else process.env[key]=value}})

it('one actual guarded send persists and reads the same accepted observation; protected nonempty siblings survive',async()=>{
 expect(evaluateControlledLiveReadiness({...f.packet,now:new Date()})).toMatchObject({ready:true,productionApproved:false})
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(result).toMatchObject({status:'transport_observed',messageId:MESSAGE,productionApproved:false,reasons:[]})
 expect(f.providerCalls).toHaveLength(1);expect(result.observedAt).toBe(f.projection()!.observedAt)
 expect(f.attempts.get(MESSAGE)?.accepted).toBe(true)
 expect(f.rpcs.filter(r=>r.name==='gridex_ediel_transport_attempt_v1').map(r=>(r.args as Row).p_input).map(s=>(s as Row).action)).toEqual(['prepare','enter','observe'])
 f.protectedUnchanged()
})
for(const [name,patch] of [
 ['incident correction',(p:ControlledLiveInput)=>{p.incident!.correctionRef=''}],
 ['agreement scope',(p:ControlledLiveInput)=>{p.counterpartyAgreement!.routeId=OTHER}],
 ['relay scope',(p:ControlledLiveInput)=>{p.relayEvidence!.routeId=OTHER}],
 ['route',(p:ControlledLiveInput)=>{p.route!.id=OTHER}],
 ['profile',(p:ControlledLiveInput)=>{p.profile!.id=OTHER}],
 ['certificate',(p:ControlledLiveInput)=>{p.certificate!.fingerprint='d'.repeat(64)}],
 ['blank',(p:ControlledLiveInput)=>{p.plan.references=[' ']}],
 ['duplicate',(p:ControlledLiveInput)=>{p.plan.references=[MESSAGE,MESSAGE]}],
 ['two',(p:ControlledLiveInput)=>{p.plan.references=[MESSAGE,OTHER]}],
 ['bulk',(p:ControlledLiveInput)=>{p.plan.source='bulk_import'}],
 ['blind',(p:ControlledLiveInput)=>{p.plan.resend={incidentId:null,diagnosis:null}}],
] as const)it('held without provider entry: '+name,async()=>{
 patch(f.packet);const r=await sendControlledLiveEdielMessage(f.packet)
 expect(r.status).toBe('held');expect(r.productionApproved).toBe(false);expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('foreign requested tenant cannot override current session and membership',async()=>{
 f.packet.tenantId=FOREIGN
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('current session permission denial is not caller-overridable',async()=>{
 f.flags.permission=false
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('registry/original guard rejection is real and cannot be promoted to success',async()=>{
 f.flags.registryMismatch=true
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('actual accepted historical observation replays without another provider entry or new observation clock',async()=>{
 const first=await sendControlledLiveEdielMessage(f.packet),before=f.providerCalls.length,observed=first.observedAt
 const second=await sendControlledLiveEdielMessage(f.packet)
 expect(second).toMatchObject({status:'already_observed',observedAt:observed,productionApproved:false});expect(f.providerCalls).toHaveLength(before);f.protectedUnchanged()
})
it('DATA uncertainty remains uncertain and never retries automatically',async()=>{
 f.flags.uncertain=true
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);expect(f.projection()).toBeNull()
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
it('accepted provider return plus failed persisted readback is uncertain, never complete or retried',async()=>{
 f.flags.readbackFailure=true
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
it('provider accepted return without a valid accepted journal is not completion',async()=>{
 f.flags.hideProjection=true
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})

for(const [name,patch] of [
 ['party UUID',()=>{f.profile.party_id=OTHER}],
 ['profile',()=>{f.profile.id=OTHER}],
 ['route disabled',()=>{f.runtime.communication_route_active=false}],
 ['stored recipient',()=>{f.message.receiver_email='different@example.invalid';f.rebaseSelectedFixture()}],
 ['certificate owner',()=>{f.certificate.owner_ediel_id='99999'}],
 ['certificate expired',()=>{f.certificate.valid_to=new Date(Date.now()-1000).toISOString()}],
] as const)it('held by actual stored binding: '+name,async()=>{
 patch();const r=await sendControlledLiveEdielMessage(f.packet)
 expect(r.status).toBe('held');expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
for(const wrong of [null,{ref:'SYNTHETIC-mandate',tenantId:COMPANY,environment:'production',incidentId:'wrong'}] as const)it('production mandate required and same-incident without provider entry',async()=>{
 f.packet.environment='production';f.packet.liveMandate=wrong as ControlledLiveInput['liveMandate']
 for(const r of [f.packet.route,f.packet.profile,f.packet.certificate,f.packet.counterpartyAgreement,f.packet.relayEvidence])r!.environment='production'
 // Matching modeled production metadata; no actual production send is entered.
 f.message.environment='production';f.profile.environment='production';f.runtime.environment='production';f.certificate.environment='production'
 f.profile.encryption_mode='smime';f.runtime.encryption_mode='smime';f.profile.transport_security_mode='required_encrypted';f.runtime.transport_security_mode='required_encrypted'
 f.rebaseSelectedFixture()
 const r=await sendControlledLiveEdielMessage(f.packet);expect(r.status).toBe('held');expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('actual stored production shadow is held by the explicit real controller guard; no ordinary sender entry',async()=>{
 f.packet.environment='production';f.packet.liveMandate={ref:'SYNTHETIC-mandate',tenantId:COMPANY,environment:'production',incidentId:f.packet.incident!.id}
 for(const r of [f.packet.route,f.packet.profile,f.packet.certificate,f.packet.counterpartyAgreement,f.packet.relayEvidence])r!.environment='production'
 f.message.environment='production';f.message.status='prepared';f.message.validation_report={productionMode:'shadow'}
 f.profile.environment='production';f.runtime.environment='production';f.certificate.environment='production'
 f.profile.encryption_mode='smime';f.runtime.encryption_mode='smime';f.profile.transport_security_mode='required_encrypted';f.runtime.transport_security_mode='required_encrypted'
 f.rebaseSelectedFixture()
 const r=await sendControlledLiveEdielMessage(f.packet);expect(r.status).toBe('held');expect(r.reasons.join(' ')).toMatch(/shadow/);expect(r.productionApproved).toBe(false)
 expect(f.providerCalls).toHaveLength(0);expect(f.attempts.size).toBe(0);f.protectedUnchanged()
})
it('ordinary guarded sender still reaches the same real journal path without the controlled wrapper',async()=>{
 await sendQueuedEdielMessage({actorUserId:ACTOR,edielMessageId:MESSAGE})
 expect(f.providerCalls).toHaveLength(1);expect(f.projection()).not.toBeNull();f.protectedUnchanged()
})


// Runtime-discriminant cases reach the real controller; no TypeScript cast is an admission guard.
for(const [name,change] of [
 ['unknown environment',(p:Row)=>{p.environment='unknown'}],
 ['unknown plan source',(p:Row)=>{(p.plan as Row).source='unknown'}],
 ['non-array references',(p:Row)=>{(p.plan as Row).references=MESSAGE}],
 ['non-string reference',(p:Row)=>{(p.plan as Row).references=[17]}],
 ['non-array fingerprints',(p:Row)=>{(p.route as Row).permittedCertificateFingerprints=FP}],
 ['invalid certificate date',(p:Row)=>{(p.certificate as Row).notAfter=new Date('invalid')}],
] as const)it('runtime malformed packet is held: '+name,async()=>{
 change(f.packet as unknown as Row)
 const r=await sendControlledLiveEdielMessage(f.packet)
 expect(r.status).toBe('held');expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})
it('caller packet mutations after the first await cannot change the captured one-message admission',async()=>{
 let changed=false
 io.sessionReadHook=async()=>{if(changed)return;await Promise.resolve();f.packet.plan.references=[OTHER];f.packet.incident!.correctionRef='';changed=true}
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(changed).toBe(true);expect(f.packet.plan.references).toEqual([OTHER])
 expect(result).toMatchObject({status:'transport_observed',messageId:MESSAGE,productionApproved:false})
 expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
async function waitPastActualClock(deadline:number){
 while(Date.now()<=deadline)await new Promise<void>(resolve=>setTimeout(resolve,Math.max(1,deadline-Date.now()+1)))
}
it('final fresh clock rejects an initially valid agreement after a real preparation wait crosses expiry',async()=>{
 const deadline=Date.now()+500;f.packet.counterpartyAgreement!.validTo=new Date(deadline)
 let entered:number|undefined,left:number|undefined
 f.flags.beforeProjection=async()=>{
  entered=Date.now();expect(entered).toBeLessThan(deadline)
  expect(evaluateControlledLiveReadiness({...f.packet,now:new Date()})).toMatchObject({ready:true})
  await waitPastActualClock(deadline);left=Date.now()
 }
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(entered).toBeDefined();expect(left).toBeGreaterThan(deadline)
 expect(result.status).toBe('held');expect(result.reasons).toContain('counterparty_agreement_not_valid_now')
 expect(f.providerCalls).toHaveLength(0);expect(f.attempts.size).toBe(0);f.protectedUnchanged()
})
it('the same real preparation wait still admits a valid agreement without a fake clock',async()=>{
 const started=Date.now(),deadline=started+60_000;f.packet.counterpartyAgreement!.validTo=new Date(deadline)
 let entered:number|undefined,left:number|undefined
 f.flags.beforeProjection=async()=>{entered=Date.now();await waitPastActualClock(entered+50);left=Date.now()}
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(entered).toBeDefined();expect(left!-entered!).toBeGreaterThanOrEqual(50);expect(left).toBeLessThan(deadline)
 expect(result.status).toBe('transport_observed');expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
it('provider return without the required real entry callback cannot complete a transport',async()=>{
 f.flags.skipCallback=true
 await expect(sendControlledLiveEdielMessage(f.packet)).rejects.toThrow()
 expect(f.providerCalls).toHaveLength(1);expect(f.projection()).toBeNull();f.protectedUnchanged()
})

// Review A-OPS04-04308-01: runtime unknown flags cannot inherit boolean false semantics.
for(const [name,value] of [['missing',undefined],['null',null],['zero',0],['empty string','']] as const)it('required certificate revocation refuses malformed runtime value: '+name,async()=>{
 const certificate=f.packet.certificate as unknown as Row
 if(name==='missing')delete certificate.revoked;else certificate.revoked=value
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(f.providerCalls).toHaveLength(0);expect(result.status).toBe('held');expect(result.productionApproved).toBe(false);f.protectedUnchanged()
})
it('explicit boolean true revocation is held while the existing false-valued positive stays valid',async()=>{
 f.packet.certificate!.revoked=true
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(result.status).toBe('held');expect(f.providerCalls).toHaveLength(0);f.protectedUnchanged()
})

// B-OPS04-04308-01: finite concurrent actor changes real stored rows; no success guard mock.
const ALT_ROUTE='00000000-0000-4000-8000-000000000012',ALT_PROFILE='00000000-0000-4000-8000-000000000013',ALT_PARTY='00000000-0000-4000-8000-000000000014'
function installOtherValidRoute(){
 f.store.ediel_route_profiles.push({...clone(f.profile),id:ALT_PROFILE,communication_route_id:ALT_ROUTE,party_id:ALT_PARTY})
 f.store.ediel_route_runtime_v.push({...clone(f.runtime),id:ALT_PROFILE,route_profile_id:ALT_PROFILE,communication_route_id:ALT_ROUTE,party_id:ALT_PARTY})
}
for(const kind of ['route','wire'] as const)it('concurrent valid stored '+kind+' drift between wrapper and sender is refused before provider entry',async()=>{
 installOtherValidRoute();let changed=false
 f.flags.beforeProjection=async()=>{await Promise.resolve();if(kind==='route')f.message.communication_route_id=ALT_ROUTE;else f.message.raw_payload=String(f.message.raw_payload).replace('SYNOPS04DOC','SYNOPS04DOC2');f.rebaseSelectedFixture();changed=true}
 let failure:unknown;try{await sendControlledLiveEdielMessage(f.packet)}catch(error){failure=error}
 expect(changed).toBe(true);expect(f.providerCalls).toHaveLength(0)
 expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toBe('ops04_controlled_message_binding_changed');f.protectedUnchanged()
})
it('same deferred stored-read wait with unchanged admitted row still sends one guarded flow',async()=>{
 installOtherValidRoute();let waited=false
 f.flags.beforeProjection=async()=>{await Promise.resolve();waited=true}
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(waited).toBe(true);expect(result.status).toBe('transport_observed');expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
for(const kind of ['profile','certificate'] as const)it('late actual transport '+kind+' reread stays bound to the controlled admission',async()=>{
 let changed=false
 f.flags.beforeProfileRead=async readNo=>{if(readNo!==3)return;await Promise.resolve();if(kind==='profile'){f.profile.id=ALT_PROFILE;f.profile.party_id=ALT_PARTY;f.runtime.route_profile_id=ALT_PROFILE;f.runtime.party_id=ALT_PARTY}else f.certificate.fingerprint_sha256='d'.repeat(64);changed=true}
 let failure:unknown;try{await sendControlledLiveEdielMessage(f.packet)}catch(error){failure=error}
 expect(changed).toBe(true);expect(f.readCounters.profiles).toBe(3);expect(f.providerCalls).toHaveLength(0)
 expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toBe('ops04_controlled_transport_binding_changed');f.protectedUnchanged()
})
it('same late transport profile-read wait with unchanged consumed facts remains a valid flow',async()=>{
 let waited=false
 f.flags.beforeProfileRead=async readNo=>{if(readNo===3){await Promise.resolve();waited=true}}
 const result=await sendControlledLiveEdielMessage(f.packet)
 expect(waited).toBe(true);expect(f.readCounters.profiles).toBe(3);expect(result.status).toBe('transport_observed');expect(f.providerCalls).toHaveLength(1);f.protectedUnchanged()
})
