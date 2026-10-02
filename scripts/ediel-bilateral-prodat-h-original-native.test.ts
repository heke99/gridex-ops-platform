import {createHash,createHmac,randomUUID} from 'node:crypto'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
// Only the browser-cookie transport factory is replaced. getUser, GoTrue
// sign-in and authenticated RPCs below use the actual local session client.
const sourceSession=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!sourceSession.client)throw Error('native_actual_source_session_required');return sourceSession.client}}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
// Own APERAKs carry the national Z07+LI pair in one ERC (P16B resolved, E2SE6A).
vi.mock('@/lib/ediel/core/messageBuilder',async importOriginal=>(await import('../__tests__/helpers/p16bHold')).captureP16bPreflight(importOriginal))
import {expectP16bHold,p16bBlockedAperaks} from '../__tests__/helpers/p16bHold'
const heldP16b=(sourceId:string)=>{expectP16bHold(sql<string>(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${literal(sourceId)}`));p16bBlockedAperaks.length=0}
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {createBilateralProdatGroundNativeFixture} from './helpers/ediel-bilateral-prodat-profile-native-fixture'
import {archiveBilateralProdatGround,reviewBilateralProdatGround} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {qualifyBilateralProdatSwitchPreparation} from '@/lib/ediel/production/bilateralProdatSwitchPreparation'
import {qualifyPersistedBilateralProdatOutboundOriginal} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import {getEdielMessageById} from '@/lib/ediel/db'
import {supabaseService} from '@/lib/supabase/service'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {guideOrderedFixtureRaw} from '../__tests__/helpers/prodatGuideOrderedFixture'
import {line,qty,common,characteristic,type Parts} from '../__tests__/fixtures/prodat-register'
import {head} from '../__tests__/fixtures/prodat-identity'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {prepareBilateralClosureOperation} from '@/lib/ediel/production/bilateralProdatClosureOperation'
import {prepareAndQueueBilateralClosureZ08} from '@/lib/ediel/flows/prodatBilateralClosure'
import {prepareAndQueueSupplyRescissionZ08} from '@/lib/ediel/flows/prodatSupplyRescission'
import {readSupplyRescissionScope,archiveSupplyRescission,reviewSupplyRescission,readSupplyRescissionBytes} from '@/lib/ediel/production/supplyRescissionIntake'
/** Genuine internal contract/signature/PDF/POA, intent/original and local SMTP
 * owner chain. Bilateral issuer/legal facts are synthetic fixture boundaries;
 * no real bilateral agreement, customer authentication or Ediel approval claim. */
async function stage(){const f=await seedNormalSwitchNativeFixture({requestedStartDate:'2026-10-15',deferOriginal:true,initialSubtype:'H'});sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN('communication.read','communication.write','communication.send','contracts.read','metering.read','metering.write');`);return f}
async function authorized(){
 const f=await createBilateralProdatGroundNativeFixture(await stage()),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Independent review of synthetic original; mechanism only'})
 expect(review.status,JSON.stringify(review)).toBe('authorized');return {...f,profileVersionId:String(review.profileVersionId)}
}
function counts(f:{companyId:string;switchId:string}){return sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),'operations',(SELECT count(*) FROM gridex_bilateral_prodat.outbound_operations WHERE company_id=${literal(f.companyId)}),'receipts',(SELECT count(*) FROM gridex_bilateral_prodat.outbound_receipts WHERE company_id=${literal(f.companyId)}),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(f.companyId)}),'consumptions',(SELECT count(*) FROM gridex_ediel_outbound_owner.consumptions WHERE company_id=${literal(f.companyId)}),'switchOriginals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}),'requests',(SELECT count(*) FROM public.outbound_requests WHERE company_id=${literal(f.companyId)}),'intents',(SELECT count(*) FROM public.ediel_message_intents WHERE company_id=${literal(f.companyId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),'acks',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_family IN('APERAK','CONTRL')),'mixedReplies',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_reply_outbox WHERE company_id=${literal(f.companyId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}))`)}
const originate=(f:{actorUserId:string;switchId:string;routeId:string})=>prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
afterEach(()=>{sourceSession.client=null;vi.unstubAllEnvs();vi.restoreAllMocks()})
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
 expect((await qualifyPersistedBilateralProdatOutboundOriginal((await getEdielMessageById(m.id))!,f.actorUserId)).qualification?.objects[0].profileVersionId).toBe(f.profileVersionId)
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
 const wire=guideOrderedFixtureRaw(own,'Z04').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`).replace("++23-DDQ-PRODAT'","++23-DDQ-PRODAT++1++1'").replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')([\s\S]*UNZ\+1\+)I'/,(_,unb:string,mid:string)=>{const id=`I${randomUUID().replaceAll('-','').slice(0,12)}`;return `+${id}${unb}${mid}${id}'`}) /* own interchange per inbound */,sourceId=randomUUID(),routeId=randomUUID(),profileId=randomUUID()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic H ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email) VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic H ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},'{"subtype":"H","prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":false}}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:H:26.A:r3' AND profile.is_enabled;`)
 const source=(await getEdielMessageById(sourceId))!;expect(source).not.toBeNull()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 expect(sql(`SELECT to_jsonb(payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex') AND received_context->>'contextOrigin'='database_insert') FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceId)}`)).toBe(true)
 return {...f,sourceId,source,wire}
}
function hStartEffects(f:{companyId:string;sourceId:string;switchId:string}){return sql(`SELECT jsonb_build_object('raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.sourceId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),'confirmations',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),'profiles',(SELECT count(*) FROM gridex_bilateral_prodat.supply_effect_receipts WHERE source_message_id=${literal(f.sourceId)}),'switch',(SELECT status FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}),'positive',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)} AND message_family='APERAK' AND raw_payload LIKE '%ERC+100%'),'active',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)} AND status='active'),'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND entity_id=${literal(f.sourceId)} AND action='ediel.bilateral_profile.supply_applied'))`)}
it('actual full H source commits its own original/contract/period/profile before ERC100 and remains future without premature activation',async()=>{
 const f=await receivedHStart()
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const first=hStartEffects(f);expect(first).toMatchObject({raw:f.wire,periods:1,confirmations:1,transitions:1,profiles:1,switch:'accepted',positive:1,active:0,audits:1});heldP16b(f.sourceId)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(hStartEffects(f)).toEqual(first)
},120000)
it('last H supply audit failure rolls back actual original confirmation, own period, source/profile transition and false positive',async()=>{
 const f=await receivedHStart(),constraint=`bilateral_h_supply_last_${randomUUID().replaceAll('-','')}`
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.bilateral_profile.supply_applied')) NOT VALID`)
 try{await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(hStartEffects(f)).toMatchObject({raw:f.wire,periods:0,confirmations:0,transitions:0,profiles:0,positive:0,active:0,audits:0});expect(sql(`SELECT to_jsonb(inbound_z04_message_id IS NULL) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}`)).toBe(true)}finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${constraint}`)}
},120000)

async function receivedHEnd(){
 const start=await receivedHStart();await processInboundEdielMessage({actorUserId:start.actorUserId,edielMessageId:start.sourceId})
 const f=await createBilateralProdatGroundNativeFixture(start,'own_end_h'),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Separate review of the synthetic H end source; mechanism only'})
 expect(review.status,JSON.stringify(review)).toBe('authorized')
 const sourceId=randomUUID(),end='202610161330',li=`H-END-${sourceId.slice(0,8)}`
 const own:Parts[]=[...head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE']:p),line('1',f.external,undefined,'9'),['DTM',['93',end,'203']],...characteristic('Z13','Z25'),['RFF',['LI',li]],['RFF',['Z05',f.gridAreaCode]],['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE'],['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.brpEdielId,'160','SVK']]]
 const wire=guideOrderedFixtureRaw(own,'Z05').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`).replace("++23-DDQ-PRODAT'","++23-DDQ-PRODAT++1++1'").replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')([\s\S]*UNZ\+1\+)I'/,(_,unb:string,mid:string)=>{const id=`I${randomUUID().replaceAll('-','').slice(0,12)}`;return `+${id}${unb}${mid}${id}'`}) /* own interchange per inbound */
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z05:H:26.A:r3' AND profile.is_enabled;`)
 const source=(await getEdielMessageById(sourceId))!,decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 return {...f,startSourceId:start.sourceId,sourceId,source,wire,end,li,profileVersionId:String(review.profileVersionId)}
}
function hEndEffects(f:{companyId:string;sourceId:string;startSourceId:string}){return sql(`SELECT jsonb_build_object('period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE source_message_id=${literal(f.startSourceId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),'profiles',(SELECT count(*) FROM gridex_bilateral_prodat.supply_effect_receipts WHERE source_message_id=${literal(f.sourceId)}),'positive',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)} AND message_family='APERAK' AND raw_payload LIKE '%ERC+100%'),'followups',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.sourceId)}),'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND entity_id=${literal(f.sourceId)} AND action='ediel.bilateral_profile.supply_applied'))`)}
it('actual H end uses original captured H start, an independently reviewed current end profile and whole canonical original; end/history/profile commit precedes ERC100 and replay is immutable',async()=>{
 const f=await receivedHEnd(),before=hEndEffects(f) as {period:{id:string;market_state_version:number;source_end_message_id:string|null}}
 expect(before.period.source_end_message_id).toBeNull()
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const applied=hEndEffects(f);expect(applied).toMatchObject({period:{id:before.period.id,source_end_message_id:f.sourceId,market_state_version:before.period.market_state_version+1,market_end_at:'2026-10-16T12:30:00+00:00',status:'ending'},transitions:1,profiles:1,positive:1,followups:1,audits:1});heldP16b(f.sourceId)
 expect(sql(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${literal(f.sourceId)}`)).toBe(f.wire)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(hEndEffects(f)).toEqual(applied)
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.bilateral_profile.review'`)
 expect(sql(`SELECT to_jsonb(gridex_bilateral_prodat.recorded_supply_current_v1(${literal(f.companyId)},${literal(f.sourceId)}))`)).toBe(false)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(hEndEffects(f)).toEqual(applied)
},120000)
it('last H end audit failure rolls back period end/version, full source transition, captured end profile and positive ACK',async()=>{
 const f=await receivedHEnd(),before=hEndEffects(f),constraint=`h_end_last_${randomUUID().replaceAll('-','')}`
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.bilateral_profile.supply_applied' AND entity_id=${literal(f.sourceId)})) NOT VALID`)
 try{await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(hEndEffects(f)).toEqual(before)}finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${constraint}`)}
},120000)

async function lkOperation(){
 const start=await receivedHStart();await processInboundEdielMessage({actorUserId:start.actorUserId,edielMessageId:start.sourceId})
 const f=await createBilateralProdatGroundNativeFixture(start,'closure_request_lk'),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Independent archived LK source review; synthetic legal mechanism only'})
 expect(review.status,JSON.stringify(review)).toBe('authorized')
 const periodId=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(start.sourceId)}`),basis=await prepareBilateralClosureOperation({companyId:f.companyId,actorUserId:f.actorUserId,supplyPeriodId:periodId,effectiveAt:'2026-10-16T12:30:00Z'})
 expect(basis.status,JSON.stringify(basis)).toBe('authorized');if(basis.status!=='authorized')throw Error('native LK operation held')
 const made=await prepareAndQueueBilateralClosureZ08({companyId:f.companyId,actorUserId:f.actorUserId,operationId:basis.operationId,preferredRouteId:f.routeId})
 expect(made.status,JSON.stringify(made)).toBe('queued');if(!('message'in made))throw Error('native LK original held')
 expect(sql(`SELECT to_jsonb(source_end_message_id IS NULL) FROM public.customer_supply_periods WHERE id=${literal(periodId)}`)).toBe(true)
 return{...f,startSourceId:start.sourceId,periodId,basis,original:made.message}
}
async function receivedLkEnd(sent:boolean){
 const f=await lkOperation()
 if(sent){provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-LK-original',response:'250 synthetic accepted'});await sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})}
 const sourceId=randomUUID(),own:Parts[]=[...head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE']:p),line('1',f.external,undefined,'9'),['DTM',['93','202610161330','203']],...characteristic('Z13','Z23'),['RFF',['LI',f.basis.lineItemReference]],['RFF',['Z05',f.gridAreaCode]],['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE'],['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.brpEdielId,'160','SVK']]],wire=guideOrderedFixtureRaw(own,'Z05').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`).replace("++23-DDQ-PRODAT'","++23-DDQ-PRODAT++1++1'").replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')([\s\S]*UNZ\+1\+)I'/,(_,unb:string,mid:string)=>{const id=`I${randomUUID().replaceAll('-','').slice(0,12)}`;return `+${id}${unb}${mid}${id}'`}) /* own interchange per inbound */
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot) SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z05:LK:26.A:r3' AND profile.is_enabled;`)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry((await getEdielMessageById(sourceId))!);expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 return{...f,sourceId,wire}
}
function lkEffects(f:{companyId:string;periodId:string;sourceId:string}){return sql(`SELECT jsonb_build_object('period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}),'ends',(SELECT count(*) FROM gridex_bilateral_prodat.closure_end_receipts WHERE source_message_id=${literal(f.sourceId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),'positive',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)} AND message_family='APERAK' AND raw_payload LIKE '%ERC+100%'),'followups',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.sourceId)}),'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND action='ediel.bilateral_profile.closure_applied' AND entity_id=${literal(f.sourceId)}))`)}
it('genuine LK operation, validated intent and atomic original remain a request until private accepted transport and the matching whole Z05 end; immutable replay and current reviewer revocation bind the captured original',async()=>{
 const f=await receivedLkEnd(true);expect(lkEffects(f)).toMatchObject({period:{source_end_message_id:null},ends:0,transitions:0,positive:0,audits:0})
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});const after=lkEffects(f);expect(after).toMatchObject({period:{source_end_message_id:f.sourceId,market_state_version:2,status:'ending'},ends:1,transitions:1,positive:1,followups:1,audits:1});heldP16b(f.sourceId)
 expect(sql(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${literal(f.sourceId)}`)).toBe(f.wire)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(lkEffects(f)).toEqual(after)
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.bilateral_profile.review'`);expect(sql(`SELECT to_jsonb(gridex_bilateral_prodat.recorded_closure_end_current_v1(${literal(f.companyId)},${literal(f.sourceId)}))`)).toBe(false)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(lkEffects(f)).toEqual(after)
},120000)
it('unsent LK original does not authorize period end, own source transition, ERC100 or closure audit',async()=>{
 const f=await receivedLkEnd(false),before=lkEffects(f);await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(lkEffects(f)).toEqual(before)
},120000)
it('last LK audit failure rolls back matched period end/version, captured original/profile receipt, full source transition and false positive',async()=>{
 const f=await receivedLkEnd(true),before=lkEffects(f),constraint=`lk_last_${randomUUID().replaceAll('-','')}`
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.bilateral_profile.closure_applied')) NOT VALID`)
 try{await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId});expect(lkEffects(f)).toEqual(before)}finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${constraint}`)}
},120000)

async function actualNationalSourceSession(actor:string){
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('native_source_session_owned_local_only')
 const password='H-intake-'+randomUUID()+'-aA1!',updated=await supabaseService.auth.admin.updateUserById(actor,{password,email_confirm:true})
 expect(updated.error).toBeNull();const email=updated.data.user?.email;if(!email)throw Error('native_source_actor_email_required')
 const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!anon)throw Error('native_source_anon_key_required')
 const client=createClient('http://127.0.0.1:54321',anon,{auth:{persistSession:false,autoRefreshToken:false}}),signed=await client.auth.signInWithPassword({email,password})
 expect(signed.error).toBeNull();expect(signed.data.user?.id).toBe(actor);const current=await client.auth.getUser();expect(current.error).toBeNull();expect(current.data.user?.id).toBe(actor)
 return client
}
async function nationalRescissionArtifact(){
 const f=await receivedHStart();await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const archiverSession=await actualNationalSourceSession(f.actorUserId),reviewerSession=await actualNationalSourceSession(f.reviewer);sourceSession.client=archiverSession
 const periodId=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceId)}`),rulePackId=sql<string>(`SELECT to_jsonb(pack.id) FROM public.ediel_rule_packs pack WHERE pack.family='PRODAT' AND pack.guide_version='26.A' AND pack.guide_revision='3' AND pack.status='active' AND(SELECT count(*) FROM public.ediel_message_profiles profile WHERE profile.rule_pack_id=pack.id AND profile.is_enabled AND(profile.profile_key='PRODAT:Z08:H:26.A:r3' OR profile.profile_key='PRODAT:Z05:L:26.A:r3'))=2`),selector={environment:'test' as const,supplyPeriodId:periodId,effectiveAt:'2026-10-16T12:30:00Z',rulePackId},scope=await readSupplyRescissionScope({companyId:f.companyId,actorUserId:f.actorUserId,...selector})
 expect(scope.status,JSON.stringify(scope)).toBe('scoped')
 const bytes=Buffer.from('SYNTHETIC LEGAL ORIGINAL: actual prerequisites completed; requested own contract rescission. NOT REAL LEGAL CLAIM.'),source={bytesBase64:bytes.toString('base64'),mimeType:'text/plain' as const,reference:'SYNTHETIC NATIONAL RESCISSION ORIGINAL',version:'1'},keyId=randomUUID(),representationId=randomUUID(),key=Buffer.from('SYNTHETIC national rescission issuer configured native fixture only'),dso=sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)} AND is_verified`)
 sql(`INSERT INTO gridex_supply_rescission.issuer_keys VALUES(${literal(keyId)},${literal(f.companyId)},'test','SYNTHETIC','DECLARED MECHANISM BOUNDARY NOT REAL LEGAL CLAIM',${literal('a'.repeat(64))},decode(${literal(key.toString('hex'))},'hex'),'2000-01-01','2100-01-01');INSERT INTO gridex_supply_rescission.issuer_representations VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},${literal(dso)},${literal(f.gridAreaCode)},'SYNTHETIC REPRESENTATION',${literal('b'.repeat(64))},'2000-01-01','2100-01-01');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(f.reviewer)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key='ediel.supply_rescission.review';`)
 const issued=new Date(Date.now()-1000).toISOString(),payload=Buffer.from(JSON.stringify({format:'ediel_national_supply_rescission_receipt_v1',purpose:'national_prodat_z08h_legal_rescission',issuerCode:'SYNTHETIC',receiptId:randomUUID(),companyId:f.companyId,environment:'test',scope:scope.scope,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceReference:source.reference,sourceVersion:'1',legalCaseReference:'SYNTHETIC CASE',legalDecisionReference:'SYNTHETIC DECISION',legalPrerequisitesReference:'SYNTHETIC PREREQUISITES',legalPrerequisitesCompletedAt:issued,issuedAt:issued,expiresAt:'2099-01-01T00:00:00Z'})),submission={...selector,source,issuerReceipt:{keyId,representationId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}},artifact=await archiveSupplyRescission({companyId:f.companyId,actorUserId:f.actorUserId,...submission}),review={sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve' as const,reason:'Independent review of actual synthetic original and completed legal prerequisites; no real legal approval',sourceClauseLocator:'Original sentence 1',sourceClauseQuote:'actual prerequisites completed; requested own contract rescission.'}
 expect(artifact.status,JSON.stringify(artifact)).toBe('archived');sourceSession.client=reviewerSession;return{...f,periodId,bytes,artifactId:String(artifact.artifactId),review}
}
it('genuine signed-contract/accepted H supply feeds a separate authenticated national legal original and independent source-clause review; a legal mandate itself neither originates Z08 nor ends supply',async()=>{
 const f=await nationalRescissionArtifact(),before=counts(f),approved=await reviewSupplyRescission({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId,...f.review})
 expect(approved.status,JSON.stringify(approved)).toBe('authorized');expect(counts(f)).toEqual(before)
 expect((await readSupplyRescissionBytes({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId})).bytes).toEqual(f.bytes)
 const basis=sql<{owner:string;periodId:string}>(`SELECT public.ediel_read_supply_rescission_mandate_v1(${literal(f.companyId)},${literal(f.actorUserId)},${literal(approved.mandateId)})`);expect(basis.owner).toBe('immutable-national-supply-rescission-mandate-v1');expect(basis.periodId).toBe(f.periodId)
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.supply_rescission.review'`)
 expect(sql(`SELECT coalesce(public.ediel_read_supply_rescission_mandate_v1(${literal(f.companyId)},${literal(f.actorUserId)},${literal(approved.mandateId)}),'null'::jsonb)`)).toBeNull();expect(counts(f)).toEqual(before)
},120000)
it('last national legal-mandate audit failure rolls back its independent review and mandate without changing own supply or making a new original',async()=>{
 const f=await nationalRescissionArtifact(),before=counts(f),constraint=`national_h_source_last_${randomUUID().replaceAll('-','')}`
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.supply_rescission.mandate_created')) NOT VALID`)
 try{await expect(reviewSupplyRescission({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId,...f.review})).rejects.toThrow();expect(counts(f)).toEqual(before);expect(sql(`SELECT jsonb_build_object('mandates',(SELECT count(*) FROM gridex_supply_rescission.mandates WHERE company_id=${literal(f.companyId)}),'reviews',(SELECT count(*) FROM gridex_supply_rescission.reviews WHERE company_id=${literal(f.companyId)}))`)).toEqual({mandates:0,reviews:0})}finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${constraint}`)}
},120000)

/** The real producers below create the source, legal review, canonical intent,
 * immutable original, local provider journal and inbound end. Only issuer trust
 * and SMTP are synthetic boundaries; no private ready/accepted rows are seeded. */
function nationalNativeOperator(companyId:string,permissions:string[]){
 const actor=randomUUID(),email=`h-operator-${actor}@example.invalid`
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(email)},now(),'{}','{}',now(),now(),false,false);INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(email)},'Synthetic native H phase operator','active');INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(actor)},${literal(companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN(${permissions.map(literal).join(',')});`)
 return actor
}
function installNationalLastWriteDeny(companyId:string,actor:string,action:string,permission:string){
 const name=`national_h_wait_${randomUUID().replaceAll('-','')}`
 // Owned native test instrumentation: the real ordinary policy row becomes
 // current only after the actual final audit write has started. No source or
 // issuer privilege is manufactured, and the failed transaction erases it.
 sql(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $probe$BEGIN IF NEW.company_id=${literal(companyId)}::uuid AND NEW.actor_user_id=${literal(actor)}::uuid AND NEW.action=${literal(action)} THEN INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from,valid_to,reason) VALUES(${literal(actor)},${literal(companyId)},${literal(permission)},'deny',true,clock_timestamp()+interval '40 milliseconds',clock_timestamp()+interval '1 day','SYNTHETIC last-write wall-clock contract');PERFORM pg_sleep(0.08);END IF;RETURN NEW;END$probe$;CREATE TRIGGER ${name} AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${name}();`)
 return()=>sql(`DROP TRIGGER ${name} ON public.audit_logs;DROP FUNCTION public.${name}();`)
}
async function nationalRescissionOperation(separatePrincipals=false){
 const f=await nationalRescissionArtifact(),approved=await reviewSupplyRescission({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId,...f.review})
 expect(approved.status,JSON.stringify(approved)).toBe('authorized')
 const creator=separatePrincipals?nationalNativeOperator(f.companyId,['communication.write','metering.write','contracts.read']):f.actorUserId,currentExecutor=separatePrincipals?nationalNativeOperator(f.companyId,['communication.send','communication.write','metering.write','contracts.read']):f.actorUserId,mandateId=String(approved.mandateId),result=await prepareAndQueueSupplyRescissionZ08({companyId:f.companyId,actorUserId:creator,mandateId,preferredRouteId:f.routeId})
 expect(result.status,JSON.stringify(result)).toBe('queued');if(!('message'in result))throw Error('native national H original held')
 const own=sql<{objects:{li:string;reason:string}[]}>(`SELECT gridex_bilateral_prodat.draft_wire_v1(${literal(result.message.raw_payload)})`).objects[0]
 expect(own).toMatchObject({li:'H'+mandateId.replaceAll('-',''),reason:'Z25'})
 expect(sql(`SELECT to_jsonb(source_end_message_id IS NULL) FROM public.customer_supply_periods WHERE id=${literal(f.periodId)}`)).toBe(true)
 if(separatePrincipals)sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(creator)};UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(creator)};`)
 return{...f,creator,currentExecutor,mandateId,original:result.message,li:own.li}
}
async function receivedNationalRescissionEnd(sent:boolean,separatePrincipals=false){
 const f=await nationalRescissionOperation(separatePrincipals)
 if(sent){provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-national-H-original',response:'250 synthetic accepted'});await sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.currentExecutor,smtpMimeMode:'nodemailer-attachment'})}
 const sourceId=randomUUID(),own:Parts[]=[...head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE']:p),line('1',f.external,undefined,'9'),['DTM',['93','202610161330','203']],...characteristic('Z13','Z22'),['RFF',['LI',f.li]],['RFF',['Z05',f.gridAreaCode]],['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE'],['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.brpEdielId,'160','SVK']]],wire=guideOrderedFixtureRaw(own,'Z05').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`).replace("++23-DDQ-PRODAT'","++23-DDQ-PRODAT++1++1'").replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')([\s\S]*UNZ\+1\+)I'/,(_,unb:string,mid:string)=>{const id=`I${randomUUID().replaceAll('-','').slice(0,12)}`;return `+${id}${unb}${mid}${id}'`}) /* own interchange per inbound */
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot) SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z05:L:26.A:r3' AND profile.is_enabled;`)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry((await getEdielMessageById(sourceId))!);expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 return{...f,endSourceId:sourceId,endWire:wire}
}
function nationalEndEffects(f:{companyId:string;periodId:string;endSourceId:string}){return sql(`SELECT jsonb_build_object('period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.endSourceId)}),'ends',(SELECT count(*) FROM gridex_supply_rescission.end_receipts WHERE source_message_id=${literal(f.endSourceId)}),'positive',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(f.endSourceId)} AND message_family='APERAK' AND raw_payload LIKE '%ERC+100%'),'followups',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.endSourceId)}),'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND action='ediel.supply_rescission.end_applied'),'watches',(SELECT jsonb_agg(jsonb_build_object('source',source_message_id,'code',expected_code,'subtype',expected_subtype,'status',status,'fulfilledBy',fulfilled_by_message_id,'dueAt',due_at) ORDER BY id) FROM public.ediel_business_expectations WHERE company_id=${literal(f.companyId)} AND expected_code='Z05'))`)}
it('national H original uses own current reviewed mandate and atomic witness/intent binding; current reviewer deny prevents fresh provider entry',async()=>{
 const f=await nationalRescissionOperation()
 expect(sql(`SELECT jsonb_build_object('operations',(SELECT count(*) FROM gridex_supply_rescission.outbound_operations WHERE company_id=${literal(f.companyId)}),'receipts',(SELECT count(*) FROM gridex_supply_rescission.outbound_receipts WHERE company_id=${literal(f.companyId)}),'intent',(SELECT ediel_message_id FROM public.ediel_message_intents WHERE id=${literal(f.original.intent_id)}),'period',(SELECT source_end_message_id FROM public.customer_supply_periods WHERE id=${literal(f.periodId)}))`)).toEqual({operations:1,receipts:1,intent:f.original.id,period:null})
 expect((await qualifyPersistedBilateralProdatOutboundOriginal((await getEdielMessageById(f.original.id))!,f.actorUserId)).qualification?.objects[0].mandateId).toBe(f.mandateId)
 provider.mockReset();sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.supply_rescission.review'`)
 await expect(sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow();expect(provider).not.toHaveBeenCalled()
},120000)
it('national Z05L requires its actually accepted own H original; unsent H never ends supply or creates ERC100',async()=>{
 const f=await receivedNationalRescissionEnd(false),before=nationalEndEffects(f)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.endSourceId});expect(nationalEndEffects(f)).toEqual(before)
},120000)
it('national Z05L commits exact H original/end receipt/history before positive ACK and final-metering followup; replay is immutable and deny disables current evidence',async()=>{
 const f=await receivedNationalRescissionEnd(true)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.endSourceId})
 const after=nationalEndEffects(f);expect(after).toMatchObject({period:{id:f.periodId,source_end_message_id:f.endSourceId,market_end_at:'2026-10-16T12:30:00+00:00',status:'ending'},transitions:1,ends:1,positive:1,followups:1,audits:1});heldP16b(f.endSourceId)
 expect(sql(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${literal(f.endSourceId)}`)).toBe(f.endWire)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.endSourceId});expect(nationalEndEffects(f)).toEqual(after)
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer)} AND permission_key='ediel.supply_rescission.review'`)
 expect(sql(`SELECT to_jsonb(gridex_supply_rescission.recorded_end_current_v1(${literal(f.companyId)},${literal(f.endSourceId)}))`)).toBe(false)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.endSourceId});expect(nationalEndEffects(f)).toEqual(after)
},120000)
it('last national H end audit failure rolls back end/version, transition, exact mandate/original receipt and positive ACK',async()=>{
 const f=await receivedNationalRescissionEnd(true),before=nationalEndEffects(f),constraint=`national_h_end_last_${randomUUID().replaceAll('-','')}`
 sql(`ALTER TABLE public.audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(company_id=${literal(f.companyId)}::uuid AND action='ediel.supply_rescission.end_applied')) NOT VALID`)
 try{await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.endSourceId});expect(nationalEndEffects(f)).toEqual(before)}finally{sql(`ALTER TABLE public.audit_logs DROP CONSTRAINT ${constraint}`)}
},120000)

it('actual prepare-only C and SEND-only E handoff preserves archived A/reviewer R/current source while revoking C; E lacks READ and current E DENY blocks execution',async()=>{
 const f=await receivedNationalRescissionEnd(true,true)
 expect(new Set([f.actorUserId,f.reviewer,f.creator,f.currentExecutor]).size).toBe(4)
 expect(f.original.created_by).toBe(f.creator)
 expect((await qualifyPersistedBilateralProdatOutboundOriginal((await getEdielMessageById(f.original.id))!,f.currentExecutor)).qualification).toMatchObject({actorUserId:f.currentExecutor,originalActorUserId:f.creator})
 const disclosure=await(supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{error:{code?:string}|null}> )('ediel_read_supply_rescission_original_v1',{p_company_id:f.companyId,p_actor_user_id:f.currentExecutor,p_message_id:f.original.id});expect(disclosure.error).toMatchObject({code:'42501'})
 expect(nationalEndEffects(f)).toMatchObject({watches:[{source:f.original.id,code:'Z05',subtype:'L',status:'pending',fulfilledBy:null,dueAt:null}]})
 await processInboundEdielMessage({actorUserId:f.currentExecutor,edielMessageId:f.endSourceId})
 const after=nationalEndEffects(f);expect(after).toMatchObject({ends:1,positive:1,watches:[{source:f.original.id,status:'fulfilled',fulfilledBy:f.endSourceId}]});heldP16b(f.endSourceId)
 await processInboundEdielMessage({actorUserId:f.currentExecutor,edielMessageId:f.endSourceId});expect(nationalEndEffects(f)).toEqual(after)
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.currentExecutor)} AND permission_key='metering.write';`)
 await processInboundEdielMessage({actorUserId:f.currentExecutor,edielMessageId:f.endSourceId});expect(nationalEndEffects(f)).toEqual(after)
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.currentExecutor)} AND permission_key='communication.send';`)
 await expect(qualifyPersistedBilateralProdatOutboundOriginal((await getEdielMessageById(f.original.id))!,f.currentExecutor)).rejects.toMatchObject({code:'42501'})
},120000)
it('a real clock-scoped prepare DENY becoming active during last audit write rolls back original, witness, receipt and intent binding',async()=>{
 const f=await nationalRescissionArtifact(),approved=await reviewSupplyRescission({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId,...f.review}),creator=nationalNativeOperator(f.companyId,['communication.write','metering.write','contracts.read']),cleanup=installNationalLastWriteDeny(f.companyId,creator,'ediel.supply_rescission.original_registered','communication.write')
 try{await expect(prepareAndQueueSupplyRescissionZ08({companyId:f.companyId,actorUserId:creator,mandateId:String(approved.mandateId),preferredRouteId:f.routeId})).rejects.toMatchObject({message:expect.stringContaining('supply_rescission_terminal_producer_forbidden')});expect(sql(`SELECT jsonb_build_object('operations',(SELECT count(*) FROM gridex_supply_rescission.outbound_operations WHERE company_id=${literal(f.companyId)}),'receipts',(SELECT count(*) FROM gridex_supply_rescission.outbound_receipts WHERE company_id=${literal(f.companyId)}),'consumptions',(SELECT count(*) FROM gridex_ediel_outbound_owner.consumptions WHERE company_id=${literal(f.companyId)} AND source_message_id IN(SELECT id FROM public.ediel_messages WHERE source_operation_id=${literal(approved.mandateId)})),'boundIntents',(SELECT count(*) FROM public.ediel_message_intents WHERE company_id=${literal(f.companyId)} AND operation_id=${literal(approved.mandateId)} AND ediel_message_id IS NOT NULL))`)).toEqual({operations:0,receipts:0,consumptions:0,boundIntents:0})}finally{cleanup()}
},120000)
it('a real clock-scoped current executor DENY during final end audit rolls back period/history/end receipt and business-watch fulfillment',async()=>{
 const f=await receivedNationalRescissionEnd(true,true),source=(await getEdielMessageById(f.endSourceId))!
 // The apply admits only a persisted accepted canonical assessment.
 expect(await recordReceivedSourceValidation({original:source,validated:source,resolvedCompanyId:f.companyId,decision:await resolveCanonicalRuntimeDecisionWithRegistry(source)})).toMatchObject({status:'recorded'})
 const before=nationalEndEffects(f),cleanup=installNationalLastWriteDeny(f.companyId,f.currentExecutor,'ediel.supply_rescission.end_applied','metering.write')
 try{expect(()=>sql(`SELECT public.ediel_apply_supply_source_v1(${literal(f.companyId)},${literal(f.endSourceId)},${literal(f.currentExecutor)})`)).toThrow('supply_rescission_post_write_actor_forbidden');expect(nationalEndEffects(f)).toEqual(before)}finally{cleanup()}
},120000)
