import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {createBilateralProdatGroundNativeFixture} from './helpers/ediel-bilateral-prodat-profile-native-fixture'
import {archiveBilateralProdatGround,reviewBilateralProdatGround} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {qualifyBilateralProdatSwitchPreparation} from '@/lib/ediel/production/bilateralProdatSwitchPreparation'
import {qualifyPersistedBilateralProdatOutboundOriginal} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import {getEdielMessageById} from '@/lib/ediel/db'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {guideOrderedFixtureRaw} from '../__tests__/helpers/prodatGuideOrderedFixture'
import {line,qty,common,characteristic,type Parts} from '../__tests__/fixtures/prodat-register'
import {head} from '../__tests__/fixtures/prodat-identity'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
/** Genuine internal contract/signature/PDF/POA, intent/original and local SMTP
 * owner chain. Bilateral issuer/legal facts are synthetic fixture boundaries;
 * no real bilateral agreement, customer authentication or Ediel approval claim. */
async function stage(){return seedNormalSwitchNativeFixture({requestedStartDate:'2026-10-15',deferOriginal:true,initialSubtype:'H'})}
async function authorized(){
 const f=await createBilateralProdatGroundNativeFixture(await stage()),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Independent review of synthetic original; mechanism only'})
 expect(review.status,JSON.stringify(review)).toBe('authorized');return {...f,profileVersionId:String(review.profileVersionId)}
}
function counts(f:{companyId:string;switchId:string}){return sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),'operations',(SELECT count(*) FROM gridex_bilateral_prodat.outbound_operations WHERE company_id=${literal(f.companyId)}),'receipts',(SELECT count(*) FROM gridex_bilateral_prodat.outbound_receipts WHERE company_id=${literal(f.companyId)}),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(f.companyId)}),'consumptions',(SELECT count(*) FROM gridex_ediel_outbound_owner.consumptions WHERE company_id=${literal(f.companyId)}),'switchOriginals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}),'requests',(SELECT count(*) FROM public.outbound_requests WHERE company_id=${literal(f.companyId)}),'intents',(SELECT count(*) FROM public.ediel_message_intents WHERE company_id=${literal(f.companyId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),'acks',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_family IN('APERAK','CONTRL')),'mixedReplies',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_reply_outbox WHERE company_id=${literal(f.companyId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}))`)}
const originate=(f:{actorUserId:string;switchId:string;routeId:string})=>prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
it('actual H operation without authenticated archived profile holds before the first request, intent or original; never falls back to L',async()=>{
 const f=await stage(),before=counts(f)
 await expect(originate(f)).rejects.toThrow()
 expect(counts(f)).toEqual(before)
 expect(sql(`SELECT jsonb_build_object('variant',prodat_variant,'reason',prodat_reason,'original',outbound_z03_message_id) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}`)).toEqual({variant:'H',reason:'Z25',original:null})
},120000)
it('actual first H original uses native archived profile, real validated intent and one atomic own witness/switch binding before local provider entry',async()=>{
 const f=await authorized(),qualified=await qualifyBilateralProdatSwitchPreparation({companyId:f.companyId,actorUserId:f.actorUserId,switchId:f.switchId,environment:'test'})
 expect(qualified.profileVersionId).toBe(f.profileVersionId)
 const m=await originate(f),tokens=tokenizeEdifact(m.raw_payload!),reasons=tokens.segments.filter(t=>t.tag==='CAV').map(t=>segmentComposite(t,1,tokens.una)[0])
 expect(reasons).toContain('Z25');expect(reasons).not.toContain('Z22')
 expect(counts(f)).toMatchObject({originals:1,operations:1,receipts:1,witnesses:1,consumptions:1,switchOriginals:1,requests:1,intents:1,periods:0,acks:0,mixedReplies:0,outbox:1})
 const binding=sql<{reason:string;original:string;intent:string;subtype:string}>(`SELECT jsonb_build_object('reason',b.original_object->>'reason','original',s.outbound_z03_message_id,'intent',i.ediel_message_id,'subtype',i.payload->>'transactionSubtype') FROM gridex_received_sources.switch_originals b JOIN public.supplier_switch_requests s ON s.id=b.switch_id JOIN public.ediel_message_intents i ON i.id=b.intent_id WHERE b.message_id=${literal(m.id)}`)
 expect(binding).toEqual({reason:'Z25',original:m.id,intent:m.id,subtype:'H'})
 expect((await qualifyPersistedBilateralProdatOutboundOriginal((await getEdielMessageById(m.id))!)).qualification?.objects[0].profileVersionId).toBe(f.profileVersionId)
 for(const [name,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(name,value)
 provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-H-owner-only',response:'250 synthetic accepted'})
 await sendEdielMessageViaSmtp((await getEdielMessageById(m.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 expect(provider).toHaveBeenCalledTimes(1)
 expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(m.id)}`)).toBe(true)
 const before=counts(f);await sendEdielMessageViaSmtp((await getEdielMessageById(m.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'});expect(provider).toHaveBeenCalledTimes(1);expect(counts(f)).toEqual(before)
},120000)
it('last audit failure rolls back the complete original transaction including witness, intent binding and switch original',async()=>{
 const f=await authorized(),constraint=`bilateral_h_lastwrite_${randomUUID().replaceAll('-','')}`,beforeSwitch=sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.bilateral_profile.original_registered')) NOT VALID`)
 try{await expect(originate(f)).rejects.toMatchObject({message:expect.stringContaining(constraint)});expect(counts(f)).toMatchObject({originals:0,operations:0,receipts:0,witnesses:0,consumptions:0,switchOriginals:0,periods:0,acks:0,mixedReplies:0,outbox:0});expect(sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)).toEqual(beforeSwitch);expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_intents WHERE company_id=${literal(f.companyId)} AND(ediel_message_id IS NOT NULL OR render_status='rendered')`)).toBe(0)}finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${constraint}`)}
},120000)
it('current reviewer DENY blocks H preparation even with active uploader, reviewer and memberships; no first intent or market effects',async()=>{
 const f=await authorized(),before=counts(f)
 sql(`DELETE FROM public.user_roles WHERE user_id=${literal(f.reviewer)};UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.bilateral_profile.review'`)
 await expect(originate(f)).rejects.toThrow();expect(counts(f)).toEqual(before)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.company_memberships WHERE company_id=${literal(f.companyId)} AND user_id IN(${literal(f.actorUserId)},${literal(f.reviewer)}) AND is_active AND status='active'`)).toBe(2)
},120000)

/** Genuine H original/provider/private source capture and whole canonical v6
 * producer. The legal issuer is the declared synthetic external boundary above.
 * No private original, accepted facet, effect or reply row is manually seeded. */
async function receivedHStart(){
 const f=await authorized(),original=await originate(f)
 for(const [name,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(name,value)
 provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-H-start-original',response:'250 synthetic accepted'})
 await sendEdielMessageViaSmtp((await getEdielMessageById(original.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 const physical=sql<{objects:{start:string;li:string}[]}>(`SELECT gridex_received_sources.normal_switch_wire_v1(${literal(original.raw_payload)})`).objects[0]
 const body:Parts[]=[...head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE']:p),line('1',f.external,undefined,'9'),qty('1000'),...common(f.external,'Synthetic',physical.start),...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','D'),['CCI','','Z14'],['CAV',['','','','L917','8716867000030']],['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.sender,'160','SVK']]]
 const own=body.map(p=>p[0]==='CAV'&&Array.isArray(p[1])&&p[1][0]==='Z22'?['CAV',['Z25']]:p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI'?['RFF',['LI',physical.li]]:p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='Z05'?['RFF',['Z05',f.gridAreaCode]]:p[0]==='NAD'&&p[1]==='UD'?['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE']:p) as Parts[]
 const wire=guideOrderedFixtureRaw(own,'Z04').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`),sourceId=randomUUID(),routeId=randomUUID(),profileId=randomUUID()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic H ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email) VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic H ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},'{}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:H:26.A:r3' AND profile.is_enabled;`)
 const source=(await getEdielMessageById(sourceId))!;expect(source).not.toBeNull()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 expect(sql(`SELECT to_jsonb(payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex') AND received_context->>'contextOrigin'='database_insert') FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceId)}`)).toBe(true)
 return {...f,sourceId,source,wire}
}
function hStartEffects(f:{companyId:string;sourceId:string;switchId:string}){return sql(`SELECT jsonb_build_object('raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.sourceId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),'confirmations',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),'profiles',(SELECT count(*) FROM gridex_bilateral_prodat.supply_effect_receipts WHERE source_message_id=${literal(f.sourceId)}),'switch',(SELECT status FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}),'positive',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)} AND message_family='APERAK' AND raw_payload LIKE '%ERC+100%'),'active',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)} AND status='active'),'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND entity_id=${literal(f.sourceId)}::uuid AND action='ediel.bilateral_profile.supply_applied'))`)}
it('actual full H source commits its own original/contract/period/profile before ERC100 and remains future without premature activation',async()=>{
 const f=await receivedHStart()
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const first=hStartEffects(f);expect(first).toMatchObject({raw:f.wire,periods:1,confirmations:1,transitions:1,profiles:1,switch:'accepted',positive:1,active:0,audits:1})
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(hStartEffects(f)).toEqual(first)
},120000)
it('last H supply audit failure rolls back actual original confirmation, own period, source/profile transition and false positive',async()=>{
 const f=await receivedHStart(),constraint=`bilateral_h_supply_last_${randomUUID().replaceAll('-','')}`
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.bilateral_profile.supply_applied')) NOT VALID`)
 try{await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(hStartEffects(f)).toMatchObject({raw:f.wire,periods:0,confirmations:0,transitions:0,profiles:0,positive:0,active:0,audits:0});expect(sql(`SELECT to_jsonb(inbound_z04_message_id IS NULL) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}`)).toBe(true)}finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${constraint}`)}
},120000)
