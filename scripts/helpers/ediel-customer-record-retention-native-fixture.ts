// Genuine local publication/signature/PDF/POA/Z03 and canonical onboarding
// owners. Only SMTP and legal competence are explicit synthetic boundaries;
// private accepted/ready/source-retention rows are never seeded.
import {createClient} from '@supabase/supabase-js'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {expect,vi} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {onboardCustomerGraph} from '@/lib/customers/canonicalOnboarding'
import {createTenantContext} from '@/lib/tenant/context'
import {CUSTOMER_RECORD_RETENTION_CLASSES,type CustomerRecordRetentionClass} from '@/lib/ediel/retention/recordClasses.catalog'
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
const allClasses=['ediel.retention.contract_pdf','ediel.retention.signature','ediel.retention.address_history','ediel.retention.portal_history','ediel.retention.legal_history']
async function user(company:string,permissions:string[],inputPassword?:string){
 const email=randomUUID()+'@example.invalid',password=inputPassword??randomUUID()+'Aa1!',created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull();const id=created.data.user!.id
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(id)},'member','active',now(),'{}','member',true,now(),'member');INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},'Synthetic native actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(id)},${literal(company)},id,key FROM public.permissions WHERE key=ANY(ARRAY[${permissions.map(literal).join(',')}]::text[])`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}}),signed=await client.auth.signInWithPassword({email,password});expect(signed.error).toBeNull();expect((await client.auth.getUser()).data.user?.id).toBe(id);expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM public.admin_users WHERE user_id=${literal(id)} AND is_active))`)).toBe(false);return {id,client,email}
}
export {user as createCustomerRecordRetentionNativeUser}
export async function seedCustomerRecordRetentionNativeFixture(input:{provider:(email:string)=>void;password?:string}){
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await seedNormalSwitchNativeFixture({provider:input.provider})
 // Real canonical command owns the onboarding legal snapshot. Its supplied
 // acceptance is an explicit synthetic customer boundary, not a legal approval.
 const onboarding=await onboardCustomerGraph({company_id:f.companyId,actor_user_id:f.actorUserId,channel:'admin',idempotency_key:'retention-'+randomUUID(),matching_policy:'link_selected',existing_customer_id:f.customerId,update_existing:false,customer:{personal_number:f.customerIdentity.id},legal:{accepted_at:new Date().toISOString(),acceptance_snapshot:{syntheticPerson:'SYNTHETIC SOURCE ONLY'},signed_scopes:[]}},createTenantContext({companyId:f.companyId,actorType:'user',actorId:f.actorUserId,sourceChannel:'admin',permissions:['customers.write']}));expect(onboarding.ok).toBe(true);if(!onboarding.ok)throw Error('actual_onboarding_snapshot_required');expect(onboarding.legal_snapshot_id).toBeTruthy()
 const history={address:randomUUID(),event:randomUUID(),access:randomUUID(),customerEvent:randomUUID(),domain:randomUUID()}
 sql(`INSERT INTO public.customer_addresses(id,company_id,customer_id,type,street_1,postal_code,city,is_active,moved_out_at,metadata) VALUES(${literal(history.address)},${literal(f.companyId)},${literal(f.customerId)},'registered','SYNTHETIC ROAD','12345','TEST',false,'2020-01-01','{"synthetic":"person"}');
 INSERT INTO public.customer_portal_events(id,company_id,customer_id,user_id,event_type,payload,metadata) VALUES(${literal(history.event)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.actorUserId)},'synthetic.history','{"synthetic":"person"}','{}');
 INSERT INTO public.customer_portal_api_access_logs(id,company_id,customer_id,external_customer_id,route,action,metadata) VALUES(${literal(history.access)},${literal(f.companyId)},${literal(f.customerId)},'SYNTHETIC','/synthetic','read','{"synthetic":"person"}');
 INSERT INTO public.customer_events(id,company_id,customer_id,event_type,external_customer_id,customer_number,payload,metadata) VALUES(${literal(history.customerEvent)},${literal(f.companyId)},${literal(f.customerId)},'customer.synthetic_history','SYNTHETIC','SYNTHETIC','{"synthetic":"person"}','{}');
 INSERT INTO public.domain_events(id,company_id,subject_customer_id,actor_user_id,event_type,aggregate_type,aggregate_id,payload) VALUES(${literal(history.domain)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.actorUserId)},'customer.synthetic_history','customer',${literal(f.customerId)},'{"synthetic":"person"}');`)
 // Closed status and absent supply below are public local fixture facts. No
 // accepted private supply/source/retention receipt is seeded or represented as
 // a real closure or issuer decision.
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)}`)).toBe(0)
 sql(`UPDATE public.customers SET status='archived' WHERE id=${literal(f.customerId)};UPDATE public.companies SET status='archived' WHERE id=${literal(f.companyId)}`)
 const submitter=await user(f.companyId,['ediel.retention.submit','ediel.retention.review','ediel.retention.purge',...allClasses],input.password),reviewer=await user(f.companyId,['ediel.retention.review',...allClasses],input.password)
 const issuer=randomUUID(),key=Buffer.from('SYNTHETIC ONLY legal competence HMAC 01234567890123456789'),legal=Buffer.from('SYNTHETIC ONLY competence mechanism. NO actual legal policy approval.')
 sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},'SYNTHETIC COMPETENCE ONLY',decode('${legal.toString('hex')}','hex'),${literal(digest(legal))},decode('${key.toString('hex')}','hex'),'2020-01-01','2099-01-01')`)
 const one=(table:string,filter:string)=>sql<string>(`SELECT to_jsonb(id) FROM public.${table} WHERE company_id=${literal(f.companyId)} AND ${filter} ORDER BY id LIMIT 1`)
 const targets:Record<CustomerRecordRetentionClass,string>={contract_signed_pdf_bytes:one('customer_contract_documents',`customer_contract_id=${literal(f.contractId)} AND document_type='signed_contract_pdf'`),contract_signature_personal_snapshot:f.contractId,contract_signature_request_personal:one('customer_contract_signature_requests',`customer_contract_id=${literal(f.contractId)}`),contract_acceptance_personal_snapshot:one('customer_contract_acceptances',`customer_contract_id=${literal(f.contractId)}`),contract_evidence_personal_snapshot:one('customer_contract_evidence',`customer_contract_id=${literal(f.contractId)}`),customer_address_history:history.address,portal_event_history:history.event,portal_access_log_history:history.access,portal_customer_event_history:history.customerEvent,portal_domain_event_history:history.domain,legal_acceptance_personal_snapshot:one('customer_legal_acceptances',`contract_id=${literal(f.contractId)}`),onboarding_legal_personal_snapshot:onboarding.legal_snapshot_id!}
 for(const k of CUSTOMER_RECORD_RETENTION_CLASSES)expect(targets[k],`actual source missing ${k}`).toMatch(/^[a-f0-9-]{36}$/)
 const policy=(k:CustomerRecordRetentionClass,document:Buffer,extra:Record<string,unknown>={})=>{
  const basis=sql<Record<string,unknown>>(`SELECT gridex_ediel_retention.record_basis_v1(${literal(f.companyId)},${literal(k)},${literal(targets[k])})`),payload=Buffer.from(JSON.stringify({format:'ediel_customer_record_retention_policy_v1',...basis,documentHash:digest(document),issuerLegalReference:'SYNTHETIC COMPETENCE ONLY',legalBasisReference:'SYNTHETIC per-class exact source deadline',journalPurposeReference:'SYNTHETIC minimal immutable continuity',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString(),...extra}));return {issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
 }
 return {...f,submitter,reviewer,targets,policy}
}
