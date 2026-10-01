import {execFileSync} from 'node:child_process'
import {createHmac,randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
function sql<T>(statement:string):T{if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_native_required');const out=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim();return out?JSON.parse(out) as T:undefined as T}
type Rpc=(name:string,params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
it('real installed private receipt verifier matches actual HMAC-SHA256 bytes, including long keys; this grants no real issuer approval',()=>{
 for(const key of [Buffer.alloc(32,11),Buffer.alloc(131,170)]){
  const payload=Buffer.from('SYNTHETIC cryptographic verifier mechanism only: ?+\0binary'),expected=createHmac('sha256',key).update(payload).digest('hex')
  expect(sql(`select to_jsonb(encode(gridex_requested_changes.receipt_hmac_sha256_v1(decode('${payload.toString('hex')}','hex'),decode('${key.toString('hex')}','hex')),'hex'))`)).toBe(expected)
 }
})
it('installed custody tables and issuer secrets are inaccessible to every application role and new review catalog grants no default role authority',()=>{
 const tables=['artifacts','reviews','review_origins','events','issuer_keys','issuer_representations','issuer_revocations','confirmed_customer_versions','customer_version_availability']
 for(const role of ['anon','authenticated','service_role'])for(const table of tables)expect(sql<boolean>(`select to_jsonb(has_table_privilege('${role}','gridex_requested_changes.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`)).toBe(false)
 expect(sql<number>(`select to_jsonb(count(*)) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id or rp.permission_id is null and p.key=rp.permission_key where p.key='ediel.source.review'`)).toBe(0)
})
it('actual native customer-version HTTP owners reject a foreign or inactive selector; no version or availability receipt can be forged',async()=>{
 const company=randomUUID(),actor=randomUUID(),source=randomUUID(),rpc=supabaseService.rpc.bind(supabaseService) as unknown as Rpc
 const before=sql(`select jsonb_build_object('versions',(select count(*) from gridex_requested_changes.confirmed_customer_versions),'availability',(select count(*) from gridex_requested_changes.customer_version_availability))`)
 for(const name of ['ediel_apply_reviewed_customer_source_v1','ediel_witness_confirmed_customer_source_v1']){
  const result=await rpc(name,{p_company_id:company,p_source_message_id:source,p_actor_user_id:actor});expect(result.error).toBeTruthy();expect(result.data).toBeNull()
 }
 const read=await rpc('ediel_confirmed_customer_snapshot_v1',{p_company_id:company,p_actor_user_id:actor,p_snapshot_id:randomUUID(),p_readset_hash:'a'.repeat(64),p_customer_id:randomUUID(),p_site_id:randomUUID()});expect(read.error).toBeTruthy();expect(read.data).toBeNull()
 expect(sql(`select jsonb_build_object('versions',(select count(*) from gridex_requested_changes.confirmed_customer_versions),'availability',(select count(*) from gridex_requested_changes.customer_version_availability))`)).toEqual(before)
})
it('native HTTP unknown actor/scope cannot archive actual bytes or forge a reviewer event; no archive or event writes occur',async()=>{
 const company=randomUUID(),actor=randomUUID(),artifact=randomUUID(),before=sql(`select jsonb_build_object('archives',(select count(*) from gridex_requested_changes.artifacts),'events',(select count(*) from gridex_requested_changes.events),'reviews',(select count(*) from gridex_requested_changes.reviews))`),rpc=supabaseService.rpc.bind(supabaseService) as unknown as Rpc
 const bytes=Buffer.from('%PDF-1.7\nSYNTHETIC forbidden-scope mechanism only\n%%EOF')
 const archive=await rpc('ediel_archive_requested_change_source_v1',{p_company_id:company,p_actor_user_id:actor,p_submission:{supplyPeriodId:randomUUID(),contractId:randomUUID(),kind:'death',effectiveAt:'2026-10-01T12:00:00Z',source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC',version:'1'},customerIdentity:{},invoiceeProfile:{}}})
 expect(archive.error).toBeTruthy();expect(archive.data).toBeNull()
 const review=await rpc('ediel_review_requested_change_artifact_v1',{p_company_id:company,p_artifact_id:artifact,p_actor_user_id:actor,p_review:{decision:'approve',sourceHash:'a'.repeat(64),claimsHash:'b'.repeat(64),reason:'SYNTHETIC unauthorized review'}})
 expect(review.error).toBeTruthy();expect(review.data).toBeNull()
 expect(sql(`select jsonb_build_object('archives',(select count(*) from gridex_requested_changes.artifacts),'events',(select count(*) from gridex_requested_changes.events),'reviews',(select count(*) from gridex_requested_changes.reviews))`)).toEqual(before)
})
it('installed independent bilateral authority and secrets are private; actual native HTTP hostile actor cannot mint archive, review, version or death/outbound facts',async()=>{
 for(const role of ['anon','authenticated','service_role'])for(const table of ['artifacts','reviews','origins','issuer_keys','representations','revocations'])expect(sql<boolean>(`select to_jsonb(has_table_privilege('${role}','gridex_bilateral_customer_sources.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`)).toBe(false)
 const company=randomUUID(),actor=randomUUID(),artifact=randomUUID(),rpc=supabaseService.rpc.bind(supabaseService) as unknown as Rpc
 const counts=`select jsonb_build_object('artifacts',(select count(*) from gridex_bilateral_customer_sources.artifacts),'origins',(select count(*) from gridex_bilateral_customer_sources.origins),'versions',(select count(*) from gridex_requested_changes.confirmed_customer_versions),'deathEvents',(select count(*) from gridex_requested_changes.events),'outbounds',(select count(*) from public.outbound_requests))`,before=sql(counts)
 const archive=await rpc('ediel_archive_bilateral_customer_source_v1',{p_company_id:company,p_actor_user_id:actor,p_submission:{sourceMessageId:randomUUID(),agreementId:randomUUID(),supplyPeriodId:randomUUID(),contractId:randomUUID(),source:{bytesBase64:Buffer.from('%PDF-1.7\nSYNTHETIC forbidden scope only').toString('base64'),mimeType:'application/pdf',reference:'SYNTHETIC',version:'1'},approved:true,authorizedFields:['310']}})
 expect(archive.error).toBeTruthy();expect(archive.data).toBeNull()
 const review=await rpc('ediel_review_bilateral_customer_source_v1',{p_company_id:company,p_actor_user_id:actor,p_artifact_id:artifact,p_review:{sourceHash:'a'.repeat(64),claimsHash:'b'.repeat(64),decision:'approve',reason:'SYNTHETIC forbidden actor',clause:{locator:'page1',quote:'fake'}}});expect(review.error).toBeTruthy();expect(review.data).toBeNull()
 const read=await rpc('ediel_read_bilateral_customer_source_v1',{p_company_id:company,p_actor_user_id:actor,p_artifact_id:artifact,p_include_bytes:true});expect(read.error).toBeTruthy();expect(read.data).toBeNull();expect(sql(counts)).toEqual(before)
})
