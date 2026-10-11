// Bounded source-recording proof only: held register/application facets never
// approve business effects or a positive ACK. External issuer/SMTP are synthetic.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {resolveTenantForInboundEdiel} from '@/lib/inbound-mail/inboundTenantResolver'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {tokenizeEdifact,segmentSourceSpan} from '@/lib/ediel/core/edifactTokenizer'
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

async function fixture(extraPermissions:string[]=[]){
 const f=await createRequestedChangeSupplyFixture(email=>external.send.mockResolvedValue({
  accepted:[email],rejected:[],messageId:'synthetic-own-Z03',response:'250 explicitly synthetic acceptance',
 }),{requestedStartDate:futureNativeSupplyDate()})
 const reviewer=await createBilateralSourceOperator(f.companyId,[...bilateralSourceOperatorPermissions,'communication.send',...extraPermissions])
 return {...f,reviewer}
}
type Fixture=Awaited<ReturnType<typeof fixture>>
function changeWire(f:Fixture,oldMeter='METER-1',options:{omitFirstRegisterReadingDeclaration?:boolean}={}){
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
    ...(options.omitFirstRegisterReadingDeclaration?[]:characteristic('Z16','101',3)),
    ...characteristic('Z02','1',3),...characteristic('Z05','6',3),
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


it('records the genuine two-register held source through v6 without granting own effects or replies',async()=>{
 const f=await fixture(),{wire}=changeWire(f)
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,smtpFrom:'synthetic@example.invalid'})
 const match=await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed,
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const tenant=await resolveTenantForInboundEdiel({mailboxCompanyId:f.companyId,mailboxId:mail.mailboxId,environment:'test',parsed:mail.parsed})
 expect(tenant.companyId).toBe(f.companyId)
 const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.reviewer.id,environment:'test',
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,meteringPointMatch:match,tenantResolution:tenant.shared})
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',id!).eq('company_id',f.companyId).single()
 expect(error).toBeNull();expect(data).toMatchObject({direction:'inbound',raw_payload:wire,mailbox_message_id:mail.inboundEmailMessageId})
 const original=data as EdielMessageRow,decision=await resolveCanonicalRuntimeDecisionWithRegistry(original)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 expect(decision.issues.filter(issue=>issue.prodatDiagnostic?.kind==='local_unknown')).toHaveLength(6)
 expect(decision.prodatApplicationValidation?.headerDecision).toBe('held')
 const receipt=await recordReceivedSourceValidation({original,validated:original,resolvedCompanyId:f.companyId,decision})
 expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 if(receipt.status!=='recorded')throw Error('native_held_source_recording_required')
 const hash=createHash('sha256').update(wire).digest('hex')
 const stored=sql<{facts:Record<string,unknown>;factsHash:string;raw:string;hash:string;response:{objects:{outcome:string;registerLineIndices:number[]}[];responses:unknown[]};application:{headerDecision:string};objects:{objects:{disposition:string}[]};hashesValid:boolean}>(`
  SELECT jsonb_build_object('facts',a.facts_text::jsonb,'factsHash',a.facts_hash,'raw',s.raw_payload,'hash',s.payload_hash,
   'response',r.response_facts_text::jsonb,'application',p.application_facts_text::jsonb,'objects',o.facts_text::jsonb,
   'hashesValid',a.facts_hash=encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') AND
     r.response_facts_hash=encode(sha256(convert_to(r.response_facts_text,'UTF8')),'hex') AND
     p.application_facts_hash=encode(sha256(convert_to(p.application_facts_text,'UTF8')),'hex') AND
     o.facts_hash=encode(sha256(convert_to(o.facts_text,'UTF8')),'hex'))
  FROM gridex_received_sources.validation_assessments a
  JOIN gridex_received_sources.sources s ON s.source_message_id=a.source_message_id AND s.company_id=a.company_id AND s.environment=a.environment
  JOIN gridex_received_sources.prodat_response_facets r ON r.assessment_id=a.id AND r.source_message_id=a.source_message_id AND r.company_id=a.company_id AND r.environment=a.environment AND r.source_payload_hash=a.source_payload_hash
  JOIN gridex_received_sources.prodat_application_facets p ON p.assessment_id=a.id AND p.source_message_id=a.source_message_id AND p.company_id=a.company_id AND p.environment=a.environment AND p.source_payload_hash=a.source_payload_hash
  JOIN gridex_received_sources.prodat_object_validation_facets o ON o.assessment_id=a.id AND o.company_id=a.company_id AND o.environment=a.environment AND o.source_message_id=a.source_message_id AND o.source_payload_hash=a.source_payload_hash
  WHERE a.id=${literal(receipt.assessmentId)} AND a.source_message_id=${literal(id!)} AND a.company_id=${literal(f.companyId)} AND a.environment='test' AND a.source_payload_hash=${literal(hash)};`)
 expect(stored).toMatchObject({factsHash:receipt.factsHash,raw:wire,hash,hashesValid:true,
  facts:{registerValidation:{objects:[{disposition:'unavailable'}]}},response:{objects:[{outcome:'held'}],responses:[]},
  application:{headerDecision:'held'},objects:{objects:[{disposition:'unavailable'}]}})
 expect(stored.response.objects[0].registerLineIndices).toHaveLength(2)
 const counts=()=>sql(`SELECT jsonb_build_object(
  'assessments',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(id!)}),
  'business',(SELECT count(*) FROM gridex_received_sources.object_assessments WHERE source_message_id=${literal(id!)}),
  'wholeEffects',(SELECT count(*) FROM gridex_received_sources.structural_apply_receipts WHERE source_message_id=${literal(id!)}),
  'partialEffects',(SELECT count(*) FROM gridex_received_sources.structural_object_apply_receipts WHERE source_message_id=${literal(id!)}),
  'batches',(SELECT count(*) FROM gridex_received_sources.structural_apply_batches WHERE source_message_id=${literal(id!)}),
  'cases',(SELECT count(*) FROM public.ediel_inbound_cases WHERE ediel_message_id=${literal(id!)}),
  'outbound',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(id!)} AND direction='outbound'),
  'outbox',(SELECT count(*) FROM public.ediel_outbox o JOIN public.ediel_messages m ON m.id=o.ediel_message_id WHERE m.related_message_id=${literal(id!)} OR m.id=${literal(id!)}));`)
 const before=counts()
 expect(before).toMatchObject({assessments:1,business:0,wholeEffects:0,partialEffects:0,batches:0,cases:0,outbound:0,outbox:0})
 // Wrong bytes and tenant cannot append an alternative authority. These are
 // in-memory mismatches; the immutable database original remains untouched.
 expect(await recordReceivedSourceValidation({original,validated:{...original,raw_payload:wire+' '},resolvedCompanyId:f.companyId,decision}))
  .toMatchObject({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(await recordReceivedSourceValidation({original,validated:original,resolvedCompanyId:randomUUID(),decision}))
  .toMatchObject({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(counts()).toEqual(before)
 expect(createHash('sha256').update(original.raw_payload!).digest('hex')).toBe(mail.sourcePayloadHash)
})

it('normal processing records held M but preserves the exact own-application guard and technical ACK on retry',async()=>{
 const f=await fixture(['metering.read','metering.write','ediel_testing.write']),{wire,reference}=changeWire(f,'METER-1',{omitFirstRegisterReadingDeclaration:true})
 // Public disposable transport inputs only; no private readiness or readings facts.
 const route=randomUUID(),profile=randomUUID(),smtp=edielSmtpConfig()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
 VALUES(${literal(route)},${literal(f.companyId)},'Synthetic held M ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
 VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Synthetic held M ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)});`)
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,smtpFrom:'synthetic@example.invalid'})
 const match=await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed,
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const tenant=await resolveTenantForInboundEdiel({mailboxCompanyId:f.companyId,mailboxId:mail.mailboxId,environment:'test',parsed:mail.parsed})
 expect(tenant.companyId).toBe(f.companyId)
 const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.reviewer.id,environment:'test',
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,meteringPointMatch:match,tenantResolution:tenant.shared})
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 const actual=await supabaseService.from('ediel_messages').select('*').eq('id',id!).eq('company_id',f.companyId).single()
 expect(actual.error).toBeNull()
 const held=await resolveCanonicalRuntimeDecisionWithRegistry(actual.data as EdielMessageRow,{actorUserId:f.reviewer.id})
 // The later register cannot supply the first register's missing declaration.
 expect(held.policy?.prodatDependentFacts?.registerObjects).toEqual([
  {meteringPointId:f.external,identityAgency:'9',meterReadingsSentInUtilts:null},
 ])
 const readingConditions=held.policy?.prodatDependentConditions.filter(c=>['214','218','259'].includes(c.fieldNumber))
 expect(readingConditions?.map(c=>c.fieldNumber).sort()).toEqual(['214','218','259'])
 expect(readingConditions?.every(c=>c.status==='undetermined')).toBe(true)
 expect(held.prodatApplicationValidation?.headerDecision).toBe('held')
 const process=()=>processInboundEdielMessage({actorUserId:f.reviewer.id,edielMessageId:id!})
 // A different error, including the former canonical recording failure, is RED.
 await expect(process()).rejects.toThrow(/^structural_apply_complete_own_application_required$/)
 const {data:stored,error}=await supabaseService.from('ediel_messages').select('*').eq('id',id!).eq('company_id',f.companyId).single()
 expect(error).toBeNull();expect(stored).toMatchObject({status:'validated',raw_payload:wire,mailbox_message_id:mail.inboundEmailMessageId,
  validation_report:{receivedSourceValidationEvidence:{status:'recorded',sourceDisposition:'not_established'}}})
 const original=stored as EdielMessageRow,receipt=original.validation_report!.receivedSourceValidationEvidence as {assessmentId:string;factsHash:string}
 const first=()=>sql(`SELECT to_jsonb(a) FROM gridex_received_sources.validation_assessments a WHERE id=${literal(receipt.assessmentId)} AND source_message_id=${literal(id!)} AND company_id=${literal(f.companyId)} AND environment='test' AND source_payload_hash=${literal(mail.sourcePayloadHash)}`)
 const immutableAssessment=first();expect(immutableAssessment).toBeTruthy()
 const facets=sql(`SELECT jsonb_build_object('app',p.application_facts_text::jsonb,'response',r.response_facts_text::jsonb)
 FROM gridex_received_sources.prodat_application_facets p JOIN gridex_received_sources.prodat_response_facets r
 ON r.assessment_id=p.assessment_id AND r.company_id=p.company_id AND r.environment=p.environment AND r.source_message_id=p.source_message_id AND r.source_payload_hash=p.source_payload_hash
 WHERE p.assessment_id=${literal(receipt.assessmentId)} AND p.company_id=${literal(f.companyId)} AND p.environment='test' AND p.source_message_id=${literal(id!)} AND p.source_payload_hash=${literal(mail.sourcePayloadHash)}`)
 expect(facets).toMatchObject({app:{headerDecision:'held'},response:{objects:[{outcome:'held'}],responses:[]}})
 type State={cases:number;whole:number;partial:number;batches:number;acceptedObjects:number;acks:{id:string;family:string;outcome:string;wire:string}[];outbox:{id:string;message:string;hash:string}[]}
 const state=()=>sql<State>(`SELECT jsonb_build_object(
 'cases',(SELECT count(*) FROM public.ediel_inbound_cases WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(id!)}),
 'whole',(SELECT count(*) FROM gridex_received_sources.structural_apply_receipts WHERE source_message_id=${literal(id!)}),
 'partial',(SELECT count(*) FROM gridex_received_sources.structural_object_apply_receipts WHERE source_message_id=${literal(id!)}),
 'batches',(SELECT count(*) FROM gridex_received_sources.structural_apply_batches WHERE source_message_id=${literal(id!)}),
 'acceptedObjects',(SELECT count(*) FROM gridex_received_sources.object_assessments a CROSS JOIN LATERAL jsonb_array_elements(a.facts_text::jsonb->'objects') o WHERE a.source_message_id=${literal(id!)} AND o->>'disposition'='accepted'),
 'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'outcome',ack_outcome,'wire',raw_payload) ORDER BY id),'[]') FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND related_message_id=${literal(id!)} AND direction='outbound'),
 'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'message',o.ediel_message_id,'hash',o.immutable_payload_hash) ORDER BY o.id),'[]') FROM public.ediel_outbox o JOIN public.ediel_messages m ON m.id=o.ediel_message_id WHERE m.related_message_id=${literal(id!)} OR o.source_message_id=${literal(id!)}));`)
 const before=state()
 expect(before).toMatchObject({cases:0,whole:0,partial:0,batches:0,acceptedObjects:0})
 expect(before.acks).toHaveLength(1)
 const ack=before.acks[0];expect(ack).toMatchObject({family:'CONTRL',outcome:'positive'})
 expect(validateEdifactEnvelope(ack.wire).ok).toBe(true)
 expect(readPhysicalAckSourceCorrelation({id:ack.id,company_id:f.companyId,environment:'test',direction:'outbound',message_family:'CONTRL',raw_payload:ack.wire},
  {id:id!,company_id:f.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',raw_payload:wire}))
  // Original T §2.1 p16 table2: UCI/0020 contains the first14 if UNB/0020 is longer.
  .toMatchObject({classification:{family:'CONTRL',outcome:'positive'},scope:'interchange',acknowledgedReferences:[reference.slice(0,14)]})
 for(const queued of before.outbox)expect(queued).toMatchObject({message:ack.id,hash:createHash('sha256').update(ack.wire).digest('hex')})
 await expect(process()).rejects.toThrow(/^structural_apply_complete_own_application_required$/)
 expect(first()).toEqual(immutableAssessment);expect(state()).toEqual(before)
 const saved=await supabaseService.from('ediel_messages').select('raw_payload,mailbox_message_id,message_received_at').eq('id',id!).eq('company_id',f.companyId).single()
 expect(saved.error).toBeNull();expect(saved.data).toMatchObject({raw_payload:wire,mailbox_message_id:original.mailbox_message_id,message_received_at:original.message_received_at})
 expect(createHash('sha256').update(saved.data!.raw_payload!).digest('hex')).toBe(mail.sourcePayloadHash)
})
