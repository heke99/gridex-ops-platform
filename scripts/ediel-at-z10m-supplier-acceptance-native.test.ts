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
import {mUtiltsWire,prepareMUtiltsMember,mUtiltsEffects,mStructuralSnapshot} from './helpers/ediel-z10m-utilts-native-fixture'
import {selectStructuralSources} from '@/lib/ediel/sources/structuralSourceSelection'
import {localEdifactDateTimeToUtc} from '@/lib/ediel/utilts/timezone'
import {qualifyControlledZ10MChronology} from './helpers/ediel-z10m-calendar-chronology'

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

it('actual M old and new E66 periods persist own readings and energy without replacing history or duplicating effects',async()=>{
  const f=await fixture(),change=changeWire(f)
  // Calendar arithmetic produces physical local minutes. Conversion below
  // uses the original PRODAT's fixed +0100 basis, never the host timezone.
  const minute=(days:number)=>new Date(Date.UTC(+change.minute.slice(0,4),+change.minute.slice(4,6)-1,
    +change.minute.slice(6,8)+days)).toISOString().slice(0,10).replaceAll('-','')+'0000'
  const utc=(value:string)=>localEdifactDateTimeToUtc(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:00`,
    {raw:'+0100',offsetMinutes:60,format:'406'})!
  const oldOptions={meter:'METER-1',registers:['101'],startValues:['10000'],endValues:['11000'],energy:'1000',
    period:{startMinute:minute(-1),endMinute:minute(0)}}
  const newOptions={meter:'NEW-METER',registers:['101','102'],startValues:['0','2000'],endValues:['1000','2300'],energy:'1000',
    period:{startMinute:minute(0),endMinute:minute(1)}}
  const old=await prepareMUtiltsMember(f,mUtiltsWire(f,oldOptions))
  expect(old.qualified.runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  expect(old.qualified.evidence.comparisons).toMatchObject([{status:'matched',codes:[],selected:[{
    sourceMessageId:f.source,meterNumber:'METER-1',registerIds:['101'],
  }]}])
  expect(mUtiltsEffects(f,old.message.id)).toMatchObject({series:[],values:[],contracts:[],bindings:[],reservations:[]})
  const oldPersisted=await old.persist()
  expect(oldPersisted).toMatchObject([{disposition:'accepted',persistenceStatus:'persisted',idempotentReplay:false}])
  const assertStored=(member:typeof old,values:string[],energy:string,energyOrdinal:number)=>{
    const stored=mUtiltsEffects(f,member.message.id),transaction=member.input.transactions[0],hash=createHash('sha256').update(member.message.raw_payload!).digest('hex')
    expect(stored.source).toMatchObject({id:member.message.id,company_id:f.companyId,environment:'test',raw_payload:member.message.raw_payload})
    expect(stored.durableSource).toMatchObject({source_message_id:member.message.id,company_id:f.companyId,environment:'test',raw_payload:member.message.raw_payload,payload_hash:hash})
    expect(stored.series).toHaveLength(1)
    expect(stored.series[0]).toMatchObject({company_id:f.companyId,source_ediel_message_id:member.message.id,
      source_transaction_reference:transaction.transactionId,metering_point_id:f.pointId})
    const start=energyOrdinal===2?minute(-1):minute(0),end=energyOrdinal===2?minute(0):minute(1)
    expect(transaction).toMatchObject({periodStart:utc(start),periodEnd:utc(end)})
    // PostgreSQL JSON and the runtime serialize the same UTC instant with
    // different suffixes; compare instants without changing stored evidence.
    expect(Date.parse(String(stored.series[0].period_start))).toBe(Date.parse(transaction.periodStart!))
    expect(Date.parse(String(stored.series[0].period_end))).toBe(Date.parse(transaction.periodEnd!))
    expect(member.readings).toEqual(values.slice(0,energyOrdinal).map((value,index)=>({transactionId:transaction.transactionId,
      register:[index<2?'101':'102'],meter:[energyOrdinal===2?'METER-1':'NEW-METER'],value,raw:transaction.quantities[index].raw,
      times:[['597',index%2===0?start:end,'203']]})))
    expect(stored.values.map(row=>({qualifier:row.qualifier,quantity:row.quantity,raw:row.raw_value,order:row.source_order,observation:row.observation_id})))
      .toEqual(values.map((value,index)=>({qualifier:index===energyOrdinal?'136':'220',quantity:Number(value),raw:transaction.quantities[index].raw,order:index+1,observation:String(index+1)})))
    // QTY220 times/registers remain physical SEQ evidence. No fictitious
    // reading_at or register column is supplied to the persisted values.
    expect(stored.values.slice(0,energyOrdinal).every(row=>row.reading_at===null)).toBe(true)
    expect(stored.bindings).toMatchObject([{raw_hash:hash,membership:[transaction.transactionId],contract_version:2}])
    expect(stored.reservations).toMatchObject([{source_message_id:member.message.id,source_transaction_id:transaction.transactionId,
      disposition:'accepted',planned_response_type:'positive_aperak',persistence_status:'persisted',persisted_series_id:stored.series[0].id}])
    expect(stored.contracts).toHaveLength(1)
    expect(stored.storedContracts).toEqual(member.input.contracts)
    expect(stored.storedContracts[0]).toMatchObject({version:2,companyId:f.companyId,environment:'test',transactionId:transaction.transactionId,
      observations:[{quantity:energy,sourceOrdinal:energyOrdinal,registerCode:null,externalPoint:f.external,
        periodStart:transaction.periodStart,periodEnd:transaction.periodEnd}]})
    return stored
  }
  const oldCommitted=assertStored(old,['10000','11000','1000'],'1000',2)
  const beforeM=sql<string>('SELECT to_jsonb(clock_timestamp())'),prior=await mStructuralSnapshot(f,beforeM)
  const priorBaseline=prior.versions.find(version=>version.sourceMessageId===f.source)
  expect(priorBaseline).toMatchObject({disposition:'accepted',wire:{meterNumber:'METER-1',registers:[{registerId:'101'}]}})
  const source=await receive(f,change.wire)
  expect(await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:source.sourceId,
    reviewerUserId:f.reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  const cases=sql<{id:string}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM public.ediel_inbound_cases WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(source.sourceId)}`)
  expect(cases).toHaveLength(1)
  const approve=()=>approveEdielInboundCase({companyId:f.companyId,actorUserId:f.reviewer.id,caseId:cases[0].id})
  expect(await approve()).toMatchObject({status:'applied'})
  const mCommitted=effects(f,source.sourceId),mFinal=await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})
  expect(mCommitted.receipts).toHaveLength(1)
  expect(mCommitted.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')).toHaveLength(1)
  expect(mFinal).toMatchObject({totalObjectCount:1,plans:[{effectKind:'structural',outcome:'positive',acknowledgedReferences:[change.reference]}]})
  expect(mUtiltsEffects(f,old.message.id)).toEqual(oldCommitted)
  const current=await prepareMUtiltsMember(f,mUtiltsWire(f,newOptions))
  expect(current.qualified.runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  expect(current.qualified.evidence.comparisons).toMatchObject([{status:'matched',codes:[],selected:[{
    sourceMessageId:source.sourceId,payloadHash:source.mail.sourcePayloadHash,meterNumber:'NEW-METER',registerIds:['101','102'],effectiveFrom:utc(minute(0)),
  }]}])
  expect(mUtiltsEffects(f,current.message.id)).toMatchObject({series:[],values:[],contracts:[],bindings:[],reservations:[]})
  const newPersisted=await current.persist()
  expect(newPersisted).toMatchObject([{disposition:'accepted',persistenceStatus:'persisted',idempotentReplay:false}])
  const newCommitted=assertStored(current,['0','1000','2000','2300','1000'],'1000',4)
  expect(mUtiltsEffects(f,old.message.id)).toEqual(oldCommitted)
  const historical=await mStructuralSnapshot(f,beforeM)
  expect(historical.versions.find(version=>version.sourceMessageId===f.source)).toEqual(priorBaseline)
  expect(historical.versions.find(version=>version.sourceMessageId===source.sourceId)?.disposition).not.toBe('accepted')
  const now=sql<string>('SELECT to_jsonb(clock_timestamp())'),readset=await mStructuralSnapshot(f,now)
  const selected=(start:string,end:string)=>selectStructuralSources({ledgerStartedAt:readset.timeline.ledgerStartedAt!,cutoffAt:now,
    readComplete:readset.timeline.boundedReadComplete,unresolvedSources:readset.unresolvedSources,versions:readset.versions,
    closures:readset.closures,closureBlockers:readset.closureBlockers,correctionContextBlockers:readset.correctionContextBlockers,
    companyId:f.companyId,environment:'test',customerId:f.customerId,supplyPeriodId:f.period,
    objectId:f.external,identityAgency:'9',legalSender:f.receiver,legalReceiver:f.sender,periodStart:utc(start),periodEnd:utc(end),boundary:'interval'})
  expect(selected(minute(-1),minute(0))).toMatchObject({status:'selected',states:[{sourceMessageId:f.source,meterNumber:'METER-1',registerIds:['101']}]})
  expect(selected(minute(0),minute(1))).toMatchObject({status:'selected',states:[{sourceMessageId:source.sourceId,meterNumber:'NEW-METER',registerIds:['101','102']}]})
  expect(await old.persist()).toMatchObject([{seriesId:oldPersisted[0].seriesId,idempotentReplay:true}])
  expect(await current.persist()).toMatchObject([{seriesId:newPersisted[0].seriesId,idempotentReplay:true}])
  await approve()
  expect(mUtiltsEffects(f,old.message.id)).toEqual(oldCommitted);expect(mUtiltsEffects(f,current.message.id)).toEqual(newCommitted)
  expect(effects(f,source.sourceId)).toEqual(mCommitted)
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})).toEqual(mFinal)
  for(const adverse of [{...newOptions,meter:'METER-1',code:'E61'},
    {...newOptions,registers:['101'],startValues:['0'],endValues:['1000'],code:'E62'}]){
    const refused=await prepareMUtiltsMember(f,mUtiltsWire(f,adverse))
    expect(refused.qualified.evidence.comparisons).toMatchObject([{status:'mismatch',codes:[adverse.code]}])
    expect(refused.qualified.runtime.transactionDispositions).toMatchObject([{disposition:'processability_rejected',responseType:'utilts_err'}])
    expect(await refused.persist()).toMatchObject([{disposition:'processability_rejected',responseType:'utilts_err',persistenceStatus:'not_applicable'}])
    const observed=mUtiltsEffects(f,refused.message.id)
    expect(observed).toMatchObject({series:[],values:[],contracts:[],storedContracts:[],outbound:[],outbox:[]})
    expect(observed.reservations.some(row=>row.planned_response_type==='positive_aperak'||row.persistence_status==='persisted')).toBe(false)
    expect(mUtiltsEffects(f,old.message.id)).toEqual(oldCommitted);expect(mUtiltsEffects(f,current.message.id)).toEqual(newCommitted)
    expect(effects(f,source.sourceId)).toEqual(mCommitted)
  }
})

// Additive controls: keep the two original complete M2 cases and M3 intact.
// A genuinely supplied first259 remains present; only its required dependent
// constant/digit pair is omitted from that same physical register.
it.each(['214','218'] as const)('M missing own required field %s keeps the reading declaration and obtains no structural effect',async field=>{
  const f=await fixture(),change=changeWire(f)
  const pair=field==='214'?"CCI++Z02'CAV+:::1'":"CCI++Z05'CAV+:::6'"
  expect(change.wire.split(pair)).toHaveLength(3)
  const omitted=change.wire.replace(pair,'')
  const wire=omitted.replace(/UNT\+(\d+)\+M'/,(_,count:string)=>`UNT+${Number(count)-2}+M'`)
  expect(wire).not.toBe(change.wire)
  expect(validateEdifactEnvelope(wire).ok).toBe(true)
  const business=()=>sql<Record<string,unknown>>(`SELECT jsonb_build_object(
    'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE p.company_id=${literal(f.companyId)} AND p.id=${literal(f.pointId)}),
    'site',(SELECT to_jsonb(s) FROM public.sites s JOIN public.metering_points p ON p.site_id=s.id AND p.company_id=s.company_id WHERE p.company_id=${literal(f.companyId)} AND p.id=${literal(f.pointId)}),
    'switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE s.company_id=${literal(f.companyId)} AND s.id=${literal(f.switchId)}),
    'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE p.company_id=${literal(f.companyId)} AND p.id=${literal(f.period)}))`)
  const before=business()
  expect(before).toMatchObject({point:{id:f.pointId,company_id:f.companyId},site:{id:f.siteId,company_id:f.companyId},
    switch:{id:f.switchId,company_id:f.companyId},supply:{id:f.period,company_id:f.companyId}})
  const source=await receive(f,wire)
  const stored=await supabaseService.from('ediel_messages').select('*').eq('id',source.sourceId).eq('company_id',f.companyId).single()
  expect(stored.error).toBeNull()
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(stored.data as EdielMessageRow,{actorUserId:f.reviewer.id})
  expect(decision.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
  expect(decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative').flatMap(plan=>plan.applicationErrors??[]))
    .toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:field,ercCode:'41',prodatFieldDiagnostic:expect.objectContaining({
      kind:'field',fieldNumber:field,errorKind:'missing',occurrence:expect.objectContaining({objectId:f.external,identityAgency:'9',lineItemReference:change.reference}),
    })})]))
  expect(await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:source.sourceId,
    reviewerUserId:f.reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null}))
    .toMatchObject({status:'recorded',sourceDisposition:'not_established',objectCounts:{accepted:0,rejected:1,held:0}})
  const after=effects(f,source.sourceId)
  expect(after.receipts).toEqual([])
  expect(after.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')).toEqual([])
  const negative=after.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='negative')
  expect(negative).toHaveLength(1)
  expect(validateEdifactEnvelope(negative[0].wire).ok).toBe(true)
  const ackSegments=tokenizeEdifact(negative[0].wire).segments
  const errorGroups=ackSegments.flatMap((segment,index)=>{
    if(segment.tag!=='ERC')return []
    const next=ackSegments.findIndex((part,position)=>position>index&&part.tag==='ERC')
    const group=ackSegments.slice(index,next<0?undefined:next)
    return [{code:segment.raw,fields:group.filter(part=>part.tag==='FTX').map(part=>part.raw),
      references:group.filter(part=>part.tag==='RFF').map(part=>part.raw)}]
  })
  expect(errorGroups).toEqual(expect.arrayContaining([expect.objectContaining({code:'ERC+41::260',
    fields:expect.arrayContaining([expect.stringMatching(new RegExp(`^FTX\\+AAO\\+\\+${field}::260\\+`))]),
    references:expect.arrayContaining([`RFF+LI:${change.reference}`]),
  })]))
  expect(readPhysicalAckSourceCorrelation({id:negative[0].id,company_id:f.companyId,environment:'test',direction:'outbound',
    message_family:'APERAK',raw_payload:negative[0].wire},
    {id:source.sourceId,company_id:f.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',raw_payload:wire}))
    .toMatchObject({classification:{family:'APERAK',outcome:'negative',profile:'PRODAT_16_B'},scope:'object',
      acknowledgedReferences:[change.reference],prodatObjectOutcomes:[{objectId:f.external,identityAgency:'9',lineItemReference:change.reference,outcome:'negative'}]})
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:wire})).toBeNull()
  expect(business()).toEqual(before)
  expect(createHash('sha256').update(wire).digest('hex')).toBe(source.mail.sourcePayloadHash)
})

it('M final positive authority and physical ACK reject another genuine source or caller-mutated original',async()=>{
  const f=await fixture(),change=changeWire(f),source=await receive(f,change.wire)
  expect(await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:source.sourceId,
    reviewerUserId:f.reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  const cases=sql<{id:string}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM public.ediel_inbound_cases WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(source.sourceId)}`)
  expect(cases).toHaveLength(1)
  expect(await approveEdielInboundCase({companyId:f.companyId,actorUserId:f.reviewer.id,caseId:cases[0].id})).toMatchObject({status:'applied'})
  const committed=effects(f,source.sourceId),positive=committed.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')
  expect(committed.receipts).toHaveLength(1);expect(positive).toHaveLength(1)
  const final=await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})
  expect(final).toMatchObject({plans:[{outcome:'positive',effectKind:'structural',acknowledgedReferences:[change.reference]}]})
  // Change only a caller copy. No protected raw/source row is patched.
  const mutated=change.wire.replace(`RFF+LI:${change.reference}'`,"RFF+LI:UNRELATED-CALLER-LI'")
  expect(mutated).not.toBe(change.wire)
  expect(validateEdifactEnvelope(mutated).ok).toBe(true)
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:mutated})).toBeNull()
  const otherChange=changeWire(f),other=await receive(f,otherChange.wire)
  expect(other.sourceId).not.toBe(source.sourceId);expect(otherChange.reference).not.toBe(change.reference)
  expect(()=>readPhysicalAckSourceCorrelation({id:positive[0].id,company_id:f.companyId,environment:'test',direction:'outbound',
    message_family:'APERAK',raw_payload:positive[0].wire},
    {id:other.sourceId,company_id:f.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',raw_payload:otherChange.wire}))
    .toThrow('ack_prodat_original_object_scope_mismatch')
  expect(effects(f,other.sourceId).receipts).toEqual([])
  expect(effects(f,other.sourceId).acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')).toEqual([])
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:other.sourceId,rawPayload:otherChange.wire})).toBeNull()
  expect(effects(f,source.sourceId)).toEqual(committed)
  expect(await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:source.sourceId,rawPayload:change.wire})).toEqual(final)
  const stored=await supabaseService.from('ediel_messages').select('raw_payload').eq('id',source.sourceId).eq('company_id',f.companyId).single()
  expect(stored.error).toBeNull();expect(stored.data?.raw_payload).toBe(change.wire)
  expect(createHash('sha256').update(stored.data!.raw_payload!).digest('hex')).toBe(source.mail.sourcePayloadHash)
})

it('actual received M with a future replacement cannot borrow reception as completed DSO send chronology',async()=>{
  const f=await fixture(),change=changeWire(f),source=await receive(f,change.wire)
  const stored=await supabaseService.from('ediel_messages').select('*').eq('id',source.sourceId).eq('company_id',f.companyId).single()
  expect(stored.error).toBeNull()
  expect(stored.data).toMatchObject({id:source.sourceId,company_id:f.companyId,environment:'test',direction:'inbound',
    message_version:'E2SE6A',raw_payload:change.wire})
  const received=stored.data!.message_received_at!
  expect(Number.isFinite(Date.parse(received))).toBe(true)
  const binding={fixtureId:'actual-M-'+source.sourceId,sourceMessageId:source.sourceId,companyId:f.companyId,
    environment:'test' as const,payloadHash:source.mail.sourcePayloadHash,meteringPointId:f.pointId,
    objectId:f.external,identityAgency:'9' as const,issuerEdielId:f.receiver,receiverEdielId:f.sender,
    oldMeter:'METER-1',newMeter:'NEW-METER'}
  const before=effects(f,source.sourceId)
  // Deliberately inadmissible controlled proposal: reception is no actual DSO
  // send witness, and this physical replacement is still in the future.
  const observed=await qualifyControlledZ10MChronology({
    source:{...binding,rawPayload:change.wire,messageVersion:'E2SE6A',sourceReceivedAt:received,
      direction:'inbound',actorRole:'SUPPLIER',applicationReference:'23-DDQ-PRODAT'},
    event:{...binding,kind:'controlled_meter_replacement',marketMinute:change.minute},
    send:{...binding,kind:'controlled_dso_send',dispatchedAt:received},
    calendar:{fixtureId:binding.fixtureId,provenance:'explicit_controlled_calendar',market:'electricity',country:'SE',
      firstDate:change.minute.slice(0,4)+'-'+change.minute.slice(4,6)+'-'+change.minute.slice(6,8),lastDate:'',rows:[]},
  })
  expect(observed).toMatchObject({evidenceLevel:'controlled_fixture',authority:'none',status:'not_established',
    reason:'send_before_event',deadlineDate:null,queries:[]})
  expect(effects(f,source.sourceId)).toEqual(before)
  expect(before.receipts).toEqual([])
  expect(before.acks.filter(ack=>ack.family==='APERAK'&&ack.outcome==='positive')).toEqual([])
})

// M5 additive proposal. Ordinary UPDATEs exercise the actual public storage
// guards; the SQL below only observes complete rows, including already-existing
// fixture effects. It does not seed, repair or grant a private source owner.
function m5OwnerControlState(f:Fixture){
  const tables=[
    ['messages','public.ediel_messages','id'],
    ['events','public.ediel_message_events','id'],
    ['cases','public.ediel_inbound_cases','id'],
    ['outbox','public.ediel_outbox','id'],
    ['reservations','public.ediel_ack_transaction_results','id'],
    ['receptions','gridex_ediel_inbound_receptions.receptions','id'],
    ['contexts','gridex_ediel_inbound_context.receipts','source_message_id'],
    ['sources','gridex_received_sources.sources','source_message_id'],
    ['assessments','gridex_received_sources.object_assessments','id'],
    ['witnesses','gridex_received_sources.object_availability_witnesses','id'],
    ['objectReceipts','gridex_received_sources.structural_object_apply_receipts','source_message_id,first_line_index'],
    ['receipts','gridex_received_sources.structural_apply_receipts','source_message_id'],
    ['batches','gridex_received_sources.structural_apply_batches','source_message_id,requested_scope_key'],
    ['transitions','gridex_received_sources.supply_source_transitions','source_message_id'],
    ['points','public.metering_points','id'],
    ['sites','public.customer_sites','id'],
    ['switches','public.supplier_switch_requests','id'],
    ['periods','public.customer_supply_periods','id'],
    ['series','public.meter_reading_series','id'],
    ['values','public.meter_reading_values','id'],
  ]
  const fields=tables.map(([name,table,order])=>`${literal(name)},
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY ${order}),'[]') FROM ${table} r WHERE r.company_id=${literal(f.companyId)})`)
  return sql<Record<string,Record<string,unknown>[]>>(`SELECT jsonb_build_object(${fields.join(',')})`)
}

function m5AssertFixtureGraph(f:Fixture,state:ReturnType<typeof m5OwnerControlState>){
  expect(state.points.filter(row=>row.id===f.pointId)).toEqual([expect.objectContaining({
    company_id:f.companyId,customer_id:f.customerId,site_id:f.siteId,customer_site_id:f.siteId,
  })])
  expect(state.sites.filter(row=>row.id===f.siteId)).toEqual([expect.objectContaining({
    company_id:f.companyId,customer_id:f.customerId,facility_id:f.external,
  })])
  expect(state.switches.filter(row=>row.id===f.switchId)).toEqual([expect.objectContaining({
    company_id:f.companyId,customer_id:f.customerId,site_id:f.siteId,metering_point_id:f.pointId,
  })])
  expect(state.periods.filter(row=>row.id===f.period)).toEqual([expect.objectContaining({
    company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,source_message_id:f.source,
  })])
}

it('M immutable received original rejects ordinary raw/hash, reserved context, receipt time and direction writes without effects',async()=>{
  const f=await fixture(),change=changeWire(f),source=await receive(f,change.wire)
  const load=()=>supabaseService.from('ediel_messages').select('*').eq('id',source.sourceId).eq('company_id',f.companyId).single()
  const original=await load()
  expect(original.error).toBeNull()
  expect(original.data).toMatchObject({id:source.sourceId,company_id:f.companyId,environment:'test',direction:'inbound',
    message_family:'PRODAT',message_code:'Z10',message_version:'E2SE6A',raw_payload:change.wire,
    immutable_payload_hash:source.mail.sourcePayloadHash,inbound_email_message_id:source.mail.inboundEmailMessageId})
  if(!original.data||!isEvidenceRecord(original.data.execution_context_snapshot)
    ||!isEvidenceRecord(original.data.execution_context_snapshot.receivedProdatContext))throw Error('M5_genuine_received_context_required')
  const context=original.data.execution_context_snapshot.receivedProdatContext
  const receivedAt=original.data.message_received_at
  if(typeof receivedAt!=='string'||!Number.isFinite(Date.parse(receivedAt)))throw Error('M5_actual_receipt_time_required')
  expect(context).toMatchObject({version:1,contextOrigin:'database_insert',sourceMessageId:source.sourceId,
    companyId:f.companyId,environment:'test',messageCode:'Z10',payloadHash:source.mail.sourcePayloadHash})
  expect(Date.parse(String(context.sourceReceivedAt))).toBe(Date.parse(receivedAt))
  const mutatedRaw=change.wire.replace(`RFF+LI:${change.reference}'`,"RFF+LI:M5-MUTATED-LI'")
  expect(mutatedRaw).not.toBe(change.wire)
  expect(validateEdifactEnvelope(mutatedRaw).ok).toBe(true)
  const mutatedHash=createHash('sha256').update(mutatedRaw).digest('hex')
  expect(mutatedHash).not.toBe(source.mail.sourcePayloadHash)
  const before=m5OwnerControlState(f),providerCalls=external.send.mock.calls.length
  m5AssertFixtureGraph(f,before)
  expect(before.sources.filter(row=>row.source_message_id===source.sourceId)).toEqual([expect.objectContaining({
    company_id:f.companyId,environment:'test',origin:'database_insert',message_code:'Z10',raw_payload:change.wire,
    payload_hash:source.mail.sourcePayloadHash,received_context:context,
  })])
  const receptions=before.receptions.filter(row=>row.source_message_id===source.sourceId)
  expect(receptions).toHaveLength(1)
  expect(receptions[0]).toMatchObject({company_id:f.companyId,environment:'test',classification:'first_reception',
    inbound_email_message_id:source.mail.inboundEmailMessageId,parse_result_id:source.mail.parseResultId,
    actor_user_id:f.reviewer.id,canonical_payload_hash:source.mail.sourcePayloadHash,received_payload_hash:source.mail.sourcePayloadHash})
  expect(Date.parse(String(receptions[0].received_at))).toBe(Date.parse(receivedAt))
  const attempts:{name:string;patch:Record<string,unknown>;sentinel:string}[]=[
    {name:'changed raw with its correct new SHA256',patch:{raw_payload:mutatedRaw,immutable_payload_hash:mutatedHash},
      sentinel:'immutable_ediel_payload_cannot_change'},
    {name:'reserved received context',patch:{execution_context_snapshot:{...original.data.execution_context_snapshot,
      receivedProdatContext:{...context,sourceMessageId:randomUUID()}}},sentinel:'immutable_ediel_received_context_cannot_change'},
    {name:'receipt time',patch:{message_received_at:new Date(Date.parse(receivedAt)+1000).toISOString()},
      sentinel:'immutable_ediel_receipt_time_cannot_change'},
    {name:'direction',patch:{direction:'outbound'},sentinel:'immutable_ediel_received_context_cannot_change'},
  ]
  // An actual second HTTP UPDATE invocation retries the payload mutation against
  // the unchanged original; this is guard retry, not processor/ACK replay proof.
  for(const attempt of [...attempts,{...attempts[0],name:'fresh ordinary payload UPDATE retry'}]){
    const rejected=await supabaseService.from('ediel_messages').update(attempt.patch)
      .eq('id',source.sourceId).eq('company_id',f.companyId).select('id')
    expect(rejected.error,attempt.name).toMatchObject({code:'23514',message:attempt.sentinel})
    const retained=await load()
    expect(retained.error,attempt.name).toBeNull()
    expect(retained.data,attempt.name).toEqual(original.data)
    expect(createHash('sha256').update(retained.data!.raw_payload).digest('hex'),attempt.name).toBe(source.mail.sourcePayloadHash)
    // Independent native SELECT observes the whole original/source/first
    // reception, every company effect row and the complete shared graph.
    expect(m5OwnerControlState(f),attempt.name).toEqual(before)
    expect(external.send.mock.calls.length,attempt.name).toBe(providerCalls)
  }
})

it('dedicated supplier-switch Z10 preparation rejects actual fixture arguments without outgoing, outbox or provider effects',async()=>{
  const f=await fixture(),before=m5OwnerControlState(f),providerCalls=external.send.mock.calls.length
  m5AssertFixtureGraph(f,before)
  const {prepareAndQueueEdielZ10}=await import('@/lib/ediel/flows/prodatSwitch')
  // This dedicated boundary rejects before actor/context loading. It proves
  // neither an ACL denial nor a live DSO-originated producer/transport path.
  const prepare=()=>prepareAndQueueEdielZ10({actorUserId:f.actorUserId,switchRequestId:f.switchId,
    communicationRouteId:f.routeId,environment:'test'})
  const sentinel='PRODAT Z10 är inbound för Gridex i aktuell marknadsroll och får inte skapas från ett supplier_switch-ärende.'
  await expect(prepare()).rejects.toThrow(sentinel)
  expect(m5OwnerControlState(f)).toEqual(before)
  expect(external.send.mock.calls.length).toBe(providerCalls)
  await expect(prepare()).rejects.toThrow(sentinel)
  expect(m5OwnerControlState(f)).toEqual(before)
  expect(external.send.mock.calls.length).toBe(providerCalls)
})
