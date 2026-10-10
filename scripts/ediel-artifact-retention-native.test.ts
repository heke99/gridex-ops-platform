import {createClient} from '@supabase/supabase-js'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
const effects=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:effects.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {createRequestedChangeSupplyFixture} from './helpers/ediel-requested-change-native-fixture'
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();effects.smtp.mockReset()})
/** Actual local signed contract→rendered/archived/accepted Z03→canonical Z04
 * source→business owner. No private accepted supply/source record is seeded. */
async function actualSupply(){
 for(const [k,v] of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 return createRequestedChangeSupplyFixture(email=>effects.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}),{requestedStartDate:'2026-09-24'})
}
async function user(company:string,permissions:string[]){
 const email=randomUUID()+'@example.invalid',password=randomUUID()+'Aa1!'
 const created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull();const id=created.data.user!.id
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(id)},'member','active',now(),'{}','member',true,now(),'member');INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},'Synthetic native actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(id)},${literal(company)},id,key FROM public.permissions WHERE key=ANY(ARRAY[${permissions.map(literal).join(',')}])`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});const signed=await client.auth.signInWithPassword({email,password});expect(signed.error).toBeNull();return {id,client}
}
/** Legal issuer/receipt is synthetic mechanism evidence only. The source bytes
 * use actual archive RPC on an actual owned supply; missing death issuer remains
 * held. This test cannot approve any real legal deadline or customer death. */
it('native authenticated source-byte lifecycle retains immutable continuity and cannot bypass current review or cross-company scope',async()=>{
 const f=await actualSupply(),submitter=await user(f.companyId,['communication.write','communication.read','customers.read','customers.write','ediel.retention.submit','ediel.retention.purge','ediel.retention.source_bytes']),reviewer=await user(f.companyId,['ediel.retention.review','ediel.retention.source_bytes'])
 const bytes=Buffer.from('SYNTHETIC pending death candidate. No actual death issuer.'),identity=f.customerIdentity,address={lines:['SYNTHETIC ROAD 1','',''],city:'TEST',postalCode:'12345',country:'SE',representation:{convention:'SOURCE',reference:'SYNTHETIC',mode:1}}
 const archived=await supabaseService.rpc('ediel_archive_requested_change_source_v1',{p_company_id:f.companyId,p_actor_user_id:submitter.id,p_submission:{supplyPeriodId:f.period,contractId:f.contractId,kind:'death',effectiveAt:'2026-10-01T12:00:00Z',source:{bytesBase64:bytes.toString('base64'),mimeType:'text/plain',reference:'SYNTHETIC PENDING SOURCE',version:'1'},customerIdentity:{...identity,name:'SYNTHETIC OWN CUSTOMER',addressLines:['SYNTHETIC ROAD 1'],city:'TEST',postalCode:'12345',country:'SE'},invoiceeProfile:{meteringPointId:f.external,identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['SYNTHETIC OWN CUSTOMER'],address,availability:'available'},event:{state:'none',reference:'SYNTHETIC'},source:{kind:'caller_selection',companyId:f.companyId,reference:'SYNTHETIC'}}}})
 expect(archived.error).toBeNull();const a=archived.data as {artifactId:string;sourceHash:string;claimsHash:string;status:string;missing:string[]};expect(a.status).toBe('archived');expect(a.sourceHash).toBe(hash(bytes));expect(a.missing).toContain('authentic_current_issuer_and_representation_receipt')
 const document=Buffer.from('SYNTHETIC class-specific byte-retention decision; no real legal authority'),issuer=randomUUID(),legal=Buffer.from('SYNTHETIC issuer competence mechanism only'),key=Buffer.from('SYNTHETIC ONLY retention HMAC key 01234567890123456789')
 sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},'SYNTHETIC COMPETENCE ONLY',decode('${legal.toString('hex')}','hex'),${literal(hash(legal))},decode('${key.toString('hex')}','hex'),'2020-01-01','2099-01-01')`)
 const payload=Buffer.from(JSON.stringify({format:'ediel_retention_policy_v1',retentionClass:'requested_change_source_artifact_bytes',companyId:f.companyId,artifactId:a.artifactId,sourceHash:a.sourceHash,claimsHash:a.claimsHash,documentHash:hash(document),issuerLegalReference:'SYNTHETIC COMPETENCE ONLY',legalBasisReference:'SYNTHETIC class-specific deadline',issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString()})),receipt={issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
 const submitted=await submitter.client.rpc('ediel_submit_artifact_retention_v1',{p_company_id:f.companyId,p_actor_user_id:submitter.id,p_artifact_id:a.artifactId,p_document_base64:document.toString('base64'),p_issuer_receipt:receipt});expect(submitted.error).toBeNull();expect(submitted.data.issuerQualified).toBe(true);const decisionId=submitted.data.decisionId
 const review=await reviewer.client.rpc('ediel_review_artifact_retention_v1',{p_company_id:f.companyId,p_actor_user_id:reviewer.id,p_decision_id:decisionId,p_outcome:'approve',p_reason:'SYNTHETIC separate mechanism review'});expect(review.error).toBeNull();expect(review.data.status).toBe('approved')
 const parameters={p_company_id:f.companyId,p_actor_user_id:submitter.id,p_decision_id:decisionId}
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(reviewer.id)},${literal(f.companyId)},'ediel.retention.review','deny',true)`)
 const denied=await submitter.client.rpc('ediel_purge_artifact_retention_v1',parameters);expect(denied.error).toBeNull();expect(denied.data.status).toBe('held');expect(sql(`SELECT to_jsonb(source_bytes IS NOT NULL) FROM gridex_requested_changes.artifacts WHERE id=${literal(a.artifactId)}`)).toBe(true)
 sql(`DELETE FROM public.user_permission_overrides WHERE user_id=${literal(reviewer.id)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.retention.review'`)
 expect((await submitter.client.rpc('ediel_purge_artifact_retention_v1',{...parameters,p_company_id:randomUUID()})).error).not.toBeNull()
 const purged=await submitter.client.rpc('ediel_purge_artifact_retention_v1',parameters);expect(purged.error).toBeNull();expect(purged.data).toMatchObject({status:'purged',artifactId:a.artifactId,sourceHash:a.sourceHash,byteLength:bytes.length,replay:false})
 expect((await submitter.client.rpc('ediel_purge_artifact_retention_v1',parameters)).data.replay).toBe(true)
 expect(sql(`SELECT jsonb_build_object('bytesAbsent',source_bytes IS NULL,'hash',source_hash,'claimsHash',claims_hash,'byteLength',source_byte_length,'tombstone',purged_at IS NOT NULL) FROM gridex_requested_changes.artifacts WHERE id=${literal(a.artifactId)}`)).toEqual({bytesAbsent:true,hash:a.sourceHash,claimsHash:a.claimsHash,byteLength:bytes.length,tombstone:true})
 const read=await supabaseService.rpc('ediel_read_requested_change_artifact_v1',{p_company_id:f.companyId,p_artifact_id:a.artifactId,p_actor_user_id:submitter.id,p_include_bytes:false});expect(read.error).toBeNull();expect(read.data.status).toBe('held');expect(read.data.byteLength).toBe(bytes.length)
 expect(sql(`SELECT jsonb_build_object('supply',EXISTS(SELECT FROM public.customer_supply_periods WHERE id=${literal(f.period)}),'source',EXISTS(SELECT FROM gridex_received_sources.sources WHERE source_message_id=${literal(f.source)} AND raw_payload IS NOT NULL),'audit',(SELECT count(*) FROM public.audit_logs WHERE entity_id=${literal(a.artifactId)} AND action='ediel.retention.bytes_purged'))`)).toEqual({supply:true,source:true,audit:1})
},60000)
