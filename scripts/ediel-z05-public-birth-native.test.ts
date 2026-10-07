// Source-only public Z05 birth prerequisite. No whole-H approval or coverage tag.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
// Only external SMTP is intercepted; parser/catalog/source/context/creator are real.
import {nativeSql as sql,literal,seedNormalSwitchNativeFixture,type NormalSwitchStageNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {getEdielMessageById} from '@/lib/ediel/db'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {escapeEdifactData} from '@/lib/ediel/core/una'
import {guideOrderedFixtureBody} from '../__tests__/helpers/prodatGuideOrderedFixture'
import {line,characteristic,type Parts} from '../__tests__/fixtures/prodat-register'
import {head} from '../__tests__/fixtures/prodat-identity'
const hash=(raw:string|Buffer)=>createHash('sha256').update(raw).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
type Ground=NormalSwitchStageNativeFixture
type Row=Record<string,unknown>
function smtp(){
 for(const [key,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(key,value)
 provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-owned-H-provider',response:'250 synthetic accepted'})
}
function parties(f:Ground):Parts[]{return head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE']:p)}
function endUser(f:Ground):Parts{return ['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE']}
function point(f:Ground):Parts{return ['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE']}
function wire(f:Ground,code:string,body:Parts[]){
 const ref='H'+randomUUID().replaceAll('-','').slice(0,12)
 const encode=(p:Parts)=>p.map(v=>typeof v==='string'?escapeEdifactData(v):v.map(x=>escapeEdifactData(x)).join(':')).join('+')
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,senderQualifier:'ZZ',receiverQualifier:'ZZ',
  interchangeReference:ref,applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:true,environment:'test',
  messages:[{messageReference:ref,messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:[
   `BGM+${code}+${ref}+9+AB`,'DTM+137:202610071200:203','DTM+ZZZ:1:805',...guideOrderedFixtureBody(body).map(encode)]}]})
}
async function receive(f:Ground,raw:string,actor=f.actorUserId,company=f.companyId){
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:company,environment:'test',raw,smtpFrom:edielSmtpConfig().from})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:company,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const meteringPointMatch=await matchMeteringPointForInbound({companyId:company,parsed:mail.parsed})
 const id=await createInboundEdielMessage({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch})
 expect(typeof id,JSON.stringify({phase:'public_inbound_birth',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})).toBe('string')
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 const source=(await getEdielMessageById(id!))!
 expect(source).toMatchObject({company_id:company,environment:'test',direction:'inbound',raw_payload:raw,inbound_email_message_id:mail.inboundEmailMessageId})
 expect(source.message_received_at).toBeTruthy()
 return{...mail,sourceId:id!,source,wire:raw}
}
function endBody(f:Ground,reason:'Z25'|'Z22',li:string):Parts[]{return [...parties(f),line('1',f.external,undefined,'9'),['DTM',['93','202610161330','203']],...characteristic('Z13',reason),['RFF',['LI',li]],['RFF',['Z05',f.gridAreaCode]],endUser(f),point(f),['NAD','Z02',[f.brpEdielId,'160','SVK']]]}
function graph(){return sql<Record<string,Record<string,unknown>[]>>(`SELECT jsonb_build_object(
 'periods',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_supply_periods x),
 'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_contracts x),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_contract_events x),
 'domain',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.domain_events x WHERE event_type='contract.event.recorded'),
 'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_operation_tasks x),
 'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_invoices x),
 'underlays',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.billing_underlays x),
 'items',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.billing_underlay_items x),
 'customers',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customers x),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_sites x),
 'points',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.metering_points x))`)}
function custody(id:string){return sql(`SELECT jsonb_build_object('source',jsonb_build_object('id',m.id,'company',m.company_id,'environment',m.environment,'direction',m.direction,'raw',m.raw_payload,'hash',m.immutable_payload_hash,'receivedAt',m.message_received_at,'renderedAt',m.immutable_rendered_at,'context',m.execution_context_snapshot,'rulePack',m.canonical_rule_pack_id,'profile',m.rule_profile_key,'version',m.rule_profile_version,'profileVersionId',m.rule_profile_version_id,'checksum',m.rule_pack_checksum,'snapshot',m.rule_pack_snapshot),'mail',(SELECT jsonb_build_object('id',x.id,'company',x.company_id,'environment',x.environment,'mailbox',x.mailbox_id,'internetId',x.internet_message_id,'raw',x.raw_edifact_payload,'mime',x.raw_email,'receivedAt',x.received_at,'from',x.from_address,'to',x.to_address) FROM public.inbound_email_messages x WHERE x.id=m.inbound_email_message_id),'parse',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inbound_ediel_parse_results x WHERE x.inbound_email_message_id=m.inbound_email_message_id),'captured',(SELECT to_jsonb(x) FROM gridex_received_sources.sources x WHERE x.source_message_id=m.id),'reception',(SELECT to_jsonb(x) FROM gridex_ediel_inbound_receptions.receptions x WHERE x.source_message_id=m.id)) FROM public.ediel_messages m WHERE id=${literal(id)}`)}
function effects(companyId:string){return sql(`SELECT jsonb_build_object('transitions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions x WHERE company_id=${literal(companyId)}),'bilateral',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY source_message_id),'[]') FROM gridex_bilateral_prodat.supply_effect_receipts x WHERE company_id=${literal(companyId)}),'national',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY source_message_id),'[]') FROM gridex_supply_rescission.end_receipts x WHERE company_id=${literal(companyId)}),'watch',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_business_expectations x WHERE company_id=${literal(companyId)}),'acks',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_messages x WHERE company_id=${literal(companyId)} AND message_family IN('CONTRL','APERAK')),'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_outbox x WHERE company_id=${literal(companyId)}),'cases',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_cases x WHERE company_id=${literal(companyId)}))`)}
function protectedOriginals(){
 // Actual durable original, authority, archive and transport journals. No auth
 // session credentials or issuer signing keys are read into evidence.
 const tables=["gridex_ediel_transport.attempts", "gridex_ediel_transport.reservations", "gridex_outbound_dispatch.originals", "gridex_outbound_dispatch.attempts", "gridex_outbound_dispatch.reservations", "gridex_outbound_dispatch.events", "gridex_outbound_dispatch.witnesses", "gridex_ediel_outbound_owner.witnesses", "gridex_ediel_outbound_owner.consumptions", "gridex_supply_rescission.outbound_operations", "gridex_supply_rescission.outbound_receipts", "gridex_supply_rescission.artifacts", "gridex_supply_rescission.reviews", "gridex_supply_rescission.mandates", "gridex_bilateral_prodat.artifacts", "gridex_bilateral_prodat.origins", "gridex_bilateral_prodat.reviews", "gridex_ack_authority.source_correlations", "gridex_ack_authority.applied_receipts", "gridex_ediel_ack_replay.creation_receipts", "public.ediel_message_payloads"]
 return sql<Record<string,Row[]>>(`SELECT jsonb_build_object(${tables.map(table=>`${literal(table)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM ${table} x)`).join(',')})`)
}

// Default-L fixture grants no H-end authority; no processor is called.
for(const reason of ['Z25','Z22'] as const)it('SOURCE_ONLY actual public Z05/'+reason+' catalog birth and same-mail replay preserve custody without end effects',async()=>{
 const f=await seedNormalSwitchNativeFixture({requestedStartDate:'2026-10-15',deferOriginal:true});smtp();provider.mockClear()
 const raw=wire(f,'Z05',endBody(f,reason,'H-BIRTH-'+randomUUID().slice(0,8)))
 const business=()=>({graph:graph(),effects:effects(f.companyId),owned:sql(`SELECT jsonb_build_object(
  'partitions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY source_message_id),'[]') FROM gridex_received_sources.supply_object_partitions p WHERE company_id=${literal(f.companyId)}),
  'objectEffects',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM gridex_received_sources.supply_object_effect_receipts p WHERE company_id=${literal(f.companyId)}),
  'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.metering_permissions p WHERE company_id=${literal(f.companyId)}),
  'permissionSites',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.metering_permission_sites p WHERE company_id=${literal(f.companyId)}))`)})
 const before=business(),originalsBefore=protectedOriginals(),m=await receive(f,raw)
 const proof=sql<{catalog:{pack:Row;profile:Row;guideSources:Row[]};captured:Row;mail:Row;parse:Row;context:Row;receptions:Row[]}>(`SELECT jsonb_build_object(
  'catalog',(SELECT jsonb_build_object('pack',to_jsonb(pack),'profile',to_jsonb(p),'guideSources',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.ediel_rule_pack_sources s WHERE rule_pack_id=pack.id)) FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs pack ON pack.id=p.rule_pack_id WHERE p.id=${literal(m.source.rule_profile_version_id)}),
  'captured',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(m.sourceId)}),
  'mail',(SELECT to_jsonb(x) FROM public.inbound_email_messages x WHERE id=${literal(m.inboundEmailMessageId)}),
  'parse',(SELECT to_jsonb(x) FROM public.inbound_ediel_parse_results x WHERE id=${literal(m.parseResultId)}),
  'context',(SELECT to_jsonb(x) FROM gridex_ediel_inbound_context.receipts x WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(m.sourceId)}),
  'receptions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM gridex_ediel_inbound_receptions.receptions x WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(m.sourceId)}))`)
 const {pack,profile,guideSources}=proof.catalog,version=String(pack.guide_version)+':r'+String(pack.guide_revision)
 expect(profile.profile_key).toBe('PRODAT:Z05:'+(reason==='Z25'?'H':'L')+':26.A:r3')
 expect(m.source).toMatchObject({canonical_rule_pack_id:pack.id,rule_profile_key:profile.profile_key,rule_profile_version_id:profile.id,rule_profile_version:version,rule_pack_checksum:pack.source_hash})
 expect(m.source.rule_pack_snapshot).toEqual({rulePack:pack,messageProfile:profile,guideSources,profileKey:profile.profile_key,profileVersionId:profile.id,version,checksum:pack.source_hash})
 expect(proof.mail).toMatchObject({id:m.inboundEmailMessageId,company_id:f.companyId,environment:'test',raw_edifact_payload:raw})
 expect(proof.parse).toMatchObject({id:m.parseResultId,company_id:f.companyId,inbound_email_message_id:m.inboundEmailMessageId,raw_payload:raw,message_family:'PRODAT',message_code:'Z05'})
 expect(proof.captured).toMatchObject({source_message_id:m.sourceId,company_id:f.companyId,environment:'test',origin:'database_insert',message_code:'Z05',raw_payload:raw,payload_hash:hash(raw)})
 expect(proof.context).toMatchObject({source_message_id:m.sourceId,company_id:f.companyId,environment:'test',direction:'inbound',payload_sha256:hash(raw)})
 expect(proof.context.status).toMatch(/^(ready|held)$/)
 if(proof.context.status==='held')expect(proof.context.reason).toEqual(expect.any(String))
 expect(proof.receptions).toHaveLength(1)
 expect(proof.receptions[0]).toMatchObject({source_message_id:m.sourceId,company_id:f.companyId,environment:'test',inbound_email_message_id:m.inboundEmailMessageId,parse_result_id:m.parseResultId,actor_user_id:f.actorUserId,classification:'first_reception',canonical_payload_hash:hash(raw),received_payload_hash:hash(raw)})
 for(const receivedAt of [m.source.message_received_at,proof.captured.source_received_at,proof.context.source_received_at,proof.receptions[0].received_at])expect(Date.parse(String(receivedAt))).toBe(Date.parse(String(proof.mail.received_at)))
 expect(business()).toEqual(before);expect(provider).not.toHaveBeenCalled()
 const originals=protectedOriginals()
 for(const [table,rows]of Object.entries(originals))expect(table==='public.ediel_message_payloads'?rows.filter(row=>row.ediel_message_id!==m.sourceId):rows,table).toEqual(originalsBefore[table])
 const born=custody(m.sourceId),outboundMatch=await matchOutboundRequestForInbound({companyId:f.companyId,parsed:m.parsed,inboundEmailMessageId:m.inboundEmailMessageId,parseResultId:m.parseResultId}),meteringPointMatch=await matchMeteringPointForInbound({companyId:f.companyId,parsed:m.parsed})
 const replay=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:m.inboundEmailMessageId,parseResultId:m.parseResultId,parsed:m.parsed,outboundMatch,meteringPointMatch})
 expect(replay).toBe(m.sourceId);expect(custody(m.sourceId)).toEqual(born)
 expect(sql(`SELECT to_jsonb(x) FROM gridex_ediel_inbound_context.receipts x WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(m.sourceId)}`)).toEqual(proof.context)
 expect(business()).toEqual(before);expect(protectedOriginals()).toEqual(originals);expect(provider).not.toHaveBeenCalled()
})
