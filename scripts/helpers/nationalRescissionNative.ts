// Shared native chain: genuine H start, received H Z04, authenticated national
// legal original, independent review, mandate and real Z08 H rescission original.
// Test files keep their own hoisted mocks (provider, session) and pass them in.
import {expect,vi,type Mock} from 'vitest'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'

import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {createBilateralProdatGroundNativeFixture} from './ediel-bilateral-prodat-profile-native-fixture'
import {archiveBilateralProdatGround,reviewBilateralProdatGround} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'


import {getEdielMessageById} from '@/lib/ediel/db'
import {supabaseService} from '@/lib/supabase/service'

import {guideOrderedFixtureRaw} from '../../__tests__/helpers/prodatGuideOrderedFixture'
import {line,qty,common,characteristic,type Parts} from '../../__tests__/fixtures/prodat-register'
import {head} from '../../__tests__/fixtures/prodat-identity'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'


import {prepareAndQueueSupplyRescissionZ08} from '@/lib/ediel/flows/prodatSupplyRescission'
import {readSupplyRescissionScope,archiveSupplyRescission,reviewSupplyRescission} from '@/lib/ediel/production/supplyRescissionIntake'

export function nationalRescissionNativeChain(deps:{provider:Mock;sourceSession:{client:SupabaseClient|null};customerName?:string}){
 const {provider,sourceSession}=deps
async function stage(){const f=await seedNormalSwitchNativeFixture({requestedStartDate:'2026-10-15',deferOriginal:true,initialSubtype:'H',customerName:deps.customerName});sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN('communication.read','communication.write','communication.send','contracts.read','metering.read','metering.write');`);return f}
async function authorized(){
 const f=await createBilateralProdatGroundNativeFixture(await stage()),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Independent review of synthetic original; mechanism only'})
 expect(review.status,JSON.stringify(review)).toBe('authorized');return {...f,profileVersionId:String(review.profileVersionId)}
}
const originate=(f:{actorUserId:string;switchId:string;routeId:string})=>prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
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
function nationalNativeOperator(companyId:string,permissions:string[]){
 const actor=randomUUID(),email=`h-operator-${actor}@example.invalid`
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(email)},now(),'{}','{}',now(),now(),false,false);INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(email)},'Synthetic native H phase operator','active');INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(actor)},${literal(companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN(${permissions.map(literal).join(',')});`)
 return actor
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
 return {stage,authorized,originate,receivedHStart,actualNationalSourceSession,nationalRescissionArtifact,nationalNativeOperator,nationalRescissionOperation}
}
