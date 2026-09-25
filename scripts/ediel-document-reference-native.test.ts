import {createServer} from 'node:http'
import {createClient} from '@supabase/supabase-js'
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'
import {supabaseService} from '@/lib/supabase/service'
import {captureCorrectionContext} from '@/lib/ediel/sources/correctionContextCapture'
import {captureDocumentReference,readDocumentReferenceContext} from '@/lib/ediel/sources/documentReferenceCapture'
import {inspectCombinedCorrectionReadset} from '@/lib/ediel/sources/combinedCorrectionReadset'
import {archiveSignedCustomerContractPdf,downloadAndVerifyCustomerContractDocumentBounded} from '@/lib/customer-contracts/documents'
const literal=(v:unknown)=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
function sql<T>(query:string):T{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const out=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim()
 return out?JSON.parse(out) as T:undefined as T
}
const raw=()=>closureFixture({reason:'Z24'}).wire
async function sourceSeed(wire=raw()){
 const companyId=randomUUID(),actorUserId=randomUUID(),sourceMessageId=randomUUID()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.permissions WHERE key='communication.send'`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z05:C:26.A:r3' AND is_enabled`)).toBe(1)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic correction capture','active');
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES(${literal(actorUserId)},'authenticated','authenticated',${literal(`${actorUserId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actorUserId)},${literal(`${actorUserId}@example.invalid`)},'Synthetic capture actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES(${literal(companyId)},${literal(actorUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active)
 SELECT ${literal(actorUserId)},id,'company_admin',${literal(companyId)},'active',true FROM public.roles WHERE key='company_admin' ON CONFLICT DO NOTHING;
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(actorUserId)},${literal(companyId)},id,'communication.send' FROM public.permissions WHERE key='communication.send';
 -- Pin the actual enabled C registry profile like the retained closure fixture.
 -- Code/date-only inference sees L, LK and C as three Z05 candidates; it cannot
 -- use parsed subtype to choose one. Preserve the real receive/commit clock.
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceMessageId)},${literal(companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{"subtype":"C"}',clock_timestamp(),'23-DDQ-PRODAT','12345','54321',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
 WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled;`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceMessageId)}`)).toBe(1)
 expect(sql(`SELECT to_jsonb(company_id=${literal(companyId)}::uuid AND environment='test' AND origin='database_insert'
  AND message_code='Z05' AND raw_payload=${literal(wire)} AND payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')
  AND received_context @> jsonb_build_object('version',1,'contextOrigin','database_insert','sourceMessageId',source_message_id,
   'companyId',company_id,'environment',environment,'messageCode',message_code,'payloadHash',payload_hash)
  AND (received_context->>'sourceReceivedAt')::timestamptz=source_received_at
  AND isfinite((received_context->>'capturedAt')::timestamptz) AND (received_context->>'capturedAt')::timestamptz<=captured_at)
  FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceMessageId)}`)).toBe(true)
 const permission=await supabaseService.rpc('gridex_actor_has_company_permission',{p_actor_user_id:actorUserId,p_company_id:companyId,p_permission:'communication.send'})
 expect(permission.error).toBeNull();expect(permission.data).toBe(true)
 expect(sql(`SELECT jsonb_build_object('companyActive',c.is_active,'companyStatus',c.status,'userStatus',u.user_status,'membershipActive',m.is_active,'membershipStatus',m.status) FROM public.companies c JOIN public.company_memberships m ON m.company_id=c.id JOIN public.user_profiles u ON u.id=m.user_id WHERE c.id=${literal(companyId)} AND u.id=${literal(actorUserId)}`))
  .toEqual({companyActive:true,companyStatus:'active',userStatus:'active',membershipActive:true,membershipStatus:'active'})
 return {companyId,actorUserId,sourceMessageId,environment:'test' as const}
}

const ownedActors:string[]=[]
const ownedObjects:string[]=[]
afterEach(async()=>{
 // Only owned synthetic direct grants; never disable a shared or last admin.
 if(ownedActors.length)sql(`DELETE FROM public.user_permissions WHERE user_id IN (${ownedActors.splice(0).map(literal).join(',')})`)
 if(ownedObjects.length){const result=await supabaseService.storage.from('customer-contract-documents').remove(ownedObjects.splice(0));expect(result.error).toBeNull()}
 vi.restoreAllMocks()
})
async function seed(bytes=Buffer.from('%PDF-1.4\nsynthetic signed context\n%%EOF'),origin='gridex_signed_contract_document_v1'){
 const f=await sourceSeed();ownedActors.push(f.actorUserId)
 const customer=randomUUID(),site=randomUUID(),point=randomUUID(),grid=randomUUID(),contract=randomUUID(),supply=randomUUID()
 expect(sql(`SELECT jsonb_object_agg(key,n) FROM (SELECT key,count(*) n FROM public.permissions WHERE key IN ('communication.send','documents.read','customers.read') AND is_active GROUP BY key) p`))
 .toEqual({'communication.send':1,'documents.read':1,'customers.read':1})
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions WHERE key IN ('documents.read','customers.read');
 INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${literal(customer)},${literal(f.companyId)},${literal(customer)},'Synthetic document customer','private');
 INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${literal(grid)},${literal(f.companyId)},'Synthetic document grid','12345','test',true,'active');
 INSERT INTO public.customer_sites(id,company_id,customer_id,facility_id,grid_owner_id) VALUES(${literal(site)},${literal(f.companyId)},${literal(customer)},'735123456789012345',${literal(grid)});
 INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,grid_owner_id) VALUES(${literal(point)},${literal(f.companyId)},${literal(customer)},${literal(site)},${literal(site)},'735123456789012345','735123456789012345',${literal(grid)});
 INSERT INTO public.customer_contracts(id,company_id,customer_id,customer_site_id,site_id,metering_point_id) VALUES(${literal(contract)},${literal(f.companyId)},${literal(customer)},${literal(site)},${literal(site)},${literal(point)});
 INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,customer_contract_id,contract_id,start_date) VALUES(${literal(supply)},${literal(f.companyId)},${literal(customer)},${literal(point)},${literal(contract)},${literal(contract)},'2026-01-01');
 INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${literal(f.companyId)},'test','electricity',true,clock_timestamp()-interval '1 day');
 INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(f.companyId)},'test',${literal(f.actorUserId)},'EdielId','54321',clock_timestamp()-interval '1 day');
 INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${literal(f.companyId)},'test',${literal(f.actorUserId)},'electricity_supplier',clock_timestamp()-interval '1 day');`)
 for(const permission of ['communication.send','documents.read','customers.read'])expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},${literal(permission)}))`)).toBe(true)
 expect(await captureCorrectionContext(f)).toMatchObject({status:'recorded'})
 const document=await archiveSignedCustomerContractPdf({companyId:f.companyId,customerContractId:contract,pdfBuffer:bytes,generationSnapshot:{schema:origin,synthetic:true}})
 ownedObjects.push(document.storage_path!)
 return {...f,documentId:document.id,document,customer,site,point,grid,contract,supply,bytes}
}
const args=(f:Awaited<ReturnType<typeof seed>>)=>({companyId:f.companyId,sourceMessageId:f.sourceMessageId,documentId:f.documentId,actorUserId:f.actorUserId,environment:f.environment})
const begin=(f:Awaited<ReturnType<typeof seed>>)=>supabaseService.rpc('gridex_begin_document_reference_v1',{p_company_id:f.companyId,p_environment:f.environment,p_source_message_id:f.sourceMessageId,p_document_id:f.documentId,p_actor_user_id:f.actorUserId})
const saved=(f:Awaited<ReturnType<typeof seed>>,cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())'))=>sql<Record<string,unknown>>(`SET ROLE service_role; SELECT public.gridex_read_document_reference_context_v1(${literal(f.companyId)},'test',${literal(f.sourceMessageId)},${literal(f.actorUserId)},${literal(cutoff)});`)

it('clean replay materializes document permission with no implicit role grants',()=>{
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.permissions WHERE key='documents.read' AND is_active`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE key='documents.read')`)).toBe(0)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.permissions WHERE key='customers.read' AND is_active`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE key='customers.read')`)).toBe(0)
})
it('customer registry forward repeats without rewriting metadata or assignments',async()=>{
 const f=await seed()
 const source=execFileSync('git',['show','HEAD:supabase/migrations/20260924021718_customer_read_permission_registry_completion.sql'],{encoding:'utf8'})
 const registry=source.slice(source.indexOf('INSERT INTO public.permissions'),source.indexOf('ON CONFLICT(key) DO NOTHING;')+'ON CONFLICT(key) DO NOTHING;'.length)
 expect(registry).toContain("VALUES ('customers.read'")
 const state=`jsonb_build_object('permission',(SELECT to_jsonb(p) FROM public.permissions p WHERE key='customers.read'),
 'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.role_permissions r),
 'users',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]') FROM public.user_permissions u),
 'overrides',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.user_permission_overrides o))`
 expect(sql(`BEGIN; UPDATE public.permissions SET name='Preserved customer metadata',is_active=false WHERE key='customers.read';
 CREATE TEMP TABLE before_customer_registry AS SELECT ${state} snapshot; ${registry} ${registry}
 SELECT to_jsonb((SELECT snapshot FROM before_customer_registry)=${state}); ROLLBACK;`)).toBe(true)
 expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'customers.read'))`)).toBe(true)
})
it.each(['gridex_signed_contract_document_v1','gridex_imported_signed_contract_document_v1'])('actual synthetic readback is context only for %s',async origin=>{
 const f=await seed(undefined,origin),result=await captureDocumentReference(args(f))
 expect(result).toMatchObject({status:'recorded',observation:'verified_at_observation',authority:'none',coverage:'incomplete'})
 expect(sql(`SELECT jsonb_build_object('attempts',count(*),'differentTransactions',bool_and(a.created_xid<>o.created_xid),'observedHash',min(o.observation->>'sha256')) FROM gridex_received_sources.document_reference_attempts a JOIN gridex_received_sources.document_reference_outcomes o ON o.attempt_id=a.id WHERE a.source_message_id=${literal(f.sourceMessageId)}`))
 .toEqual({attempts:1,differentTransactions:true,observedHash:createHash('sha256').update(f.bytes).digest('hex')})
 expect(saved(f)).toMatchObject({coverage:'incomplete',authority:'none',requiresRevalidation:true})
})
it('the combined receipt includes a real document reference attempt, outcome and witness',async()=>{
 const f=await seed()
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'recorded',observation:'verified_at_observation',authority:'none'})
 const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())')
 const receipt=sql<{snapshotId:string;readsetText:string;readsetHash:string}>(`SET ROLE service_role;
  SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.companyId)},'test',${literal(f.sourceMessageId)},${literal(cutoff)})`)
 const body=JSON.parse(receipt.readsetText) as {document:{attemptCount:number;attempts:{id:string;sourceMessageId:string;documentId:string;
  factsHash:string;outcome:{status:string;observation:{sha256:string};factsHash:string;witnessId:string}}[]};outbound:{originalCount:number}}
 expect(body.document.attemptCount).toBe(1)
 expect(body.document.attempts).toEqual([expect.objectContaining({sourceMessageId:f.sourceMessageId,documentId:f.documentId,
  factsHash:expect.stringMatching(/^[a-f0-9]{64}$/),outcome:expect.objectContaining({status:'verified_at_observation',
   observation:expect.objectContaining({sha256:createHash('sha256').update(f.bytes).digest('hex')}),
   factsHash:expect.stringMatching(/^[a-f0-9]{64}$/),witnessId:expect.stringMatching(/^[0-9a-f-]{36}$/)})})])
 expect(inspectCombinedCorrectionReadset({companyId:f.companyId,environment:'test',cutoffAt:cutoff},f.sourceMessageId,receipt)).not.toBeNull()
 expect(sql(`SELECT to_jsonb(readset_text=${literal(receipt.readsetText)} AND readset_hash=${literal(receipt.readsetHash)})
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(receipt.snapshotId)}`)).toBe(true)
})
it.each([2097152,2097153,10485760])('actual Storage enforces capture byte boundary %i',async size=>{
 const bytes=Buffer.alloc(size,32);bytes.write('%PDF-1.4\n');const f=await seed(bytes)
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'recorded',observation:size===2097152?'verified_at_observation':'unavailable'})
})
it('upsert false and locked archive identity prevent metadata substitution',async()=>{
 const f=await seed();expect((await supabaseService.storage.from('customer-contract-documents').upload(f.document.storage_path!,Buffer.from('different'),{upsert:false,contentType:'application/pdf'})).error).not.toBeNull()
 for(const statement of [`UPDATE public.customer_contract_documents SET document_sha256=repeat('0',64) WHERE id=${literal(f.documentId)}`,`UPDATE public.customer_contract_documents SET storage_path='other' WHERE id=${literal(f.documentId)}`,`UPDATE public.customer_contract_documents SET company_id=${literal(randomUUID())} WHERE id=${literal(f.documentId)}`,`DELETE FROM public.customer_contract_documents WHERE id=${literal(f.documentId)}`])expect(()=>sql(statement)).toThrow()
})
it('raw sealed candidate and durable incomplete epoch survive failure before initial attempt',async()=>{
 const f=await seed();const rpc=vi.spyOn(supabaseService,'rpc').mockImplementationOnce(()=>{throw Error('interrupted')})
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'unconfirmed',coverage:'incomplete'});rpc.mockRestore()
 expect(saved(f)).toMatchObject({sourceMessageId:f.sourceMessageId,sourceScope:{objectId:'735123456789012345'},coverage:'incomplete',attempts:[]})
})
it('missing bytes leave durable attempted/unavailable context',async()=>{
 const f=await seed();await supabaseService.storage.from('customer-contract-documents').remove([f.document.storage_path!])
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'recorded',observation:'unavailable'})
 expect(saved(f)).toMatchObject({attempts:[{documentId:f.documentId,outcome:{observation:{status:'unavailable'}}}]})
})
it('null storage path remains unresolved with no verified observation',async()=>{
 const f=await seed(),id=randomUUID()
 sql(`INSERT INTO public.customer_contract_documents(id,company_id,customer_contract_id,document_type,storage_bucket,storage_path,mime_type,document_sha256,generation_snapshot) VALUES(${literal(id)},${literal(f.companyId)},${literal(f.contract)},'signed_contract_pdf','customer-contract-documents',NULL,'application/pdf',repeat('b',64),'{}')`)
 expect(await captureDocumentReference({...args(f),documentId:id})).toMatchObject({status:'recorded',observation:'unavailable'})
})
it.each(['documents.read','customers.read','communication.send'])('missing effective %s prevents any attempt',async missing=>{
 const f=await seed(),actor=randomUUID();ownedActors.push(actor)
 sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},'{}','{}');
 INSERT INTO public.user_profiles(id,email,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,role,is_active,role_key) VALUES(${literal(f.companyId)},${literal(actor)},'viewer','active','viewer',true,'viewer');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(actor)},${literal(f.companyId)},id,key FROM public.permissions WHERE key IN ('communication.send','documents.read','customers.read') AND key<>${literal(missing)};`)
 expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(actor)},${literal(f.companyId)},${literal(missing)}))`)).toBe(false)
 const storage=vi.spyOn(supabaseService.storage,'from')
 expect(await captureDocumentReference({...args(f),actorUserId:actor})).toMatchObject({status:'unconfirmed'});expect(storage).not.toHaveBeenCalled();storage.mockRestore()
 expect(saved(f)).toMatchObject({attempts:[]})
})
it('foreign document and environment are rejected without new attempts',async()=>{
 const f=await seed(),foreign=await seed()
 expect(await captureDocumentReference({...args(f),documentId:foreign.documentId})).toMatchObject({status:'unconfirmed'})
 expect(await captureDocumentReference({...args(f),environment:'production'})).toMatchObject({status:'unconfirmed'})
 expect(saved(f)).toMatchObject({attempts:[]})
})
it.each(['customer','site','point','supply','party'])('wrong same-company %s graph stays unresolved',async field=>{
 const f=await seed()
 const mutation={customer:`UPDATE public.metering_points SET customer_id=NULL WHERE id=${literal(f.point)}`,site:`UPDATE public.customer_contracts SET customer_site_id=NULL WHERE id=${literal(f.contract)}`,point:`UPDATE public.metering_points SET meter_point_id='735000000000000000' WHERE id=${literal(f.point)}`,supply:`UPDATE public.customer_supply_periods SET customer_contract_id=NULL,contract_id=NULL WHERE id=${literal(f.supply)}`,party:`UPDATE public.tenant_actor_roles SET role_code='grid_owner' WHERE company_id=${literal(f.companyId)}`}[field]!
 sql(mutation)
 if(field==='supply')expect(sql(`SELECT jsonb_build_object('customerContractId',customer_contract_id,'contractId',contract_id) FROM public.customer_supply_periods WHERE id=${literal(f.supply)}`))
  .toEqual({customerContractId:null,contractId:null})
 const storage=vi.spyOn(supabaseService.storage,'from')
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'recorded',observation:'unavailable'})
 expect(storage).not.toHaveBeenCalled()
})
it('interruption before outcome leaves an unresolved committed attempt',async()=>{
 const f=await seed();const original=supabaseService.rpc.bind(supabaseService)
 vi.spyOn(supabaseService,'rpc').mockImplementation((name,params,options)=>{if(name==='gridex_observe_document_reference_v1')throw Error('interrupted');return original(name,params,options)})
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'unconfirmed'})
 expect(saved(f)).toMatchObject({attempts:[{outcome:null,witness:null}]})
})
it('interruption before witness leaves committed unwitnessed outcome',async()=>{
 const f=await seed();const original=supabaseService.rpc.bind(supabaseService)
 vi.spyOn(supabaseService,'rpc').mockImplementation((name,params,options)=>{if(name==='gridex_witness_document_reference_v1')throw Error('interrupted');return original(name,params,options)})
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'unconfirmed'})
 expect(saved(f)).toMatchObject({attempts:[{outcome:{observation:{status:'verified_at_observation'}},witness:null}]})
})
it.each(['before_append','before_witness','after_witness'].flatMap(boundary=>['delete','replace'].map(loss=>({boundary,loss}))))('storage $loss at $boundary preserves old receipt and new reads hold',async({boundary,loss})=>{
 const f=await seed();const original=supabaseService.rpc.bind(supabaseService)
 const lose=async()=>{const result=loss==='delete'?await supabaseService.storage.from('customer-contract-documents').remove([f.document.storage_path!]):await supabaseService.storage.from('customer-contract-documents').upload(f.document.storage_path!,Buffer.from('%PDF-replaced'),{upsert:true,contentType:'application/pdf'});expect(result.error).toBeNull()}
 if(boundary!=='after_witness')vi.spyOn(supabaseService,'rpc').mockImplementation((name,params,options)=>{
  if(name===(boundary==='before_append'?'gridex_observe_document_reference_v1':'gridex_witness_document_reference_v1'))return {abortSignal:async()=>{await lose();return await original(name,params,options)}} as unknown as ReturnType<typeof supabaseService.rpc>
  return original(name,params,options)
 })
 expect(await captureDocumentReference(args(f))).toMatchObject({status:'recorded',observation:'verified_at_observation'})
 vi.restoreAllMocks();const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())'),old=saved(f,cutoff)
 await lose()
 const fresh=await readDocumentReferenceContext({...args(f),cutoff})
 expect(fresh.revalidation).toMatchObject([{status:'recorded',observation:'unavailable'}]);expect(fresh.contentStatus).toBe('document_reference_unavailable');expect(saved(f,cutoff)).toEqual({...old,visibilitySnapshot:expect.any(String)})
})
it('byte replacement is unavailable despite immutable metadata',async()=>{
 const f=await seed();expect((await supabaseService.storage.from('customer-contract-documents').upload(f.document.storage_path!,Buffer.from('%PDF-wrong'),{upsert:true,contentType:'application/pdf'})).error).toBeNull()
 expect(await downloadAndVerifyCustomerContractDocumentBounded(f.document)).toMatchObject({status:'unavailable',reason:'hash_mismatch'})
})
it('direct table access and authenticated RPC are denied; witness requires another transaction',async()=>{
 const f=await seed(),a=await begin(f);expect(a.error).toBeNull()
 for(const role of ['anon','authenticated','service_role'])for(const table of ['document_reference_epoch','document_reference_attempts','document_reference_outcomes','document_reference_witnesses'])expect(()=>sql(`SET ROLE ${role}; SELECT * FROM gridex_received_sources.${table};`)).toThrow()
 expect(()=>sql(`SET ROLE authenticated; SELECT public.gridex_begin_document_reference_v1(${literal(f.companyId)},'test',${literal(f.sourceMessageId)},${literal(f.documentId)},${literal(f.actorUserId)});`)).toThrow()
 expect(()=>sql(`SET ROLE service_role; DO $$ DECLARE a jsonb; BEGIN a:=public.gridex_begin_document_reference_v1(${literal(f.companyId)},'test',${literal(f.sourceMessageId)},${literal(f.documentId)},${literal(f.actorUserId)}); PERFORM public.gridex_observe_document_reference_v1(${literal(f.companyId)},'test',(a->>'attemptId')::uuid,${literal(f.actorUserId)},'{}'); END $$;`)).toThrow()
 for(const table of ['document_reference_epoch','document_reference_attempts'])expect(()=>sql(`DELETE FROM gridex_received_sources.${table};`)).toThrow()
})
it('registry forward first application and repeat preserve assignments and preexisting metadata',()=>{
 const name='20260924013820_document_reference_context.sql'
 const source=execFileSync('git',['show',`HEAD:supabase/migrations/${name}`],{encoding:'utf8'})
 // Execute only the registry statement; table creation is deliberately forward-only.
 const registry=source.slice(source.indexOf('INSERT INTO public.permissions'),source.indexOf('ON CONFLICT(key) DO NOTHING;')+'ON CONFLICT(key) DO NOTHING;'.length)
 const state=`jsonb_build_object('roles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.role_permissions r),'users',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]') FROM public.user_permissions u),'overrides',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.user_permission_overrides o))`
 expect(sql(`BEGIN; CREATE TEMP TABLE before_document_registry AS SELECT ${state} grants;
 DELETE FROM public.permissions WHERE key='documents.read'; ${registry}
 SELECT jsonb_build_object('count',(SELECT count(*) FROM public.permissions WHERE key='documents.read'),'unchanged',(SELECT grants FROM before_document_registry)=${state}); ROLLBACK;`)).toEqual({count:1,unchanged:true})
 expect(sql(`BEGIN; UPDATE public.permissions SET name='Preserved disabled metadata',is_active=false WHERE key='documents.read'; CREATE TEMP TABLE before_document_registry AS SELECT to_jsonb(p) record FROM public.permissions p WHERE key='documents.read'; ${registry} ${registry}
 SELECT to_jsonb((SELECT record FROM before_document_registry)=(SELECT to_jsonb(p) FROM public.permissions p WHERE key='documents.read')); ROLLBACK;`)).toBe(true)
})
it('revoked isolated actor cannot append outcome; legitimate administrator remains active',async()=>{
 const f=await seed(),actor=randomUUID();ownedActors.push(actor)
 sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},'{}','{}');
 INSERT INTO public.user_profiles(id,email,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,role,is_active,role_key) VALUES(${literal(f.companyId)},${literal(actor)},'viewer','active','viewer',true,'viewer');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(actor)},${literal(f.companyId)},id,key FROM public.permissions WHERE key IN ('communication.send','documents.read','customers.read');`)
 const attempt=await begin({...f,actorUserId:actor});expect(attempt.error).toBeNull()
 const id=(attempt.data as {attemptId:string}).attemptId
 sql(`DELETE FROM public.user_permissions WHERE user_id=${literal(actor)} AND permission_key='documents.read';`)
 expect((await supabaseService.rpc('gridex_observe_document_reference_v1',{p_company_id:f.companyId,p_environment:f.environment,p_attempt_id:id,p_actor_user_id:actor,p_observation:{status:'unavailable',reason:'storage_error',startedAt:null,completedAt:null,byteCount:0}})).error).not.toBeNull()
 expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'documents.read'))`)).toBe(true)
})
it('outcome witness cannot certify the append transaction itself',async()=>{
 const f=await seed(),attempt=await begin(f);expect(attempt.error).toBeNull()
 expect(()=>sql(`SET ROLE service_role; DO $$ DECLARE o jsonb; BEGIN o:=public.gridex_observe_document_reference_v1(${literal(f.companyId)},'test',${literal(attempt.data.attemptId)},${literal(f.actorUserId)},'{"status":"unavailable","reason":"storage_error","startedAt":null,"completedAt":null,"byteCount":0}'); PERFORM public.gridex_witness_document_reference_v1(${literal(f.companyId)},'test',(o->>'outcomeId')::uuid,o->>'factsHash'); END $$;`)).toThrow()
})
it('wrong-company actor has no document capture authority',async()=>{
 const f=await seed(),other=await seed(),storage=vi.spyOn(supabaseService.storage,'from')
 expect(await captureDocumentReference({...args(f),actorUserId:other.actorUserId})).toMatchObject({status:'unconfirmed'});expect(storage).not.toHaveBeenCalled();storage.mockRestore()
 expect(saved(f)).toMatchObject({attempts:[]})
})
it('append-only outcome and witness reject service DML and privileged mutation',async()=>{
 const f=await seed(),errors:string[]=[]
 const original=supabaseService.rpc.bind(supabaseService)
 const observed=vi.spyOn(supabaseService,'rpc').mockImplementation(((name:string,input:Record<string,unknown>)=>
  Promise.resolve(original(name,input)).then(result=>{
   if(result.error)errors.push(`${name}:${result.error.code}:${result.error.message}`)
   return result
  })) as unknown as typeof supabaseService.rpc)
 let capture:Awaited<ReturnType<typeof captureDocumentReference>>
 try{capture=await captureDocumentReference(args(f))}finally{observed.mockRestore()}
 expect(capture,JSON.stringify({capture,errors})).toMatchObject({status:'recorded'})
 for(const table of ['document_reference_outcomes','document_reference_witnesses']){
  expect(()=>sql(`SET ROLE service_role; DELETE FROM gridex_received_sources.${table};`)).toThrow()
  expect(()=>sql(`DELETE FROM gridex_received_sources.${table};`)).toThrow()
  expect(()=>sql(`TRUNCATE gridex_received_sources.${table} CASCADE;`)).toThrow()
 }
})
it('saved null-path identity and append visibility survive later row completion and observation',async()=>{
 const f=await seed(),id=randomUUID(),expectedHash=createHash('sha256').update(Buffer.from('%PDF-completed-later')).digest('hex')
 const originalDocument={id,company_id:f.companyId,customer_contract_id:f.contract,document_type:'signed_contract_pdf',storage_bucket:'customer-contract-documents',storage_path:null,mime_type:'application/pdf',document_sha256:expectedHash,generation_snapshot:{schema:'synthetic_null_path_v1',original:true}}
 sql(`INSERT INTO public.customer_contract_documents(id,company_id,customer_contract_id,document_type,storage_bucket,storage_path,mime_type,document_sha256,generation_snapshot) VALUES(${literal(id)},${literal(f.companyId)},${literal(f.contract)},'signed_contract_pdf','customer-contract-documents',NULL,'application/pdf',${literal(expectedHash)},${literal(originalDocument.generation_snapshot)})`)
 expect(await captureDocumentReference({...args(f),documentId:id})).toMatchObject({status:'recorded',observation:'unavailable'})
 const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())'),old=saved(f,cutoff)
 const attempts=old.attempts as Array<{document:unknown;createdXid:string;outcome:{createdXid:string};witness:{visibilitySnapshot:string}}>
 expect(attempts).toHaveLength(1);expect(attempts[0].document).toEqual(originalDocument)
 expect(attempts[0].createdXid).toMatch(/^[0-9]+$/);expect(attempts[0].outcome.createdXid).toMatch(/^[0-9]+$/)
 expect(attempts[0].createdXid).not.toBe(attempts[0].outcome.createdXid);expect(attempts[0].witness.visibilitySnapshot).toMatch(/^[0-9]+:[0-9]+:/)
 const materialized=JSON.stringify(old)
 const completed=await archiveSignedCustomerContractPdf({companyId:f.companyId,customerContractId:f.contract,pdfBuffer:Buffer.from('%PDF-completed-later'),generationSnapshot:{schema:'synthetic_completed_v1',original:false}})
 ownedObjects.push(completed.storage_path!);expect(completed.id).toBe(id)
 const errors:{name:string;code:string;message:string}[]=[]
 const originalRpc=supabaseService.rpc.bind(supabaseService)
 const observe=vi.spyOn(supabaseService,'rpc').mockImplementation((name,params,options)=>{
  const request=originalRpc(name,params,options),then=request.then.bind(request)
  request.then=((resolve,reject)=>then(response=>{
   if(response.error)errors.push({name,code:response.error.code,message:response.error.message})
   return response
  }).then(resolve,reject)) as typeof request.then
  return request
 })
 const completedCapture=await captureDocumentReference({...args(f),documentId:id})
 observe.mockRestore()
 expect(completedCapture,JSON.stringify({rpcErrors:errors,attempts:saved(f).attempts})).toMatchObject({status:'recorded',observation:'verified_at_observation'})
 expect(JSON.stringify(old)).toBe(materialized)
 expect(saved(f,cutoff)).toEqual({...old,visibilitySnapshot:expect.any(String)})
 const current=saved(f).attempts as Array<{document:{storage_path:string|null}}>
 expect(current[0].document).toEqual(originalDocument);expect(current[1].document.storage_path).toBe(completed.storage_path)
})

// Actual installed SDK + Node fetch + loopback TCP. Only client selection is
// redirected; no mock Response, stream, clock or network operation is used.
it.each(['headers','body'])('native SDK aborts a %s stall and rejects a late local response',async phase=>{
 const bytes=Buffer.from('%PDF-local-transport'),hash=createHash('sha256').update(bytes).digest('hex')
 let transportSignal:AbortSignal|undefined,requestCount=0,closedResolve!:()=>void
 const closed=new Promise<void>(resolve=>{closedResolve=resolve})
 let lateResponse:import('node:http').ServerResponse|undefined
 const server=createServer((request,response)=>{
  requestCount++;expect(request.method).toBe('GET');lateResponse=response
  response.on('close',closedResolve)
  response.on('error',()=>{})
  if(phase==='body'){response.writeHead(200,{'content-type':'application/pdf'});response.flushHeaders();response.write(bytes.subarray(0,5))}
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const address=server.address();if(!address||typeof address==='string')throw Error('loopback_server_missing')
 const base=`http://127.0.0.1:${address.port}`
 const client=createClient(base,'synthetic-loopback-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
  if(!String(url).startsWith(base+'/'))throw Error('loopback_only')
  transportSignal=init?.signal??undefined
  return fetch(url,init)
 }}})
 const storage=vi.spyOn(supabaseService.storage,'from').mockImplementation(bucket=>client.storage.from(bucket))
 try{
  const start=performance.now()
  const result=await downloadAndVerifyCustomerContractDocumentBounded({id:randomUUID(),company_id:randomUUID(),customer_contract_id:randomUUID(),document_type:'signed_contract_pdf',storage_bucket:'customer-contract-documents',storage_path:'synthetic-stall.pdf',mime_type:'application/pdf',document_sha256:hash,generation_snapshot:{schema:'synthetic_transport'},generated_at:new Date().toISOString(),created_at:new Date().toISOString(),archived_at:null,verified_at:null})
  expect(result).toMatchObject({status:'unavailable',reason:'timeout'});expect(performance.now()-start).toBeGreaterThanOrEqual(9900);expect(performance.now()-start).toBeLessThan(15000)
  expect(requestCount).toBe(1);expect(transportSignal?.aborted).toBe(true)
  let closeTimer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([closed,new Promise<never>((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('transport_not_cancelled')),1500)})])}finally{clearTimeout(closeTimer)}
  expect(lateResponse?.destroyed).toBe(true)
  // A late producer cannot turn the already returned observation into success.
  lateResponse?.end(bytes);expect(result.status).toBe('unavailable')
 }finally{
  storage.mockRestore();server.closeAllConnections()
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
 }
},20000)
