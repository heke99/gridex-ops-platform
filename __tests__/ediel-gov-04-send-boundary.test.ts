// masterplan: GOV-04, AT-GOV-04
import {createHash} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

// Strict finite registry, source, archive and journal ports. The actual clock,
// complete validator, send guard, source-pack comparison and attempt fence run.
// This is application behavior, not PostgreSQL durability or market delivery.
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),registry:vi.fn(),route:vi.fn(),events:[] as unknown[],archives:[] as unknown[],attempts:[] as Record<string,unknown>[],providerCalls:0,originalRevision:'25-A-4',rollover:false,rolloverAction:'',observedAt:null as string|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async original=>({...await original<typeof import('@/lib/ediel/rulebook/canonicalRulePackRegistry')>(),resolveCanonicalRulePack:io.registry}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:io.route,createEdielMessageEvent:async(input:unknown)=>{io.events.push(structuredClone(input))}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'sender@example.invalid',provider:'strato',appLevelDkimEnabled:false})}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:async(input:{to:string},entry:{beforeProviderCall:(actual:Record<string,unknown>)=>Promise<void>})=>{
 if(io.rollover)vi.setSystemTime(new Date('2026-09-30T22:00:01Z'))
 await entry.beforeProviderCall({from:'sender@example.invalid',to:input.to,rfcMessageId:'<synthetic-gov04@example.invalid>',mimeArchiveRef:'finite-archive',mimeSha256:'e'.repeat(64),mimeLength:123})
 io.providerCalls++
 return {accepted:[input.to],rejected:[],messageId:'synthetic-provider',response:'250 synthetic acceptance'}
}}))
import {sendCorrectionFencedEmail} from '@/lib/ediel/sources/correctionOutboundDispatch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'

const profile='00000000-0000-4000-8000-000000000003',pack='00000000-0000-4000-8000-000000000004'
const identity=(revision:string)=>({profileKey:`UTILTS:E66:${revision}`,profileVersionId:profile,version:revision,checksum:(revision==='25-A-4'?'a':'b').repeat(64)})
const queued=()=>({...energyHandoffMessage('2026-09-30','00000000-0000-4000-8000-000000000002'),raw_payload:energyHandoffMessage('2026-09-30').raw_payload!.replaceAll('\n',''),id:'00000000-0000-4000-8000-000000000001',direction:'outbound',status:'queued',message_received_at:null,receiver_email:'receiver@example.invalid',mime_type:'application/edifact'} as EdielMessageRow)

beforeEach(()=>{
 vi.useFakeTimers().setSystemTime(new Date('2026-10-05T09:00:00Z'));vi.clearAllMocks()
 io.events=[];io.archives=[];io.attempts=[];io.providerCalls=0;io.originalRevision='25-A-4';io.rollover=false;io.rolloverAction='';io.observedAt=null
 io.registry.mockImplementation(async({canonicalPolicy}:{canonicalPolicy:{guide:{guideRevision:string}}})=>{
  const s=identity(canonicalPolicy.guide.guideRevision)
  return {databaseProfileKey:s.profileKey,profileKey:s.profileKey,messageProfileId:s.profileVersionId,originalVersion:s.version,sourceHash:s.checksum,originalSnapshot:{guideRevision:s.version}}
 })
 io.route.mockResolvedValue(null)
 io.from.mockImplementation((table:string)=>{
  if(table==='ediel_messages'){const q={eq:()=>q,then:(callback:(r:{error:null})=>unknown)=>Promise.resolve(callback({error:null}))};return {update:()=>q}}
  if(table==='ediel_message_payloads')return {insert:async(input:unknown)=>{io.archives.push(structuredClone(input));return {error:null}}}
  throw new Error('UNEXPECTED_QUERY:'+table)
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='gridex_ediel_negative_fixture_read_v1')return {data:null,error:null}
  if(name==='gridex_ediel_accepted_transport_projection_v1'||name==='gridex_ediel_repair_accepted_transport_projection_v1'){
   if(!io.attempts.some(x=>x.action==='observe'&&Array.isArray((x.result as Record<string,unknown>).accepted)))return {data:null,error:null}
   const row=queued()
   return {data:{status:'accepted_projection',companyId:row.company_id,environment:row.environment,messageId:row.id,attemptId:io.attempts[0].attemptId,lane:'generic_journal',originalHash:createHash('sha256').update(row.raw_payload!).digest('hex'),observedAt:io.observedAt,frozenRecipient:row.receiver_email,providerReceipt:{accepted:[row.receiver_email],rejected:[],messageId:'synthetic-provider',response:'250 synthetic acceptance'},businessExpectationPlan:null,authorizesProviderEntry:false,deliveryProven:false,projectionStatus:'sent'},error:null}
  }
  if(name==='ediel_metering_method_change_send_basis_v1')return {data:{version:1,kind:'not_applicable',companyId:args.p_company_id,environment:'test',messageId:args.p_message_id,sourcePayloadHash:createHash('sha256').update(queued().raw_payload!).digest('hex'),intentId:undefined},error:null}
  if(name==='ediel_capture_source_rule_pack_basis_v1'){
   const snapshot=identity(io.originalRevision)
   return {data:{rulePackId:pack,messageProfileId:profile,profileKey:snapshot.profileKey,version:snapshot.version,sourceHash:snapshot.checksum,snapshot},error:null}
  }
  if(name==='ediel_reserve_wire_reference_namespace_v1')return {data:null,error:null}
  if(name==='gridex_outbound_dispatch_v1'){
   const input=args.p_input as Record<string,unknown>;io.attempts.push(structuredClone(input))
   if(input.action===io.rolloverAction)vi.setSystemTime(new Date('2026-09-30T22:00:01Z'))
   return {data:{scoped:true,proceed:true,eventId:'synthetic-event',witnessed:true,facts:{classification:input.action==='result'&&!(input.result as Record<string,unknown>).accepted?'unknown':'accepted'},observationClock:'database_provider_result_capture',observedAt:new Date().toISOString()},error:null}
  }
  if(name==='gridex_ediel_transport_attempt_v1'){
   const input=args.p_input as Record<string,unknown>;io.attempts.push(structuredClone(input))
   if(input.action===io.rolloverAction)vi.setSystemTime(new Date('2026-09-30T22:00:01Z'))
   if(input.action==='observe')io.observedAt=new Date().toISOString()
   return {data:input.action==='observe'?{classification:(input.result as Record<string,unknown>).accepted?'accepted':'unknown',observedAt:new Date().toISOString()}:{proceed:true},error:null}
  }
  throw new Error('UNEXPECTED_RPC:'+name)
 })
})
afterEach(()=>vi.useRealTimers())

it('actual SMTP validates the current guide and binds the unchanged original bytes and decision before provider entry',async()=>{
 const row=queued(),before=structuredClone(row)
 const sent=await sendEdielMessageViaSmtp(row,{actorUserId:'synthetic-operator',smtpMimeMode:'nodemailer-attachment'})
 expect(sent.accepted).toEqual([row.receiver_email]);expect(io.providerCalls).toBe(1)
 expect(io.registry.mock.calls[0][0].canonicalPolicy.guide.guideRevision).toBe('25-A-4')
 expect(io.attempts.map(x=>x.action)).toEqual(['prepare','enter','observe'])
 expect(io.attempts[0].binding).toMatchObject({originalHash:createHash('sha256').update(before.raw_payload!).digest('hex'),admissionDecision:{referenceDate:'2026-10-05',guide:{guideRevision:'25-A-4'}},sourceRulePackEvidence:{version:'25-A-4'}})
 expect(row).toEqual(before);expect(io.archives.length).toBeGreaterThan(0)
})

it('a retained old queued original cannot gain the current guide label and preserves original history without provider entry',async()=>{
 const row=queued(),before=structuredClone(row);io.originalRevision='25-A-3'
 await expect(sendEdielMessageViaSmtp(row,{actorUserId:'synthetic-operator',smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow('ediel_send_original_rule_pack_mismatch')
 expect(io.providerCalls).toBe(0);expect(io.attempts).toEqual([]);expect(io.archives).toEqual([]);expect(io.events).toEqual([])
 expect(io.originalRevision).toBe('25-A-3');expect(row).toEqual(before)
})

it('preparation crossing the Stockholm guide boundary cannot enter the provider with the preceding guide decision',async()=>{
 vi.setSystemTime(new Date('2026-09-30T21:59:59Z'));io.originalRevision='25-A-3';io.rollover=true
 const row=queued(),before=structuredClone(row)
 await expect(sendEdielMessageViaSmtp(row,{actorUserId:'synthetic-operator',smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow(/admission.*(stale|changed)|guide.*(stale|changed)/)
 expect(io.providerCalls).toBe(0);expect(row).toEqual(before)
})


for(const action of ['prepare','enter'])it(`the generic ${action} journal await cannot carry a stale admission into the provider`,async()=>{
 vi.setSystemTime(new Date('2026-09-30T21:59:59Z'));io.originalRevision='25-A-3';io.rolloverAction=action
 const row=queued(),before=structuredClone(row)
 await expect(sendEdielMessageViaSmtp(row,{actorUserId:'synthetic-operator',smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow(/admission.*changed/)
 expect(io.providerCalls).toBe(0);expect(row).toEqual(before)
 expect(io.attempts.map(x=>x.action)).toEqual(action==='prepare'?['prepare','release']:['prepare','enter','observe'])
 if(action==='enter')expect(io.attempts.at(-1)?.result).toMatchObject({error:{message:'ediel_transport_admission_changed_retry_required'}})
})

for(const action of ['archive','prepare','enter'])it(`sealed Z08 ${action} cannot carry a stale admission into the provider`,async()=>{
 vi.setSystemTime(new Date('2026-09-30T21:59:59Z'));io.rollover=action==='archive';io.rolloverAction=action
 const row={...queued(),message_code:'Z08'},before=structuredClone(row)
 await expect(sendCorrectionFencedEmail({to:row.receiver_email!,subject:'synthetic',text:'synthetic'}, {message:row,actorUserId:'synthetic-operator',mimeMode:'nodemailer-attachment',payload:Buffer.from(row.raw_payload!),encoding:'7bit',admissionDecision:{referenceDate:'2026-09-30',guide:{guideRevision:'25-A-3'}}})).rejects.toThrow(/admission.*changed/)
 expect(io.providerCalls).toBe(0);expect(row).toEqual(before)
 expect(io.attempts.map(x=>x.action)).toEqual(action==='archive'?[]:action==='prepare'?['prepare','witness','release','witness']:['prepare','witness','enter','witness','result','witness'])
 if(action==='enter')expect(io.attempts.find(x=>x.action==='result')?.result).toMatchObject({error:{message:'ediel_transport_admission_changed_retry_required'}})
})

it('an accepted historical send repairs its immutable observation without a new guide choice or provider call',async()=>{
 const row=queued(),before=structuredClone(row)
 const sent=await sendEdielMessageViaSmtp(row,{actorUserId:'synthetic-operator',smtpMimeMode:'nodemailer-attachment'})
 const attempts=structuredClone(io.attempts),archives=structuredClone(io.archives)
 vi.setSystemTime(new Date('2026-11-01T09:00:00Z'))
 const replay=await sendEdielMessageViaSmtp(row,{actorUserId:'synthetic-operator',smtpMimeMode:'nodemailer-attachment'})
 expect(replay.dispatchObservedAt).toBe(sent.dispatchObservedAt);expect(replay.accepted).toEqual(sent.accepted)
 expect(io.providerCalls).toBe(1);expect(io.registry).toHaveBeenCalledTimes(1);expect(io.attempts).toEqual(attempts);expect(io.archives).toEqual(archives);expect(row).toEqual(before)
})
