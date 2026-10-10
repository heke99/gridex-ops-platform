// AT-Z10M-SUPPLIER native proposal: actual received source -> review -> first
// structural effect -> physical ACK. No whole tag until all clauses are proved.
// External issuer/contract/SMTP fixtures are synthetic; no live acceptance.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {supabaseService} from '@/lib/supabase/service'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {resolveTenantForInboundEdiel} from '@/lib/inbound-mail/inboundTenantResolver'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {tokenizeEdifact,segmentSourceSpan} from '@/lib/ediel/core/edifactTokenizer'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {bindReceivedProdatApplicationObjects} from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {approveEdielInboundCase} from '@/lib/ediel/inboundCases'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {createRequestedChangeSupplyFixture} from './helpers/ediel-requested-change-native-fixture'
import {createBilateralSourceOperator,bilateralSourceOperatorPermissions} from './helpers/ediel-bilateral-customer-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {futureNativeSupplyDate,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {raw,line,characteristic,type Parts} from '../__tests__/fixtures/prodat-register'

const external=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.send})}}))
beforeEach(()=>{
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid')
  vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
  vi.stubEnv('EMAIL_PROVIDER','resend');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
  vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid')
  vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');external.send.mockReset()
})
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})

async function fixture(){
  const f=await createRequestedChangeSupplyFixture(email=>external.send.mockResolvedValue({
    accepted:[email],rejected:[],messageId:'synthetic-own-Z03',response:'250 explicitly synthetic acceptance',
  }),{requestedStartDate:futureNativeSupplyDate()})
  // Public disposable route/profile inputs only, as in existing raw-scope
  // acceptance. Canonical ACK readiness/authority are actual owner outputs.
  const routeId=randomUUID(),profileId=randomUUID(),smtp=edielSmtpConfig()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
    VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic M ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
    VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic M ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)});`)
  const reviewer=await createBilateralSourceOperator(f.companyId,[...bilateralSourceOperatorPermissions,'communication.send','metering.read','metering.write','ediel_testing.write'])
  expect(await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:f.source,
    reviewerUserId:reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  return {...f,reviewer}
}
type Fixture=Awaited<ReturnType<typeof fixture>>

function changeWire(f:Fixture,oldMeter='METER-1'){
  const instant=new Date(`${f.requestedStartDate}T00:00:00Z`);instant.setUTCDate(instant.getUTCDate()+12)
  const minute=instant.toISOString().slice(0,10).replaceAll('-','')+'0000'
  const reference='M-'+randomUUID().replaceAll('-','').slice(0,28)
  // Independent full supplied wire: new meter with two distinct register rows.
  // No caller MeterChangeSelection declares inbound conditional facts.
  const body:Parts[]=[
    ['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE'],
    ['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE'],
    line('1',f.external,'1','9'),['DTM',['157',minute,'203']],['DTM',['354','15','806']],
    ...characteristic('Z13','E58'),...characteristic('Z04','Z04'),
    ...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
    ...characteristic('Z16','101',3),...characteristic('Z02','1',3),...characteristic('Z05','6',3),
    ['RFF',['MG','NEW-METER']],['RFF',['Z02',oldMeter]],['RFF',['Z05',f.gridAreaCode]],['RFF',['LI',reference]],
    ['NAD','Z02',[f.brpEdielId,'160','SVK']],
    line('2',f.external,'2','9'),...characteristic('Z16','102',3),
    ...characteristic('Z02','1',3),...characteristic('Z05','6',3),
  ]
  let wire=raw(body,'Z10').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`)
    .replace('BGM+Z10+D+9+AB',`BGM+Z10+${reference}+9+AB`)
  const tokens=tokenizeEdifact(wire),header=tokens.segments.find(s=>s.tag==='UNB')!,span=segmentSourceSpan(header)!
  const parts=header.raw.split(tokens.una.dataElementSeparator)
  const marketClock=new Date(Date.now()+3600000).toISOString().replace(/[-:TZ.]/g,'').slice(0,12)
  while(parts.length<12)parts.push('')
  parts[4]=`${marketClock.slice(2,8)}:${marketClock.slice(8,12)}`;parts[5]=reference;parts[9]='1';parts[11]='1'
  wire=(wire.slice(0,span.startOffset)+parts.join(tokens.una.dataElementSeparator)+wire.slice(span.endOffset))
    .replace('DTM+137:202609171200:203',`DTM+137:${marketClock}:203`).replace("UNZ+1+I'",`UNZ+1+${reference}'`)
  return {wire,reference,minute}
}

// A new read after normal failure, before the retained extra resolver/recorder.
// This is not the failed normal read's return and cannot approve any effect.
async function observePostFailureApplicationRead(input:{companyId:string;sourceMessageId:string;rawPayload:string}){
  const observation='new_post_failure_read_before_extra_resolver_recorder'
  let reply
  try{
    reply=await supabaseService.rpc('ediel_read_prodat_application_objects_v1',{
      p_company_id:input.companyId,p_source_message_id:input.sourceMessageId,
    }).abortSignal(AbortSignal.timeout(2000))
  }catch{return {observation,status:'rpc_error',sqlstate:'unknown'}}
  try{
    const {data,error}=reply
    if(error){
      const sqlstate=typeof error.code==='string'&&['42501','P0001','22P02','57014','40001','40P01'].includes(error.code)?error.code:'unknown'
      return {observation,status:'rpc_error',sqlstate}
    }
    if(data===null)return {observation,status:'missing'}
    if(!isEvidenceRecord(data))return {observation,status:'shape'}
    const {assessmentId,...candidate}=data
    if(!isEvidenceUuid(assessmentId))return {observation,status:'shape'}
    const facet=bindReceivedProdatApplicationObjects(candidate,input.rawPayload)
    if(!facet||!['accepted','rejected','held'].includes(facet.headerDecision)
      ||facet.objects.some(object=>!['accepted','rejected','held'].includes(object.applicationDecision)))return {observation,status:'unbound'}
    const objectCount=facet.objects.length,registerCount=facet.objects.reduce((count,object)=>count+object.registers.length,0)
    if(!Number.isSafeInteger(objectCount)||objectCount>8192||!Number.isSafeInteger(registerCount)||registerCount>8192)return {observation,status:'shape'}
    return {observation,status:facet.headerDecision,objectCount,registerCount,
      acceptedObjectCount:facet.objects.filter(object=>object.applicationDecision==='accepted').length,
      rejectedObjectCount:facet.objects.filter(object=>object.applicationDecision==='rejected').length,
      heldObjectCount:facet.objects.filter(object=>object.applicationDecision==='held').length}
  }catch{return {observation,status:'projection_error'}}
}

async function receive(f:Fixture,wire:string){
  const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,
    smtpFrom:'synthetic@example.invalid'})
  const match=await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed,
    inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
  const tenant=await resolveTenantForInboundEdiel({mailboxCompanyId:f.companyId,mailboxId:mail.mailboxId,
    environment:'test',parsed:mail.parsed})
  expect(tenant.companyId).toBe(f.companyId)
  const sourceId=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.reviewer.id,environment:'test',
    inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,meteringPointMatch:match,tenantResolution:tenant.shared})
  expect(sourceId).toMatch(/^[a-f0-9-]{36}$/)
  const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',sourceId!).single()
  expect(error).toBeNull();expect(data).toMatchObject({company_id:f.companyId,direction:'inbound',raw_payload:wire,
    inbound_email_message_id:mail.inboundEmailMessageId,mailbox_message_id:mail.inboundEmailMessageId})
  try{
    await processInboundEdielMessage({actorUserId:f.reviewer.id,edielMessageId:sourceId!})
  }catch(error){
    const postFailureApplicationRead=await observePostFailureApplicationRead({companyId:f.companyId,sourceMessageId:sourceId!,rawPayload:wire})
    let diagnostic:unknown
    try{
      // Separate fresh canonical invocation after the failed normal processor.
      // The real recorder may write canonical evidence; it never repairs the
      // original failure, fabricates an owner, or continues to business apply.
      const original=data as EdielMessageRow
      const decision=await resolveCanonicalRuntimeDecisionWithRegistry(original)
      const evidence=buildReceivedSourceValidationEvidence({original,validated:original,resolvedCompanyId:f.companyId,decision})
      const recording=evidence?await supabaseService.rpc('gridex_record_prodat_source_validation_v6',{
        p_company_id:evidence.companyId,p_environment:evidence.environment,p_source_message_id:evidence.sourceMessageId,
        p_source_payload_hash:evidence.sourcePayloadHash,p_facts_text:evidence.factsText,
        p_source_function_facts_text:evidence.prodatSourceFunctionValidation?JSON.stringify(evidence.prodatSourceFunctionValidation):null,
        p_object_facts_text:evidence.prodatObjectValidation?JSON.stringify(evidence.prodatObjectValidation):null,
        p_application_facts_text:evidence.prodatApplicationValidation?JSON.stringify(evidence.prodatApplicationValidation):null,
        p_ignored_fields_text:evidence.prodatIgnoredFields?JSON.stringify(evidence.prodatIgnoredFields):null,
        p_response_facts_text:evidence.prodatResponseValidation?JSON.stringify(evidence.prodatResponseValidation):null,
      }).abortSignal(AbortSignal.timeout(2000)):null
      diagnostic={syntax:decision.syntaxDecision,application:decision.applicationDecision,functional:decision.functionalDecision,
        issues:decision.issues,objects:decision.prodatApplicationValidation,registers:decision.prodatRegisterValidation,
        evidenceBuilt:evidence!==null,recording:recording?{error:recording.error?{code:recording.error.code,message:recording.error.message}:null,
          dataVersion:(recording.data as {version?:unknown}|null)?.version}:null}
    }catch(diagnosticError){diagnostic={diagnosticFailure:diagnosticError instanceof Error?diagnosticError.message:String(diagnosticError)}}
    throw new Error(JSON.stringify({normalProcessFailure:error instanceof Error?error.message:String(error),postFailureApplicationRead,diagnostic}),{cause:error})
  }
  const saved=await supabaseService.from('ediel_messages').select('*').eq('id',sourceId!).eq('company_id',f.companyId).single()
  expect(saved.error).toBeNull()
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(saved.data as EdielMessageRow)
  // Diagnostic projection only: retained source, no flags/profile/clock patch.
  const diagnostic={syntax:decision.syntaxDecision,application:decision.applicationDecision,functional:decision.functionalDecision,
    disposition:decision.prodatProcessingDisposition,issues:decision.issues,trace:decision.decisionTrace,
    objects:decision.prodatApplicationValidation,registers:decision.prodatRegisterValidation}
  return {sourceId:sourceId!,mail,wire,diagnostic}
}

function effects(f:Fixture,source:string){
  return sql<{receipts:Record<string,unknown>[];acks:{id:string;family:string;outcome:string;wire:string;company:string}[];
    outbox:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source)}),
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'outcome',ack_outcome,'wire',raw_payload,'company',company_id) ORDER BY id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(source)} AND direction='outbound'),
    'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'message',ediel_message_id,'company',company_id,'source',source_message_id,'hash',immutable_payload_hash,'created',created_at) ORDER BY id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(source)}))`)
}

it('first genuine two-register Z10 is staged, reviewed, applied and physically acknowledged once',async()=>{
  const f=await fixture(),change=changeWire(f),source=await receive(f,change.wire)
  const early=effects(f,source.sourceId)
  expect(early.receipts).toEqual([])
  expect(early.acks.filter(ack=>ack.family==='CONTRL')).toHaveLength(1)
  expect(early.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')).toEqual([])
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})).toBeNull()
  const reviewed=await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:source.sourceId,
    reviewerUserId:f.reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})
  expect(reviewed,JSON.stringify({reviewed,canonical:source.diagnostic})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  const cases=sql<{id:string}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM public.ediel_inbound_cases WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(source.sourceId)}`)
  expect(cases).toHaveLength(1)
  const approve=()=>approveEdielInboundCase({companyId:f.companyId,actorUserId:f.reviewer.id,caseId:cases[0].id})
  expect(await approve()).toMatchObject({status:'applied'})
  const final=await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})
  expect(final).toMatchObject({totalObjectCount:1,plans:[{effectKind:'structural',outcome:'positive',acknowledgedReferences:[change.reference]}]})
  const committed=effects(f,source.sourceId),positive=committed.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')
  expect(committed.receipts).toHaveLength(1);expect(positive).toHaveLength(1)
  expect(positive[0].company).toBe(f.companyId)
  expect(validateEdifactEnvelope(positive[0].wire).ok).toBe(true)
  expect(readPhysicalAckSourceCorrelation({id:positive[0].id,company_id:f.companyId,environment:'test',
    direction:'outbound',message_family:'APERAK',raw_payload:positive[0].wire},
    {id:source.sourceId,company_id:f.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',raw_payload:change.wire}))
    .toMatchObject({classification:{family:'APERAK',outcome:'positive',profile:'PRODAT_16_B'},scope:'object',
      acknowledgedReferences:[change.reference],prodatObjectOutcomes:[{objectId:f.external,identityAgency:'9',lineItemReference:change.reference,outcome:'positive'}]})
  expect(committed.outbox).toEqual(expect.arrayContaining([expect.objectContaining({message:positive[0].id,source:source.sourceId,company:f.companyId})]))
  const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())')
  const snapshot=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:f.companyId,p_environment:'test',p_cutoff:cutoff})
  expect(snapshot.error).toBeNull()
  const version=inspectStructuralReadset({companyId:f.companyId,environment:'test',cutoffAt:cutoff},snapshot.data).versions.find(v=>v.sourceMessageId===source.sourceId)
  expect(version?.wire).toMatchObject({meterNumber:'NEW-METER',oldMeterNumber:'METER-1',registers:[{registerId:'101'},{registerId:'102'}]})
  await approve()
  expect(effects(f,source.sourceId)).toEqual(committed)
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})).toEqual(final)
  expect(createHash('sha256').update(source.wire).digest('hex')).toBe(source.mail.sourcePayloadHash)
})

it('a contradictory prior meter obtains no positive first effect or final ACK authority',async()=>{
  const f=await fixture(),change=changeWire(f,'UNRELATED-OLD-METER'),source=await receive(f,change.wire)
  const reviewed=await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:source.sourceId,
    reviewerUserId:f.reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})
  expect(reviewed,JSON.stringify({reviewed,canonical:source.diagnostic})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  const cases=sql<{id:string}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM public.ediel_inbound_cases WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(source.sourceId)}`)
  expect(cases).toHaveLength(1)
  // Hypothesis probe: no existing precommit old-meter refusal code was found.
  // Any unexpected throw fails this probe; a generic permission/route error
  // cannot masquerade as a successful business refusal. Inspect actual effects.
  await approveEdielInboundCase({companyId:f.companyId,actorUserId:f.reviewer.id,caseId:cases[0].id})
  const after=effects(f,source.sourceId)
  expect(after.receipts).toEqual([]);expect(after.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')).toEqual([])
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})).toBeNull()
})
