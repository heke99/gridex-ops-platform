// masterplan: AT-Z14N-ESCO
// Genuine local archive/review/Z13/intake/permission/ACK consumers. Only
// upstream issuer/mail/counterparty bytes and SMTP responses are synthetic.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {seedNativeEscoFixture as seed,prepareNativeEscoPermissionFixture as prepare,qualifyNativeEscoFixture as qualify,resetNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,nativeEscoExternal} from './fixtures/ediel-service-evidence-native'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './helpers/originalMailboxNative'
import {omitPermissionField} from './helpers/ediel-permission-field-omissions'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {getEdielMessageById} from '@/lib/ediel/db'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import {createCanonicalOutboundMessage} from '@/lib/ediel/core/kernel'
import {supabaseService} from '@/lib/supabase/service'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import type {EdielMessageRow} from '@/lib/ediel/types'

beforeEach(resetNativeEscoFixture)
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
type Fixture=Awaited<ReturnType<typeof seed>>
type Pending=Awaited<ReturnType<typeof prepare>>
// Independent national N-profile obligations. Its fourteen conditional D
// cells are inactive; absent UD/IT also makes 316/233/234 inapplicable.
const required=['311','312','202','203','313','205','206','207','208','314','223','322','226'] as const
const outcomes=[['A13','rejected_active'],['A76','rejected_passive_timeout']] as const

function denial(f:Fixture,p:Pending,status:'A13'|'A76',change:Record<string,unknown>={}){
 const rendered=renderProdat({code:'Z14',variant:'N',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},context:{code:'Z14',customerName:'',meterPointId:'',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:p.li,senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,reasonForTransaction:'Z96',permissionStatus:status,...change}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]})
}
async function receive(f:Fixture,raw:string){
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:edielSmtpConfig().from,senderEmail:'dso-native@example.invalid'})
 const code=mail.parsed.messageCode??'Z14'
 const source=await f.insert(raw,'PRODAT',code,code==='Z14'?'PRODAT:Z14:N:26.A:r3':undefined,mail)
 await recordOriginalMailboxNativeReception({companyId:f.ids.company,sourceMessageId:source.id,actorUserId:f.ids.actor,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,sourcePayloadHash:mail.sourcePayloadHash})
 return source
}
function configureAckRoute(f:Fixture){
 const smtp=edielSmtpConfig()
 expect(sql(`UPDATE public.ediel_route_profiles SET application_reference=${lit(f.app)},route_name='Synthetic N own ACK',mailbox=${lit(smtp.from)},smtp_host=${lit(smtp.host)},smtp_port=${lit(smtp.port)} WHERE id=${lit(f.ids.ackProfile)} AND company_id=${lit(f.ids.company)} AND communication_route_id=${lit(f.ids.ackRoute)} RETURNING to_jsonb(id)`)).toBe(f.ids.ackProfile)
}
function market(f:Fixture){
 return sql<{permissions:Record<string,unknown>[];sites:Record<string,unknown>[];grants:Record<string,unknown>[];receipts:number;transitions:number}>(`SELECT jsonb_build_object(
 'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permissions p WHERE company_id=${lit(f.ids.company)}),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE company_id=${lit(f.ids.company)}),
 'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]') FROM public.ediel_data_access_grants g WHERE company_id=${lit(f.ids.company)}),
 'receipts',(SELECT count(*) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${lit(f.ids.company)}),
 'transitions',(SELECT count(*) FROM gridex_received_sources.permission_effect_transitions_v1 WHERE company_id=${lit(f.ids.company)}))`)
}
function reporting(f:Fixture){
 return sql(`SELECT jsonb_build_object(
 'series',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.meter_reading_series s WHERE company_id=${lit(f.ids.company)}),
 'values',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') FROM public.meter_reading_values v WHERE company_id=${lit(f.ids.company)}),
 'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.series_id),'[]') FROM gridex_utilts_binding.contracts c WHERE company_id=${lit(f.ids.company)}),
 'bindings',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id),'[]') FROM gridex_utilts_binding.receipts r WHERE company_id=${lit(f.ids.company)}),
 'projections',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_ediel_services.projection_receipts r WHERE company_id=${lit(f.ids.company)}),
 'exports',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.id),'[]') FROM gridex_ediel_exports.jobs j WHERE beneficiary_company_id=${lit(f.ids.beneficiary)}),
 'results',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.job_id),'[]') FROM gridex_ediel_exports.results r WHERE beneficiary_company_id=${lit(f.ids.beneficiary)}),
 'outgoingReports',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.ediel_messages m WHERE company_id=${lit(f.ids.company)} AND direction='outbound' AND message_family='UTILTS'),
 'supply',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.customer_supply_periods s WHERE company_id=${lit(f.ids.company)}),
 'switches',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.supplier_switch_requests s WHERE company_id=${lit(f.ids.company)}))`)
}
function ackRows(f:Fixture,source:EdielMessageRow){
 return sql<{acks:EdielMessageRow[];outbox:Record<string,unknown>[]}>(`SELECT jsonb_build_object('acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.message_family),'[]') FROM public.ediel_messages a WHERE company_id=${lit(f.ids.company)} AND direction='outbound' AND related_message_id=${lit(source.id)}),'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)}))`)
}
function original(p:Pending){
 return sql(`SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'raw',raw_payload,'hash',immutable_payload_hash,'rendered',immutable_rendered_at,'intent',intent_id,'route',route_profile_id) FROM public.ediel_messages WHERE id=${lit(p.z13.id)}`)
}
async function consume(f:Fixture,s:EdielMessageRow){
 await processInboundEdielMessage({actorUserId:f.ids.actor,edielMessageId:s.id})
 const stored=(await getEdielMessageById(s.id))!
 expect(stored.raw_payload).toBe(s.raw_payload)
 expect(stored.company_id).toBe(f.ids.company)
 expect(stored.environment).toBe('test')
 return stored
}
async function proveAcks(f:Fixture,s:EdielMessageRow){
 const actual=ackRows(f,s),wire=tokenizeEdifact(s.raw_payload!),envelope=EdifactEnvelopeCodec.decode(s.raw_payload!),line=wire.segments.find(x=>x.tag==='LIN')!
 expect(actual.acks.map(a=>a.message_family)).toEqual(['APERAK','CONTRL'])
 for(const ack of actual.acks){
  expect(ack).toMatchObject({company_id:f.ids.company,environment:'test',direction:'outbound',related_message_id:s.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const outer=EdifactEnvelopeCodec.decode(ack.raw_payload!),physical=readPhysicalAckSourceCorrelation(ack,s)
  expect([outer.sender,outer.receiver]).toEqual([envelope.receiver,envelope.sender])
  expect(physical.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL')expect(physical.acknowledgedReferences).toEqual([envelope.interchangeReference])
  else{
   expect(physical.lookupReferences).toContainEqual({type:'BGM_REF',value:segmentComposite(wire.segments.find(x=>x.tag==='BGM'),2,wire.una)[0]})
   expect(physical.prodatObjectOutcomes).toMatchObject([{objectId:null,lineItemReference:segmentComposite(wire.segments.find(x=>x.tag==='RFF'&&segmentComposite(x,1,wire.una)[0]==='LI'),1,wire.una)[1],firstLineIndex:line.index,outcome:'positive'}])
   expect(ack.route_profile_id).toBe(f.ids.ackProfile)
  }
  const entries=actual.outbox.filter(o=>o.ediel_message_id===ack.id)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({company_id:f.ids.company,environment:'test',source_message_id:s.id,message_family:ack.message_family,ack_outcome:'positive'})
  const calls=nativeEscoExternal.send.mock.calls.length
  await sendEdielMessageViaSmtp(ack,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
  expect(nativeEscoExternal.send).toHaveBeenCalledTimes(calls+1)
  expect((await getEdielMessageById(ack.id))?.status).toBe('sent')
 }
 expect(actual.outbox).toHaveLength(2)
 return ackRows(f,s)
}
async function heldGrant(f:Fixture,p:Pending){
 const link=sql<string>(`SELECT to_jsonb(id) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)} AND permission_id=${lit(p.permissionId)}`)
 const g=await f.command({action:'create_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,fields:{permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,data_start:f.fields.data_start,data_end:f.fields.data_end,valid_from:f.fields.valid_from,valid_to:f.fields.valid_to}})
 expect(g).toMatchObject({status:'held',accessGranted:false})
 return {id:String(g.grantId),version:Number(g.grantVersion)}
}

it.each(outcomes)('real %s N response records %s, sends correlated positive processing ACKs and leaves access/reporting denied',async(status,expected)=>{
 const f=await seed(),p=await prepare(f);configureAckRoute(f)
 const grant=await heldGrant(f,p),beforeOriginal=original(p),beforeReports=reporting(f),before=market(f)
 const raw=denial(f,p,status),segments=tokenizeEdifact(raw).segments
 expect(segments.some(s=>s.tag==='NAD'&&segmentComposite(s,1)[0]==='UD')).toBe(false)
 expect(segments.some(s=>s.tag==='RFF'&&['Z05','Z09'].includes(segmentComposite(s,1)[0]??''))).toBe(false)
 const source=await receive(f,raw),stored=await consume(f,source),after=market(f)
 expect(stored.validation_report).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted'})
 const permission=after.permissions.find(x=>x.id===p.permissionId)!
 expect(permission).toMatchObject({status:expected,approved_start_date:null,approved_end_date:null,approved_start_at:null,approved_end_at:null,product_code:null,report_frequency:null,inbound_z14_message_id:source.id})
 expect(after.sites).toEqual(before.sites);expect(after.grants).toEqual(before.grants)
 expect(after.permissions.filter(x=>x.id!==p.permissionId)).toEqual(before.permissions.filter(x=>x.id!==p.permissionId))
 expect(after.receipts).toBe(before.receipts+1);expect(after.transitions).toBe(before.transitions+1)
 expect(sql(`SELECT jsonb_build_object('original',qualified_original_message_id,'code',qualified_expected_message_code,'hash',payload_hash) FROM gridex_received_sources.permission_effect_receipts WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(source.id)} AND permission_id=${lit(p.permissionId)}`)).toEqual({original:p.z13.id,code:'Z14',hash:createHash('sha256').update(raw).digest('hex')})
 const plan=await readReceivedProdatFinalResponsePlan({companyId:f.ids.company,sourceMessageId:source.id,rawPayload:raw})
 expect(plan?.plans).toHaveLength(1)
 expect(plan!.plans[0]).toMatchObject({effectKind:'metering_permission',outcome:'positive',objectLineIndices:[segments.find(x=>x.tag==='LIN')!.index]})
 expect(plan!.plans[0].effectReceiptId).toMatch(/^[0-9a-f-]{36}$/)
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'company',company_id,'hash',payload_hash,'canonical',canonical_assessment_id) FROM gridex_received_sources.permission_effect_receipts WHERE id=${lit(plan!.plans[0].effectReceiptId)}`)).toEqual({source:source.id,company:f.ids.company,hash:createHash('sha256').update(raw).digest('hex'),canonical:plan!.plans[0].canonicalAssessmentId})
 const acks=await proveAcks(f,source)
 expect(reporting(f)).toEqual(beforeReports);expect(original(p)).toEqual(beforeOriginal)
 const published=await f.command({action:'publish_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,grantId:grant.id,expectedGrantVersion:grant.version})
 expect(published).toMatchObject({status:'held',missing:expect.arrayContaining(['current_source_approved_market_permission'])})
 expect(market(f).grants).toEqual(before.grants)
 const stable=market(f),calls=nativeEscoExternal.send.mock.calls.length
 await consume(f,source)
 expect(await applyPermissionMarketSource({actorUserId:f.ids.actor,message:(await getEdielMessageById(source.id))!,expectedPermissionId:p.permissionId})).toMatchObject({applied:true,idempotent:true,permissionId:p.permissionId,status:expected})
 expect(market(f)).toEqual(stable);expect(ackRows(f,source)).toEqual(acks);expect(reporting(f)).toEqual(beforeReports);expect(original(p)).toEqual(beforeOriginal);expect(nativeEscoExternal.send).toHaveBeenCalledTimes(calls)
},120000)

it.each(required)('actual N source independently omitting required field %s never denies the request or grants access/reporting',async field=>{
 const f=await seed(),p=await prepare(f);configureAckRoute(f)
 const control=await receive(f,denial(f,p,'A13')),decision=await resolveCanonicalRuntimeDecisionWithRegistry(control)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 const omitted=omitPermissionField(denial(f,p,'A13'),field),before=market(f),reports=reporting(f),old=original(p),calls=nativeEscoExternal.send.mock.calls.length
 if(field==='202'){
  // Missing BGM cannot select a canonical guide at actual mailbox birth.
  // Keep the observed parser identity; never fabricate Z14/profile metadata.
  expect(parseEdifactPayload(omitted).messageCode).toBe('PRODAT_UNKNOWN')
  const effects=f.effects()
  await expect(receive(f,omitted)).rejects.toThrow(/canonical_inbound_rule_profile_resolution_failed:PRODAT:PRODAT_UNKNOWN:/)
  expect(market(f)).toEqual(before);expect(reporting(f)).toEqual(reports);expect(original(p)).toEqual(old)
  expect(f.effects()).toEqual(effects);expect(nativeEscoExternal.send).toHaveBeenCalledTimes(calls)
  return
 }
 const source=await receive(f,omitted)
 if(field==='314'){
  const rejected=await resolveCanonicalRuntimeDecisionWithRegistry(source)
  expect(rejected.applicationDecision).toBe('rejected')
  expect(rejected.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:'314',errorKind:'missing'})})]))
  // Without a physical sequence or an N object identity the source owner
  // cannot confirm this malformed scope. Keep that fail-closed boundary;
  // a technical CONTRL may already exist, never a positive business effect.
  await expect(consume(f,source)).rejects.toThrow(/^prodat_canonical_source_validation_unconfirmed$/)
 }else await consume(f,source)
 expect(market(f)).toEqual(before);expect(reporting(f)).toEqual(reports);expect(original(p)).toEqual(old)
 expect(ackRows(f,source).acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='positive')).toEqual([])
 const first=ackRows(f,source)
 if(field==='314')await expect(consume(f,source)).rejects.toThrow(/^prodat_canonical_source_validation_unconfirmed$/)
 else await consume(f,source)
 expect(market(f)).toEqual(before);expect(reporting(f)).toEqual(reports);expect(original(p)).toEqual(old);expect(ackRows(f,source)).toEqual(first);expect(nativeEscoExternal.send).toHaveBeenCalledTimes(calls)
},120000)

it.each(['LI','legal_receiver','market_role'] as const)('actual N refuses wrong current %s with pending permission, unrelated tenant and reporting unchanged',async fault=>{
 const f=await seed(),p=await prepare(f),other=await seed(),otherAuthority=await qualify(other);configureAckRoute(f)
 const otherBefore=market(other),otherReports=reporting(other)
 expect(otherBefore.grants.find(g=>g.id===otherAuthority.grantId)).toMatchObject({status:'active'})
 const change=fault==='LI'?{transactionReference:'UNRELATED-'+randomUUID().slice(0,8)}:fault==='legal_receiver'?{legalReceiverId:other.sender}:{}
 const source=await receive(f,denial(f,p,'A76',change)),before=market(f),reports=reporting(f),old=original(p)
 if(fault==='market_role')sql(`UPDATE public.tenant_actor_roles SET role_code='supplier' WHERE company_id=${lit(f.ids.company)} AND actor_id=${lit(f.ids.legal)} AND environment='test' AND role_code='energy_service_company'`)
 await consume(f,source)
 expect(market(f)).toEqual(before);expect(reporting(f)).toEqual(reports);expect(original(p)).toEqual(old);expect(market(other)).toEqual(otherBefore);expect(reporting(other)).toEqual(otherReports)
 expect(ackRows(f,source).acks.filter(a=>a.message_family==='APERAK'&&a.ack_outcome==='positive')).toEqual([])
 const first=ackRows(f,source)
 await consume(f,source)
 expect(market(f)).toEqual(before);expect(ackRows(f,source)).toEqual(first);expect(market(other)).toEqual(otherBefore)
},120000)

it('N outbound direction and actual raw/direction mutations refuse before denial/access/report effects',async()=>{
 const f=await seed(),p=await prepare(f),raw=denial(f,p,'A13'),source=await receive(f,raw),before=market(f),reports=reporting(f),originalRow=sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(source.id)}`)
 const calls=nativeEscoExternal.send.mock.calls.length
 const outboundSegments=tokenizeEdifact(denial(f,p,'A13',{legalSenderId:f.sender,legalReceiverId:f.receiver})).segments.filter(s=>!['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>s.raw)
 const outboundRaw=EdifactEnvelopeCodec.encode({sender:f.sender,receiver:f.receiver,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,14),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:outboundSegments}]})
 const old=original(p),effects=f.effects()
 await expect(createCanonicalOutboundMessage({actorUserId:f.ids.actor,requestType:'metering_access',baseInput:{actorUserId:f.ids.actor,companyId:f.ids.company,environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z14',messageVersion:'E2SE6A',applicationReference:f.app,rawPayload:outboundRaw,senderEdielId:f.sender,receiverEdielId:f.receiver,communicationRouteId:f.ids.route,routeProfileId:f.ids.routeProfile}})).rejects.toThrow(/^Outbound PRODAT Z14 blockerades av canonical Ediel-policy: CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE - canonical_source_direction_not_allowed:Z14:outbound:inbound$/)
 expect(f.effects()).toEqual(effects);expect(original(p)).toEqual(old)
 expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(source.id)}`)).toEqual(originalRow)
 for(const [patch,reason] of [[{raw_payload:raw+' '},'immutable_ediel_payload_cannot_change'],[{direction:'outbound'},'immutable_ediel_received_context_cannot_change']] as const){
  const changed=await supabaseService.from('ediel_messages').update(patch).eq('id',source.id).eq('company_id',f.ids.company)
  expect(changed.error).toMatchObject({code:'23514',message:reason})
  expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(source.id)}`)).toEqual(originalRow)
 }
 expect(market(f)).toEqual(before);expect(reporting(f)).toEqual(reports);expect(nativeEscoExternal.send).toHaveBeenCalledTimes(calls)
},120000)
