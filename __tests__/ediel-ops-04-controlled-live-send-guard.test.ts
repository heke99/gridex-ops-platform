// masterplan: OPS-04, AT-OPS-04
//
// Behaviour tests for the OPS-04 controlled live send guard wired into the
// actual sendEdielMessageViaSmtp path. A controlled send carries a binding
// minted by issueControlledLiveBinding (what the explicit entry point
// sendControlledLiveEdielMessage does after its own server-side checks); the
// binding only selects the incident and plan, all evidence is read here. Supabase, provider and route loader are
// finite synthetic ports (as in the GOV-04 send-boundary test); the real guard,
// evaluator, relay-trace evaluator, validator and journal fence run. All
// identifiers are SYNTHETIC. This proves application behaviour only: it is not
// a native PostgreSQL execution, a counterparty test or market activation.
import {createHash} from 'node:crypto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),registry:vi.fn(),route:vi.fn(),events:[] as unknown[],archives:[] as unknown[],attempts:[] as Record<string,unknown>[],providerCalls:0,observedAt:null as string|null,
 rpcNames:[] as string[],tables:[] as string[],rows:{} as Record<string,Record<string,unknown>|null>,incident:null as null|((args:Record<string,unknown>)=>unknown),native:null as null|{data:unknown;error:unknown},
 probe:null as null|((args:Record<string,unknown>)=>{data:unknown;error:unknown}),recovery:null as null|((args:Record<string,unknown>)=>{data:unknown;error:unknown}),forceConsumptionReplay:false,consumed:{} as Record<string,string>,consumptions:[] as Record<string,unknown>[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async original=>({...await original<typeof import('@/lib/ediel/rulebook/canonicalRulePackRegistry')>(),resolveCanonicalRulePack:io.registry}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:io.route,createEdielMessageEvent:async(input:unknown)=>{io.events.push(structuredClone(input))}}))
// The existing scoped production capability gate runs (and is proven) before
// OPS-04; it is a finite pass here so production OPS-04 refusals are reached.
vi.mock('@/lib/ediel/scopedCapabilityReadiness',()=>({assertScopedEdielProductionCapability:async()=>{}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'sender@example.invalid',provider:'strato',appLevelDkimEnabled:false})}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:async(input:{to:string;finalProviderGate?:(actual:Readonly<Record<string,unknown>>)=>Promise<void>},entry:{beforeProviderCall:(actual:Record<string,unknown>)=>Promise<void>})=>{
 const actual={mode:'attachment',from:'sender@example.invalid',to:input.to,rfcMessageId:'<synthetic-ops04@example.invalid>',mimeArchiveRef:'finite-archive',mimeSha256:'e'.repeat(64),mimeLength:123,mimePayloadSnapshotId:'00000000-0000-4000-8000-000000000099'}
 await entry.beforeProviderCall(actual)
 await input.finalProviderGate?.(Object.freeze(structuredClone(actual)))
 io.providerCalls++
 return {accepted:[input.to],rejected:[],messageId:'synthetic-provider',response:'250 synthetic acceptance'}
}}))
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {SmtpDeliveryUncertainError} from '@/lib/ediel/transport/smtpOutcome'
import {CONTROLLED_FLOW_PROBE_RPC,CONTROLLED_LIVE_CONSUME_RPC,CONTROLLED_LIVE_EVIDENCE_RPC,CONTROLLED_LIVE_REFUSED,controlledCertificateFingerprint,issueControlledLiveBinding,selectControlledCertificateId,type ControlledLiveBinding,type ControlledLiveSelection} from '@/lib/ediel/transport/controlledLiveSendGuard'

const C='00000000-0000-4000-8000-000000000002',OTHER='00000000-0000-4000-8000-0000000000ff'
const INC='00000000-0000-4000-8000-0000000000a1',ROUTE='00000000-0000-4000-8000-0000000000b1',COMM='00000000-0000-4000-8000-0000000000b2'
const CERT='00000000-0000-4000-8000-0000000000c1',PROF='00000000-0000-4000-8000-0000000000d1',CP='00000000-0000-4000-8000-0000000000e1'
const MSG='00000000-0000-4000-8000-000000000001',AGR='00000000-0000-4000-8000-0000000000e2',MAN='00000000-0000-4000-8000-0000000000e3',ORIGINAL='00000000-0000-4000-8000-0000000000f2'
const profile='00000000-0000-4000-8000-000000000003',pack='00000000-0000-4000-8000-000000000004'
const snapshot={profileKey:'UTILTS:E66:25-A-4',profileVersionId:profile,version:'25-A-4',checksum:'a'.repeat(64)}
const actor='synthetic-operator'
const tlsHeaders=['Authentication-Results: mx.mailbox.example.invalid; spf=pass smtp.mailfrom=own.example.invalid',
 'Received: from smtp.provider.example.invalid (smtp.provider.example.invalid [192.0.2.10])\r\n\tby mx.mailbox.example.invalid with ESMTPS id r2; Mon, 05 Oct 2026 10:00:02 +0200',
 'Received: from app.own.example.invalid (app.own.example.invalid [192.0.2.5])\r\n\tby smtp.provider.example.invalid with ESMTPSA id s1; Mon, 05 Oct 2026 10:00:01 +0200','Subject: SYNTHETIC',''].join('\r\n')
type Env='test'|'production'
// Server-side resend classification: the existing protected recovery operation binding of the stored row.
const RECOVERY_BASIS_RPC='ediel_prodat_recovery_original_basis_v1',RECOVERY_OP='00000000-0000-4000-8000-0000000000c7',UNRELATED='00000000-0000-4000-8000-0000000000f9'

// Legacy payload marker: never a selection channel, only refused without a server binding.
const marker=(over:Record<string,unknown>={})=>({schema:'gridex_ops04_controlled_flow_v1',incidentId:INC,references:[MSG],source:'single_controlled',resend:null,...over})
// Entry-point selection: identifiers and the plan only.
const sel=(plan:Partial<ControlledLiveSelection['plan']>={},incidentId=INC):ControlledLiveSelection=>({incidentId,plan:{references:[MSG],source:'single_controlled',resend:null,...plan}})
function queued(over:Partial<EdielMessageRow>={},flow:unknown=null):EdielMessageRow{
 const base=energyHandoffMessage('2026-09-30',C)
 return {...base,raw_payload:base.raw_payload!.replaceAll('\n',''),id:MSG,direction:'outbound',status:'queued',message_received_at:null,
  receiver_email:'receiver@example.invalid',mime_type:'application/edifact',communication_route_id:COMM,parsed_payload:flow===null?{}:{ops04ControlledLiveFlow:flow},...over} as EdielMessageRow
}
const routeRow=(env:Env='test',over:Record<string,unknown>={})=>({id:ROUTE,company_id:C,communication_route_id:COMM,is_enabled:true,is_active:true,environment:env,counterparty_id:CP,
 transport_profile_id:PROF,receiver_certificate_id:CERT,certificate_id:null,transport_security_mode:'unencrypted',encryption_mode:'none',tls_required:true,payload_format:'edifact',...over})
const certRow=(env:Env='test',over:Record<string,unknown>={})=>({id:CERT,company_id:C,environment:env,status:'active',fingerprint_sha256:'AA:BB',valid_from:'2026-01-01T00:00:00Z',valid_to:'2027-01-01T00:00:00Z',...over})
const profRow=(env:Env='test',over:Record<string,unknown>={})=>({id:PROF,company_id:C,environment:env,is_active:true,...over})
const receipt=(env:Env='test',company=C)=>({incidentId:INC,commandId:'00000000-0000-4000-8000-0000000000f1',companyId:company,environment:env,sourceMessageId:ORIGINAL,ackMessageId:'00000000-0000-4000-8000-0000000000f3',
 scope:{scope:'message',reference:'synthetic-scope',outcome:'positive'},reportedAt:'2026-10-01T00:00:00Z',finding:{code:'late_internal_business_error',summary:'synthetic'},status:'reported',findingValidated:false,ackHistoryChanged:false,contactStatus:'held',correctionStatus:'held',trafficAuthorized:false})
const evidence=(env:Env='test',over:Record<string,unknown>={})=>({companyId:C,environment:env,incidentId:INC,routeProfileId:ROUTE,
 incidentCorrection:{companyId:C,environment:env,incidentId:INC,correctionRef:'synthetic-fix-1'},
 counterpartyAgreement:{id:AGR,companyId:C,environment:env,ref:'synthetic-agr-1',counterpartyId:CP,routeId:ROUTE,validFrom:'2026-10-01T00:00:00Z',validTo:'2026-10-31T00:00:00Z',consumedByMessageId:null},
 liveMandate:env==='production'?{id:MAN,companyId:C,environment:env,ref:'synthetic-mandate-1',incidentId:INC,consumedByMessageId:null}:null,
 relayCapture:{companyId:C,environment:env,evidenceRef:'synthetic-relay-1',routeId:ROUTE,rawHeaders:tlsHeaders},...over})

function bind(env:Env='test'){
 io.route.mockResolvedValue(routeRow(env));io.rows={ediel_certificates:certRow(env),ediel_transport_profiles:profRow(env)}
 io.incident=()=>receipt(env);io.native={data:evidence(env),error:null}
 io.probe=args=>({data:{companyId:args.p_company_id,environment:args.p_environment,messageId:args.p_message_id,controlled:true},error:null})
}

beforeEach(()=>{
 vi.useFakeTimers().setSystemTime(new Date('2026-10-05T09:00:00Z'));vi.clearAllMocks()
 io.events=[];io.archives=[];io.attempts=[];io.providerCalls=0;io.observedAt=null;io.rpcNames=[];io.tables=[];io.forceConsumptionReplay=false;io.consumed={};io.consumptions=[];io.recovery=null
 io.registry.mockResolvedValue({databaseProfileKey:snapshot.profileKey,profileKey:snapshot.profileKey,messageProfileId:profile,originalVersion:snapshot.version,sourceHash:snapshot.checksum,originalSnapshot:{guideRevision:snapshot.version}})
 bind()
 io.from.mockImplementation((table:string)=>{
  io.tables.push(table)
  if(table==='ediel_certificates'||table==='ediel_transport_profiles'){
   const filters:Record<string,unknown>={}
   const q={select:()=>q,eq:(c:string,v:unknown)=>{filters[c]=v;return q},maybeSingle:async()=>{const row=io.rows[table];return {data:row&&row.id===filters.id&&row.company_id===filters.company_id?row:null,error:null}}}
   return q
  }
  if(table==='ediel_counterparties'){const q={select:()=>q,eq:()=>q,or:async()=>({data:[],error:null})};return q}
  if(table==='ediel_messages'){const q={eq:()=>q,then:(callback:(r:{error:null})=>unknown)=>Promise.resolve(callback({error:null}))};return {update:()=>q}}
  if(table==='ediel_message_payloads')return {insert:async(input:unknown)=>{io.archives.push(structuredClone(input));return {error:null}}}
  throw new Error('UNEXPECTED_QUERY:'+table)
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  io.rpcNames.push(name)
  if(name==='ediel_read_fresh_business_incident_v1')return io.incident?{data:io.incident(args),error:null}:{data:null,error:{message:'not found'}}
  if(name===CONTROLLED_LIVE_EVIDENCE_RPC)return io.native??{data:null,error:{code:'PGRST202',message:'function not found'}}
  if(name===CONTROLLED_FLOW_PROBE_RPC)return io.probe?io.probe(args):{data:null,error:{code:'PGRST202',message:'function not found'}}
  // Protected PRODAT recovery link (message -> authorized recovery operation); NULL for every other row.
  if(name===RECOVERY_BASIS_RPC)return io.recovery?io.recovery(args):{data:null,error:null}
  if(name===CONTROLLED_LIVE_CONSUME_RPC){
   // Finite model of the unique consumption keys (agreement, mandate, message).
   const keys=[`a:${args.p_agreement_id}`,...(args.p_mandate_id?[`m:${args.p_mandate_id}`]:[])]
   const prior=keys.map(k=>io.consumed[k]).find(Boolean)
   if(prior&&prior!==args.p_message_id)return {data:null,error:{code:'P0001',message:'ediel_ops04_authorization_consumed'}}
   for(const k of keys)io.consumed[k]=String(args.p_message_id)
   if(!prior&&!io.forceConsumptionReplay)io.consumptions.push(structuredClone(args))
   return {data:{consumptionId:'00000000-0000-4000-8000-0000000000c9',companyId:args.p_company_id,environment:args.p_environment,messageId:args.p_message_id,agreementId:args.p_agreement_id,mandateId:args.p_mandate_id,replayed:!!prior||io.forceConsumptionReplay},error:null}
  }
  if(name==='gridex_ediel_negative_fixture_read_v1')return {data:null,error:null}
  if(name==='gridex_ediel_accepted_transport_projection_v1'||name==='gridex_ediel_repair_accepted_transport_projection_v1'){
   if(!io.attempts.some(x=>x.action==='observe'&&Array.isArray((x.result as Record<string,unknown>).accepted)))return {data:null,error:null}
   const row=queued()
   return {data:{status:'accepted_projection',companyId:row.company_id,environment:row.environment,messageId:row.id,attemptId:io.attempts[0].attemptId,lane:'generic_journal',originalHash:createHash('sha256').update(row.raw_payload!).digest('hex'),observedAt:io.observedAt,frozenRecipient:row.receiver_email,providerReceipt:{accepted:[row.receiver_email],rejected:[],messageId:'synthetic-provider',response:'250 synthetic acceptance'},businessExpectationPlan:null,authorizesProviderEntry:false,deliveryProven:false,projectionStatus:'sent'},error:null}
  }
  if(name==='ediel_metering_method_change_send_basis_v1')return {data:{version:1,kind:'not_applicable',companyId:args.p_company_id,environment:'test',messageId:args.p_message_id,sourcePayloadHash:createHash('sha256').update(queued().raw_payload!).digest('hex'),intentId:undefined},error:null}
  if(name==='ediel_capture_source_rule_pack_basis_v1')return {data:{rulePackId:pack,messageProfileId:profile,profileKey:snapshot.profileKey,version:snapshot.version,sourceHash:snapshot.checksum,snapshot},error:null}
  if(name==='ediel_reserve_wire_reference_namespace_v1')return {data:null,error:null}
  if(name==='gridex_ediel_transport_attempt_v1'){
   const input=args.p_input as Record<string,unknown>;io.attempts.push(structuredClone(input))
   if(input.action==='observe')io.observedAt=new Date().toISOString()
   return {data:input.action==='observe'?{classification:(input.result as Record<string,unknown>).accepted?'accepted':'unknown',observedAt:new Date().toISOString()}:{proceed:true},error:null}
  }
  throw new Error('UNEXPECTED_RPC:'+name)
 })
})
afterEach(()=>vi.useRealTimers())

const unbound=()=>{io.probe=args=>({data:{companyId:args.p_company_id,environment:args.p_environment,messageId:args.p_message_id,controlled:false},error:null})}
const ops04Reads=()=>io.rpcNames.filter(n=>n.startsWith('gridex_ediel_ops04'))
function failRpc(target:string,result:()=>Promise<{data:unknown;error:unknown}>){
 const base=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{if(name!==target)return base(name,args);io.rpcNames.push(name);return result()})
}
// Mint a binding from the CURRENT synthetic route/certificate rows without recording a loader call.
async function bindingFor(row:EdielMessageRow,selection:ControlledLiveSelection):Promise<ControlledLiveBinding>{
 const route=await io.route.getMockImplementation()?.(row.communication_route_id,{companyId:row.company_id}) as Record<string,unknown>|null
 const certificateId=selectControlledCertificateId(route)
 const cert=io.rows.ediel_certificates
 const fingerprint=cert&&cert.id===certificateId&&cert.company_id===row.company_id?controlledCertificateFingerprint(cert):''
 const fixed=evidence(row.environment as Env),relay=fixed.relayCapture
 return issueControlledLiveBinding({messageSnapshot:JSON.stringify(row),routeProfileSnapshot:JSON.stringify(route),certificateId:certificateId as string,certificateFingerprint:fingerprint,selection,
  evidenceSnapshot:{agreementId:AGR,mandateId:row.environment==='production'?MAN:null,correctionRef:fixed.incidentCorrection!.correctionRef,relayEvidenceRef:relay!.evidenceRef,relayHeadersHash:createHash('sha256').update(relay!.rawHeaders,'utf8').digest('hex')}})
}
const send=async(row:EdielMessageRow,selection:ControlledLiveSelection|null=sel())=>sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',
 controlledBinding:selection?await bindingFor(row,selection):undefined})
// Only this attempt's NEW effects are asserted absent; a worker row may already carry an outbox id.
function expectNoSideEffect(row:EdielMessageRow,before:EdielMessageRow){
 expect(io.providerCalls).toBe(0);expect(io.attempts).toEqual([]);expect(io.archives).toEqual([]);expect(io.events).toEqual([]);expect(io.consumptions).toEqual([])
 expect(io.rpcNames).not.toContain('ediel_reserve_wire_reference_namespace_v1');expect(io.tables).not.toContain('ediel_messages')
 expect(row).toEqual(before)
}
async function refused(row:EdielMessageRow,reason:string,selection:ControlledLiveSelection|null=sel()){
 const before=structuredClone(row)
 const error=await send(row,selection).then(()=>null,(e:unknown)=>e as Error)
 expect(error?.message).toContain(CONTROLLED_LIVE_REFUSED);expect(error?.message).toContain(reason)
 expectNoSideEffect(row,before)
}

// A refusal at the final authority point preserves lawful entered-journal audit.
async function refusedAfterEntry(row:EdielMessageRow,reason:string,selection:ControlledLiveSelection=sel()){
 const error=await send(row,selection).then(()=>null,(e:unknown)=>e as Error)
 expect(error).toBeInstanceOf(SmtpDeliveryUncertainError)
 expect(error?.message).toContain(CONTROLLED_LIVE_REFUSED);expect(error?.message).toContain(reason)
 expect(io.providerCalls).toBe(0);expect(io.consumptions).toEqual([])
 expect(io.attempts.map(x=>x.action)).toEqual(['prepare','enter','observe'])
 expect(io.attempts.at(-1)?.result).toHaveProperty('error')
}

describe('OPS-04 controlled live send guard on the actual SMTP path',()=>{
 it('a fully bound controlled flow in its own tenant and environment proceeds to exactly one provider send',async()=>{
  const row=queued()
  const sent=await send(row)
  expect(sent.accepted).toEqual([row.receiver_email]);expect(io.providerCalls).toBe(1)
  expect(io.attempts.map(x=>x.action)).toEqual(['prepare','enter','observe'])
  const nativeCall=io.rpc.mock.calls.find(([n])=>n===CONTROLLED_LIVE_EVIDENCE_RPC)
  expect(nativeCall?.[1]).toEqual({p_company_id:C,p_environment:'test',p_actor_user_id:actor,p_message_id:row.id,p_incident_id:INC,p_route_profile_id:ROUTE})
  expect(io.rpc.mock.calls.find(([n])=>n==='ediel_read_fresh_business_incident_v1')?.[1]).toMatchObject({p_company_id:C,p_actor_user_id:actor,p_incident_id:INC})
  expect(io.route).toHaveBeenCalledWith(COMM,{companyId:C})
  expect(io.rpc.mock.calls.find(([n])=>n===CONTROLLED_FLOW_PROBE_RPC)?.[1]).toEqual({p_company_id:C,p_environment:'test',p_message_id:row.id,p_communication_route_id:COMM})
  expect(io.consumptions).toHaveLength(1)
  expect(io.consumptions[0]).toMatchObject({p_company_id:C,p_environment:'test',p_actor_user_id:actor,p_message_id:row.id,p_incident_id:INC,p_route_profile_id:ROUTE,p_agreement_id:AGR,p_mandate_id:null,p_resend:false,
   p_binding:{certificateId:CERT,certificateFingerprint:'aabb',relayEvidenceRef:'synthetic-relay-1',provider:{to:row.receiver_email,mimeSha256:'e'.repeat(64)}}})
  const consumeIndex=io.rpc.mock.calls.findIndex(([name])=>name===CONTROLLED_LIVE_CONSUME_RPC)
  const enterIndex=io.rpc.mock.calls.findIndex(([name,args])=>name==='gridex_ediel_transport_attempt_v1'&&(args.p_input as Record<string,unknown>).action==='enter')
  expect(consumeIndex).toBeGreaterThan(enterIndex)
 })

 it('a normal route-less send without the marker is unaffected and makes no OPS-04 read at all',async()=>{
  io.route.mockResolvedValue(null);io.incident=null;io.native=null;io.probe=null
  const row=queued({communication_route_id:null})
  const sent=await send(row,null)
  expect(sent.accepted).toEqual([row.receiver_email]);expect(io.providerCalls).toBe(1)
  expect(io.rpcNames).not.toContain(CONTROLLED_FLOW_PROBE_RPC);expect(io.rpcNames).not.toContain(CONTROLLED_LIVE_EVIDENCE_RPC);expect(io.rpcNames).not.toContain('ediel_read_fresh_business_incident_v1')
  expect(io.tables).not.toContain('ediel_certificates');expect(io.tables).not.toContain('ediel_transport_profiles')
 })
 it('a normal routed send on a route without a server binding makes exactly one scoped probe and is otherwise unaffected',async()=>{
  io.incident=null;io.native=null;unbound()
  const row=queued()
  const sent=await send(row,null)
  expect(sent.accepted).toEqual([row.receiver_email]);expect(io.providerCalls).toBe(1)
  expect(io.rpcNames.filter(n=>n===CONTROLLED_FLOW_PROBE_RPC)).toHaveLength(1)
  expect(io.rpcNames).not.toContain(CONTROLLED_LIVE_EVIDENCE_RPC);expect(io.rpcNames).not.toContain(CONTROLLED_LIVE_CONSUME_RPC);expect(io.rpcNames).not.toContain('ediel_read_fresh_business_incident_v1')
  expect(io.tables).not.toContain('ediel_certificates');expect(io.tables).not.toContain('ediel_transport_profiles')
 })

 it('without the native evidence source (current schema) every declared controlled flow is refused',async()=>{
  io.native=null
  await refused(queued(),'controlled_live_evidence_unavailable')
 })
 it('an incident that is only reported (no correction) is refused',async()=>{
  io.native={data:evidence('test',{incidentCorrection:null}),error:null}
  await refused(queued(),'incident_not_corrected')
 })
 it('an incident read in another tenant scope is refused',async()=>{
  io.incident=()=>receipt('test',OTHER)
  await refused(queued(),'incident_trace_unreadable')
 })
 it('a route of another tenant is refused',async()=>{
  io.route.mockResolvedValue(routeRow('test',{company_id:OTHER}))
  await refused(queued(),'route_tenant_mismatch')
 })
 it('native evidence echoed for another tenant is refused',async()=>{
  io.native={data:evidence('test',{companyId:OTHER}),error:null}
  await refused(queued(),'controlled_live_evidence_scope_mismatch')
 })
 it('evidence items bound to another tenant are refused',async()=>{
  io.native={data:evidence('test',{counterpartyAgreement:{...evidence().counterpartyAgreement,companyId:OTHER}}),error:null}
  await refused(queued(),'counterparty_agreement_tenant_mismatch')
 })
 it('a route of another environment is refused',async()=>{
  io.route.mockResolvedValue(routeRow('production'))
  await refused(queued(),'route_environment_mismatch')
 })
 it('an incident of another environment is refused',async()=>{
  io.incident=()=>receipt('production')
  await refused(queued(),'incident_environment_mismatch')
 })
 it('a missing route is refused',async()=>{
  io.route.mockResolvedValue(null)
  await refused(queued(),'route_missing')
 })
 it('a disabled route is refused',async()=>{
  io.route.mockResolvedValue(routeRow('test',{is_enabled:false}))
  await refused(queued(),'route_disabled')
 })
 it('a message bound to a different route profile is refused',async()=>{
  await refused(queued({route_profile_id:'00000000-0000-4000-8000-0000000000b9'}),'message_route_profile_mismatch')
 })
 it('agreement for another route is refused',async()=>{
  io.native={data:evidence('test',{counterpartyAgreement:{...evidence().counterpartyAgreement,routeId:'other-route'}}),error:null}
  await refused(queued(),'counterparty_agreement_route_mismatch')
 })
 it('a missing transport profile is refused',async()=>{
  io.rows.ediel_transport_profiles=null
  await refused(queued(),'profile_missing')
 })
 it('a profile of another environment is refused',async()=>{
  io.rows.ediel_transport_profiles=profRow('production')
  await refused(queued(),'profile_environment_mismatch')
 })
 it('an inactive profile is refused',async()=>{
  io.rows.ediel_transport_profiles=profRow('test',{is_active:false})
  await refused(queued(),'profile_missing')
 })
 it('a revoked certificate is refused',async()=>{
  io.rows.ediel_certificates=certRow('test',{status:'revoked'})
  await refused(queued(),'certificate_revoked')
 })
 it('an expired certificate is refused',async()=>{
  io.rows.ediel_certificates=certRow('test',{valid_to:'2026-10-01T00:00:00Z'})
  await refused(queued(),'certificate_not_valid_now')
 })
 it('a certificate of another tenant is not loaded and is refused',async()=>{
  io.rows.ediel_certificates=certRow('test',{company_id:OTHER})
  await refused(queued(),'certificate_missing')
 })
 it('a missing counterparty test agreement is refused',async()=>{
  io.native={data:evidence('test',{counterpartyAgreement:null}),error:null}
  await refused(queued(),'counterparty_agreement_missing')
 })
 it('a production controlled flow without a LIVE mandate is refused before any production send step',async()=>{
  bind('production');io.native={data:evidence('production',{liveMandate:null}),error:null}
  await refused(queued({environment:'production'}),'live_mandate_missing')
 })
 it('a LIVE mandate for another incident is refused',async()=>{
  bind('production');io.native={data:evidence('production',{liveMandate:{id:MAN,companyId:C,environment:'production',ref:'m',incidentId:'00000000-0000-4000-8000-0000000000a9',consumedByMessageId:null}}),error:null}
  await refused(queued({environment:'production'}),'live_mandate_incident_mismatch')
 })
 it('a bulk reference import is refused',async()=>{
  await refused(queued(),'bulk_reference_import_not_a_test_strategy',sel({source:'bulk_import'}))
 })
 it('more than one reference is refused',async()=>{
  await refused(queued(),'plan_not_single_controlled_flow',sel({references:[MSG,'r2']}))
 })
 it('a blind resend without diagnosis is refused',async()=>{
  await refused(queued({original_message_id:ORIGINAL}),'blind_resend_not_a_test_strategy',sel({resend:{incidentId:INC,diagnosis:null}}))
 })
 it('a resend citing another incident is refused',async()=>{
  await refused(queued({original_message_id:ORIGINAL}),'blind_resend_not_a_test_strategy',sel({resend:{incidentId:'00000000-0000-4000-8000-0000000000a9',diagnosis:'synthetic'}}))
 })
 it('a relay trace with a plaintext hop is refused',async()=>{
  io.native={data:evidence('test',{relayCapture:{...evidence().relayCapture,rawHeaders:tlsHeaders.replace('with ESMTPS id r2','with ESMTP id r2')}}),error:null}
  await refused(queued(),'relay_trace_not_verified')
 })
 it('a malformed controlled-flow marker is refused',async()=>{
  await refused(queued({},{schema:'gridex_ops04_controlled_flow_v1',incidentId:INC}),'controlled_flow_marker_invalid',null)
 })

 // Server-side activation (review finding 1).
 it('a server-bound route without an entry-point binding is refused: no other path can send on it',async()=>{
  await refused(queued(),'controlled_flow_entry_point_required',null)
  expect(ops04Reads()).toEqual([CONTROLLED_FLOW_PROBE_RPC])
 })
 it('a marker without a server-side binding is refused: the payload cannot self-activate',async()=>{
  unbound()
  await refused(queued({},marker()),'controlled_flow_binding_missing',null)
  expect(ops04Reads()).toEqual([CONTROLLED_FLOW_PROBE_RPC])
 })
 it('an entry-point binding without server-side evidence for the route is refused',async()=>{
  unbound()
  await refused(queued(),'controlled_flow_binding_missing')
  expect(ops04Reads()).toEqual([CONTROLLED_FLOW_PROBE_RPC])
 })
 it('a hand-built binding not minted by the entry point is refused without any read',async()=>{
  const row=queued(),before=structuredClone(row)
  const forged={...await bindingFor(row,sel())}
  const error=await sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',controlledBinding:forged}).then(()=>null,(e:unknown)=>e as Error)
  expect(error?.message).toContain('controlled_binding_not_issued');expect(ops04Reads()).toEqual([])
  expectNoSideEffect(row,before)
 })
 it('an issued binding is frozen: the caller cannot rewrite its selection',async()=>{
  const binding=await bindingFor(queued(),sel())
  expect(()=>{(binding.selection.plan.references as string[]).push('r2')}).toThrow()
  expect(Object.isFrozen(binding)).toBe(true)
 })
 it('an unavailable probe refuses a routed send (fail-closed)',async()=>{
  io.probe=null
  await refused(queued(),'controlled_flow_probe_unavailable',null)
 })
 it('a probe that throws refuses a routed send (fail-closed)',async()=>{
  failRpc(CONTROLLED_FLOW_PROBE_RPC,async()=>{throw new Error('socket hang up')})
  await refused(queued(),'controlled_flow_probe_unavailable',null)
 })
 it('a probe answering for another scope is refused',async()=>{
  io.probe=args=>({data:{companyId:OTHER,environment:args.p_environment,messageId:args.p_message_id,controlled:false},error:null})
  await refused(queued(),'controlled_flow_probe_scope_mismatch',null)
 })
 it('a marker without a route is refused without any OPS-04 read',async()=>{
  await refused(queued({communication_route_id:null},marker()),'route_missing',null)
  expect(ops04Reads()).toEqual([])
 })
 it('a binding without a route is refused without any OPS-04 read',async()=>{
  await refused(queued({communication_route_id:null}),'route_missing')
  expect(ops04Reads()).toEqual([])
 })
 for(const [label,value] of [['null',null],['an array',[marker()]],['a string',JSON.stringify(marker())]] as const){
  it(`a marker given as ${label} is refused as invalid before any OPS-04 read`,async()=>{
   await refused(queued({parsed_payload:{ops04ControlledLiveFlow:value}} as Partial<EdielMessageRow>),'controlled_flow_marker_invalid',null)
   expect(ops04Reads()).toEqual([])
  })
 }
 it('parsed_payload stored as a JSON string still carries the marker and cannot self-activate',async()=>{
  unbound()
  await refused(queued({parsed_payload:JSON.stringify({ops04ControlledLiveFlow:marker()})} as unknown as Partial<EdielMessageRow>),'controlled_flow_binding_missing',null)
 })
 it('an inert legacy marker beside an issued binding proceeds exactly once on the binding selection',async()=>{
  const row=queued({parsed_payload:JSON.stringify({ops04ControlledLiveFlow:marker({references:['ignored']})})} as unknown as Partial<EdielMessageRow>)
  await send(row);expect(io.providerCalls).toBe(1);expect(io.consumptions).toHaveLength(1)
 })
 it('parsed_payload stored as a non-JSON string on a bound route is refused',async()=>{
  await refused(queued({parsed_payload:'not json'} as unknown as Partial<EdielMessageRow>),'controlled_flow_entry_point_required',null)
 })
 it('the evidence RPC throwing is refused',async()=>{
  failRpc(CONTROLLED_LIVE_EVIDENCE_RPC,async()=>{throw new Error('socket hang up')})
  await refused(queued(),'controlled_live_evidence_unavailable')
 })
 // Single use (review finding 2).
 it('a second message against the same agreement is refused at consumption',async()=>{
  await send(queued());expect(io.providerCalls).toBe(1)
  io.providerCalls=0;io.attempts=[];io.archives=[];io.events=[];io.rpcNames=[];io.tables=[];io.consumptions=[]
  const SECOND='00000000-0000-4000-8000-000000000009'
  await refusedAfterEntry(queued({id:SECOND}),'controlled_live_authorization_consumed',sel({references:[SECOND]}))
  expect(ops04Reads()).toContain(CONTROLLED_LIVE_CONSUME_RPC)
 })
 it('evidence reporting the agreement consumed by another message is refused before consumption',async()=>{
  io.native={data:evidence('test',{counterpartyAgreement:{...evidence().counterpartyAgreement,consumedByMessageId:'00000000-0000-4000-8000-000000000009'}}),error:null}
  await refused(queued(),'controlled_live_authorization_consumed')
  expect(ops04Reads()).not.toContain(CONTROLLED_LIVE_CONSUME_RPC)
 })
 it('a production LIVE mandate already consumed by another message is refused',async()=>{
  bind('production');io.native={data:evidence('production',{liveMandate:{...evidence('production').liveMandate!,consumedByMessageId:'00000000-0000-4000-8000-000000000009'}}),error:null}
  await refused(queued({environment:'production'}),'controlled_live_authorization_consumed')
 })
 it('a consumption RPC failure preserves entered audit with zero provider progress',async()=>{
  failRpc(CONTROLLED_LIVE_CONSUME_RPC,async()=>({data:null,error:{message:'ediel_ops04_current_agreement_required'}}))
  await refusedAfterEntry(queued(),'controlled_live_consumption_unavailable')
 })
 it('a consumption RPC that throws preserves entered audit with zero provider progress',async()=>{
  failRpc(CONTROLLED_LIVE_CONSUME_RPC,async()=>{throw new Error('socket hang up')})
  await refusedAfterEntry(queued(),'controlled_live_consumption_unavailable')
 })
 it('a repeated same-message final consumption receipt never grants another provider entry',async()=>{
  io.forceConsumptionReplay=true
  await refusedAfterEntry(queued(),'controlled_live_authorization_consumed')
 })
 // Plan bound to the message (review finding 3).
 it('a plan reference that is not this message is refused',async()=>{
  await refused(queued(),'plan_reference_message_mismatch',sel({references:['synthetic-ref-1']}))
 })
 it('a diagnosed resend of the corrected original proceeds and is consumed as a resend',async()=>{
  await send(queued({original_message_id:ORIGINAL}),sel({resend:{incidentId:INC,diagnosis:'synthetic diagnosis'}}))
  expect(io.providerCalls).toBe(1);expect(io.consumptions[0]).toMatchObject({p_resend:true})
 })
 it('a resend whose original is not the incident source message is refused',async()=>{
  await refused(queued({original_message_id:'00000000-0000-4000-8000-0000000000f9'}),'resend_original_mismatch',sel({resend:{incidentId:INC,diagnosis:'synthetic diagnosis'}}))
 })
 it('a resend without an original message is refused',async()=>{
  await refused(queued({original_message_id:null}),'resend_original_mismatch',sel({resend:{incidentId:INC,diagnosis:'synthetic diagnosis'}}))
 })
 // Resend classification is derived server-side from the stored row, never from the caller's plan.
 const recoveryRow=(over:Partial<EdielMessageRow>={})=>queued({original_message_id:ORIGINAL,source_operation_id:RECOVERY_OP,...over})
 const storedRecovery=(over:Record<string,unknown>={})=>{io.recovery=args=>({error:null,data:args.p_company_id===C&&args.p_message_id===MSG&&args.p_actor_user_id===actor?{
  originalMessageId:ORIGINAL,sourceOriginMessageId:ORIGINAL,operationId:RECOVERY_OP,sourceAckMessageId:'00000000-0000-4000-8000-0000000000f3',kind:'contrl_correction',
  correctedPayloadHash:createHash('sha256').update(recoveryRow().raw_payload!,'utf8').digest('hex'),allowedObjects:[{point:null,identityAgency:null}],...over}:null})}
 const diagnosed=()=>sel({resend:{incidentId:INC,diagnosis:'synthetic diagnosis'}})
 it('a stored PRODAT recovery sent with plan.resend=null is held as a blind resend: no consumption, no SMTP',async()=>{
  storedRecovery()
  await refused(recoveryRow(),'blind_resend_not_a_test_strategy')
  expect(io.rpc.mock.calls.find(([n])=>n===RECOVERY_BASIS_RPC)?.[1]).toEqual({p_company_id:C,p_message_id:MSG,p_actor_user_id:actor})
  expect(io.rpcNames).not.toContain(CONTROLLED_LIVE_CONSUME_RPC)
 })
 it('a stored recovery without a source operation column is still classified by its protected binding and held',async()=>{
  storedRecovery()
  await refused(recoveryRow({source_operation_id:null,original_message_id:null}),'blind_resend_not_a_test_strategy')
 })
 it('a stored recovery declared as a resend for an incident on an unrelated message is held',async()=>{
  storedRecovery({originalMessageId:UNRELATED,sourceOriginMessageId:UNRELATED})
  await refused(recoveryRow({original_message_id:UNRELATED}),'resend_original_mismatch',diagnosed())
 })
 it('a stored recovery whose protected original is not the row original cited by the incident is held',async()=>{
  storedRecovery({originalMessageId:UNRELATED,sourceOriginMessageId:UNRELATED})
  await refused(recoveryRow(),'resend_original_mismatch',diagnosed())
 })
 it('a stored recovery whose protected operation or corrected payload is not this row is held',async()=>{
  storedRecovery({operationId:'00000000-0000-4000-8000-0000000000c8'})
  await refused(recoveryRow(),'resend_classification_mismatch',diagnosed())
  io.rpcNames=[];io.tables=[]
  storedRecovery({correctedPayloadHash:'f'.repeat(64)})
  await refused(recoveryRow(),'resend_classification_mismatch',diagnosed())
 })
 it('a stored recovery declared as a diagnosed resend of the incident original proceeds once as a resend',async()=>{
  storedRecovery()
  await send(recoveryRow(),diagnosed())
  expect(io.providerCalls).toBe(1);expect(io.consumptions).toHaveLength(1);expect(io.consumptions[0]).toMatchObject({p_resend:true})
 })
 it('an unreadable resend classification is held (fail-closed) before consumption or SMTP',async()=>{
  failRpc(RECOVERY_BASIS_RPC,async()=>({data:null,error:{message:'prodat_recovery_original_basis_unqualified'}}))
  await refused(recoveryRow(),'resend_classification_unavailable')
 })
 it('an ordinary row carrying original_message_id (as ACKs do) and no recovery binding is unaffected with resend=null',async()=>{
  const row=queued({original_message_id:ORIGINAL})
  const sent=await send(row)
  expect(sent.accepted).toEqual([row.receiver_email]);expect(io.providerCalls).toBe(1)
  expect(io.consumptions).toHaveLength(1);expect(io.consumptions[0]).toMatchObject({p_resend:false})
  expect(io.rpc.mock.calls.find(([n])=>n===RECOVERY_BASIS_RPC)?.[1]).toEqual({p_company_id:C,p_message_id:MSG,p_actor_user_id:actor})
 })
 it('an ordinary original carrying its own source operation id and no recovery binding is unaffected with resend=null',async()=>{
  await send(queued({source_operation_id:RECOVERY_OP}))
  expect(io.providerCalls).toBe(1);expect(io.consumptions[0]).toMatchObject({p_resend:false})
 })
 // Certificate selection mirrors the send path's `??` (review finding 4).
 it('an empty receiver certificate id is not replaced by the route certificate id',async()=>{
  io.route.mockResolvedValue(routeRow('test',{receiver_certificate_id:'',certificate_id:CERT}))
  await refused(queued(),'certificate_missing')
 })
 it('a null receiver certificate id falls back to the route certificate id like the send path',async()=>{
  io.route.mockResolvedValue(routeRow('test',{receiver_certificate_id:null,certificate_id:CERT}))
  await send(queued());expect(io.providerCalls).toBe(1)
 })
 // Existing paths keep working (review finding 5).
 it('the accepted-receipt repair path restores a consumed controlled message without new SMTP or OPS-04 reads',async()=>{
  const row=queued()
  await send(row);expect(io.providerCalls).toBe(1)
  io.rpcNames=[];io.consumptions=[]
  const attemptsBefore=io.attempts.length
  const repaired=await send(row)
  expect(repaired.accepted).toEqual([row.receiver_email]);expect(io.providerCalls).toBe(1)
  expect(io.attempts).toHaveLength(attemptsBefore);expect(io.consumptions).toEqual([]);expect(ops04Reads()).toEqual([])
  expect(io.rpcNames).toContain('gridex_ediel_repair_accepted_transport_projection_v1')
 })
 it('a worker-owned refused send adds no new effect (the row may already carry its outbox id)',async()=>{
  const row=queued()
  const before=structuredClone(row)
  const controlledBinding=await bindingFor(row,sel({references:['synthetic-ref-1']}))
  const error=await sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',dispatchOwner:{kind:'worker',outboxId:'00000000-0000-4000-8000-0000000000aa'} as never,controlledBinding}).then(()=>null,(e:unknown)=>e as Error)
  expect(error?.message).toContain('plan_reference_message_mismatch')
  expectNoSideEffect(row,before)
 })
 it('an unbound worker send on a controlled route is refused: the outbox cannot bypass the entry point',async()=>{
  const row=queued(),before=structuredClone(row)
  const error=await sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',dispatchOwner:{kind:'worker',outboxId:'00000000-0000-4000-8000-0000000000aa'} as never}).then(()=>null,(e:unknown)=>e as Error)
  expect(error?.message).toContain('controlled_flow_entry_point_required')
  expectNoSideEffect(row,before)
 })
 // TOCTOU binding (donor 2314f603d controlledBinding), now against server-read facts.
 it('a route profile changed between entry point and guard is refused before consumption',async()=>{
  const row=queued(),binding=await bindingFor(row,sel()),before=structuredClone(row)
  io.route.mockResolvedValue(routeRow('test',{tls_required:false}))
  const error=await sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',controlledBinding:binding}).then(()=>null,(e:unknown)=>e as Error)
  expect(error?.message).toContain('controlled_binding_route_changed')
  expectNoSideEffect(row,before)
 })
 it('a certificate fingerprint changed between entry point and guard is refused before consumption',async()=>{
  const row=queued(),binding=await bindingFor(row,sel()),before=structuredClone(row)
  io.rows.ediel_certificates=certRow('test',{fingerprint_sha256:'CC:DD'})
  const error=await sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',controlledBinding:binding}).then(()=>null,(e:unknown)=>e as Error)
  expect(error?.message).toContain('controlled_binding_certificate_changed')
  expectNoSideEffect(row,before)
 })
 it('the late send-path route profile read stays bound before final consumption',async()=>{
  const row=queued(),binding=await bindingFor(row,sel())
  io.route.mockResolvedValueOnce(routeRow()).mockResolvedValueOnce(routeRow('test',{tls_required:false}))
  const error=await sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',controlledBinding:binding}).then(()=>null,(e:unknown)=>e as Error)
  expect(error?.message).toBe('ops04_controlled_transport_binding_changed')
  expect(io.consumptions).toHaveLength(0);expect(io.providerCalls).toBe(0);expect(io.attempts).toEqual([])
 })
 it('the bound certificate changed during journal entry is refused by the final check',async()=>{
  const row=queued(),binding=await bindingFor(row,sel())
  const base=io.rpc.getMockImplementation()!
  io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{const r=await base(name,args);if(name==='gridex_ediel_transport_attempt_v1'&&(args.p_input as Record<string,unknown>).action==='enter')io.rows.ediel_certificates=certRow('test',{fingerprint_sha256:'CC:DD'});return r})
  const error=await sendEdielMessageViaSmtp(row,{actorUserId:actor,smtpMimeMode:'nodemailer-attachment',controlledBinding:binding}).then(()=>null,(e:unknown)=>e as Error)
  expect(error).toBeInstanceOf(SmtpDeliveryUncertainError);expect(error?.message).toContain('controlled_binding_certificate_changed')
  expect(io.consumptions).toHaveLength(0);expect(io.providerCalls).toBe(0);expect(io.attempts.map(x=>x.action)).toEqual(['prepare','enter','observe'])
 })
})
