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
