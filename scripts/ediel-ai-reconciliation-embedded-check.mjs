/** Declared synthetic isolated SQL probe. Its test-only decision stub proves
 * transaction/source mechanics, never a legal owner, native RLS, authentic
 * market history, production activation or acceptance. Real reader stays held. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL)
const db=new PGlite()
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
CREATE TABLE public.user_profiles(id uuid,user_status text);
CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE SCHEMA gridex_received_sources;
CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'received_source_evidence_is_append_only'; END$$;
CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,created_by uuid,message_standard text,message_family text,message_code text,direction text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,sender_ediel_id text,receiver_ediel_id text,file_name text,grid_owner_id uuid,environment text DEFAULT 'test');
CREATE TABLE public.tenant_ediel_profiles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE public.tenant_actor_identifiers(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE public.tenant_actor_roles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE public.ai_list_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,created_by uuid,list_type text,gdpr_basis text,retention_until date,raw_payload text,filename text,grid_owner_id uuid,status text,row_count int,discrepancy_count int,metadata jsonb);
CREATE TABLE public.ai_list_import_rows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,import_id uuid,row_number int,raw_columns jsonb,metering_point_external_id text,matched_metering_point_id uuid,matched_customer_id uuid,matched_customer_site_id uuid,match_status text,discrepancy_reasons text[]);
CREATE TABLE public.ai_list_discrepancies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,import_id uuid,import_row_id uuid,discrepancy_type text,severity text,current_values jsonb,imported_values jsonb,status text);
CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid,full_name text,personal_number text);
CREATE TABLE public.customer_sites(id uuid PRIMARY KEY,company_id uuid,facility_id text,site_name text);
CREATE TABLE public.contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,metadata jsonb);
CREATE TABLE public.customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,metadata jsonb);
CREATE TABLE public.supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,metadata jsonb);
CREATE TABLE public.metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id text,meter_point_id text,ediel_reference text,site_facility_id text,grid_area_code text,grid_owner_ediel_id text);`)
await db.exec(readFileSync(new URL('../supabase/migrations/20260930165219_ediel_ai_processing_decision_consumer.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../supabase/migrations/20260930174145_ediel_ai_source_atomic_reconciliation.sql',import.meta.url),'utf8'))
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',decision='00000000-0000-4000-8000-000000000003',source='00000000-0000-4000-8000-000000000004',point='00000000-0000-4000-8000-000000000005',foreign='00000000-0000-4000-8000-000000000006'
const csv='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;\nOTHER;735123456789012346;9;;;;;Other;12345;Town;12345;;;;;;;199001011234;Person;;;\n'
const hash=createHash('sha256').update(csv,'utf8').digest('hex')
const customer='00000000-0000-4000-8000-000000000007',site='00000000-0000-4000-8000-000000000008'
// The reduced schemas and full-row sentinels are finite test dependencies,
// not genuine customer/supply or legal authority. Snapshot every protected
// table, including foreign rows; a matching GSRN cannot authorize any write.
const protectedTables=['customers','customer_sites','metering_points','contracts','customer_contracts','supplier_switch_requests']
const masterdataSnapshot=async()=>Object.fromEntries(await Promise.all(protectedTables.map(async table=>[table,(await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows.map(result=>result.row)])))
await db.query('INSERT INTO public.companies(id) VALUES($1),($2)',[company,foreign])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
await db.query("INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES($1,'test','electricity',true,now()-interval '1 day')",[company])
await db.query("INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES($1,'test',$2,'EdielId','12345',now()-interval '1 day')",[company,actor])
await db.query("INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES($1,'test',$2,'electricity_supplier',now()-interval '1 day')",[company,actor])
await assert.rejects(()=>db.query("SELECT gridex_ai_processing.header_company_basis_v1($1,'test','99999','54321')",[company]),/ai_bi_header_supplier_tenant_mismatch/)
await assert.rejects(()=>db.query("SELECT gridex_ai_processing.header_company_basis_v1($1,'test','12345','54321')",[company]),/ai_bi_network_registry_version_unqualified/)
// Synthetic sealed source setup only: the real before-storage legal guard is
// separately tested closed. No deployed migration disables that guard.
await db.exec('ALTER TABLE public.ediel_messages DISABLE TRIGGER ai_bi_message_requires_legal_decision')
await db.query("INSERT INTO public.ediel_messages(id,company_id,created_by,message_standard,message_family,message_code,direction,raw_payload,immutable_rendered_at,immutable_payload_hash,sender_ediel_id,receiver_ediel_id) VALUES($1,$2,$3,'ai_list','AI_LIST','AI','inbound',$4,now(),$5,'54321','12345')",[source,company,actor,csv,hash])
const apply=async(c=company,h=hash)=>(await db.query('SELECT gridex_ai_processing.reconcile_source_v1($1,$2,$3,$4) AS result',[c,actor,source,h])).rows[0].result
await assert.rejects(()=>apply(),/ai_bi_processing_decision_missing/)
assert.equal((await db.query('SELECT count(*)::int AS count FROM public.ai_list_imports')).rows[0].count,0)
await db.query("INSERT INTO gridex_ai_processing.decisions(id,company_id,list_type,purpose,revision,gdpr_basis,retention_days,valid_from,source_reference,source_sha256,decision_owner_registry_id,decision_owner_registry_version) VALUES($1,$2,'AI','ediel_list_reconciliation',1,'synthetic-unqualified',1,now()-interval '1 day','synthetic',repeat('a',64),$3,'synthetic-unqualified')",[decision,company,actor])
await assert.rejects(()=>apply(),/ai_bi_processing_decision_owner_registry_unqualified/)
// Explicit test-only stub. This is NOT authentic owner/approval evidence.
await db.exec(`CREATE OR REPLACE FUNCTION gridex_ai_processing.current_decision_v1(c uuid,actor uuid,list_type text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','decision',jsonb_build_object('id','${decision}','companyId',c,'listType',list_type,'gdprBasis','synthetic-unqualified','retentionUntil',current_date+1))$$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.network_registry_basis_v1(network_id text,env text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','syntheticUnqualified',true)$$;
CREATE FUNCTION public.synthetic_row_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.row_number=3 THEN RAISE EXCEPTION 'synthetic_second_row_failure'; END IF; RETURN NEW; END$$;
CREATE TRIGGER synthetic_row_failure BEFORE INSERT ON public.ai_list_import_rows FOR EACH ROW EXECUTE FUNCTION public.synthetic_row_failure();`)
await assert.rejects(()=>apply(),/synthetic_second_row_failure/)
for(const table of ['public.ai_list_imports','public.ai_list_import_rows','public.ai_list_discrepancies','gridex_ai_processing.reconciliation_receipts'])assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,0)
await db.exec('DROP TRIGGER synthetic_row_failure ON public.ai_list_import_rows')
await db.query("INSERT INTO public.customers VALUES($1,$2,'Retained own customer','199001011234'),($3,$3,'Retained foreign customer','FOREIGN')",[customer,company,foreign])
await db.query("INSERT INTO public.customer_sites VALUES($1,$2,'735123456789012345','Retained own site'),($3,$3,'735123456789012346','Retained foreign site')",[site,company,foreign])
for(const table of ['contracts','customer_contracts','supplier_switch_requests'])await db.query(`INSERT INTO public.${table} VALUES($1,$2,$3,'active','{"retained":"own original"}'),($4,$4,$4,'active','{"retained":"foreign original"}')`,[point,company,customer,foreign])
await db.query("INSERT INTO public.metering_points(id,company_id,customer_id,customer_site_id,meter_point_id,grid_area_code,grid_owner_ediel_id) VALUES($1,$2,$5,$6,'735123456789012345','WRONG','54321'),($3,$4,$3,$3,'735123456789012346','OTHER','54321')",[point,company,foreign,foreign,customer,site])
const originalMasterdata=await masterdataSnapshot()
const originalSource=(await db.query('SELECT to_jsonb(m) AS row FROM public.ediel_messages m WHERE id=$1',[source])).rows[0].row
const result=await apply()
assert.equal(result.status,'applied');assert.equal(result.rowCount,2);assert.equal(result.discrepancyCount,2)
const rows=(await db.query('SELECT * FROM public.ai_list_import_rows ORDER BY row_number')).rows
assert.deepEqual(rows[0].discrepancy_reasons,['grid_area_mismatch']);assert.equal(rows[0].matched_metering_point_id,point)
assert.deepEqual(rows[1].discrepancy_reasons,['metering_point_not_found']);assert.equal(rows[1].matched_metering_point_id,null)
assert.equal(rows[0].raw_columns.physical_columns[17],'199001011234');assert.equal(rows[0].raw_columns.source_row_number,2)
assert.equal((await db.query('SELECT grid_area_code FROM public.metering_points WHERE id=$1',[point])).rows[0].grid_area_code,'WRONG')
assert.deepEqual(await masterdataSnapshot(),originalMasterdata)
assert.deepEqual((await db.query('SELECT to_jsonb(m) AS row FROM public.ediel_messages m WHERE id=$1',[source])).rows[0].row,originalSource)
const investigations=(await db.query('SELECT * FROM public.ai_list_discrepancies ORDER BY import_row_id')).rows
assert.equal((await db.query('SELECT status FROM public.ai_list_imports WHERE id=$1',[result.importId])).rows[0].status,'review_required')
assert.equal(investigations.length,2)
for(const row of rows){
 const investigation=investigations.find(item=>item.import_row_id===row.id)
 assert.equal(investigation.company_id,company);assert.equal(investigation.import_id,result.importId);assert.equal(investigation.status,'open')
 assert.equal(investigation.discrepancy_type,row.discrepancy_reasons[0]);assert.deepEqual(investigation.imported_values,row.raw_columns)
 if(row.matched_metering_point_id===point)assert.deepEqual(investigation.current_values,{id:point,company_id:company,customer_id:customer,site_id:site,grid_area_code:'WRONG',grid_owner_ediel_id:'54321'})
 else assert.deepEqual(investigation.current_values,{})
}
const retainedOutcome=(await db.query('SELECT to_jsonb(r) AS row FROM gridex_ai_processing.reconciliation_receipts r WHERE source_message_id=$1',[source])).rows[0].row
assert.equal(retainedOutcome.source_payload_hash,hash);assert.equal(retainedOutcome.import_id,result.importId);assert.deepEqual(retainedOutcome.result,result)
await db.exec("CREATE OR REPLACE FUNCTION gridex_ai_processing.current_decision_v1(c uuid,actor uuid,list_type text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','held','blocker','ai_bi_processing_decision_missing')$$")
assert.deepEqual(await apply(),result)
assert.deepEqual(await masterdataSnapshot(),originalMasterdata)
assert.deepEqual((await db.query('SELECT to_jsonb(r) AS row FROM gridex_ai_processing.reconciliation_receipts r WHERE source_message_id=$1',[source])).rows[0].row,retainedOutcome)
assert.deepEqual((await db.query('SELECT * FROM public.ai_list_discrepancies ORDER BY import_row_id')).rows,investigations)
assert.deepEqual((await db.query('SELECT to_jsonb(m) AS row FROM public.ediel_messages m WHERE id=$1',[source])).rows[0].row,originalSource)
assert.equal((await db.query('SELECT count(*)::int AS count FROM public.ai_list_imports')).rows[0].count,1)
await assert.rejects(()=>apply(company,'b'.repeat(64)),/ai_bi_reconciliation_sealed_source_required/)
await assert.rejects(()=>apply(foreign),/ediel_tenant_actor_forbidden/)
await assert.rejects(()=>db.query('UPDATE gridex_ai_processing.reconciliation_receipts SET source_payload_hash=repeat(\'b\',64)'),/received_source_evidence_is_append_only/)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.gridex_ai_bi_reconcile_source_v1(uuid,uuid,uuid,text)','EXECUTE') AS allowed")).rows[0].allowed,false)
assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_ai_processing.reconciliation_receipts','INSERT') AS allowed")).rows[0].allowed,false)
await db.query("UPDATE public.company_memberships SET status='revoked' WHERE company_id=$1 AND user_id=$2",[company,actor])
await assert.rejects(()=>apply(),/ediel_tenant_actor_forbidden/)
await db.close()
console.log('PASS: synthetic AI atomic rollback, sealed own source, six whole masterdata tables unchanged, open review-required investigation provenance, tenant separation, immutable exact replay and service-only receipt mechanics. Real legal owner stays held; native/replay/RLS/concurrency acceptance NOT RUN.')
