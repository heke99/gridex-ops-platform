import {createClient} from '@supabase/supabase-js'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const effects=vi.hoisted(()=>({smtp:vi.fn()}))
// Only the external delivery/notification endpoints are bounded. Contract,
// Storage, canonical source, business SQL, GoTrue, archive and review are real.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:effects.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {createRequestedChangeSupplyFixture} from './helpers/ediel-requested-change-native-fixture'
import {archiveRequestedChangeSource,reviewRequestedChangeArtifact,readRequestedChangeArtifact,type RequestedChangeSourceSubmission} from '@/lib/ediel/production/requestedChangeIntake'
import {readRequestedChangeSource} from '@/lib/ediel/production/requestedChangeSource'
import {prepareAndQueueProdatRequestedChange} from '@/lib/ediel/flows/prodatRequestedChange'
import {writeBrowserFixture} from './helpers/browserFixture'
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();effects.smtp.mockReset()})
async function actor(company:string,keys:string[]){
 const email=`rcs-${randomUUID()}@example.invalid`,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD!
 const created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull();const id=created.data.user!.id,role=randomUUID(),key=`rcs_${role}`
 sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},'Disposable source operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.roles(id,key,name,scope) VALUES(${literal(role)},${literal(key)},'Disposable source role','company');
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(id)},'member','active',now(),'member',true,now(),'member');
 INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${literal(id)},${literal(company)},${literal(role)},${literal(key)},'active',true);
 INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT ${literal(role)},${literal(key)},id,key FROM public.permissions WHERE key=ANY(ARRAY[${keys.map(literal).join(',')}]);`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}}),login=await client.auth.signInWithPassword({email,password});expect(login.error).toBeNull()
 const context=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:company});expect(context.error).toBeNull();expect(context.data).toMatchObject({authorized:true,selected_company_id:company});for(const k of keys)expect((context.data as {permissions:string[]}).permissions).toContain(k)
 return {id,email}
}
it('actual archived issuer source, separate native review, qualified Z09 queue and interactive browser continuity',async()=>{
 const path=process.env.GRIDEX_RCS_FIXTURE_PATH!
 if(process.env.GRIDEX_RCS_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as {companyId:string;browserSourceHash:string;reviewerId:string;nativeEventId:string;pointId:string;supplySource:string}
  const artifacts=sql<{id:string;eventId:string;submittedBy:string;reviewedBy:string;bytesHash:string}[]>(`SELECT jsonb_agg(jsonb_build_object('id',a.id,'eventId',o.event_id,'submittedBy',a.submitted_by,'reviewedBy',r.reviewer_user_id,'bytesHash',encode(sha256(a.source_bytes),'hex'))) FROM gridex_requested_changes.artifacts a JOIN gridex_requested_changes.review_origins o ON o.artifact_id=a.id JOIN gridex_requested_changes.reviews r ON r.id=o.review_id WHERE a.company_id=${literal(f.companyId)} AND a.source_hash=${literal(f.browserSourceHash)}`)
  expect(artifacts).toHaveLength(1);expect(artifacts[0].reviewedBy).toBe(f.reviewerId);expect(artifacts[0].submittedBy).not.toBe(artifacts[0].reviewedBy);expect(artifacts[0].bytesHash).toBe(f.browserSourceHash)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_code='Z09' AND source_operation_id IN(${literal(f.nativeEventId)},${literal(artifacts[0].eventId)})`)).toBe(2)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_code='Z09' AND status='sent'`)).toBe(0)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND metering_point_id=${literal(f.pointId)} AND source_message_id=${literal(f.supplySource)}`)).toBe(1)
  return
 }
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createRequestedChangeSupplyFixture(email=>effects.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))
 const read=['communication.read','customers.read'],write=[...read,'communication.write','customers.write','communication.send','operations.read','operations.write','contracts.read','contracts.write']
 const submitter=await actor(f.companyId,[...write,'ediel.source.review']),reviewer=await actor(f.companyId,[...write,'ediel.source.review']),reader=await actor(f.companyId,read),foreign=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreign)},'Disposable foreign source company','active')`);const outsider=await actor(foreign,write)
 const route=randomUUID(),profile=randomUUID()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(route)},${literal(f.companyId)},'Disposable requested change','customer_masterdata',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code) VALUES(${literal(profile)},${literal(f.companyId)},${literal(route)},'Disposable requested change','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid','PRODAT','Z09')`)
 const identity={id:f.customerIdentity.id,qualifier:'SE1' as const,agency:'260' as const},customerIdentity={...identity,name:'SYNTHETIC SOURCE CUSTOMER',addressLines:['SYNTHETIC ROAD 1'],city:'TEST',postalCode:'12345',country:'SE'},effectiveAt='2026-10-01T12:00:00Z',keyId=randomUUID(),representationId=randomUUID(),secret=Buffer.from('SYNTHETIC issuer key only 012345678901234567890123456789'),competence=hash(Buffer.from('SYNTHETIC external issuer competence only'))
 // Explicit external-issuer fixture boundary. No real key or approved private
 // source/event/review is seeded, and no real legal competence is claimed.
 sql(`INSERT INTO gridex_requested_changes.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES(${literal(keyId)},${literal(f.companyId)},'test','SYNTHETIC','SYNTHETIC COMPETENCE ONLY',${literal(competence)},decode('${secret.toString('hex')}','hex'),'2020-01-01','2099-01-01');
 INSERT INTO gridex_requested_changes.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,permitted_kind,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},'death','SYNTHETIC REPRESENTATION ONLY',${literal(competence)},'2020-01-01','2099-01-01')`)
 function submission(reference:string,bytes:Buffer,withReceipt=true):RequestedChangeSourceSubmission{
  const address={lines:['SYNTHETIC ROAD 1','',''] as [string,string,string],city:'TEST',postalCode:'12345',country:'SE',representation:{convention:'originalunderlag',reference,mode:1 as const}}
  const receiptBytes=Buffer.from(JSON.stringify({format:'ediel_requested_change_issuer_receipt_v1',issuerCode:'SYNTHETIC',receiptId:randomUUID(),companyId:f.companyId,environment:'test',legalActorId:f.actorUserId,customerId:f.customerId,meteringPointId:f.pointId,kind:'death',effectiveAt,sourceHash:hash(bytes),sourceReference:reference,sourceVersion:'1',customerIdentity,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}))
  return {supplyPeriodId:f.period,contractId:f.contractId,kind:'death',effectiveAt,source:{bytesBase64:bytes.toString('base64'),mimeType:'text/plain',reference,version:'1'},customerIdentity,invoiceeProfile:{meteringPointId:f.external,identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:[customerIdentity.name],address,availability:'available'},event:{state:'none',reference},source:{kind:'caller_selection',companyId:f.companyId,reference}},...(withReceipt?{issuerReceipt:{keyId,representationId,payloadBase64:receiptBytes.toString('base64'),signatureHex:createHmac('sha256',secret).update(receiptBytes).digest('hex')}}:{})}
 }
 const pending=await archiveRequestedChangeSource({...submission('SYNTHETIC MISSING ISSUER',Buffer.from('SYNTHETIC held source'),false),companyId:f.companyId,actorUserId:submitter.id})
 const held=await reviewRequestedChangeArtifact({artifactId:pending.artifactId,sourceHash:pending.sourceHash,claimsHash:pending.claimsHash,companyId:f.companyId,actorUserId:reviewer.id,decision:'approve',reason:'Synthetic independent missing issuer control'});expect(held.status).toBe('held')
 const native=await archiveRequestedChangeSource({...submission('SYNTHETIC NATIVE SOURCE',Buffer.from('SYNTHETIC native issuer source')),companyId:f.companyId,actorUserId:submitter.id})
 await expect(reviewRequestedChangeArtifact({artifactId:native.artifactId,sourceHash:native.sourceHash,claimsHash:native.claimsHash,companyId:f.companyId,actorUserId:submitter.id,decision:'approve',reason:'Synthetic self review forbidden'})).rejects.toBeTruthy()
 const approved=await reviewRequestedChangeArtifact({artifactId:native.artifactId,sourceHash:native.sourceHash,claimsHash:native.claimsHash,companyId:f.companyId,actorUserId:reviewer.id,decision:'approve',reason:'Synthetic separate native mechanism review'});expect(approved.status).toBe('authorized');if(approved.status!=='authorized')throw Error('native_source_not_authorized')
 expect((await readRequestedChangeSource({companyId:f.companyId,eventId:approved.eventId,actorUserId:submitter.id})).status).toBe('authorized')
 const queued=await prepareAndQueueProdatRequestedChange({companyId:f.companyId,eventId:approved.eventId,actorUserId:submitter.id,preferredRouteId:route});expect(queued.status).toBe('queued')
 expect((await prepareAndQueueProdatRequestedChange({companyId:f.companyId,eventId:approved.eventId,actorUserId:submitter.id,preferredRouteId:route})).status).toBe('existing')
 await expect(readRequestedChangeArtifact({companyId:foreign,artifactId:native.artifactId,actorUserId:outsider.id})).rejects.toBeTruthy()
 const browserBytes=Buffer.from('SYNTHETIC browser issuer original source'),browser=submission('SYNTHETIC BROWSER SOURCE',browserBytes)
 writeBrowserFixture(path,{companyId:f.companyId,pointId:f.pointId,supplySource:f.source,periodId:f.period,contractId:f.contractId,external:f.external,submitterEmail:submitter.email,reviewerEmail:reviewer.email,reviewerId:reviewer.id,readerEmail:reader.email,outsiderEmail:outsider.email,nativeArtifactId:native.artifactId,nativeEventId:approved.eventId,browserSourceHash:hash(browserBytes),browser,sourceText:browserBytes.toString()},{mode:0o600})
})
