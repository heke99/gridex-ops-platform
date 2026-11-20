// Finding 019 (native): UTILTS without BGM (UTILTS_UNKNOWN) is born through the
// SQL-owned syntax-negative receipt and receives exactly one negative CONTRL
// (UCI action 4) for its own interchange. Parser, intake, SQL owners, triggers,
// processor and ACK builder are actual; only SMTP/notification sinks are synthetic.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {decisionNativeSql as sql,decisionUser,literal} from './helpers/ediel-decision-original-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {supabaseService} from '@/lib/supabase/service'

const SMTP_ENV={EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',
 EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}
afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})

function wire(input:{sender:string;receiver:string;reference:string;bgm?:string;unb?:boolean}){
 const body=['UNH+1+UTILTS:D:02B:UN:E5SE5A',...(input.bgm?[input.bgm]:[]),'DTM+137:202610301508:203','DTM+735:?+0200:406','MKS+23+E02::260',
  `NAD+MS+${input.sender}:SVK:260`,`NAD+MR+${input.receiver}:SVK:260`,`IDE+24+${input.reference}`,'LOC+172+735999260756511878::9',
  'LIN+++8716867000030:::9','DTM+324:202607010000202607010015:719','QTY+136:500']
 const unb=`UNB+UNOC:3+${input.sender}:ZZ+${input.receiver}:ZZ+261030:1508+${input.reference}++23-DDQ-E66-T++1++1`
 return [...(input.unb===false?[]:[unb]),...body,`UNT+${body.length+1}+1`,`UNZ+1+${input.reference}`].join("'")+"'"
}

// Public prospective ACK route configuration for the technical reply only; no
// source, receipt or effect fact is seeded.
function ackRoute(t:{companyId:string;receiver:string;sender:string}){
 const smtp=assertEdielSmtpReadiness(),route=randomUUID(),profile=randomUUID()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
  VALUES(${literal(route)},${literal(t.companyId)},'Synthetic missing-BGM ACK route','ediel_ack','bilateral_test',true,'recipient@example.invalid');
  INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,message_family,business_code,mailbox,smtp_host,smtp_port)
  VALUES(${literal(profile)},${literal(t.companyId)},${literal(route)},'Synthetic missing-BGM ACK profile','test','edifact','edifact',${literal(t.receiver)},${literal(t.sender)},NULL,NULL,'23-DDQ-E66-T',true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',NULL,NULL,${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)})`)
}

async function tenant(){
 const companyId=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic missing-BGM tenant','active')`)
 const actor=await decisionUser(companyId,['communication.write','communication.send','communication.read'],randomUUID()+'Aa1!')
 const receiver=sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_legal_actor_identifier',0));
  WITH available AS (SELECT candidate::text value FROM generate_series(40000,49999) candidate WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),
  allocated AS (INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${literal(companyId)},'test',${literal(actor.id)},'EdielId',value,clock_timestamp()-interval '1 day' FROM available RETURNING identifier_value)
  SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
 return {companyId,actorUserId:actor.id,receiver,sender:'7'+String(Math.floor(Math.random()*9000)+1000)}
}
const reference=()=>randomUUID().replaceAll('-','').slice(0,14).toUpperCase()

function effects(companyId:string,id:string){
 return sql<Record<string,unknown>>(`SELECT jsonb_build_object(
  'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome,'raw',raw_payload,'company',company_id) ORDER BY id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(id)} AND direction='outbound'),
  'aperak',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(id)} AND message_family IN('APERAK','UTILTS_ERR')),
  'commonHeader',(SELECT count(*) FROM gridex_ediel_common_header.sources WHERE source_message_id=${literal(id)}),
  'assessments',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(id)}),
  'ruleBasis',(SELECT count(*) FROM gridex_ediel_source_rules.receipts WHERE source_message_id=${literal(id)}),
  'meterValues',(SELECT count(*) FROM public.metering_values WHERE company_id=${literal(companyId)}),
  'original',(SELECT jsonb_build_object('family',message_family,'code',message_code,'pack',canonical_rule_pack_id,'profile',rule_profile_key,'customer',customer_id,'point',metering_point_id,'related',related_message_id,'outbound',outbound_request_id) FROM public.ediel_messages WHERE id=${literal(id)}),
  'receipt',(SELECT jsonb_build_object('status',status,'kind',evidence->>'kind','business',evidence->'authorizesBusinessEffect') FROM gridex_ediel_header_negative_birth.receipts WHERE source_message_id=${literal(id)}))`)
}

it('UTILTS without BGM gets exactly one negative CONTRL for its own UNB, stable on retry, with no business effect',async()=>{
 for(const[k,v]of Object.entries(SMTP_ENV))vi.stubEnv(k,v)
 delivery.smtp.mockResolvedValue({accepted:['synthetic@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
 const t=await tenant(),ref=reference(),raw=wire({sender:t.sender,receiver:t.receiver,reference:ref})
 ackRoute(t)
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:t.companyId,environment:'test',raw,smtpFrom:assertEdielSmtpReadiness().from})
 expect(mail.parsed).toMatchObject({messageFamily:'UTILTS',messageCode:'UTILTS_UNKNOWN'})
 const birth={companyId:t.companyId,actorUserId:t.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed}
 const id=await createInboundEdielMessage(birth)
 expect(id).toEqual(expect.any(String));if(!id)throw Error('utilts_missing_bgm_birth_required')
 expect(await createInboundEdielMessage(birth)).toBe(id)
 for(let attempt=0;attempt<2;attempt++)await processInboundEdielMessage({actorUserId:t.actorUserId,edielMessageId:id})
 const after=effects(t.companyId,id) as {acks:Array<{family:string;outcome:string;raw:string;company:string}>}&Record<string,unknown>
 expect(after).toMatchObject({aperak:0,commonHeader:0,assessments:0,ruleBasis:0,meterValues:0,
  original:{family:'UTILTS',code:'UTILTS_UNKNOWN',pack:null,profile:null,customer:null,point:null,related:null,outbound:null},
  receipt:{status:'consumed',kind:'utilts_syntax_missing_bgm',business:false}})
 expect(after.acks).toHaveLength(1)
 expect(after.acks[0]).toMatchObject({family:'CONTRL',outcome:'negative',company:t.companyId})
 const ack=tokenizeEdifact(after.acks[0].raw),uci=ack.segments.filter(row=>row.tag==='UCI')
 expect(uci).toHaveLength(1)
 expect(segmentComposite(uci[0],1,ack.una)).toEqual([ref])
 expect(segmentComposite(uci[0],4,ack.una)).toEqual(['4'])
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE inbound_email_message_id=${literal(mail.inboundEmailMessageId)} AND direction='inbound'`)).toBe(1)
},120000)

it('without UNB no syntax-negative birth, no original and no CONTRL',async()=>{
 for(const[k,v]of Object.entries(SMTP_ENV))vi.stubEnv(k,v)
 const t=await tenant(),raw=wire({sender:t.sender,receiver:t.receiver,reference:reference(),unb:false})
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:t.companyId,environment:'test',raw,smtpFrom:assertEdielSmtpReadiness().from})
 expect(await createInboundEdielMessage({companyId:t.companyId,actorUserId:t.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed})).toBeNull()
 expect(sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(t.companyId)}),'receipts',(SELECT count(*) FROM gridex_ediel_header_negative_birth.receipts WHERE company_id=${literal(t.companyId)}))`)).toEqual({originals:0,receipts:0})
},120000)

it('unlisted UTILTS code, foreign actor and foreign tenant stay refused with no row',async()=>{
 for(const[k,v]of Object.entries(SMTP_ENV))vi.stubEnv(k,v)
 const t=await tenant(),other=await tenant()
 const unlisted=wire({sender:t.sender,receiver:t.receiver,reference:reference(),bgm:'BGM+ZZZ+DOC1+9'})
 const m1=await seedOriginalMailboxNative(sql,literal,{companyId:t.companyId,environment:'test',raw:unlisted,smtpFrom:assertEdielSmtpReadiness().from})
 expect(await createInboundEdielMessage({companyId:t.companyId,actorUserId:t.actorUserId,environment:'test',inboundEmailMessageId:m1.inboundEmailMessageId,parseResultId:m1.parseResultId,parsed:m1.parsed})).toBeNull()
 const raw=wire({sender:t.sender,receiver:t.receiver,reference:reference()})
 const m2=await seedOriginalMailboxNative(sql,literal,{companyId:t.companyId,environment:'test',raw,smtpFrom:assertEdielSmtpReadiness().from})
 const call=(companyId:string,actorUserId:string)=>supabaseService.rpc('ediel_create_utilts_syntax_negative_v1' as never,{p_company_id:companyId,p_environment:'test',p_actor_user_id:actorUserId,
  p_inbound_email_message_id:m2.inboundEmailMessageId,p_parse_result_id:m2.parseResultId,p_expected_raw_payload:raw,p_expected_payload_hash:createHash('sha256').update(raw).digest('hex')} as never)
 expect((await call(t.companyId,other.actorUserId)).error).toMatchObject({code:'42501'})
 expect((await call(other.companyId,other.actorUserId)).error).toMatchObject({code:'23514',message:'utilts_syntax_negative_retained_ingress_required'})
 expect(sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM public.ediel_messages WHERE company_id IN(${literal(t.companyId)},${literal(other.companyId)})),'receipts',(SELECT count(*) FROM gridex_ediel_header_negative_birth.receipts WHERE company_id IN(${literal(t.companyId)},${literal(other.companyId)})))`)).toEqual({originals:0,receipts:0})
},120000)

it('rule pack carried on a bound BGM-less original is refused (no wildcard binding)',async()=>{
 for(const[k,v]of Object.entries(SMTP_ENV))vi.stubEnv(k,v)
 const t=await tenant(),raw=wire({sender:t.sender,receiver:t.receiver,reference:reference()})
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:t.companyId,environment:'test',raw,smtpFrom:assertEdielSmtpReadiness().from})
 const id=await createInboundEdielMessage({companyId:t.companyId,actorUserId:t.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed})
 expect(id).toEqual(expect.any(String))
 const {error}=await supabaseService.from('ediel_messages').update({rule_profile_key:'UTILTS:E66'} as never).eq('id',id!)
 expect(error).toMatchObject({code:'23514'})
 expect(sql(`SELECT jsonb_build_object('bound',gridex_ediel_header_negative_birth.is_bound_v1(jsonb_populate_record(m,jsonb_build_object('rule_profile_key','UTILTS:E66')),false),'actual',gridex_ediel_header_negative_birth.is_bound_v1(m,false)) FROM public.ediel_messages m WHERE id=${literal(id)}`)).toEqual({bound:false,actual:true})
},120000)
