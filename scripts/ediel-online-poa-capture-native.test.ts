// Native synthetic local tenants only; actual execution is required for proof.
// Existing publication fixture supplies a real graph; the target is a NEW
// unsigned contract with NULL commercial dates, its own V2 consent and PDF.
// No claimed browser/customer authentication, provider delivery or activation.
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {archiveOnlineSignaturePoa} from '@/lib/customer-contracts/onlineSigning'
import {poaMailEvidenceFingerprint} from '@/lib/email/poaMailEvidence'
import {futureNativeSupplyDate,literal,nativeSql as sql,seedNormalSwitchNativeFixture,type NormalSwitchStageNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {installPoaContractTriggerProfile} from './helpers/ediel-poa-contract-trigger-profile.native'

type Pending={contractId:string;requestId:string;tokenHash:string}
type Receipt={company_id:string;customer_id:string;contract_id:string;request_id:string;signed_at:string;signature_snapshot_sha256:string;power_of_attorney_id:string;already_signed:boolean}
let f:NormalSwitchStageNativeFixture
let overlay:ReturnType<typeof installPoaContractTriggerProfile>|undefined
let own:SupabaseClient,foreign:SupabaseClient
const anon=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
const digest=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex')
const effectTables=['customer_contracts','customer_contract_signature_requests','contract_price_snapshots','customer_legal_acceptances','customer_contract_acceptances','customer_contract_evidence','powers_of_attorney','power_of_attorney_scopes','customer_authorization_documents','authorization_scopes','customer_operation_jobs','customer_operation_events','customer_contract_events']
function effects(ignoreArchiveRetryTimestamp=false){return sql<Record<string,string>>(`SELECT jsonb_build_object(${effectTables.map(t=>`${literal(t)},(SELECT encode(extensions.digest(convert_to(coalesce(jsonb_agg(${ignoreArchiveRetryTimestamp&&t==='powers_of_attorney'?"to_jsonb(r)-'updated_at'":'to_jsonb(r)'} ORDER BY r.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') FROM public.${t} r WHERE company_id=${literal(f.companyId)})`).join(',')})`)}
function guard(){overlay!.assertInstalled()}
beforeAll(async()=>{
 overlay=installPoaContractTriggerProfile()
 // The base's V1/manual-POA data is NEVER substituted for target V2 evidence.
 f=await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:futureNativeSupplyDate()})
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions p
 WHERE key='contracts.create' AND NOT EXISTS(SELECT FROM public.user_permissions u
 WHERE u.user_id=${literal(f.actorUserId)} AND u.company_id=${literal(f.companyId)} AND (u.permission_id=p.id OR u.permission_key=p.key));`)
 const otherCompany=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(otherCompany)},'Synthetic foreign POA native','active');`)
 own=(await createCustomerRecordRetentionNativeUser(f.companyId,['customers.read','customers.write','contracts.read','contracts.write','operations.read'])).client
 foreign=(await createCustomerRecordRetentionNativeUser(otherCompany,['customers.read','contracts.read','operations.read'])).client
 guard()
},180000)
afterAll(()=>{overlay?.restore()},120000)
async function pending():Promise<Pending>{
 guard();const contractId=randomUUID(),tokenHash=randomBytes(32).toString('hex')
 // Reuse only the actual immutable published graph. No acceptance, signature,
 // price SHA, source receipt, POA, active period or market original is copied.
 sql(`INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
 contract_offer_id,status,contract_version,requested_start_date,starts_at,ends_at,metadata,created_by,
 contract_publication_version_id,contract_product_id,contract_product_version_id,price_plan_id,
 price_plan_version_id,price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
 SELECT ${literal(contractId)},c.company_id,c.customer_id,c.site_id,c.metering_point_id,c.contract_offer_id,
 'draft','v1',${literal(f.requestedStartDate)}::date,NULL,NULL,
 '{"test_center":{"kind":"invoice_test_customer"},"test":"SYNTHETIC V2 POA NATIVE"}',${literal(f.actorUserId)},
 v.id,p.contract_product_id,v.contract_product_version_id,v.price_plan_id,v.price_plan_version_id,
 v.price_book_id,v.legal_bundle_version_id,v.offer_reference,p.commercial_snapshot,l.rendered_snapshot
 FROM public.customer_contracts c JOIN public.contract_publication_versions v ON v.id=c.contract_publication_version_id
 JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
 JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
 WHERE c.company_id=${literal(f.companyId)} AND c.id=${literal(f.contractId)} AND v.status='published'
 AND v.locked_at IS NOT NULL AND p.power_of_attorney_required=true
 AND EXISTS(SELECT FROM public.legal_bundle_version_documents d WHERE d.legal_bundle_version_id=l.id AND d.module_key='power_of_attorney');`)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_contracts WHERE company_id=${literal(f.companyId)} AND id=${literal(contractId)} AND starts_at IS NULL AND ends_at IS NULL AND signed_at IS NULL AND locked_at IS NULL AND status='draft'`)).toBe(1)
 const result=await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1',{
 p_company_id:f.companyId,p_customer_id:f.customerId,p_contract_id:contractId,p_token_hash:tokenHash,
 p_recipient_email:`synthetic-${f.customerId}@example.invalid`,p_expires_at:new Date(Date.now()+3600000).toISOString(),
 p_actor_user_id:f.actorUserId,p_channel:'internal'})
 expect(result.error?.code??null).toBeNull()
 const r=result.data as {ok:boolean;request_id:string};expect(r.ok).toBe(true)
 expect(typeof r.request_id==='string'&&/^[a-f0-9-]{36}$/.test(r.request_id)).toBe(true)
 return {contractId,requestId:r.request_id,tokenHash}
}
const params=(p:Pending,extra:Record<string,unknown>={})=>({p_token_hash:p.tokenHash,
 p_signed_ip_hash:digest('SYNTHETIC LOCAL LOOPBACK ONLY'),p_signed_user_agent:'SYNTHETIC local V2 native; no customer browser proof',
 p_signer_ip:'127.0.0.1',p_poa_accepted:true,p_poa_scopes:['supplier_switch','facility_information_lookup'],p_poa_terms_version:'ops_online_poa_v1',...extra})
async function signed(p:Pending){const r=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p));expect(r.error?.code??null).toBeNull();const receipt=r.data as Receipt;expect(receipt).toMatchObject({company_id:f.companyId,customer_id:f.customerId,contract_id:p.contractId,request_id:p.requestId,already_signed:false});return receipt}
function original(p:Pending){return sql<{poa:Record<string,unknown>;signature:Record<string,unknown>;signedAt:string;usedAt:string;startsAt:null;endsAt:null;price:string;job:Record<string,unknown>}>(`SELECT jsonb_build_object('poa',to_jsonb(p),'signature',c.signature_snapshot,
 'signedAt',c.signed_at,'usedAt',r.used_at,'startsAt',c.starts_at,'endsAt',c.ends_at,'price',s.snapshot_hash,
 'job',(SELECT to_jsonb(j) FROM public.customer_operation_jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.customer_id AND j.idempotency_key='contract-signed:'||c.id::text AND j.job_type='start_supplier_switch'))
 FROM public.customer_contracts c JOIN public.powers_of_attorney p ON p.customer_contract_id=c.id AND p.company_id=c.company_id
 JOIN public.customer_contract_signature_requests r ON r.customer_contract_id=c.id AND r.id=${literal(p.requestId)}
 JOIN public.contract_price_snapshots s ON s.id=c.contract_price_snapshot_id AND s.contract_id=c.id AND s.company_id=c.company_id
 WHERE c.company_id=${literal(f.companyId)} AND c.id=${literal(p.contractId)} AND p.source='ops_online_signature'`)}

it('captures exact NULL-start contract/customer/tenant/site/legal/price/IP/verifier and one real acceptance clock; gates its operation until private archive',async()=>{
 const p=await pending();await signed(p);const v=original(p),poa=v.poa
 expect(v.startsAt).toBeNull();expect(v.endsAt).toBeNull();expect(v.usedAt).toBe(v.signedAt)
 expect(poa).toMatchObject({company_id:f.companyId,customer_id:f.customerId,customer_site_id:f.siteId,site_id:f.siteId,
 customer_contract_id:p.contractId,source:'ops_online_signature',status:'signed',accepted_ip:'127.0.0.1',accepted_at:v.signedAt,signed_at:v.signedAt,
 signed_scope_snapshot:['supplier_switch','facility_information_lookup']})
 expect(poa.evidence_payload).toMatchObject({capture_source:'actual_signing_request',signature_request_id:p.requestId,ip_address:'127.0.0.1',verification_reference:expect.any(String)})
 expect(v.job).toMatchObject({status:'blocked',review_reason_code:'poa_archive_pending',payload:expect.objectContaining({contract_id:p.contractId,online_poa_id:poa.id,signature_request_id:p.requestId})})
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_authorization_documents WHERE company_id=${literal(f.companyId)} AND power_of_attorney_id=${literal(poa.id)}`)).toBe(0)
 expect(v.signature).toMatchObject({pricing_snapshot_sha256:v.price,accepted_at:v.signedAt,signature_request_id:p.requestId,
 power_of_attorney_snapshot:expect.objectContaining({power_of_attorney_id:poa.id})})
 const snapshotBefore=effects();const replay=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p,{p_signer_ip:'127.0.0.2',p_poa_scopes:['supplier_switch']}))
 expect(replay.error?.code??null).toBeNull();expect((replay.data as Receipt).already_signed).toBe(true);expect(effects()).toEqual(snapshotBefore)
})

it.each([
 ['missing consent',{p_poa_accepted:false,p_poa_scopes:[]},'poa_explicit_consent_required'],
 ['missing IP',{p_signer_ip:null},'poa_signer_ip_required'],
 ['bad scopes',{p_poa_scopes:['supplier_switch','terminate_any_contract']},'poa_explicit_scopes_invalid'],
 ['wrong terms version',{p_poa_terms_version:'not-current'},'poa_explicit_scopes_invalid'],
] as const)('rejects %s with zero tenant effects',async(_name,change,code)=>{
 const p=await pending(),before=effects();const r=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p,change));expect(r.error?.message).toContain(code);expect(effects()).toEqual(before)
})

it('rejects anon/authenticated JWT finalization even with the exact bearer hash',async()=>{
 const p=await pending(),before=effects()
 for(const client of [anon,own,foreign]){const r=await client.rpc('gridex_finalize_customer_contract_signature_v2',params(p));expect(r.error).not.toBeNull()}
 expect(effects()).toEqual(before)
})

it('uploads genuine private PDF, verifies exact bytes/hash and document-bound scopes, releases only matching archive hold, and recovers idempotently',async()=>{
 const p=await pending(),receipt=await signed(p),before=original(p),poaId=String(before.poa.id)
 const immutableBefore={poa:{...before.poa,metadata:undefined,updated_at:undefined,document_path:undefined,document_hash:undefined,document_id:undefined},signature:before.signature,signedAt:before.signedAt,price:before.price}
 const attachment=await archiveOnlineSignaturePoa(receipt)
 expect(attachment?.contentType).toBe('application/pdf');expect(attachment).not.toBeNull()
 const bytes=Buffer.from(attachment!.content,'base64');expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.byteLength).toBeGreaterThan(128)
 const after=original(p),archive=(after.poa.metadata as {document_archive:{path:string;storage_bucket:string;sha256:string;evidence_sha256:string}}).document_archive
 expect(archive.storage_bucket).toBe('customer-documents');expect(archive.path).toContain(`companies/${f.companyId}/customers/${f.customerId}/powers-of-attorney/${poaId}/`)
 expect(archive.sha256).toBe(digest(bytes));expect(archive.evidence_sha256).toBe(poaMailEvidenceFingerprint(after.poa))
 const downloaded=await supabaseService.storage.from('customer-documents').download(archive.path);expect(downloaded.error).toBeNull();expect(digest(Buffer.from(await downloaded.data!.arrayBuffer()))).toBe(archive.sha256)
 const bucket=sql<{public:boolean}>(`SELECT jsonb_build_object('public',public) FROM storage.buckets WHERE id='customer-documents'`);expect(bucket.public).toBe(false)
 const document=sql<{id:string;company:string;customer:string;sha:string;scopes:string[]}>(`SELECT jsonb_build_object('id',d.id,'company',d.company_id,'customer',d.customer_id,'sha',d.file_checksum,'scopes',s.signed_scope_snapshot)
 FROM public.customer_authorization_documents d JOIN public.authorization_scopes s ON s.authorization_document_id=d.id AND s.company_id=d.company_id AND s.customer_id=d.customer_id
 WHERE d.power_of_attorney_id=${literal(poaId)} AND d.company_id=${literal(f.companyId)} AND d.customer_contract_id=${literal(p.contractId)} AND d.status='active'`)
 expect(document).toMatchObject({id:expect.any(String),company:f.companyId,customer:f.customerId,sha:archive.sha256,scopes:['supplier_switch','facility_information_lookup']})
 expect(after.job).toMatchObject({status:'queued',review_reason_code:null})
 expect({poa:{...after.poa,metadata:undefined,updated_at:undefined,document_path:undefined,document_hash:undefined,document_id:undefined},signature:after.signature,signedAt:after.signedAt,price:after.price}).toEqual(immutableBefore)
 const ownDocs=await own.from('customer_authorization_documents').select('id').eq('id',document.id);expect(ownDocs.error).toBeNull();expect(ownDocs.data).toHaveLength(1)
 const otherDocs=await foreign.from('customer_authorization_documents').select('id').eq('id',document.id);expect(otherDocs.error).toBeNull();expect(otherDocs.data).toHaveLength(0)
 for(const client of [anon,foreign]){const denied=await client.storage.from('customer-documents').download(archive.path);expect(denied.error).not.toBeNull()}
 // Archive completion legitimately refreshes the POA retry timestamp, but
 // cannot create new consent, documents, scopes or jobs or change originals.
 const stateBeforeReplay=effects(true);const second=await archiveOnlineSignaturePoa(receipt);expect(second?.content).toBe(attachment?.content);expect(effects(true)).toEqual(stateBeforeReplay)
})

it('fences an actual old-runtime service claim before delivery and advances only a new owned confirmation lease',async()=>{
 const p=await pending();await signed(p)
 let oldDeliveryCallbacks=0
 const oldClaim=await supabaseService.from('customer_contract_confirmation_deliveries')
  .update({next_attempt_at:new Date(Date.now()+600000).toISOString()})
  .eq('company_id',f.companyId).eq('signature_request_id',p.requestId)
  .eq('state','pending').lte('next_attempt_at',new Date().toISOString()).select('attempts')
 if(!oldClaim.error&&oldClaim.data?.length)oldDeliveryCallbacks++
 expect(oldClaim.error?.message).toContain('confirmation_v2_runtime_required');expect(oldDeliveryCallbacks).toBe(0)
 const args={p_company_id:f.companyId,p_contract_id:p.contractId,p_request_id:p.requestId,p_action:'claim'}
 for(const client of [anon,own,foreign]){
  const denied=await client.rpc('gridex_advance_contract_confirmation_v2',args);expect(denied.error).not.toBeNull()
 }
 const wrong=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',{...args,p_company_id:randomUUID()})
 expect(wrong.error?.message).toContain('confirmation_binding_invalid')
 const competing=await Promise.all([supabaseService.rpc('gridex_advance_contract_confirmation_v2',args),supabaseService.rpc('gridex_advance_contract_confirmation_v2',args)])
 // Preserve each actual PostgREST error in a failed original; a boolean
 // discarded the SQL cause of the tenant-key regression.
 expect(competing.map(r=>r.error)).toEqual([null,null])
 expect(competing.filter(r=>(r.data as {claimed:boolean}).claimed)).toHaveLength(1)
 const claim=competing.find(r=>(r.data as {claimed:boolean}).claimed)!.data as {claimed:boolean;state:string;attempts:number;lease_until:string}
 expect(claim).toMatchObject({claimed:true,state:'pending',attempts:0});expect(typeof claim.lease_until).toBe('string')
 const duplicate=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',args)
 expect(duplicate.error).toBeNull();expect(duplicate.data).toMatchObject({claimed:false,state:'pending',attempts:0})
 const stale=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',{...args,p_action:'failed',p_expected_lease_until:'2000-01-01T00:00:00.123456Z',p_error:'SYNTHETIC stale owner'})
 expect(stale.error).toBeNull();expect(stale.data).toMatchObject({advanced:false,state:'pending',attempts:0})
 const failed=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',{...args,p_action:'failed',p_expected_lease_until:claim.lease_until,p_error:'SYNTHETIC owned failure; no provider call'})
 expect(failed.error).toBeNull();expect(failed.data).toMatchObject({advanced:true,state:'pending',attempts:1})
 const oldFailure=await supabaseService.from('customer_contract_confirmation_deliveries').update({attempts:99})
  .eq('company_id',f.companyId).eq('signature_request_id',p.requestId)
 expect(oldFailure.error?.message).toContain('confirmation_v2_runtime_required')
 const row=sql<{attempts:number;seconds:number}>(`SELECT jsonb_build_object('attempts',attempts,'seconds',extract(epoch FROM next_attempt_at-updated_at)) FROM public.customer_contract_confirmation_deliveries WHERE signature_request_id=${literal(p.requestId)} AND company_id=${literal(f.companyId)}`)
 expect(row).toEqual({attempts:1,seconds:300})
})

it('refuses archive receipt customer/tenant substitution before any storage or job effect',async()=>{
 const p=await pending(),receipt=await signed(p),before=effects()
 await expect(archiveOnlineSignaturePoa({...receipt,customer_id:randomUUID()})).rejects.toThrow()
 await expect(archiveOnlineSignaturePoa({...receipt,company_id:randomUUID()})).rejects.toThrow()
 expect(effects()).toEqual(before)
})

it('preserves the original POA provenance against service relabels and authenticated normalized reserved-source inserts',async()=>{
 const p=await pending();await signed(p);const v=original(p),poaId=String(v.poa.id),before=effects()
 const relabel=await supabaseService.from('powers_of_attorney').update({source:'manual_pdf'}).eq('id',poaId).eq('company_id',f.companyId)
 expect(relabel.error?.message).toContain('poa_online_original_capture_immutable')
 for(const source of ['ops_online_signature',' OPS_ONLINE_SIGNATURE ','\u00a0ops_online_signature\ufeff']){
  // The canonical generated-reference default is service-only. Supply a
  // valid synthetic reference so this JWT actually reaches the POA guard;
  // retain its exact rejection and the zero-effects assertion below.
  const inserted=await own.from('powers_of_attorney').insert({company_id:f.companyId,customer_id:f.customerId,site_id:f.siteId,source,scope:'supplier_switch',status:'draft',reference:'SYNTHETIC-'+randomUUID(),power_of_attorney_reference:'poa_'+randomUUID().replaceAll('-','')})
  expect(inserted.error?.message).toContain('poa_online_capture_service_role_required')
 }
 expect(effects()).toEqual(before)
})

it('rechecks expiry after actual blocked-row lock acquisition, never committing a late acceptance',async()=>{
 const p=await pending();guard()
 // A genuine competing native SQL session holds the customer row after V2's
 // first expiry check; observe V2 actually waiting before crossing the deadline.
 const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1','-f','-'],{stdio:['pipe','pipe','pipe']})
 let output='';child.stdout.on('data',b=>{output+=b.toString()})
 const done=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)})
 let response:PromiseLike<unknown>|undefined
 const waitUntil=async(check:()=>boolean,ms=5000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('native_lock_observation_timeout');await new Promise(r=>setTimeout(r,20))}}
 child.stdin.write(`BEGIN;SELECT id FROM public.customers WHERE id=${literal(f.customerId)} AND company_id=${literal(f.companyId)} FOR UPDATE;SELECT 'POA_LOCK_READY';\n`)
 try{
  await waitUntil(()=>output.includes('POA_LOCK_READY'))
  const expiry=sql<string>(`UPDATE public.customer_contract_signature_requests SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=${literal(p.requestId)} AND company_id=${literal(f.companyId)} RETURNING to_jsonb(expires_at)`)
  const before=effects();const invocation=supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p))
  // Force the PostgREST thenable to start now while the independent lock holds.
  const invocationResponse=Promise.resolve(invocation);response=invocationResponse
  await waitUntil(()=>sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%gridex_finalize_customer_contract_signature_v2%'))`))
  expect(Date.now()).toBeLessThan(Date.parse(expiry))
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(expiry)-Date.now()+50)))
  child.stdin.end('COMMIT;\n');expect(await done).toBe(0)
  const result=await invocationResponse;expect(result.error?.message).toContain('signature_link_expired');expect(effects()).toEqual(before)
 }finally{
  try{if(child.exitCode===null){child.stdin.end('COMMIT;\n');await done}}
  finally{if(response)await Promise.allSettled([response])}
 }
})
