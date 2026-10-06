// Reused completed national end producer. Importing this module registers no
// tests and creates no facts, sources, accepted decisions or business effects.
import {randomUUID} from 'node:crypto'
import {expect,type Mock} from 'vitest'
import {nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {guideOrderedFixtureRaw} from '../../__tests__/helpers/prodatGuideOrderedFixture'
import {line,characteristic,type Parts} from '../../__tests__/fixtures/prodat-register'
import {head} from '../../__tests__/fixtures/prodat-identity'
import type {nationalRescissionNativeChain} from './nationalRescissionNative'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './originalMailboxNative'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'

// Candidate controls act before immutable received-source birth. Observe mode
// returns the actual canonical decision; it never labels an invalid input accepted.
export type ReceivedEndCandidate = {
 lineItemReference?:string; endDate?:string;
 transformParts?:(parts:Parts[])=>Parts[];
 qualification?:'observe';
 retainOriginalMailbox?:boolean;
}
export function nationalEndNativeChain(deps:{
 nationalRescissionOperation:ReturnType<typeof nationalRescissionNativeChain>['nationalRescissionOperation']; provider:Mock
}) {
 const {nationalRescissionOperation,provider}=deps
async function receivedNationalRescissionEnd(sent:boolean,separatePrincipals=false,candidate:ReceivedEndCandidate={}){
 const f=await nationalRescissionOperation(separatePrincipals)
 if(sent){provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-national-H-original',response:'250 synthetic accepted'});await sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.currentExecutor,smtpMimeMode:'nodemailer-attachment'})}
 const sourceId=randomUUID(),own:Parts[]=[...head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE']:p),line('1',f.external,undefined,'9'),['DTM',['93',candidate.endDate ?? '202610161330','203']],...characteristic('Z13','Z22'),['RFF',['LI',candidate.lineItemReference ?? f.li]],['RFF',['Z05',f.gridAreaCode]],['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE'],['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.brpEdielId,'160','SVK']]]
 const wire=guideOrderedFixtureRaw(candidate.transformParts?.(own) ?? own,'Z05').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`).replace("++23-DDQ-PRODAT'","++23-DDQ-PRODAT++1++1'").replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')([\s\S]*UNZ\+1\+)I'/,(_,unb:string,mid:string)=>{const id=`I${randomUUID().replaceAll('-','').slice(0,12)}`;return `+${id}${unb}${mid}${id}'`}) /* own interchange per inbound */
 const mail=candidate.retainOriginalMailbox?await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,smtpFrom:edielSmtpConfig().from}):null
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id${mail?',interchange_reference,inbound_email_message_id,mailbox_message_id':''},canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot) SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)}${mail?','+literal(mail.parsed.interchangeReference)+','+literal(mail.inboundEmailMessageId)+','+literal(mail.inboundEmailMessageId):''},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z05:L:26.A:r3' AND profile.is_enabled;`)
 if(mail)await recordOriginalMailboxNativeReception({...mail,companyId:f.companyId,sourceMessageId:sourceId,actorUserId:f.actorUserId})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry((await getEdielMessageById(sourceId))!);if(candidate.qualification!=='observe')expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 return{...f,endSourceId:sourceId,endWire:wire,decision}
}
function nationalEndEffects(f:{companyId:string;periodId:string;endSourceId:string}){return sql(`SELECT jsonb_build_object('period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.endSourceId)}),'ends',(SELECT count(*) FROM gridex_supply_rescission.end_receipts WHERE source_message_id=${literal(f.endSourceId)}),'positive',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(f.endSourceId)} AND message_family='APERAK' AND raw_payload LIKE '%ERC+100%'),'followups',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.endSourceId)}),'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND action='ediel.supply_rescission.end_applied'),'watches',(SELECT jsonb_agg(jsonb_build_object('source',source_message_id,'code',expected_code,'subtype',expected_subtype,'status',status,'fulfilledBy',fulfilled_by_message_id,'dueAt',due_at) ORDER BY id) FROM public.ediel_business_expectations WHERE company_id=${literal(f.companyId)} AND expected_code='Z05'))`)}
 return {receivedNationalRescissionEnd,nationalEndEffects}
}
