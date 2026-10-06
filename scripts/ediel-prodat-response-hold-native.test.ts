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

async function fixture(){
 const f=await createRequestedChangeSupplyFixture(email=>external.send.mockResolvedValue({
  accepted:[email],rejected:[],messageId:'synthetic-own-Z03',response:'250 explicitly synthetic acceptance',
 }),{requestedStartDate:futureNativeSupplyDate()})
 const reviewer=await createBilateralSourceOperator(f.companyId,bilateralSourceOperatorPermissions)
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
