// Proposed whole H05/H08 proof. No masterplan approval tags until authentic
// public-birth integration, actual native execution and literal review pass.
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {type SupabaseClient} from '@supabase/supabase-js'
import {afterEach,expect,it,vi} from 'vitest'

vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
const sourceSession=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{
 if(!sourceSession.client)throw Error('native_actual_source_session_required')
 return sourceSession.client
}}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
// No catalog, canonical, source, legal review, ACK or effect consumer is mocked.
import {nativeSql as sql,literal,seedNormalSwitchNativeFixture,type NormalSwitchFixtureInput} from './helpers/ediel-normal-switch-native-fixture'
import {nationalRescissionNativeChain} from './helpers/nationalRescissionNative'
import {createBilateralProdatGroundNativeFixture} from './helpers/ediel-bilateral-prodat-profile-native-fixture'
import {seedOriginalMailboxNative} from './helpers/originalMailboxNative'
import {archiveBilateralProdatGround,reviewBilateralProdatGround,readBilateralProdatGroundArtifact} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {readSupplyRescissionScope,archiveSupplyRescission,reviewSupplyRescission,readSupplyRescissionBytes} from '@/lib/ediel/production/supplyRescissionIntake'
import {prepareAndQueueSupplyRescissionZ08} from '@/lib/ediel/flows/prodatSupplyRescission'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {getEdielMessageById} from '@/lib/ediel/db'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingState} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {escapeEdifactData} from '@/lib/ediel/core/una'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {buildContrlDraft,buildAperakDraft} from '@/lib/ediel/ack'
import {guideOrderedFixtureBody} from '../__tests__/helpers/prodatGuideOrderedFixture'
import {line,qty,common,characteristic,type Parts} from '../__tests__/fixtures/prodat-register'
import {head} from '../__tests__/fixtures/prodat-identity'
import {type EdielMessageRow} from '@/lib/ediel/types'
import {h05Required,omitSupplyEndField} from './helpers/ediel-supply-end-field-omissions'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {readEdielTransportCopies} from '@/lib/ediel/transport/copy'
import {readVerifiedEdielTransportCopy} from '@/lib/ediel/transport/verifiedCopy'
import {applySupplyMarketSource} from '@/lib/ediel/flows/supplyMarketTransition'
import {SmtpDeliveryUncertainError} from '@/lib/ediel/transport/smtpOutcome'
import {readSupplyRescissionMandate} from '@/lib/ediel/production/supplyRescissionOperation'

const {originate,actualNationalSourceSession,nationalNativeOperator}=nationalRescissionNativeChain({provider,sourceSession})
async function authorized(input:Pick<NormalSwitchFixtureInput,'bindingMonths'|'billingAddress'>={}){
 const stage=await seedNormalSwitchNativeFixture({requestedStartDate:'2026-10-15',deferOriginal:true,initialSubtype:'H',...input})
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(stage.actorUserId)},${literal(stage.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN('communication.read','communication.write','communication.send','contracts.read','metering.read','metering.write');`)
 const f=await createBilateralProdatGroundNativeFixture(stage),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()})
 const review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Separate synthetic original review before actual public H origination'})
 expect(review.status,JSON.stringify(review)).toBe('authorized');return{...f,profileVersionId:String(review.profileVersionId)}
}
const hash=(raw:string|Buffer)=>createHash('sha256').update(raw).digest('hex')
afterEach(()=>{sourceSession.client=null;vi.unstubAllEnvs();vi.restoreAllMocks()})

function smtp(){
 for(const [key,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(key,value)
 provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-owned-H-provider',response:'250 synthetic accepted'})
}
type Ground=Awaited<ReturnType<typeof authorized>>
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
async function ackRoute(f:Ground){
 const id=randomUUID(),profile=randomUUID(),{from,host,port}=edielSmtpConfig()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(id)},${literal(f.companyId)},'Synthetic public H ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port) VALUES(${literal(profile)},${literal(f.companyId)},${literal(id)},'Synthetic public H ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(from)},${literal(host)},${literal(port)});`)
}
class ExpectedPhysicalBirthRefusal extends Error{}
async function receive(f:Ground,raw:string,actor=f.actorUserId,company=f.companyId,omittedField?:string){
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:company,environment:'test',raw,smtpFrom:edielSmtpConfig().from})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:company,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const meteringPointMatch=await matchMeteringPointForInbound({companyId:company,parsed:mail.parsed})
 let id:string|null
 try{id=await createInboundEdielMessage({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch})}
 catch(error){
  // Only the actual birth call is eligible. Parser/matcher/auth/network/setup
  // failures and our own assertions always propagate as test failures.
  const message=error&&typeof error==='object'&&'message'in error?String(error.message):''
  const selectors=['311','312','202','203','314','209','223']
  if(omittedField&&selectors.includes(omittedField)&&(message==='canonical_ediel_rule_pack_required'||omittedField==='312'&&message==='supply_end_birth_association_mismatch'))throw new ExpectedPhysicalBirthRefusal(message)
  throw error
 }
 expect(typeof id,JSON.stringify({phase:'public_inbound_birth',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,omittedField:omittedField??null})).toBe('string')
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 const source=(await getEdielMessageById(id!))!
 expect(source).toMatchObject({company_id:company,environment:'test',direction:'inbound',raw_payload:raw,inbound_email_message_id:mail.inboundEmailMessageId})
 expect(source.message_received_at).toBeTruthy()
 return{...mail,sourceId:id!,source,wire:raw}
}
async function accepted(f:Ground,raw:string){
 const m=await receive(f,raw),decision=await resolveCanonicalRuntimeDecisionWithRegistry(m.source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 return{...m,decision}
}
async function publicH04Reception(input:Pick<NormalSwitchFixtureInput,'bindingMonths'|'billingAddress'>={},declaration:'declared'|'absent'|'malformed'='declared'){
 const f=await authorized(input);smtp();provider.mockClear();const original=await originate(f)
 await sendEdielMessageViaSmtp((await getEdielMessageById(original.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 const originalBefore=custody(original.id),originalTransport=await retainedTransportBytes(f,original.id)
 const parsed=tokenizeEdifact(original.raw_payload!),rff=parsed.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,parsed.una)[0]==='LI'),dtm=parsed.segments.find(s=>s.tag==='DTM'&&segmentComposite(s,1,parsed.una)[0]==='92')
 const li=segmentComposite(rff,1,parsed.una)[1],start=segmentComposite(dtm,1,parsed.una)[1]
 expect(li).toBeTruthy();expect(start).toBeTruthy();await ackRoute(f)
 const body:Parts[]=[...parties(f),line('1',f.external,undefined,'9'),qty('1000'),...common(f.external,'Synthetic',start),...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','D'),['CCI','','Z14'],['CAV',['','','','L917','8716867000030']],point(f),['NAD','Z02',[f.brpEdielId,'160','SVK']]]
 // Honest synthetic SOURCE inputs, before public birth: P26.A214/218/259
 // fourth CAV components declare only that future UTILTS readings will follow.
 // Neither an accepted source nor historical UTILTS/register inventory is seeded.
 if(declaration!=='absent')body.push(...characteristic('Z02','1',3),...characteristic('Z05','6',3),...characteristic('Z16','111',declaration==='malformed'?0:3))
 const own=body.map(p=>p[0]==='CAV'&&Array.isArray(p[1])&&p[1][0]==='Z22'?['CAV',['Z25']]:p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI'?['RFF',['LI',li]]:p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='Z05'?['RFF',['Z05',f.gridAreaCode]]:p[0]==='NAD'&&p[1]==='UD'?endUser(f):p) as Parts[]
 const born=await receive(f,wire(f,'Z04',own)),decision=await resolveCanonicalRuntimeDecisionWithRegistry(born.source)
 if(declaration==='declared')expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 const received={...born,decision},sourceBefore=custody(received.sourceId)
 const tokens=tokenizeEdifact(received.wire),groups=prodatRegisterGroups(tokens.segments,tokens.una).groups
 expect(groups).toHaveLength(1);expect(groups[0]).toMatchObject({itemId:f.external,identityAgency:'9',validRegisterChain:true})
 const physicalReadings=Object.fromEntries(['214','218','259'].map(field=>[field,prodatRegisterReadingState(field,groups[0].segments,tokens.una)]))
 if(declaration==='declared')expect(physicalReadings).toEqual({214:{present:true,value:'1',malformed:false},218:{present:true,value:'6',malformed:false},259:{present:true,value:'111',malformed:false}})
 if(declaration==='absent')for(const state of Object.values(physicalReadings))expect(state).toEqual({present:false,value:null,malformed:false})
 if(declaration==='malformed')expect(physicalReadings['259']).toEqual({present:true,value:null,malformed:true})
 const businessBefore=graph(),effectsBefore=effects(f.companyId),providerBefore=provider.mock.calls.length
 const processed=await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:received.sourceId})
 const period=sql<{id:string;source_message_id:string;source_end_message_id:string|null}>(`SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(received.sourceId)}`)
 // Observe the first actual outcome without applying again or manufacturing
 // its prerequisite. Every positive still requires the committed period.
 const diagnostic=period?undefined:sql(`WITH source AS (
  SELECT * FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND id=${literal(received.sourceId)}
 ), leaf AS (
  SELECT a.* FROM gridex_received_sources.validation_assessments a JOIN source m ON m.company_id=a.company_id AND m.id=a.source_message_id
  WHERE NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)
 ) SELECT jsonb_build_object(
  'phase','public_h04_predecessor_no_period',
  'sourceId',${literal(received.sourceId)},
  'persisted',(SELECT jsonb_build_object('status',m.status,'failureReason',m.failure_reason,'tenantResolutionStatus',m.tenant_resolution_status) FROM source m),
  'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',e.event_type,'status',e.event_status,'payload',e.payload) ORDER BY e.created_at,e.id),'[]') FROM public.ediel_message_events e JOIN source m ON m.company_id=e.company_id AND m.id=e.ediel_message_id),
  'partition',(SELECT p.result FROM gridex_received_sources.supply_object_partitions p JOIN source m ON m.company_id=p.company_id AND m.id=p.source_message_id),
  'canonicalLeafCount',(SELECT count(*) FROM leaf),
  'canonical',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'syntax',a.facts_text::jsonb->>'syntaxDecision','application',a.facts_text::jsonb->>'applicationDecision','functional',a.facts_text::jsonb->>'functionalDecision','registerValidation',a.facts_text::jsonb->'registerValidation','factsHashMatches',a.facts_hash=encode(sha256(convert_to(a.facts_text,'UTF8')),'hex'),'sourceHashMatches',a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'applicationFacetCount',(SELECT count(*) FROM gridex_received_sources.prodat_application_facets p WHERE p.company_id=m.company_id AND p.source_message_id=m.id AND p.assessment_id=a.id),'applicationFacets',(SELECT coalesce(jsonb_agg(jsonb_build_object('facts',p.application_facts_text::jsonb,'factsHashMatches',p.application_facts_hash=encode(sha256(convert_to(p.application_facts_text,'UTF8')),'hex'),'sourceHashMatches',p.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'embeddedSourceHashMatches',p.application_facts_text::jsonb->>'sourcePayloadHash'=p.source_payload_hash,'environmentMatches',p.environment=m.environment) ORDER BY p.assessment_id),'[]') FROM gridex_received_sources.prodat_application_facets p WHERE p.company_id=m.company_id AND p.source_message_id=m.id AND p.assessment_id=a.id),'functionFacetCount',(SELECT count(*) FROM gridex_received_sources.prodat_source_function_facets p WHERE p.company_id=m.company_id AND p.source_message_id=m.id AND p.assessment_id=a.id)) ORDER BY a.id),'[]') FROM leaf a JOIN source m ON m.company_id=a.company_id AND m.id=a.source_message_id),
  'context',(SELECT jsonb_build_object('status',c.status,'reason',c.reason) FROM gridex_ediel_inbound_context.receipts c JOIN source m ON m.company_id=c.company_id AND m.id=c.source_message_id),
  'effectCount',(SELECT count(*) FROM gridex_received_sources.supply_object_effect_receipts e JOIN source m ON m.company_id=e.company_id AND m.id=e.source_message_id),
  'periodCount',(SELECT count(*) FROM public.customer_supply_periods p JOIN source m ON m.company_id=p.company_id AND m.id=p.source_message_id)
 )`)
 expect(custody(original.id)).toEqual(originalBefore);expect(custody(received.sourceId)).toEqual(sourceBefore)
 expect(await retainedTransportBytes(f,original.id)).toEqual(originalTransport)
 return{...f,received,processed,period,diagnostic,physicalReadings,businessBefore,effectsBefore,providerBefore,originalZ03:original}
}
async function publicHStart(input:Pick<NormalSwitchFixtureInput,'bindingMonths'|'billingAddress'>={}){
 const f=await publicH04Reception(input)
 const {received,processed,period,diagnostic}=f
 // Every original positive STILL requires the actual committed same-source
 // period. The new declared wire cannot convert a local UNKNOWN into acceptance.
 expect(period,JSON.stringify({physicalReadings:f.physicalReadings,returned:{status:processed.status,failureReason:processed.failure_reason,tenantResolutionStatus:processed.tenant_resolution_status},diagnostic,receivedControl:diagnostic?{issues:received.decision.issues,application:received.decision.prodatApplicationValidation}:undefined})).toMatchObject({source_message_id:received.sourceId,source_end_message_id:null})
 return{...f,startSourceId:received.sourceId,startWire:received.wire,periodId:period.id}
}
function endBody(f:Ground,reason:'Z25'|'Z22',li:string):Parts[]{return [...parties(f),line('1',f.external,undefined,'9'),['DTM',['93','202610161330','203']],...characteristic('Z13',reason),['RFF',['LI',li]],['RFF',['Z05',f.gridAreaCode]],endUser(f),point(f),['NAD','Z02',[f.brpEdielId,'160','SVK']]]}
async function hEndGround(input:Pick<NormalSwitchFixtureInput,'bindingMonths'|'billingAddress'>={}){
 const start=await publicHStart(input),f=await createBilateralProdatGroundNativeFixture(start,'own_end_h')
 const artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()})
 const review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Independent synthetic H-end legal-original review; no external legal approval'})
 expect(review.status,JSON.stringify(review)).toBe('authorized')
 const li='H-END-'+randomUUID().slice(0,8)
 return{...f,startSourceId:start.startSourceId,periodId:start.periodId,li,profileVersionId:String(review.profileVersionId),artifactId:String(artifact.artifactId)}
}

// Full durable rows: no counters can hide rewritten history or foreign effects.
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

async function sendOwnAcks(f:Ground,m:Awaited<ReturnType<typeof receive>>,li:string){
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.companyId,sourceMessageId:m.sourceId,rawPayload:m.wire})
 expect(final?.plans).toHaveLength(1);expect(final!.plans[0]).toMatchObject({effectKind:'supply',outcome:'positive',acknowledgedReferences:[li]})
 expect(final!.plans[0].effectReceiptId).toBe(m.sourceId)
 const transitionHash=sql<string>(`SELECT to_jsonb(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) FROM gridex_received_sources.supply_source_transitions t WHERE source_message_id=${literal(m.sourceId)}`)
 expect(final!.plans[0].effectFactsHash).toBe(transitionHash)
 const acks=sql<EdielMessageRow[]>(`SELECT jsonb_agg(to_jsonb(x) ORDER BY message_family) FROM public.ediel_messages x WHERE related_message_id=${literal(m.sourceId)} AND direction='outbound'`)
 expect(acks.map(x=>[x.message_family,x.ack_outcome])).toEqual([['APERAK','positive'],['CONTRL','positive']])
 for(const ack of acks){
  expect(ack).toMatchObject({company_id:f.companyId,environment:'test',related_message_id:m.sourceId,direction:'outbound'})
  expect(validateUnsmGrammar(ack.raw_payload!).issues.filter(x=>x.severity==='error')).toEqual([])
  const correlation=readPhysicalAckSourceCorrelation(ack,m.source);expect(correlation.classification.outcome).toBe('positive')
  const original=tokenizeEdifact(m.wire),tokens=tokenizeEdifact(ack.raw_payload!),unb=original.segments.find(x=>x.tag==='UNB'),ackUnb=tokens.segments.find(x=>x.tag==='UNB')
  expect(segmentComposite(ackUnb,2,tokens.una)).toEqual(segmentComposite(unb,3,original.una))
  expect(segmentComposite(ackUnb,3,tokens.una)).toEqual(segmentComposite(unb,2,original.una))
  if(ack.message_family==='CONTRL'){
   const uci=tokens.segments.find(x=>x.tag==='UCI')
   expect(segmentComposite(uci,1,tokens.una)[0]).toBe(segmentComposite(unb,5,original.una)[0])
   expect(segmentComposite(uci,2,tokens.una)).toEqual(segmentComposite(unb,2,original.una))
   expect(segmentComposite(uci,3,tokens.una)).toEqual(segmentComposite(unb,3,original.una))
  }else{
   expect(correlation.acknowledgedReferences).toEqual([li])
   expect(correlation.prodatObjectOutcomes).toMatchObject([{objectId:f.external,identityAgency:'9',lineItemReference:li,outcome:'positive'}])
   const acw=tokens.segments.find(x=>x.tag==='RFF'&&segmentComposite(x,1,tokens.una)[0]==='ACW')
   expect(segmentComposite(acw,1,tokens.una)[1]).toBe(segmentComposite(original.segments.find(x=>x.tag==='BGM'),2,original.una)[0])
  }
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_outbox WHERE ediel_message_id=${literal(ack.id)}`)).toBe(1)
  const calls=provider.mock.calls.length
  await sendEdielMessageViaSmtp((await getEdielMessageById(ack.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
  expect(provider).toHaveBeenCalledTimes(calls+1)
  expect((await getEdielMessageById(ack.id))!).toMatchObject({status:'sent',raw_payload:ack.raw_payload})
 }
}

async function retainedTransportBytes(f:Ground,messageId:string,actor=f.actorUserId){
 const copies=await readEdielTransportCopies({companyId:f.companyId,actorUserId:actor,messageId})
 expect(copies.status).toBe('available');expect(copies.copies).toHaveLength(1)
 const copy=copies.copies[0]
 expect(copy).toMatchObject({companyId:f.companyId,messageId,environment:'test',smtpClassification:'accepted',archiveReadbackRequired:true})
 const bytes=await readVerifiedEdielTransportCopy({companyId:f.companyId,actorUserId:actor,messageId,attemptId:copy.attemptId})
 expect(hash(bytes)).toBe(copy.mimeSha256);expect(bytes.length).toBe(copy.mimeLength)
 return{copy,bytesHash:hash(bytes)}
}

type Row=Record<string,unknown>
const newRows=(before:Row[],after:Row[])=>after.filter(row=>!before.some(old=>old.id===row.id))
function commercialEnd(before:ReturnType<typeof graph>,after:ReturnType<typeof graph>,f:Ground&{periodId:string;startSourceId:string},sourceId:string,started:string,finished:string,bindingMonths=0){
 const prior=before.periods.find(p=>p.id===f.periodId)!,period=after.periods.find(p=>p.id===f.periodId)!
 expect(period).toMatchObject({id:f.periodId,source_message_id:f.startSourceId,source_end_message_id:sourceId,market_end_at:'2026-10-16T12:30:00+00:00',status:'ending',market_state_version:Number(prior.market_state_version)+1})
 expect(period.market_start_at).toBe(prior.market_start_at)
 expect(after.periods.filter(p=>p.id!==f.periodId)).toEqual(before.periods.filter(p=>p.id!==f.periodId))
 const contract=before.contracts.find(c=>c.id===f.contractId)!,event=newRows(before.events,after.events)
 expect(contract).toMatchObject({status:'signed',company_id:f.companyId});expect(Number(contract.binding_months??0)).toBe(bindingMonths)
 expect(event).toHaveLength(1);const e=event[0],at=String(e.happened_at),endKey='source-end:'+f.periodId+':2026-10-16',eventKey='supply-end:'+f.contractId+':'+endKey
 expect(Date.parse(at)).toBeGreaterThanOrEqual(Date.parse(started));expect(Date.parse(at)).toBeLessThanOrEqual(Date.parse(finished))
 expect(e).toMatchObject({company_id:f.companyId,customer_id:f.customerId,customer_contract_id:f.contractId,event_type:'terminated',actor_user_id:null})
 expect(e.metadata).toEqual({ends_at:'2026-10-16',termination_notice_date:at,termination_reason:'supply_end',reason_code:'supply_end',source_message_id:f.startSourceId,idempotency_key:eventKey})
 const expected={...contract,status:'terminated',ended_at:'2026-10-16T00:00:00+00:00',termination_notice_date:at.slice(0,10),termination_reason:'supply_end',status_reason_code:'supply_end',metadata:{...(contract.metadata as Row),status_reason_code:'supply_end'},updated_at:at,updated_by:null}
 expect(after.contracts).toEqual(before.contracts.map(c=>c.id===f.contractId?expected:c))
 const domain=newRows(before.domain,after.domain);expect(domain).toHaveLength(1)
 expect(domain[0]).toMatchObject({company_id:f.companyId,event_type:'contract.event.recorded',aggregate_type:'customer_contract',aggregate_id:f.contractId,actor_user_id:null,source:'gridex_record_customer_contract_event_v1',idempotency_key:'customer-contract-event:'+eventKey})
 expect(domain[0].payload).toEqual({customer_contract_event_id:e.id,customer_id:f.customerId,event_type:'terminated',previous_status:'signed',new_status:'terminated'})
 const tasks=newRows(before.tasks,after.tasks);expect(tasks).toHaveLength(bindingMonths?2:1)
 const final=tasks.find(x=>x.task_type==='final_invoice_pending')!
 expect(final).toMatchObject({company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,task_type:'final_invoice_pending',status:'open',priority:'high',resolved_at:null})
 expect(final.metadata).toEqual({supply_end_date:'2026-10-16',end_reason:'supply_end',end_key:endKey,supply_period_id:f.periodId})
 if(bindingMonths){
  const review=tasks.find(x=>x.task_type==='break_fee_review')!
  expect(review).toMatchObject({company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,status:'open',priority:'normal',resolved_at:null})
  expect(review.metadata).toEqual({contract_id:f.contractId,binding_months:bindingMonths,binding_ends_at:'2027-10-15',supply_end_date:'2026-10-16',end_key:endKey})
 }
 for(const key of ['invoices','underlays','items','customers','sites','points'])expect(after[key],key).toEqual(before[key])
 for(const key of ['events','domain','tasks'])expect(after[key].filter(row=>before[key].some(old=>old.id===row.id)),key).toEqual(before[key])
}
const clock=()=>sql<string>('SELECT to_jsonb(clock_timestamp())')
it('public H04 declares source-own future UTILTS readings before birth and commits its genuine same-source period',async()=>{
 const f=await publicHStart()
 expect(f.physicalReadings).toEqual({214:{present:true,value:'1',malformed:false},218:{present:true,value:'6',malformed:false},259:{present:true,value:'111',malformed:false}})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'end',source_end_message_id,'company',company_id) FROM public.customer_supply_periods WHERE id=${literal(f.periodId)}`)).toEqual({source:f.startSourceId,end:null,company:f.companyId})
})
for(const declaration of ['absent','malformed'] as const)it('public H04 '+declaration+' reading declaration cannot manufacture a period, business effects or positive APERAK',async()=>{
 const f=await publicH04Reception({},declaration)
 expect(f.period,JSON.stringify({declaration,physicalReadings:f.physicalReadings,diagnostic:f.diagnostic})).toBeUndefined()
 expect(graph()).toEqual(f.businessBefore)
 const after=effects(f.companyId) as Record<string,Row[]>,before=f.effectsBefore as Record<string,Row[]>
 for(const key of ['transitions','bilateral','national','watch','cases'])expect(after[key],key).toEqual(before[key])
 expect(after.acks.filter(row=>row.message_family==='APERAK'&&row.ack_outcome==='positive')).toEqual(before.acks.filter(row=>row.message_family==='APERAK'&&row.ack_outcome==='positive'))
 expect(provider).toHaveBeenCalledTimes(f.providerBefore)
 const persisted=(await getEdielMessageById(f.received.sourceId))!
 expect(persisted).toMatchObject({company_id:f.companyId,environment:'test',direction:'inbound',raw_payload:f.received.wire,immutable_payload_hash:hash(f.received.wire)})
 const leaf=sql<{facts:{syntaxDecision:string;registerValidation:{objects:Array<{objectId:string;identityAgency:string;disposition:string;reasons:string[]}>}}}>(`SELECT jsonb_build_object('facts',a.facts_text::jsonb) FROM gridex_received_sources.validation_assessments a WHERE a.company_id=${literal(f.companyId)} AND a.source_message_id=${literal(f.received.sourceId)} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)`)
 expect(leaf.facts.syntaxDecision).toBe('accepted')
 // A syntactically valid header is not own-register acceptance. Observe the
 // actual physical object's serialized REG disposition, never header globals.
 expect(leaf.facts.registerValidation.objects).toHaveLength(1)
 expect(leaf.facts.registerValidation.objects[0]).toMatchObject({objectId:f.external,identityAgency:'9'})
 expect(leaf.facts.registerValidation.objects[0].disposition,JSON.stringify({technicalStatus:persisted.status,physicalReadings:f.physicalReadings})).not.toBe('accepted')
 if(declaration==='absent')expect(leaf.facts.registerValidation.objects[0]).toMatchObject({disposition:'unavailable',reasons:expect.arrayContaining(['PRODAT_DEPENDENT_CONDITION_UNDETERMINED'])})
 const retained={graph:graph(),effects:effects(f.companyId),custody:custody(f.received.sourceId),original:custody(f.originalZ03.id)}
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.received.sourceId})
 expect({graph:graph(),effects:effects(f.companyId),custody:custody(f.received.sourceId),original:custody(f.originalZ03.id)}).toEqual(retained)
 expect(provider).toHaveBeenCalledTimes(f.providerBefore)
})
// Limited source proof, separate from the 91 strict whole-H effect cases below.
// normal_start_h fixture authority never grants an own_end_h mandate here.
for(const reason of ['Z25','Z22'] as const)it('SOURCE_ONLY actual public Z05/'+reason+' catalog birth and same-mail replay preserve custody without end effects',async()=>{
 const f=await authorized();smtp();provider.mockClear()
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
it('public H05 reception commits the same supply/history and only its actual commercial end before exact physical ACKs; replay preserves originals and effects',async()=>{
 const f=await hEndGround(),m=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li))),before=graph(),inputBefore=custody(m.sourceId),startBefore=custody(f.startSourceId),started=clock()
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 const after=graph();commercialEnd(before,after,f,m.sourceId,started,clock())
 const receipt=sql<Row>(`SELECT to_jsonb(x) FROM gridex_bilateral_prodat.supply_effect_receipts x WHERE source_message_id=${literal(m.sourceId)}`)
 expect(receipt).toMatchObject({company_id:f.companyId,source_message_id:m.sourceId,environment:'test',payload_hash:hash(m.wire)})
 const grammarHash=sql<string>(`SELECT to_jsonb(a.scope->>'sourceGrammarHash') FROM gridex_bilateral_prodat.origins o JOIN gridex_bilateral_prodat.artifacts a ON a.id=o.artifact_id AND a.company_id=o.company_id WHERE o.ground_id=${literal(f.profileVersionId)} AND o.company_id=${literal(f.companyId)}`)
 expect(grammarHash).toMatch(/^[a-f0-9]{64}$/)
 expect(receipt.profiles).toEqual([expect.objectContaining({sourceGrammarHash:grammarHash,owner:'immutable-bilateral-prodat-profile-v1',profileVersionId:f.profileVersionId,process:'own_end_h',objectId:f.external,identityAgency:'9',lineItemReference:f.li,sourceHash:f.sourceHash})])
 const transition=sql<Row>(`SELECT to_jsonb(x) FROM gridex_received_sources.supply_source_transitions x WHERE source_message_id=${literal(m.sourceId)}`)
 expect(transition).toMatchObject({company_id:f.companyId,source_message_id:m.sourceId,payload_hash:hash(m.wire),source_code:'Z05',previous_states:[before.periods.find(x=>x.id===f.periodId)]})
 expect(transition.resulting_states).toEqual([after.periods.find(x=>x.id===f.periodId)])
 expect(custody(m.sourceId)).toEqual(inputBefore);expect(custody(f.startSourceId)).toEqual(startBefore)
 await sendOwnAcks(f,m,f.li)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_cases WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(m.sourceId)}`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND entity_id=${literal(m.sourceId)} AND action='ediel.bilateral_profile.supply_applied'`)).toBe(1)
 const original=custody(m.sourceId),saved=effects(f.companyId),protectedSaved=protectedOriginals(),calls=provider.mock.calls.length
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 expect(graph()).toEqual(after);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(protectedSaved);expect(custody(m.sourceId)).toEqual(original);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

it('public H05 signed binding source opens only human break-fee review and final-invoice work; replay never charges',async()=>{
 const f=await hEndGround({bindingMonths:12}),m=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li))),before=graph(),started=clock()
 expect(before.contracts.find(x=>x.id===f.contractId)).toMatchObject({status:'signed',binding_months:12})
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 const after=graph();commercialEnd(before,after,f,m.sourceId,started,clock(),12)
 const saved=effects(f.companyId),privateSaved=protectedOriginals(),original=custody(m.sourceId),calls=provider.mock.calls.length
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 expect(graph()).toEqual(after);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(m.sourceId)).toEqual(original);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

it('actual H05 current metering permission withdrawal refuses the honest retained source without any effect',async()=>{
 const f=await hEndGround(),m=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li)))
 await assertEdielTenantActor({companyId:f.companyId,actorUserId:f.actorUserId,permission:'metering.write'})
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)} AND permission_key='metering.write'`)
 await expect(assertEdielTenantActor({companyId:f.companyId,actorUserId:f.actorUserId,permission:'metering.write'})).rejects.toThrow('ediel_tenant_permission_forbidden')
 const before=graph(),saved=effects(f.companyId),privateSaved=protectedOriginals(),input=custody(m.sourceId),calls=provider.mock.calls.length
 expect(await applySupplyMarketSource({actorUserId:f.actorUserId,message:m.source})).toMatchObject({applied:false,reason:'supply_execution_actor_unqualified'})
 expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(m.sourceId)).toEqual(input);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

for(const failure of ['foreign_actor','permission_withdrawn'] as const)it('actual H05 birth '+failure+' refuses the real retained mailbox and parse before source creation',async()=>{
 const f=await hEndGround(),control=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li)))
 expect(control.decision.functionalDecision).toBe('accepted')
 let actor=f.actorUserId,reason='ediel_tenant_permission_forbidden'
 if(failure==='foreign_actor'){const foreign=await authorized();actor=foreign.actorUserId;reason='ediel_tenant_actor_forbidden'}
 else{
  await assertEdielTenantActor({companyId:f.companyId,actorUserId:actor,permission:'communication.write'})
  sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(actor)} AND permission_key='communication.write'`)
 }
 await expect(assertEdielTenantActor({companyId:f.companyId,actorUserId:actor,permission:'communication.write'})).rejects.toThrow(reason)
 const before=graph(),saved=effects(f.companyId),privateSaved=protectedOriginals(),input=custody(control.sourceId),calls=provider.mock.calls.length
 await expect(receive(f,wire(f,'Z05',endBody(f,'Z25',f.li)),actor)).rejects.toThrow(reason)
 expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(control.sourceId)).toEqual(input);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

it('actual public H05 has no standard end effect when its own bilateral transition profile was never established',async()=>{
 const f=await publicHStart(),m=await receive(f,wire(f,'Z05',endBody(f,'Z25','H-END-UNAGREED'))),before=graph(),old=effects(f.companyId),privateBefore=protectedOriginals(),input=custody(m.sourceId),calls=provider.mock.calls.length
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 expect(graph()).toEqual(before)
 const after=effects(f.companyId) as Record<string,unknown>;for(const key of ['transitions','bilateral','national','watch'])expect(after[key],key).toEqual((old as Record<string,unknown>)[key])
 oldRowsPreserved(old,after);preservedProtected(privateBefore,m.sourceId);expect(custody(m.sourceId)).toEqual(input)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(m.sourceId)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 expect(provider).toHaveBeenCalledTimes(calls)
},120000)

for(const revoked of ['supplier_role','reviewer'] as const)it('actual H05 '+revoked+' withdrawal keeps captured history but removes current transition authority',async()=>{
 const f=await hEndGround(),m=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li)))
 expect(await readBilateralProdatGroundArtifact({companyId:f.companyId,actorUserId:f.actorUserId,artifactId:f.artifactId})).toMatchObject({status:'authorized'})
 if(revoked==='supplier_role')sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier'`)
 else{
  expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.reviewer)},${literal(f.companyId)},'ediel.bilateral_profile.review'))`)).toBe(true)
  sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.bilateral_profile.review'`)
  expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.reviewer)},${literal(f.companyId)},'ediel.bilateral_profile.review'))`)).toBe(false)
 }
 expect(await readBilateralProdatGroundArtifact({companyId:f.companyId,actorUserId:f.actorUserId,artifactId:f.artifactId})).toMatchObject({status:'held',missing:expect.arrayContaining(['actual_current_qualified_ground'])})
 const before=graph(),saved=effects(f.companyId),privateSaved=protectedOriginals(),input=custody(m.sourceId),calls=provider.mock.calls.length
 await expect(applySupplyMarketSource({actorUserId:f.actorUserId,message:m.source})).rejects.toMatchObject({message:'bilateral_h_end_current_profile_required'})
 expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(m.sourceId)).toEqual(input);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

for(const change of ['customer','grid_area','sender','receiver','object','agency'] as const)it('actual public H05 wrong '+change+' correlation cannot end or bill any supply',async()=>{
 const f=await hEndGround(),control=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li)))
 expect(control.decision.functionalDecision).toBe('accepted')
 const body=endBody(f,'Z25',f.li).map(p=>{
  if(change==='customer'&&p[0]==='NAD'&&p[1]==='UD')return ['NAD','UD',['199101011239','SE2','260'],...p.slice(3)]
  if(change==='grid_area'&&p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='Z05')return ['RFF',['Z05','OTH']]
  if((change==='sender'&&p[1]==='FR'||change==='receiver'&&p[1]==='DO')&&p[0]==='NAD')return [p[0],p[1],['99999','160','SVK'],...p.slice(3)]
  if((change==='object'||change==='agency')&&p[0]==='LIN')return line('1',change==='object'?'735999999999999999':f.external,undefined,change==='agency'?'89':'9')
  if((change==='object'||change==='agency')&&p[0]==='NAD'&&p[1]==='IT')return ['NAD','IT',[change==='object'?'735999999999999999':f.external,'',change==='agency'?'89':'9'],...p.slice(3)]
  return p
 }) as Parts[]
 const m=await receive(f,wire(f,'Z05',body)),before=graph(),old=effects(f.companyId),privateBefore=protectedOriginals(),input=custody(m.sourceId),calls=provider.mock.calls.length
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 expect(graph()).toEqual(before)
 const after=effects(f.companyId) as Record<string,unknown>;for(const key of ['transitions','bilateral','national','watch'])expect(after[key],key).toEqual((old as Record<string,unknown>)[key])
 oldRowsPreserved(old,after);preservedProtected(privateBefore,m.sourceId);expect(custody(m.sourceId)).toEqual(input)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(m.sourceId)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 const saved=effects(f.companyId),privateSaved=protectedOriginals()
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(m.sourceId)).toEqual(input);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

it('actual H05 registered raw/direction and protected legal-context mutations are refused without rewriting originals',async()=>{
 const f=await hEndGround(),m=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li))),before=graph(),saved=effects(f.companyId),input=custody(m.sourceId),privateSaved=protectedOriginals(),calls=provider.mock.calls.length
 expect(await applySupplyMarketSource({actorUserId:f.actorUserId,message:{...m.source,direction:'outbound'}})).toMatchObject({applied:false,reason:'not_inbound_supply_source'})
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=raw_payload||' ' WHERE id=${literal(m.sourceId)}`)).toThrow('ediel_registered_reception_original_immutable')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_wire_namespace.coverage WHERE source_message_id=${literal(m.sourceId)}`)).toBe(0)
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${literal(m.sourceId)}`)).toThrow('ediel_registered_reception_original_immutable')
 expect(()=>sql(`UPDATE gridex_ediel_inbound_context.receipts SET context=context||'{"actorRole":"supplier"}'::jsonb WHERE source_message_id=${literal(m.sourceId)}`)).toThrow('ediel_original_identity_basis_immutable')
 expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(custody(m.sourceId)).toEqual(input);expect(protectedOriginals()).toEqual(privateSaved);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

it('actual H05 final audit failure rolls back market, contract, billing, transition and positive ACK writes atomically',async()=>{
 const f=await hEndGround(),m=await accepted(f,wire(f,'Z05',endBody(f,'Z25',f.li))),before=graph(),old=effects(f.companyId),input=custody(m.sourceId),privateBefore=protectedOriginals(),calls=provider.mock.calls.length,name='native_h05_final_audit_'+randomUUID().replaceAll('-','')
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${name} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.bilateral_profile.supply_applied' AND entity_id=${literal(m.sourceId)}::uuid)) NOT VALID`)
 try{
  await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_events WHERE ediel_message_id=${literal(m.sourceId)} AND payload->>'supplySourceApply'='rolled_back' AND position(${literal(name)} in payload->>'reason')>0`)).toBe(1)
  expect(graph()).toEqual(before)
  const after=effects(f.companyId) as Record<string,unknown>;for(const key of ['transitions','bilateral','national','watch'])expect(after[key],key).toEqual((old as Record<string,unknown>)[key])
  oldRowsPreserved(old,after);preservedProtected(privateBefore,m.sourceId);expect(custody(m.sourceId)).toEqual(input)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(m.sourceId)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
  expect(provider).toHaveBeenCalledTimes(calls)
 }finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${name}`)}
},120000)

// Independent frozen H05/P26.A field paths; no runtime matrix supplies expected
// requirements or omission positions. Preserve framing after each omission.

function oldRowsPreserved(before:unknown,after:unknown){
 const prior=before as Record<string,Row[]>,current=after as Record<string,Row[]>
 for(const key of ['acks','outbox','cases'])for(const row of prior[key])expect(current[key].find(x=>x.id===row.id),key).toEqual(row)
}
function preservedProtected(before:ReturnType<typeof protectedOriginals>,sourceId:string){
 const after=protectedOriginals(),ackIds=sql<string[]>(`SELECT coalesce(jsonb_agg(id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(sourceId)} AND message_family IN('CONTRL','APERAK')`)
 const ackWitnessIds=sql<string[]>(`SELECT coalesce(jsonb_agg(witness_id),'[]') FROM gridex_ediel_outbound_owner.consumptions WHERE source_message_id IN(SELECT id FROM public.ediel_messages WHERE related_message_id=${literal(sourceId)} AND message_family IN('CONTRL','APERAK'))`)
 const responseTables=['gridex_ediel_outbound_owner.witnesses','gridex_ediel_outbound_owner.consumptions','gridex_ediel_ack_replay.creation_receipts','public.ediel_message_payloads']
 for(const [table,old]of Object.entries(before)){
  expect(after[table],table).toEqual(expect.arrayContaining(old))
  for(const row of after[table].filter(current=>!old.some(prior=>JSON.stringify(prior)===JSON.stringify(current)))){
   expect(responseTables,table).toContain(table)
   const ids=[row.message_id,row.ediel_message_id,row.ack_message_id,row.source_message_id]
   const qualifiedWitness=table==='gridex_ediel_outbound_owner.witnesses'&&typeof row.id==='string'&&ackWitnessIds.includes(row.id)
   expect(qualifiedWitness||ids.some(id=>typeof id==='string'&&ackIds.includes(id)),table+JSON.stringify(row)).toBe(true)
  }
 }
}
async function rejectPhysicalEnd(f:Awaited<ReturnType<typeof hEndGround>>,raw:string,field:string,control:Awaited<ReturnType<typeof accepted>>){
 const before=graph(),prior=effects(f.companyId),protectedBefore=protectedOriginals(),calls=provider.mock.calls.length
 const tokens=tokenizeEdifact(raw),policy=control.decision.policy
 expect(policy).toBeTruthy()
 // Diagnose the independently omitted physical field using the actual
 // qualified control's policy. This pure projection grants no admission.
 const typed=validateCanonicalPolicyFields({policy:policy!,rawPayload:raw,rawSegments:tokens.segments.map(x=>x.raw),una:tokens.una})
 const expected=field==='UD'?['227','228']:field==='IT'?['233','234']:[field]
 expect(typed.some(x=>x.prodatDiagnostic?.kind==='field'&&expected.includes(x.prodatDiagnostic.fieldNumber)),JSON.stringify(typed)).toBe(true)
 let m:Awaited<ReturnType<typeof receive>>|undefined,birthError:unknown
 try{m=await receive(f,raw,f.actorUserId,f.companyId,field)}catch(error){if(!(error instanceof ExpectedPhysicalBirthRefusal))throw error;birthError=error}
 if(m){
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(m.source)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).not.toEqual(['accepted','accepted','accepted'])
  await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(m.sourceId)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 }else expect(birthError).toBeInstanceOf(ExpectedPhysicalBirthRefusal)
 expect(graph()).toEqual(before)
 // Genuine technical/negative responses can be created; all business receipts
 // and the old outbox/ACK rows must remain unchanged.
 const after=effects(f.companyId) as Record<string,unknown>,old=prior as Record<string,unknown>
 for(const key of ['transitions','bilateral','national','watch'])expect(after[key],key).toEqual(old[key])
 oldRowsPreserved(prior,after)
 if(m)preservedProtected(protectedBefore,m.sourceId);else expect(protectedOriginals()).toEqual(protectedBefore)
 if(m){
  const saved=effects(f.companyId),original=custody(m.sourceId),privateSaved=protectedOriginals()
  await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
  expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(m.sourceId)).toEqual(original)
 }
 expect(provider).toHaveBeenCalledTimes(calls)
}
for(const field of [...h05Required,'UD','IT'])it('public H05 refuses missing physical '+field+' without end, billing, history or positive business ACK',async()=>{
 const f=await hEndGround(),valid=wire(f,'Z05',endBody(f,'Z25',f.li))
 const control=await accepted(f,valid)
 expect(control.decision.functionalDecision).toBe('accepted')
 await rejectPhysicalEnd(f,omitSupplyEndField(wire(f,'Z05',endBody(f,'Z25',f.li)),field),field,control)
},120000)

for(const field of ['250','251','253','317','318'])it('public H05 physical IV activates its own '+field+' requirement and a missing value never ends supply',async()=>{
 const f=await hEndGround(),body=[...endBody(f,'Z25',f.li),['NAD','IV',['SYNTHETIC-BILL','','89'],'','Invoicee','Invoice Street','Invoice Town','','12345','SE'] as Parts]
 const control=await accepted(f,wire(f,'Z05',body))
 await rejectPhysicalEnd(f,omitSupplyEndField(wire(f,'Z05',body),field),field,control)
},120000)

// Reuse the delivered synthetic issuer/legal-original fixture recipe. Its
// predecessor is this suite's actual publicHStart, never a catalog INSERT.
async function nationalArtifact(input:Pick<NormalSwitchFixtureInput,'bindingMonths'|'billingAddress'>={}){
 const f=await publicHStart(input)
 const archiverSession=await actualNationalSourceSession(f.actorUserId),reviewerSession=await actualNationalSourceSession(f.reviewer);sourceSession.client=archiverSession
 const periodId=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.startSourceId)}`),rulePackId=sql<string>(`SELECT to_jsonb(pack.id) FROM public.ediel_rule_packs pack WHERE pack.family='PRODAT' AND pack.guide_version='26.A' AND pack.guide_revision='3' AND pack.status='active' AND(SELECT count(*) FROM public.ediel_message_profiles profile WHERE profile.rule_pack_id=pack.id AND profile.is_enabled AND(profile.profile_key='PRODAT:Z08:H:26.A:r3' OR profile.profile_key='PRODAT:Z05:L:26.A:r3'))=2`),selector={environment:'test' as const,supplyPeriodId:periodId,effectiveAt:'2026-10-16T12:30:00Z',rulePackId},scope=await readSupplyRescissionScope({companyId:f.companyId,actorUserId:f.actorUserId,...selector})
 expect(scope.status,JSON.stringify(scope)).toBe('scoped')
 const bytes=Buffer.from('SYNTHETIC LEGAL ORIGINAL: actual prerequisites completed; requested own contract rescission. NOT REAL LEGAL CLAIM.'),source={bytesBase64:bytes.toString('base64'),mimeType:'text/plain' as const,reference:'SYNTHETIC NATIONAL RESCISSION ORIGINAL',version:'1'},keyId=randomUUID(),representationId=randomUUID(),key=Buffer.from('SYNTHETIC national rescission issuer configured native fixture only'),dso=sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)} AND is_verified`)
 sql(`INSERT INTO gridex_supply_rescission.issuer_keys VALUES(${literal(keyId)},${literal(f.companyId)},'test','SYNTHETIC','DECLARED MECHANISM BOUNDARY NOT REAL LEGAL CLAIM',${literal('a'.repeat(64))},decode(${literal(key.toString('hex'))},'hex'),'2000-01-01','2100-01-01');INSERT INTO gridex_supply_rescission.issuer_representations VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},${literal(dso)},${literal(f.gridAreaCode)},'SYNTHETIC REPRESENTATION',${literal('b'.repeat(64))},'2000-01-01','2100-01-01');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(f.reviewer)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key='ediel.supply_rescission.review';`)
 const issued=new Date(Date.now()-1000).toISOString(),payload=Buffer.from(JSON.stringify({format:'ediel_national_supply_rescission_receipt_v1',purpose:'national_prodat_z08h_legal_rescission',issuerCode:'SYNTHETIC',receiptId:randomUUID(),companyId:f.companyId,environment:'test',scope:scope.scope,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceReference:source.reference,sourceVersion:'1',legalCaseReference:'SYNTHETIC CASE',legalDecisionReference:'SYNTHETIC DECISION',legalPrerequisitesReference:'SYNTHETIC PREREQUISITES',legalPrerequisitesCompletedAt:issued,issuedAt:issued,expiresAt:'2099-01-01T00:00:00Z'})),submission={...selector,source,issuerReceipt:{keyId,representationId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}},artifact=await archiveSupplyRescission({companyId:f.companyId,actorUserId:f.actorUserId,...submission}),review={sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve' as const,reason:'Independent review of actual synthetic original and completed legal prerequisites; no real legal approval',sourceClauseLocator:'Original sentence 1',sourceClauseQuote:'actual prerequisites completed; requested own contract rescission.'}
 expect(artifact.status,JSON.stringify(artifact)).toBe('archived');sourceSession.client=reviewerSession;return{...f,periodId,bytes,artifactId:String(artifact.artifactId),review}
}

async function nationalOperation(separatePrincipals=false,input:Pick<NormalSwitchFixtureInput,'bindingMonths'|'billingAddress'>={}){
 const f=await nationalArtifact(input),approved=await reviewSupplyRescission({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId,...f.review})
 expect(approved.status,JSON.stringify(approved)).toBe('authorized')
 const creator=separatePrincipals?nationalNativeOperator(f.companyId,['communication.write','metering.write','contracts.read']):f.actorUserId,currentExecutor=separatePrincipals?nationalNativeOperator(f.companyId,['communication.send','communication.write','metering.write','contracts.read']):f.actorUserId,mandateId=String(approved.mandateId),result=await prepareAndQueueSupplyRescissionZ08({companyId:f.companyId,actorUserId:creator,mandateId,preferredRouteId:f.routeId})
 expect(result.status,JSON.stringify(result)).toBe('queued');if(!('message'in result))throw Error('native national H original held')
 const own=sql<{objects:{li:string;reason:string}[]}>(`SELECT gridex_bilateral_prodat.draft_wire_v1(${literal(result.message.raw_payload)})`).objects[0]
 expect(own).toMatchObject({li:'H'+mandateId.replaceAll('-',''),reason:'Z25'})
 expect(sql(`SELECT to_jsonb(source_end_message_id IS NULL) FROM public.customer_supply_periods WHERE id=${literal(f.periodId)}`)).toBe(true)
 if(separatePrincipals)sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(creator)};UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(creator)};`)
 return{...f,creator,currentExecutor,mandateId,original:result.message,li:own.li}
}

type National=Awaited<ReturnType<typeof nationalOperation>>
async function sendNational(f:National){
 const calls=provider.mock.calls.length
 await sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.currentExecutor,smtpMimeMode:'nodemailer-attachment'})
 expect(provider).toHaveBeenCalledTimes(calls+1)
 const actual=(await getEdielMessageById(f.original.id))!
 expect(actual.status).toBe('sent');expect(actual.raw_payload).toBe(f.original.raw_payload)
 return actual
}
const nationalWatch=(f:National)=>sql<Row[]>(`SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ediel_business_expectations x WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.original.id)} AND expected_code='Z05'`)
async function incomingAck(f:National,raw:string){
 const m=await receive(f,raw)
 await processInboundEdielMessage({actorUserId:f.currentExecutor,edielMessageId:m.sourceId})
 const receipt=await readCommittedInboundAck({actorUserId:f.currentExecutor,message:(await getEdielMessageById(m.sourceId))!})
 expect(receipt).toMatchObject({kind:'exact_receipt',sourceMessageId:f.original.id,result:{outcome:'positive'}})
 return m
}
it('public H08 authentic archive/review creates only its own H request; physical CONTRL/APERAK precede matching public Z05L and untimed watch fulfilment',async()=>{
 const f=await nationalOperation(true)
 expect((await readSupplyRescissionBytes({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId})).bytes).toEqual(f.bytes)
 const beforeSend=graph(),actuallySent=await sendNational(f),transport=await retainedTransportBytes(f,f.original.id),wireTokens=tokenizeEdifact(actuallySent.raw_payload!)
 expect(segmentComposite(wireTokens.segments.find(x=>x.tag==='UNB'),7,wireTokens.una)[0]).toBe('23-DDQ-PRODAT')
 expect(segmentComposite(wireTokens.segments.find(x=>x.tag==='BGM'),1,wireTokens.una)[0]).toBe('Z08')
 expect(wireTokens.segments.filter(x=>x.tag==='CAV').map(x=>segmentComposite(x,1,wireTokens.una)[0])).toContain('Z25')
 expect(segmentComposite(wireTokens.segments.find(x=>x.tag==='RFF'&&segmentComposite(x,1,wireTokens.una)[0]==='LI'),1,wireTokens.una)[1]).toBe('H'+f.mandateId.replaceAll('-',''))
 expect(graph()).toEqual(beforeSend)
 expect(nationalWatch(f)).toMatchObject([{expected_code:'Z05',expected_subtype:'L',status:'pending',fulfilled_by_message_id:null,due_at:null,metadata:{remoteReceiptKnown:false}}])
 // This counterpart exists only in the pure renderer. Admit received bytes
 // through real reception; never persist a relabelled outgoing row.
 const counterpart={...actuallySent,direction:'inbound' as const}
 await incomingAck(f,buildContrlDraft({sourceMessage:counterpart,outcome:'positive'}).rawPayload!)
 await incomingAck(f,buildAperakDraft({sourceMessage:counterpart,outcome:'positive'}).rawPayload!)
 expect((await getEdielMessageById(f.original.id))!).toMatchObject({contrl_status:'received',aperak_status:'received'})
 expect(graph()).toEqual(beforeSend);expect(nationalWatch(f)).toMatchObject([{status:'pending',fulfilled_by_message_id:null,due_at:null}])
 const m=await accepted(f,wire(f,'Z05',endBody(f,'Z22',f.li))),started=clock()
 await processInboundEdielMessage({actorUserId:f.currentExecutor,edielMessageId:m.sourceId})
 const after=graph();commercialEnd(beforeSend,after,f,m.sourceId,started,clock())
 const receipt=sql<Row>(`SELECT to_jsonb(x) FROM gridex_supply_rescission.end_receipts x WHERE source_message_id=${literal(m.sourceId)}`)
 expect(receipt).toMatchObject({company_id:f.companyId,environment:'test',mandate_id:f.mandateId,original_message_id:f.original.id,original_payload_hash:hash(f.original.raw_payload!),source_message_id:m.sourceId,source_payload_hash:hash(m.wire)})
 const transitionHash=sql<string>(`SELECT to_jsonb(encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex')) FROM gridex_received_sources.supply_source_transitions x WHERE source_message_id=${literal(m.sourceId)} AND company_id=${literal(f.companyId)}`)
 expect(transitionHash).toMatch(/^[a-f0-9]{64}$/);expect(receipt.transition_hash).toBe(transitionHash)
 expect(nationalWatch(f)).toMatchObject([{status:'fulfilled',fulfilled_by_message_id:m.sourceId,due_at:null,metadata:{resolvedBy:'immutable_matched_national_h_end',mandateId:f.mandateId,sourcePayloadHash:hash(m.wire),originalPayloadHash:hash(f.original.raw_payload!),transitionHash,remoteReceiptKnown:false}}])
 await sendOwnAcks({...f,actorUserId:f.currentExecutor},m,f.li)
 const saved=effects(f.companyId),input=custody(m.sourceId),original=custody(f.original.id),privateSaved=protectedOriginals(),calls=provider.mock.calls.length
 await processInboundEdielMessage({actorUserId:f.currentExecutor,edielMessageId:m.sourceId})
 await sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.currentExecutor,smtpMimeMode:'nodemailer-attachment'})
 expect(graph()).toEqual(after);expect(effects(f.companyId)).toEqual(saved);expect(custody(m.sourceId)).toEqual(input);expect(custody(f.original.id)).toEqual(original);expect(protectedOriginals()).toEqual(privateSaved);expect(await retainedTransportBytes(f,f.original.id)).toEqual(transport);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

for(const change of ['unsent','wrong_li','wrong_object','wrong_agency','wrong_end','reviewer_revoked'] as const)it('public H08 '+change+' cannot end any supply or produce a positive business ACK',async()=>{
 const f=await nationalOperation(),body=endBody(f,'Z22',f.li)
 if(change!=='unsent')await sendNational(f)
 if(change==='reviewer_revoked')sql(`DELETE FROM public.user_roles WHERE user_id=${literal(f.reviewer)};UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.supply_rescission.review'`)
 const changed=body.map(p=>change==='wrong_li'&&p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI'?['RFF',['LI','FOREIGN-LI']]:change==='wrong_object'&&p[0]==='LIN'?line('1','735999999999999999',undefined,'9'):change==='wrong_agency'&&p[0]==='LIN'?line('1',f.external,undefined,'89'):change==='wrong_end'&&p[0]==='DTM'?['DTM',['93','202610171330','203']]:p) as Parts[]
 const m=await accepted(f,wire(f,'Z05',changed)),before=graph(),old=effects(f.companyId) as Record<string,unknown>,input=custody(m.sourceId),original=custody(f.original.id),privateBefore=protectedOriginals(),calls=provider.mock.calls.length
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 expect(graph()).toEqual(before)
 const after=effects(f.companyId) as Record<string,unknown>;for(const key of ['transitions','bilateral','national','watch'])expect(after[key],key).toEqual(old[key])
 oldRowsPreserved(old,after);preservedProtected(privateBefore,m.sourceId)
 expect(custody(m.sourceId)).toEqual(input);expect(custody(f.original.id)).toEqual(original)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE related_message_id=${literal(m.sourceId)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(0)
 expect(provider).toHaveBeenCalledTimes(calls)
 const saved=effects(f.companyId),privateSaved=protectedOriginals()
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:m.sourceId})
 expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(m.sourceId)).toEqual(input);expect(custody(f.original.id)).toEqual(original);expect(provider).toHaveBeenCalledTimes(calls)
},120000)

// Literal H08 R21 and D9 expectations are independent of runtime descriptors.
// A modified caller row never replaces the immutable queued original. The real
// policy identifies the omitted field, then the actual transport owner refuses
// the mutated candidate before provider entry, preserving every old receipt.
const h08Required=['311','312','202','203','313','205','206','207','208','314','209','211','223','260','226','227','228','231','232','316','262']
const separateBilling={street:'Invoice Street',postalCode:'54321',city:'Invoice Town',country:'SE'}
for(const field of [...h08Required,'207country','208country','229','250','251','252','253','317','318'])it('actual H08 original missing physical '+field+' is refused before SMTP and cannot change any original, supply, watch or billing effect',async()=>{
 const iv=['250','251','252','253','317','318'].includes(field),f=await nationalOperation(false,iv?{billingAddress:separateBilling}:{}),actual=(await getEdielMessageById(f.original.id))!
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(actual)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 expect(decision.policy).toBeTruthy()
 const originalTokens=tokenizeEdifact(actual.raw_payload!),ivs=originalTokens.segments.filter(x=>x.tag==='NAD'&&segmentComposite(x,1,originalTokens.una)[0]==='IV')
 expect(ivs).toHaveLength(iv?1:0)
 if(iv)expect(sql(`SELECT jsonb_build_object('street',billing_street,'postalCode',billing_postal_code,'city',billing_city,'country',billing_country) FROM public.customer_contracts WHERE id=${literal(f.contractId)} AND status='signed'`)).toEqual(separateBilling)
 const omitted=omitSupplyEndField(actual.raw_payload!,field),tokens=tokenizeEdifact(omitted)
 const typed=validateCanonicalPolicyFields({policy:decision.policy!,rawPayload:omitted,rawSegments:tokens.segments.map(x=>x.raw),una:tokens.una})
 expect(field==='229'?typed.some(x=>x.code==='PRODAT_END_USER_ADDRESS_VALUE_MISMATCH'&&x.fieldPath==='NAD+UD/C059/3042[1..3]'):typed.some(x=>x.prodatDiagnostic?.kind==='field'&&x.prodatDiagnostic.fieldNumber===field.replace('country','')),JSON.stringify(typed)).toBe(true)
 const before=graph(),saved=effects(f.companyId),input=custody(actual.id),privateSaved=protectedOriginals(),calls=provider.mock.calls.length
 // The qualified customer source binds the original exact bytes. This is
 // source-integrity refusal; the independent typed call above proves the
 // field diagnostic without claiming transport reached that validator.
 let refusal:unknown
 try{await sendEdielMessageViaSmtp({...actual,raw_payload:omitted},{actorUserId:f.currentExecutor,smtpMimeMode:'nodemailer-attachment'})}catch(error){refusal=error}
 expect(refusal).toBeInstanceOf(Error)
 const message=(refusal as Error).message
 // Source binding is checked before field admission. A syntax refusal can
 // occur even earlier for malformed mandatory envelope/message components.
 expect(message==='customer_masterdata_message_basis_invalid'||message.startsWith('ediel_send_syntax_rejected:')).toBe(true)
 expect(provider).toHaveBeenCalledTimes(calls);expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(actual.id)).toEqual(input)
},120000)

it('actual H08 current SEND withdrawal denies the provider and leaves the unsent original, supply and untimed expectation unchanged',async()=>{
 const f=await nationalOperation(true),before=graph(),saved=effects(f.companyId),input=custody(f.original.id),privateSaved=protectedOriginals(),calls=provider.mock.calls.length
 await assertEdielTenantActor({companyId:f.companyId,actorUserId:f.currentExecutor,permission:'communication.send'})
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.currentExecutor)} AND permission_key='communication.send'`)
 await expect(assertEdielTenantActor({companyId:f.companyId,actorUserId:f.currentExecutor,permission:'communication.send'})).rejects.toThrow('ediel_tenant_permission_forbidden')
 await expect(sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.currentExecutor,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow('ediel_tenant_permission_forbidden')
 expect(provider).toHaveBeenCalledTimes(calls);expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(f.original.id)).toEqual(input)
},120000)

for(const family of ['CONTRL','APERAK'] as const)it('actual H08 wrong '+family+' physical source reference never commits a remote receipt or fulfils its untimed watch',async()=>{
 const f=await nationalOperation(),sent=await sendNational(f),counterpart={...sent,direction:'inbound' as const},draft=family==='CONTRL'?buildContrlDraft({sourceMessage:counterpart,outcome:'positive'}):buildAperakDraft({sourceMessage:counterpart,outcome:'positive'})
 const tokens=tokenizeEdifact(draft.rawPayload!),target=tokens.segments.find(x=>family==='CONTRL'?x.tag==='UCI':x.tag==='RFF'&&segmentComposite(x,1,tokens.una)[0]==='ACW')!
 expect(target).toBeTruthy()
 const parts=target.raw.split(tokens.una.dataElementSeparator)
 parts[1]=family==='CONTRL'?'FOREIGN-INTERCHANGE':'ACW'+tokens.una.componentDataElementSeparator+'FOREIGN-DOCUMENT'
 const m=await receive(f,draft.rawPayload!.replace(target.raw,parts.join(tokens.una.dataElementSeparator))),before=graph(),old=effects(f.companyId),privateBefore=protectedOriginals(),input=custody(m.sourceId),original=custody(sent.id),transport=await retainedTransportBytes(f,sent.id),calls=provider.mock.calls.length
 await processInboundEdielMessage({actorUserId:f.currentExecutor,edielMessageId:m.sourceId})
 expect(await readCommittedInboundAck({actorUserId:f.currentExecutor,message:(await getEdielMessageById(m.sourceId))!})).toBeNull()
 expect(graph()).toEqual(before)
 const after=effects(f.companyId) as Record<string,unknown>;for(const key of ['transitions','bilateral','national','watch'])expect(after[key],key).toEqual((old as Record<string,unknown>)[key])
 oldRowsPreserved(old,after);preservedProtected(privateBefore,m.sourceId);expect(custody(m.sourceId)).toEqual(input);expect(custody(sent.id)).toEqual(original);expect(await retainedTransportBytes(f,sent.id)).toEqual(transport)
 expect(nationalWatch(f)).toMatchObject([{status:'pending',fulfilled_by_message_id:null,due_at:null,metadata:{remoteReceiptKnown:false}}])
 expect(provider).toHaveBeenCalledTimes(calls)
},120000)

for(const change of ['raw','direction'] as const)it('actual accepted H08 '+change+' candidate cannot rewrite its protected transport receipt or enter SMTP again',async()=>{
 const f=await nationalOperation(),sent=await sendNational(f),before=graph(),saved=effects(f.companyId),original=custody(sent.id),privateSaved=protectedOriginals(),transport=await retainedTransportBytes(f,sent.id),calls=provider.mock.calls.length
 const changed={...sent,...(change==='raw'?{raw_payload:sent.raw_payload+' '}:{direction:'inbound' as const})}
 let observed:unknown
 try{await sendEdielMessageViaSmtp(changed,{actorUserId:f.currentExecutor,smtpMimeMode:'nodemailer-attachment'})}catch(error){observed=error}
 expect(observed).toBeInstanceOf(SmtpDeliveryUncertainError)
 expect((observed as SmtpDeliveryUncertainError).cause).toMatchObject({message:'ediel_accepted_projection_original_changed'})
 expect(provider).toHaveBeenCalledTimes(calls);expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(sent.id)).toEqual(original);expect(await retainedTransportBytes(f,sent.id)).toEqual(transport)
},120000)

for(const withdrawal of ['supplier_role','reviewer'] as const)it('actual H08 '+withdrawal+' withdrawal removes current mandate authority and creates no further original or business effect',async()=>{
 const f=await nationalOperation()
 expect(await readSupplyRescissionMandate({companyId:f.companyId,actorUserId:f.currentExecutor,mandateId:f.mandateId})).toMatchObject({status:'authorized',mandateId:f.mandateId})
 if(withdrawal==='supplier_role')sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND environment='test' AND role_code='electricity_supplier'`)
 else{
  expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.reviewer)},${literal(f.companyId)},'ediel.supply_rescission.review'))`)).toBe(true)
  sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.supply_rescission.review'`)
  expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.reviewer)},${literal(f.companyId)},'ediel.supply_rescission.review'))`)).toBe(false)
 }
 const before=graph(),saved=effects(f.companyId),input=custody(f.original.id),privateSaved=protectedOriginals(),calls=provider.mock.calls.length
 const held={status:'held',missing:['actual_current_own_supply_and_authenticated_reviewed_legal_rescission_original']}
 expect(await readSupplyRescissionMandate({companyId:f.companyId,actorUserId:f.currentExecutor,mandateId:f.mandateId})).toEqual(held)
 expect(await prepareAndQueueSupplyRescissionZ08({companyId:f.companyId,actorUserId:f.currentExecutor,mandateId:f.mandateId,preferredRouteId:f.routeId})).toEqual(held)
 expect(provider).toHaveBeenCalledTimes(calls);expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved);expect(custody(f.original.id)).toEqual(input)
},120000)

it('actual H08 archived but unreviewed legal original never becomes a mandate or outgoing rescission',async()=>{
 const f=await nationalArtifact(),before=graph(),saved=effects(f.companyId),privateSaved=protectedOriginals(),calls=provider.mock.calls.length
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_supply_rescission.mandates WHERE artifact_id=${literal(f.artifactId)}`)).toBe(0)
 expect(await prepareAndQueueSupplyRescissionZ08({companyId:f.companyId,actorUserId:f.actorUserId,mandateId:randomUUID(),preferredRouteId:f.routeId})).toEqual({status:'held',missing:['actual_current_own_supply_and_authenticated_reviewed_legal_rescission_original']})
 expect(provider).toHaveBeenCalledTimes(calls);expect(graph()).toEqual(before);expect(effects(f.companyId)).toEqual(saved);expect(protectedOriginals()).toEqual(privateSaved)
},120000)
