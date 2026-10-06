// Shared completed LK producer sequence. No tests register on import; callers
// keep their own actual source-session and finite SMTP/P16B transport hooks.
import {randomUUID} from 'node:crypto'
import {expect,type Mock} from 'vitest'
import {nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {createBilateralProdatGroundNativeFixture} from './ediel-bilateral-prodat-profile-native-fixture'
import {archiveBilateralProdatGround,reviewBilateralProdatGround} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {prepareBilateralClosureOperation} from '@/lib/ediel/production/bilateralProdatClosureOperation'
import {prepareAndQueueBilateralClosureZ08} from '@/lib/ediel/flows/prodatBilateralClosure'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {guideOrderedFixtureRaw} from '../../__tests__/helpers/prodatGuideOrderedFixture'
import {line,characteristic,type Parts} from '../../__tests__/fixtures/prodat-register'
import {head} from '../../__tests__/fixtures/prodat-identity'
import type {nationalRescissionNativeChain} from './nationalRescissionNative'
import type {ReceivedEndCandidate} from './ediel-national-end-native-fixture'

export function bilateralClosureNativeChain(deps:{
 receivedHStart: ReturnType<typeof nationalRescissionNativeChain>['receivedHStart']; provider: Mock
}) {
 const {receivedHStart,provider}=deps
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
async function receivedLkEnd(sent:boolean, candidate:ReceivedEndCandidate = {}){
 const f=await lkOperation()
 if(sent){provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-LK-original',response:'250 synthetic accepted'});await sendEdielMessageViaSmtp((await getEdielMessageById(f.original.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})}
 const sourceId=randomUUID(),own:Parts[]=[...head().map(p=>p[0]==='NAD'&&p[1]==='FR'?['NAD','FR',[f.receiver,'160','SVK'],'','','','','','','SE']:p[0]==='NAD'&&p[1]==='DO'?['NAD','DO',[f.sender,'160','SVK'],'','','','','','','SE']:p),line('1',f.external,undefined,'9'),['DTM',['93',candidate.endDate ?? '202610161330','203']],...characteristic('Z13','Z23'),['RFF',['LI',candidate.lineItemReference ?? f.basis.lineItemReference]],['RFF',['Z05',f.gridAreaCode]],['NAD','UD',[f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency],'','Synthetic','Street','City','','12345','SE'],['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.brpEdielId,'160','SVK']]]
 const wire=guideOrderedFixtureRaw(candidate.transformParts?.(own) ?? own,'Z05').replace('+S+R+',`+${f.receiver}:14+${f.sender}:14+`).replace("++23-DDQ-PRODAT'","++23-DDQ-PRODAT++1++1'").replace(/\+I(\+\+23-DDQ-PRODAT\+\+1\+\+1')([\s\S]*UNZ\+1\+)I'/,(_,unb:string,mid:string)=>{const id=`I${randomUUID().replaceAll('-','').slice(0,12)}`;return `+${id}${unb}${mid}${id}'`}) /* own interchange per inbound */
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot) SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z05:LK:26.A:r3' AND profile.is_enabled;`)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry((await getEdielMessageById(sourceId))!);if(candidate.qualification!=='observe')expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 return{...f,sourceId,wire,decision}
}
function lkEffects(f:{companyId:string;periodId:string;sourceId:string}){return sql(`SELECT jsonb_build_object('period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}),'ends',(SELECT count(*) FROM gridex_bilateral_prodat.closure_end_receipts WHERE source_message_id=${literal(f.sourceId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}),'positive',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)} AND message_family='APERAK' AND raw_payload LIKE '%ERC+100%'),'followups',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.sourceId)}),'audits',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND action='ediel.bilateral_profile.closure_applied' AND entity_id=${literal(f.sourceId)}))`)}
 return {lkOperation,receivedLkEnd,lkEffects}
}
