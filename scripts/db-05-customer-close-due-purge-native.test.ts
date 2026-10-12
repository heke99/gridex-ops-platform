// masterplan: DB-05
// Mechanism proof only: synthetic people, manual retained history and explicit
// synthetic legal competence. This neither decides a lawful retention period
// nor approves DB-05, AT-DB-05 or SC-070. C3 consumes this single native chain.
import {execFileSync,spawn} from 'node:child_process'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {createClient} from '@supabase/supabase-js'
import {expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {canonicalPortalCustomer} from '@/lib/customer-portal/customerLifecycle'

const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function sql<T>(input:string):T {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('db05_owned_local_only')
 const output=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
  input,encoding:'utf8',timeout:10000,maxBuffer:2_000_000,
 }).trim()
 return output?JSON.parse(output) as T:undefined as T
}
function customerLock(company:string,customer:string) {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('db05_owned_local_only')
 const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 let output='',errors='',acquired=false
 let resolveReady:(pid:number)=>void=()=>{},rejectReady:(error:Error)=>void=()=>{}
 const ready=new Promise<number>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
 const timer=setTimeout(()=>{child.kill('SIGTERM');rejectReady(Error('db05_customer_lock_not_observed'))},8000)
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
 child.stdout.on('data',(data:string)=>{
  output+=data
  const marker=/DB05_CUSTOMER_LOCK_HELD:(\d+)/.exec(output)
  if(!acquired&&marker){acquired=true;clearTimeout(timer);resolveReady(Number(marker[1]))}
 })
 child.stderr.on('data',(data:string)=>{errors+=data})
 const done=new Promise<void>((resolve,reject)=>{
  child.on('error',(error:Error)=>{clearTimeout(timer);rejectReady(error);reject(error)})
  child.on('close',(code:number|null)=>{
   clearTimeout(timer)
   if(!acquired)rejectReady(Error('db05_lock_holder_closed_before_marker'))
   if(code===0)resolve();else reject(Error('db05_lock_holder_failed:'+String(code)+':'+errors))
  })
 })
 // Observe a real held row lock; keep stdin open until the caller releases it.
 child.stdin.write(`BEGIN;SELECT id FROM public.customers WHERE id=${literal(customer)} AND company_id=${literal(company)} FOR UPDATE;SELECT 'DB05_CUSTOMER_LOCK_HELD:'||pg_backend_pid();\n`)
 return {ready,done,release:()=>{if(!child.stdin.writableEnded)child.stdin.end('ROLLBACK;\n')}}
}
async function actor(company:string,permissions:string[]) {
 const email=randomUUID()+'@example.invalid',password=randomUUID()+'Aa1!'
 const created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true})
 expect(created.error).toBeNull()
 const id=created.data.user!.id,role=randomUUID(),roleKey='db05_'+role
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
  VALUES(${literal(company)},${literal(id)},'member','active',now(),'{}','member',true,now(),'member');
  INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},'Synthetic DB05 actor','active')
  ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.roles(id,key,name,scope) VALUES(${literal(role)},${literal(roleKey)},'Synthetic DB05 role','company');
  INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active)
  VALUES(${literal(id)},${literal(company)},${literal(role)},${literal(roleKey)},'active',true);
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
  SELECT ${literal(id)},${literal(company)},id,key FROM public.permissions WHERE key=ANY(ARRAY[${permissions.map(literal).join(',')}]);`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
 expect((await client.auth.signInWithPassword({email,password})).error).toBeNull()
 return {id,client}
}
async function fixture(activeSupply=false) {
 const company=randomUUID(),customer=randomUUID(),otherCompany=randomUUID(),otherCustomer=randomUUID()
 const site=randomUUID(),point=randomUUID(),portal=randomUUID(),claim=randomUUID()
 const invoice=randomUUID(),meter=randomUUID(),message=randomUUID(),ack=randomUUID(),journal=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES
  (${literal(company)},'Synthetic DB05 native','active'),(${literal(otherCompany)},'Synthetic DB05 other','active');
  INSERT INTO public.customers(id,company_id,status,customer_type,name,first_name,last_name,full_name,email,personal_number,phone)
  VALUES(${literal(customer)},${literal(company)},'active','private','Synthetic Person','Synthetic','Person','Synthetic Person','synthetic@example.invalid','199001011234','0101234567'),
  (${literal(otherCustomer)},${literal(otherCompany)},'active','private','Other Person','Other','Person','Other Person','other@example.invalid','198001011234','0101111111');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(${literal(site)},${literal(company)},${literal(customer)},'Synthetic site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(${literal(point)},${literal(company)},${literal(customer)},${literal(site)},'735999999999999992','monthly','consumption',true,'active');
  INSERT INTO public.customer_portal_accounts(id,company_id,customer_id,status,is_active,email)
  VALUES(${literal(portal)},${literal(company)},${literal(customer)},'active',true,'synthetic@example.invalid');
  INSERT INTO public.customer_portal_claims(id,company_id,customer_id,status)
  VALUES(${literal(claim)},${literal(company)},${literal(customer)},'active');
  INSERT INTO public.customer_invoices(id,company_id,customer_id,status,source_system)
  VALUES(${literal(invoice)},${literal(company)},${literal(customer)},'paid','manual');
  INSERT INTO public.metering_values(id,company_id,customer_id,site_id,metering_point_id,value_kwh,read_at,period_start,period_end)
  VALUES(${literal(meter)},${literal(company)},${literal(customer)},${literal(site)},${literal(point)},1.25,'2020-01-01','2020-01-01','2020-01-02');
  INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,customer_id,site_id,metering_point_id,message_received_at,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${literal(message)},${literal(company)},'test','inbound','edifact','PRODAT','Z04','received','SYNTHETIC historical original: no market acceptance',${literal(customer)},${literal(site)},${literal(point)},clock_timestamp(),pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
  WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;
  INSERT INTO public.ediel_ack_transaction_results(id,company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result)
  VALUES(${literal(ack)},${literal(company)},'test',${literal(message)},'synthetic-retained-only','pending','pending','pending');
  INSERT INTO public.canonical_audit_events(id,company_id,event_type,aggregate_type,aggregate_id,idempotency_key,metadata)
  VALUES(${literal(journal)},${literal(company)},'synthetic.retained','customer',${literal(customer)},${literal(randomUUID())},'{"fixture":"history only"}');`)
 const lifecycle=await actor(company,['customers.write'])
 const submitter=await actor(company,['customers.write','ediel.retention.submit','ediel.retention.review','ediel.retention.customer_fields'])
 const reviewer=await actor(company,['ediel.retention.review','ediel.retention.customer_fields'])
 const purger=await actor(company,['customers.write','ediel.retention.purge','ediel.retention.customer_fields'])
 const other=await actor(otherCompany,['customers.write','ediel.retention.purge','ediel.retention.customer_fields'])
 if(activeSupply)sql(`INSERT INTO public.customer_supply_periods(company_id,customer_id,metering_point_id,start_date,status,source)
  VALUES(${literal(company)},${literal(customer)},${literal(point)},current_date,'active','manual')`)
 const preserved=()=>sql<Record<string,unknown>>(`SELECT jsonb_build_object(
  'invoice',(SELECT to_jsonb(x) FROM public.customer_invoices x WHERE id=${literal(invoice)}),
  'meter',(SELECT to_jsonb(x) FROM public.metering_values x WHERE id=${literal(meter)}),
  'ack',(SELECT to_jsonb(x) FROM public.ediel_ack_transaction_results x WHERE id=${literal(ack)}),
  'original',(SELECT to_jsonb(x) FROM public.ediel_messages x WHERE id=${literal(message)}),
  'journal',(SELECT to_jsonb(x) FROM public.canonical_audit_events x WHERE id=${literal(journal)}),
  'otherCustomer',(SELECT to_jsonb(x) FROM public.customers x WHERE id=${literal(otherCustomer)}))`)
 const historical=preserved()
 expect(Object.values(historical).every(value=>value!==null)).toBe(true)
 const closureArgs={p_company_id:company,p_customer_id:customer,p_actor_user_id:lifecycle.id,
  p_decision_type:'cancelled',p_scope_type:'customer',p_scope_id:null,
  p_received_at:new Date().toISOString(),p_reason:'SYNTHETIC customer closure'}
 // The lifecycle service boundary refuses ordinary JWTs and mismatched tenant.
 expect((await submitter.client.rpc('gridex_register_customer_lifecycle_decision_v1',closureArgs)).error).not.toBeNull()
 expect((await supabaseService.rpc('gridex_register_customer_lifecycle_decision_v1',{...closureArgs,p_company_id:otherCompany})).error).not.toBeNull()
 const closed=await supabaseService.rpc('gridex_register_customer_lifecycle_decision_v1',closureArgs)
 expect(closed.error).toBeNull()
 expect(closed.data).toMatchObject({scope_type:'customer',effect:{already_archived:false,closed_sites:1,closed_metering_points:1}})
 const customerRow=await supabaseService.from('customers').select('*').eq('id',customer).eq('company_id',company).single()
 expect(customerRow.error).toBeNull()
 expect(customerRow.data).toMatchObject({status:'archived',archived_by:lifecycle.id,lifecycle_status_reason:'SYNTHETIC customer closure'})
 expect(customerRow.data!.archived_at).not.toBeNull()
 // Real native row feeds the existing portal access fence: an archived
 // relationship cannot resolve even before its retained personal fields purge.
 expect(await canonicalPortalCustomer({companyId:company,customer:customerRow.data!,allowMergedAlias:false,
  load:async()=>{throw Error('unexpected_alias_lookup')},
 })).toBeNull()
 expect(preserved()).toEqual(historical)
 const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID()),legal=Buffer.from('SYNTHETIC DB05 competence only')
 sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to)
  VALUES(${literal(issuer)},${literal(company)},'SYNTHETIC DB05 class issuer',decode(${literal(legal.toString('hex'))},'hex'),${literal(hash(legal))},decode(${literal(key.toString('hex'))},'hex'),now()-interval '1 day',now()+interval '1 day')`)
 const source=()=>sql<string>(`SELECT to_jsonb(encode(sha256(convert_to(gridex_ediel_retention.customer_personal_fields_v1(c)::text,'UTF8')),'hex')) FROM public.customers c WHERE id=${literal(customer)} AND company_id=${literal(company)}`)
 const document=Buffer.from('SYNTHETIC DB05 exact customer field policy only'),sourceHash=source()
 const token=(retainUntil:string,extra:Record<string,unknown>={})=>{
  const now=sql<string>('SELECT to_jsonb(clock_timestamp())')
  const payload=Buffer.from(JSON.stringify({format:'ediel_customer_retention_policy_v1',retentionClass:'customer_canonical_personal_fields',
   companyId:company,customerId:customer,sourceHash,documentHash:hash(document),issuerLegalReference:'SYNTHETIC DB05 class issuer',
   legalBasisReference:'SYNTHETIC mechanism deadline, NOT an authorized legal period',issuedAt:new Date(Date.parse(now)-1000).toISOString(),
   expiresAt:new Date(Date.parse(now)+3600000).toISOString(),retainUntil,...extra,
  }))
  return {issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
 }
 const submit=(receipt:ReturnType<typeof token>|null,bytes=document)=>submitter.client.rpc('ediel_submit_customer_retention_v1',{
  p_company_id:company,p_actor_user_id:submitter.id,p_customer_id:customer,p_document_base64:bytes.toString('base64'),p_issuer_receipt:receipt,
 })
 const review=(decision:string,client=reviewer.client,id=reviewer.id)=>client.rpc('ediel_review_customer_retention_v1',{
  p_company_id:company,p_actor_user_id:id,p_decision_id:decision,p_outcome:'approve',p_reason:'SYNTHETIC separate class review',
 })
 const purge=(decision:string,client=purger.client,id=purger.id,companyId=company)=>client.rpc('ediel_pseudonymise_customer_retention_v1',{
  p_company_id:companyId,p_actor_user_id:id,p_decision_id:decision,
 })
 const state=()=>sql<Record<string,unknown>>(`SELECT jsonb_build_object(
  'source',encode(sha256(convert_to(gridex_ediel_retention.customer_personal_fields_v1(c)::text,'UTF8')),'hex'),
  'name',c.full_name,'email',c.email,'identity',c.personal_number,'anonymised',c.anonymized_at IS NOT NULL,
  'portal',(SELECT status FROM public.customer_portal_accounts WHERE id=${literal(portal)}),
  'claim',(SELECT status FROM public.customer_portal_claims WHERE id=${literal(claim)}),
  'tombstones',(SELECT count(*) FROM gridex_ediel_retention.customer_tombstones WHERE customer_id=c.id),
  'purgeAudits',(SELECT count(*) FROM public.audit_logs WHERE company_id=c.company_id AND entity_id=c.id::text AND action='ediel.retention.customer_pseudonymised'))
  FROM public.customers c WHERE id=${literal(customer)} AND company_id=${literal(company)}`)
 return {company,customer,otherCompany,site,point,issuer,submitter,reviewer,purger,other,
  sourceHash,document,token,submit,review,purge,state,preserved,historical}
}

it('canonical customer closure then the SAME decision holds before its real deadline and later purges with separate authority, replay and retained history',async()=>{
 const f=await fixture(),initial=f.state()
 const deadline=sql<string>("SELECT to_jsonb(clock_timestamp()+interval '10 seconds')")
 const submitted=await f.submit(f.token(deadline))
 expect(submitted.error).toBeNull()
 expect(submitted.data).toMatchObject({status:'submitted',issuerQualified:true,sourceHash:f.sourceHash})
 const decision=submitted.data.decisionId as string
 // Separate permissions: submitter cannot purge, purger cannot review.
 expect((await f.purge(decision,f.submitter.client,f.submitter.id)).error).not.toBeNull()
 expect((await f.review(decision,f.purger.client,f.purger.id)).error).not.toBeNull()
 const selfReview=await f.review(decision,f.submitter.client,f.submitter.id)
 expect(selfReview.error?.message).toContain('customer_retention_separate_reviewer_required')
 const reviewed=await f.review(decision)
 expect(reviewed.error).toBeNull()
 expect(reviewed.data).toMatchObject({status:'approved',decisionId:decision})
 expect(sql<boolean>(`SELECT to_jsonb(clock_timestamp()<${literal(deadline)}::timestamptz)`)).toBe(true)
 const before=await f.purge(decision)
 expect(before.error).toBeNull()
 expect(before.data).toMatchObject({status:'held',missing:['current_customer_class_legal_retention_deadline']})
 expect(f.state()).toEqual(initial)
 expect(f.preserved()).toEqual(f.historical)
 // Real clock, separate RPC transactions; no patched now(), policy rewrite or
 // manually toggled archived flag. A bounded wait ends after the SAME deadline.
 const untilDue=sql<number>(`SELECT to_jsonb(greatest(0,extract(epoch FROM (${literal(deadline)}::timestamptz-clock_timestamp())))*1000)`)
 expect(untilDue).toBeLessThanOrEqual(10000)
 await delay(untilDue+100)
 expect(sql<boolean>(`SELECT to_jsonb(clock_timestamp()>=${literal(deadline)}::timestamptz)`)).toBe(true)
 // Actor/tenant/object contrasts must leave this exact decision and source intact.
 expect((await f.purge(decision,f.purger.client,f.reviewer.id)).error).not.toBeNull()
 expect((await f.purge(decision,f.other.client,f.other.id,f.otherCompany)).error).not.toBeNull()
 expect((await f.purge(randomUUID())).error).not.toBeNull()
 const deny=randomUUID()
 sql(`INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active)
  VALUES(${literal(deny)},${literal(f.purger.id)},${literal(f.company)},'ediel.retention.purge','deny',true)`)
 expect((await f.purge(decision)).error).not.toBeNull()
 expect(f.state()).toEqual(initial)
 sql(`DELETE FROM public.user_permission_overrides WHERE id=${literal(deny)}`)
 sql(`INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active)
  VALUES(${literal(deny)},${literal(f.purger.id)},${literal(f.company)},'ediel.retention.customer_fields','deny',true)`)
 expect((await f.purge(decision)).error).not.toBeNull()
 expect(f.state()).toEqual(initial)
 sql(`DELETE FROM public.user_permission_overrides WHERE id=${literal(deny)}`)
 sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.company)} AND user_id=${literal(f.reviewer.id)}`)
 const lostReviewer=await f.purge(decision)
 expect(lostReviewer.error).toBeNull()
 expect(lostReviewer.data).toMatchObject({status:'held',missing:['current_retention_reviewer_authority']})
 expect(f.state()).toEqual(initial)
 sql(`UPDATE public.company_memberships SET is_active=true WHERE company_id=${literal(f.company)} AND user_id=${literal(f.reviewer.id)}`)
 sql(`INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active)
  VALUES(${literal(deny)},${literal(f.reviewer.id)},${literal(f.company)},'ediel.retention.customer_fields','deny',true)`)
 const lostClass=await f.purge(decision)
 expect(lostClass.error).toBeNull()
 expect(lostClass.data).toMatchObject({status:'held',missing:['current_retention_class_reviewer_authority']})
 expect(f.state()).toEqual(initial)
 sql(`DELETE FROM public.user_permission_overrides WHERE id=${literal(deny)}`)
 sql(`UPDATE public.customers SET email='changed@example.invalid' WHERE id=${literal(f.customer)} AND company_id=${literal(f.company)}`)
 const changed=await f.purge(decision)
 expect(changed.error).toBeNull()
 expect(changed.data).toMatchObject({status:'held',missing:['exact_native_customer_personal_fields_changed']})
 expect(f.state()).toMatchObject({tombstones:0,purgeAudits:0,anonymised:false})
 sql(`UPDATE public.customers SET email='synthetic@example.invalid' WHERE id=${literal(f.customer)} AND company_id=${literal(f.company)}`)
 expect(f.state()).toEqual(initial)
 const purged=await f.purge(decision)
 expect(purged.error).toBeNull()
 expect(purged.data).toMatchObject({status:'pseudonymised',customerId:f.customer,sourceHash:f.sourceHash,replay:false})
 expect(f.state()).toMatchObject({name:'Pseudonymiserad kund',email:null,identity:null,anonymised:true,portal:'revoked',claim:'revoked',tombstones:1,purgeAudits:1})
 const tombstone=sql<Record<string,unknown>>(`SELECT to_jsonb(t) FROM gridex_ediel_retention.customer_tombstones t WHERE customer_id=${literal(f.customer)}`)
 expect(tombstone).toMatchObject({company_id:f.company,customer_id:f.customer,decision_id:decision,source_hash:f.sourceHash,actor_user_id:f.purger.id,review_id:reviewed.data.reviewId})
 const replay=await f.purge(decision)
 expect(replay.error).toBeNull()
 expect(replay.data).toMatchObject({...purged.data,replay:true})
 expect(sql(`SELECT to_jsonb(t) FROM gridex_ediel_retention.customer_tombstones t WHERE customer_id=${literal(f.customer)}`)).toEqual(tombstone)
 expect(f.state()).toMatchObject({tombstones:1,purgeAudits:1})
 expect(()=>sql(`SET ROLE service_role;UPDATE public.customers SET email='restored@example.invalid' WHERE id=${literal(f.customer)}`)).toThrow(/customer_retention_personal_fields_tombstoned/)
 expect(()=>sql(`SET ROLE service_role;DELETE FROM public.customers WHERE id=${literal(f.customer)}`)).toThrow(/customer_retention_no_tombstone_cascade|customer_hard_delete_blocked/)
 expect(()=>sql(`SET ROLE service_role;DELETE FROM public.companies WHERE id=${literal(f.company)}`)).toThrow(/company_hard_delete_blocked/)
 for(const role of ['anon','authenticated','service_role'])expect(()=>sql(`SET ROLE ${role};SELECT * FROM gridex_ediel_retention.customer_decisions`)).toThrow(/permission denied/)
 expect(f.preserved()).toEqual(f.historical)
},180000)

it('absent legal competence stays held and a revoked SAME approved decision cannot erase its canonically closed customer',async()=>{
 const f=await fixture(),initial=f.state()
 const absent=await f.submit(null,Buffer.from('SYNTHETIC unsigned original'))
 expect(absent.error).toBeNull()
 expect(absent.data).toMatchObject({issuerQualified:false})
 expect((await f.review(absent.data.decisionId)).data).toMatchObject({status:'held'})
 expect((await f.purge(absent.data.decisionId)).data).toMatchObject({status:'held',missing:['current_customer_class_legal_retention_deadline']})
 expect(f.state()).toEqual(initial)
 const due=sql<string>("SELECT to_jsonb(clock_timestamp()-interval '1 second')")
 const submitted=await f.submit(f.token(due))
 expect(submitted.error).toBeNull()
 const decision=submitted.data.decisionId as string
 expect((await f.review(decision)).data).toMatchObject({status:'approved'})
 const revoked=await f.reviewer.client.rpc('ediel_revoke_customer_retention_v1',{
  p_company_id:f.company,p_actor_user_id:f.reviewer.id,p_decision_id:decision,p_reason:'SYNTHETIC decision withdrawn',
 })
 expect(revoked.error).toBeNull()
 const held=await f.purge(decision)
 expect(held.error).toBeNull()
 expect(held.data).toMatchObject({status:'held',missing:['current_customer_class_legal_retention_deadline']})
 expect(f.state()).toEqual(initial)
 expect(f.preserved()).toEqual(f.historical)
},180000)

it('current issuer revocation prevents due purge despite an earlier independent approval',async()=>{
 const f=await fixture(),initial=f.state()
 const due=sql<string>("SELECT to_jsonb(clock_timestamp()-interval '1 second')")
 const submitted=await f.submit(f.token(due))
 expect(submitted.error).toBeNull()
 const decision=submitted.data.decisionId as string
 expect((await f.review(decision)).data).toMatchObject({status:'approved'})
 sql(`INSERT INTO gridex_ediel_retention.issuer_revocations(issuer_id,reference) VALUES(${literal(f.issuer)},'SYNTHETIC issuer withdrawn')`)
 const held=await f.purge(decision)
 expect(held.error).toBeNull()
 expect(held.data).toMatchObject({status:'held',missing:['current_customer_class_legal_retention_deadline']})
 expect(f.state()).toEqual(initial)
 expect(f.preserved()).toEqual(f.historical)
},180000)

it('a canonical archive with remaining active supply stays held without erasing its customer or history',async()=>{
 const f=await fixture(true),initial=f.state()
 const due=sql<string>("SELECT to_jsonb(clock_timestamp()-interval '1 second')")
 const submitted=await f.submit(f.token(due))
 expect(submitted.error).toBeNull()
 const decision=submitted.data.decisionId as string
 expect((await f.review(decision)).data).toMatchObject({status:'approved'})
 const held=await f.purge(decision)
 expect(held.error).toBeNull()
 expect(held.data).toMatchObject({status:'held',missing:['operative_customer_closed_and_no_active_supply']})
 expect(f.state()).toEqual(initial)
 expect(f.preserved()).toEqual(f.historical)
},180000)

it('a correctly signed but expired class policy stays held without erasure',async()=>{
 const f=await fixture(),initial=f.state()
 const now=sql<string>('SELECT to_jsonb(clock_timestamp())')
 const due=new Date(Date.parse(now)-1000).toISOString()
 const submitted=await f.submit(f.token(due,{expiresAt:new Date(Date.parse(now)-1).toISOString()}))
 expect(submitted.error).toBeNull()
 expect(submitted.data).toMatchObject({issuerQualified:false})
 expect((await f.review(submitted.data.decisionId)).data).toMatchObject({status:'held'})
 const held=await f.purge(submitted.data.decisionId)
 expect(held.error).toBeNull()
 expect(held.data).toMatchObject({status:'held',missing:['current_customer_class_legal_retention_deadline']})
 expect(f.state()).toEqual(initial)
 expect(f.preserved()).toEqual(f.historical)
},180000)

it('a policy expiring during an observed customer lock wait cannot authorize erasure when the request resumes',async()=>{
 const f=await fixture(),initial=f.state()
 const now=sql<string>('SELECT to_jsonb(clock_timestamp())')
 const expires=new Date(Date.parse(now)+6000).toISOString()
 const due=new Date(Date.parse(now)-1000).toISOString()
 const submitted=await f.submit(f.token(due,{expiresAt:expires}))
 expect(submitted.error).toBeNull()
 expect(submitted.data).toMatchObject({issuerQualified:true})
 const decision=submitted.data.decisionId as string
 const approved=await f.review(decision)
 expect(approved.error).toBeNull()
 expect(approved.data).toMatchObject({status:'approved'})
 const lock=customerLock(f.company,f.customer)
 let result:Awaited<ReturnType<typeof f.purge>>|undefined
 let pending:Promise<Awaited<ReturnType<typeof f.purge>>>|undefined
 try {
  const holderPid=await lock.ready
  // Consume the thenable now, so PostgREST begins a real request while the
  // policy is valid. A later invocation would miss the stale-clock contrast.
  pending=Promise.resolve(f.purge(decision))
  let waiting:{started:string;observed:string}|null=null
  for(let attempt=0;attempt<30;attempt++) {
   waiting=sql<{started:string;observed:string}|null>(`SELECT (SELECT to_jsonb(x) FROM (
    SELECT xact_start AS started,clock_timestamp() AS observed FROM pg_stat_activity
    WHERE usename='authenticator' AND state='active' AND wait_event_type='Lock'
      AND ${holderPid}=ANY(pg_blocking_pids(pid))
      AND query LIKE '%ediel_pseudonymise_customer_retention_v1%'
    LIMIT 1) x)`)
   if(waiting)break
   await delay(100)
  }
  expect(waiting,'actual PostgREST request must wait on the held customer row').not.toBeNull()
  expect(Date.parse(waiting!.started)).toBeLessThan(Date.parse(expires))
  expect(Date.parse(waiting!.observed)).toBeLessThan(Date.parse(expires))
  const remaining=sql<number>(`SELECT to_jsonb(greatest(0,extract(epoch FROM (${literal(expires)}::timestamptz-clock_timestamp())))*1000)`)
  await delay(remaining+100)
  expect(sql<boolean>(`SELECT to_jsonb(clock_timestamp()>=${literal(expires)}::timestamptz)`)).toBe(true)
  lock.release()
  await lock.done
  result=await pending
 } finally {
  lock.release()
  await lock.done
  if(pending)await pending
 }
 // Paired fresh target: a request admitted after expiry already stays held.
 // Do not use a retry of f, whose tombstone deliberately bypasses revalidation.
 const control=await fixture(),controlInitial=control.state()
 const expired=await control.submit(control.token(due,{expiresAt:expires,issuedAt:new Date(Date.parse(now)-1000).toISOString()}))
 expect(expired.error).toBeNull()
 expect(expired.data).toMatchObject({issuerQualified:false})
 expect((await control.review(expired.data.decisionId)).data).toMatchObject({status:'held'})
 const after=await control.purge(expired.data.decisionId)
 expect(after.error).toBeNull()
 expect(after.data).toMatchObject({status:'held',missing:['current_customer_class_legal_retention_deadline']})
 expect(control.state()).toEqual(controlInitial)
 expect(control.preserved()).toEqual(control.historical)
 expect(result!.error).toBeNull()
 expect(result!.data).toMatchObject({status:'held',missing:['current_customer_class_legal_retention_deadline']})
 expect(f.state()).toEqual(initial)
 expect(f.preserved()).toEqual(f.historical)
},180000)

for(const permission of ['ediel.retention.purge','ediel.retention.customer_fields']) {
 it(`a scheduled ${permission} DENY activating during an observed customer lock wait prevents erasure when the request resumes`,async()=>{
  const f=await fixture(),initial=f.state()
  const due=sql<string>("SELECT to_jsonb(clock_timestamp()-interval '1 second')")
  // Keep legal competence valid for an hour: this contrasts P's authority,
  // independently of the legal-policy expiry case above. R stays authorized.
  const submitted=await f.submit(f.token(due))
  expect(submitted.error).toBeNull()
  expect(submitted.data).toMatchObject({issuerQualified:true})
  const decision=submitted.data.decisionId as string
  const approved=await f.review(decision)
  expect(approved.error).toBeNull()
  expect(approved.data).toMatchObject({status:'approved'})
  const activates=sql<string>("SELECT to_jsonb(clock_timestamp()+interval '6 seconds')")
  sql(`INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from)
   VALUES(${literal(randomUUID())},${literal(f.purger.id)},${literal(f.company)},${literal(permission)},'deny',true,${literal(activates)}::timestamptz)`)
  expect(sql<boolean>(`SELECT to_jsonb(gridex_ediel_retention.permission_v1(${literal(f.company)},${literal(f.purger.id)},${literal(permission)}))`)).toBe(true)
  const lock=customerLock(f.company,f.customer)
  let result:Awaited<ReturnType<typeof f.purge>>|undefined
  let pending:Promise<Awaited<ReturnType<typeof f.purge>>>|undefined
  try {
   const holderPid=await lock.ready
   pending=Promise.resolve(f.purge(decision))
   let waiting:{started:string;observed:string}|null=null
   for(let attempt=0;attempt<30;attempt++) {
    waiting=sql<{started:string;observed:string}|null>(`SELECT (SELECT to_jsonb(x) FROM (
     SELECT xact_start AS started,clock_timestamp() AS observed FROM pg_stat_activity
     WHERE usename='authenticator' AND state='active' AND wait_event_type='Lock'
       AND ${holderPid}=ANY(pg_blocking_pids(pid))
       AND query LIKE '%ediel_pseudonymise_customer_retention_v1%'
     LIMIT 1) x)`)
    if(waiting)break
    await delay(100)
   }
   expect(waiting,'actual PostgREST request must wait on the held customer row').not.toBeNull()
   expect(Date.parse(waiting!.started)).toBeLessThan(Date.parse(activates))
   expect(Date.parse(waiting!.observed)).toBeLessThan(Date.parse(activates))
   const remaining=sql<number>(`SELECT to_jsonb(greatest(0,extract(epoch FROM (${literal(activates)}::timestamptz-clock_timestamp())))*1000)`)
   await delay(remaining+100)
   expect(sql<boolean>(`SELECT to_jsonb(clock_timestamp()>=${literal(activates)}::timestamptz)`)).toBe(true)
   lock.release()
   await lock.done
   result=await pending
  } finally {
   lock.release()
   await lock.done
   if(pending)await pending
  }
  // The current SQL helper and a fresh JWT request must both see the DENY.
  // Entry actor checks precede replay, so this control remains meaningful even
  // if a defective first request has already created the customer's tombstone.
  expect(sql<boolean>(`SELECT to_jsonb(gridex_ediel_retention.permission_v1(${literal(f.company)},${literal(f.purger.id)},${literal(permission)}))`)).toBe(false)
  const fresh=await f.purge(decision)
  expect(fresh.error?.code).toBe('42501')
  const refusal=permission==='ediel.retention.purge'?'ediel_retention_current_actor_forbidden':'customer_retention_scoped_write_required'
  expect(fresh.error?.message).toContain(refusal)
  expect(result!.error?.code).toBe('42501')
  expect(result!.error?.message).toContain(refusal)
  expect(f.state()).toEqual(initial)
  expect(f.preserved()).toEqual(f.historical)
 },180000)
}
