// Targeted embedded PostgreSQL owner-command fixtures, not native/real approval evidence.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const migration=readFileSync(new URL('../supabase/migrations/20260930143025_ediel_service_assignment_grants_v1.sql',import.meta.url),'utf8')
const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb"
let checks=0
async function command(input,company=uid(1),actor=uid(20)){await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT ediel_service_administration_command_v1('${company}','${actor}',${json(input)}) result`)).rows[0].result}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create table public.companies(id uuid primary key);
 create table public.customers(id uuid primary key,company_id uuid not null);
 create table public.platform_market_actors(id uuid primary key);
 create table public.tenant_ediel_profiles(id uuid primary key,company_id uuid not null,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_counterparty_relations(id uuid primary key,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_actor_roles(id uuid default gen_random_uuid(),company_id uuid,actor_id uuid,environment text,role_code text,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_actor_identifiers(id uuid default gen_random_uuid(),company_id uuid,actor_id uuid,environment text,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 create table public.metering_permissions(id uuid primary key default gen_random_uuid(),company_id uuid not null,customer_id uuid not null,status text,purpose_code text,permission_scope text,requested_start_date date,requested_end_date date,source_z14_message_id uuid,inbound_z14_message_id uuid,product_code text,metadata jsonb);
 create table public.metering_permission_sites(id uuid default gen_random_uuid(),company_id uuid,metering_permission_id uuid,customer_id uuid,facility_id text,status text,start_date date,end_date date,metadata jsonb);
 create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create table public.user_profiles(id uuid,user_status text);
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';
 -- Only grant/projection guards tested here: private source authority is independently exercised by process owner.
 create table public.source_authority_fixture(allowed boolean);insert into public.source_authority_fixture values(true);
 create function public.ediel_permission_source_is_current_v1(uuid,uuid,uuid) returns boolean language sql as 'select allowed from public.source_authority_fixture';
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,execution_context_snapshot jsonb,raw_payload text,intent_id uuid,customer_id uuid);
 create table public.meter_reading_series(source_ediel_message_id uuid,id uuid primary key,company_id uuid,message_code text,series_kind text,external_metering_point_id text,product_id text,period_start timestamptz,period_end timestamptz,registration_date timestamptz,resolution text);
 create table public.meter_reading_values(id uuid primary key,company_id uuid,series_id uuid,reading_at timestamptz,quantity numeric,unit text,quality text,qualifier text);
 create table public.platform_table_classification(table_name text primary key,kind text,rationale text);`)

 await db.exec(migration)
 await db.exec(`ALTER TABLE metering_permissions ADD COLUMN grid_owner_ediel_id text;`)
 await db.exec(`CREATE TABLE public.ediel_message_intents(id uuid primary key);CREATE TABLE public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);CREATE SCHEMA gridex_ediel_transport;CREATE FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT $1';CREATE FUNCTION public.ediel_reserve_wire_reference_namespace_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS 'BEGIN RETURN;END';`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930162005_ediel_service_permission_origination_v1.sql',import.meta.url),'utf8'))
 await db.exec(`INSERT INTO companies VALUES('${uid(1)}'),('${uid(2)}');INSERT INTO customers VALUES('${uid(10)}','${uid(1)}');INSERT INTO auth.users VALUES('${uid(20)}');INSERT INTO user_profiles VALUES('${uid(20)}','active');INSERT INTO company_memberships VALUES('${uid(1)}','${uid(20)}','active',true,now());INSERT INTO platform_market_actors VALUES('${uid(30)}'),('${uid(31)}');INSERT INTO tenant_ediel_profiles VALUES('${uid(40)}','${uid(1)}','test','electricity',true,'2000-01-01',null);INSERT INTO tenant_actor_identifiers(company_id,actor_id,environment,identifier_type,identifier_value,valid_from) VALUES('${uid(1)}','${uid(30)}','test','EdielId','21660','2000-01-01');INSERT INTO tenant_actor_roles(company_id,actor_id,environment,role_code,valid_from) VALUES('${uid(1)}','${uid(30)}','test','energy_service_company','2000-01-01');
 INSERT INTO ediel_service_assignments(company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,valid_from,status) VALUES('${uid(1)}','${uid(2)}','${uid(30)}','${uid(40)}','${uid(10)}','${uid(31)}','test','V','legacy',ARRAY['legacy'],ARRAY['product'],ARRAY['quantity'],'2000-01-01','2000-01-01','active');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930184042_ediel_service_administration_commands_v1.sql',import.meta.url),'utf8'));checks++
 assert.equal((await db.query(`SELECT scope_basis_version FROM ediel_service_assignments`)).rows[0].scope_basis_version,null);checks++
 const fields={beneficiary_company_id:uid(2),provider_actor_id:uid(30),actor_profile_id:uid(40),customer_id:uid(10),dso_actor_id:uid(31),environment:'test',mode:'V',purpose:'analysis',object_ids:['point-a'],product_ids:['8716867000030'],field_sets:['quantity'],data_start:'2026-01-01',data_end:'2027-01-01',valid_from:'2000-01-01',valid_to:null}
 const create={action:'create_assignment',commandId:uid(100),fields}
 const created=await command(create);assert.equal(created.status,'held');const aid=created.assignmentId;assert.equal(created.assignmentVersion,1);checks++
 assert.deepEqual(await command(create),created);checks++
 await assert.rejects(command({...create,fields:{...fields,purpose:'other'}}),/scope_conflict/);checks++
 await assert.rejects(command({...create,commandId:uid(101)},uid(2)),/actor_forbidden/);checks++
 await assert.rejects(command({...create,commandId:uid(101),fields:{...fields,status:'active'}}),/field_forbidden/);checks++
 assert.equal((await db.query(`SELECT scope_basis_version FROM ediel_service_assignments WHERE id='${aid}'`)).rows[0].scope_basis_version,1);checks++
 const approval={action:'approve_assignment',commandId:uid(102),assignmentId:aid,expectedVersion:1}
 assert.equal((await command(approval)).status,'held');assert.equal((await db.query(`SELECT version FROM ediel_service_assignments WHERE id='${aid}'`)).rows[0].version,1);checks++
 const evidence={action:'stage_evidence',commandId:uid(103),assignmentId:aid,expectedVersion:1,fields:{kind:'end_user_contract',source_reference:'SYNTHETIC pending claim',source_sha256:'a'.repeat(64),source_version:'fixture',valid_from:'2000-01-01',valid_to:null}}
 const pending=await command(evidence);assert.equal(pending.status,'pending');assert.equal(pending.approvalGranted,false);checks++
 await assert.rejects(command({...evidence,commandId:uid(104),fields:{...evidence.fields,status:'verified',approved_by:uid(20)}}),/approval_field_forbidden/);checks++
 // Owner verification is an explicit fixture, never exposed by the staging API.
 await db.exec(`UPDATE ediel_service_evidence SET status='verified',approved_by='${uid(20)}',approved_at='2000-01-01',approved_assignment_version=1 WHERE id='${pending.evidenceId}';INSERT INTO ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,status,approved_by,approved_at,approved_assignment_version) SELECT '${uid(1)}','${aid}',kind,'SYNTHETIC NOT LEGAL APPROVAL',repeat('b',64),'fixture','2000-01-01','verified','${uid(20)}','2000-01-01',1 FROM unnest(ARRAY['dso_contract','service_contract','downstream_use','privacy_roles']) kind`)
 const approved=await command({...approval,commandId:uid(105)});assert.equal(approved.status,'approved_waiting_permission');assert.equal(approved.assignmentVersion,2);checks++
 assert.equal((await db.query(`SELECT scope_basis_version FROM ediel_service_assignments WHERE id='${aid}'`)).rows[0].scope_basis_version,1);assert.equal((await db.query(`SELECT ediel_service_assignment_assessment_v1('${uid(1)}','${aid}') result`)).rows[0].result.status,'authorized');checks++
 await db.exec(`INSERT INTO platform_actor_identifiers VALUES('${uid(200)}','${uid(31)}','EdielId','54321',true,'2000-01-01',null);INSERT INTO metering_permissions(id,company_id,customer_id,status,source_z14_message_id,metadata,grid_owner_ediel_id) VALUES('${uid(201)}','${uid(1)}','${uid(10)}','active','${uid(202)}','{"marketPermission":{"legalActor":"21660","dsoActor":"54321","mode":"V"}}','54321');INSERT INTO ediel_assignment_permission_links(id,company_id,assignment_id,permission_id) VALUES('${uid(203)}','${uid(1)}','${aid}','${uid(201)}');INSERT INTO metering_permission_sites(company_id,metering_permission_id,customer_id,facility_id,status,start_at,end_at,metadata) VALUES('${uid(1)}','${uid(201)}','${uid(10)}','point-a','approved','2026-01-01','2027-01-01','{"source":"inbound_prodat_z14","edielMessageId":"${uid(202)}","mode":"S17","product":"8716867000030"}')`)
 const grant=await command({action:'create_grant',commandId:uid(106),assignmentId:aid,expectedVersion:2,fields:{permission_link_id:uid(203),object_ids:['point-a'],product_ids:['8716867000030'],fields:['quantity'],data_start:'2026-01-01',data_end:'2027-01-01',valid_from:'2000-01-01',valid_to:null}})
 assert.equal(grant.status,'held');assert.equal(grant.accessGranted,false);checks++
 const publish={action:'publish_grant',commandId:uid(107),assignmentId:aid,expectedVersion:2,grantId:grant.grantId,expectedGrantVersion:1}
 await assert.rejects(command({...publish,expectedGrantVersion:null}),/grant_version_required/);checks++
 const published=await command(publish);assert.equal(published.status,'active');assert.equal(published.grantVersion,2);checks++
 // Explicit private-authority fixtures below test the projection's dependency
 // usage, not native capture/UTILTS acceptance (covered by their owners).
 await db.exec(`CREATE SCHEMA gridex_ediel_inbound_context;CREATE TABLE gridex_ediel_inbound_context.fixture(company_id uuid,message_id uuid,basis jsonb);CREATE FUNCTION gridex_ediel_inbound_context.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN SELECT basis INTO b FROM gridex_ediel_inbound_context.fixture WHERE company_id=c AND message_id=m;IF b IS NULL THEN RAISE EXCEPTION 'historical_identity_basis_unavailable';END IF;RETURN b;END$$;CREATE SCHEMA gridex_utilts_binding;CREATE TABLE gridex_utilts_binding.contracts(series_id uuid,company_id uuid,source_message_id uuid,transaction_id text,contract jsonb);CREATE FUNCTION gridex_utilts_binding.stored_contract_v1(c uuid,m uuid,t text) RETURNS jsonb LANGUAGE sql AS 'SELECT contract FROM gridex_utilts_binding.contracts WHERE company_id=c AND source_message_id=m AND transaction_id=t';`)
 const tokenizer=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8').match(/CREATE FUNCTION gridex_utilts_binding\.wire_tokens_v1[\s\S]*?END \$\$;/)[0]
 await db.exec(tokenizer)
 const basis={legalActorId:uid(30),actorRole:'energy_service_company',environment:'test',direction:'inbound',family:'UTILTS',code:'E66'},contract={seriesKind:'actual',messageCode:'E66',observations:[{externalPoint:'point-a',productCode:'8716867000030'}]}
 await db.exec(`INSERT INTO company_memberships VALUES('${uid(2)}','${uid(20)}','active',true,now());INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,execution_context_snapshot,raw_payload) VALUES('${uid(202)}','${uid(1)}','test','inbound','PRODAT','Z14','{}',NULL),('${uid(210)}','${uid(1)}','test','inbound','UTILTS','E66','{"receiverActorId":"FORGED-PUBLIC-PROFILE"}',$wire$UNB+UNOC:3+54321:ZZ+21660:ZZ+260930:1200+S'UNH+1+UTILTS:D:23A:UN:E5SE2A'NAD+MS+54321:160:SVK'UNT+3+1'UNZ+1+S'$wire$);INSERT INTO meter_reading_series(id,company_id,source_ediel_message_id,message_code,series_kind,external_metering_point_id,product_id,period_start,period_end) VALUES('${uid(211)}','${uid(1)}','${uid(210)}','E66','actual','point-a','8716867000030','2026-01-01','2027-01-01');INSERT INTO gridex_utilts_binding.contracts VALUES('${uid(211)}','${uid(1)}','${uid(210)}','tx',${json(contract)});INSERT INTO gridex_ediel_inbound_context.fixture VALUES('${uid(1)}','${uid(210)}',${json(basis)});`)
 const page=()=>db.query(`SELECT ediel_beneficiary_series_page_v1('${uid(2)}','${uid(20)}','${grant.grantId}',2,'analysis','${uid(211)}',ARRAY['quantity'],'2026-01-01','2026-02-01') result`)
 assert.deepEqual((await page()).rows[0].result.rows,[]);checks++
 await db.exec(`UPDATE gridex_ediel_inbound_context.fixture SET basis=basis||'{"legalActorId":"${uid(999)}"}'`);await assert.rejects(page(),/source_actor_not_qualified/);checks++
 await db.exec(`UPDATE gridex_ediel_inbound_context.fixture SET basis=${json(basis)};DELETE FROM gridex_ediel_inbound_context.fixture`);await assert.rejects(page(),/historical_identity_basis_unavailable/);checks++
 await db.exec(`INSERT INTO gridex_ediel_inbound_context.fixture VALUES('${uid(1)}','${uid(210)}',${json(basis)});UPDATE metering_permission_sites SET end_at='2026-01-15'`);await assert.rejects(page(),/object_not_approved/);checks++
 const revoke=await command({...publish,action:'revoke_grant',commandId:uid(108),expectedGrantVersion:2});assert.equal(revoke.status,'revoked');checks++
 await assert.rejects(command({...publish,commandId:uid(109),expectedGrantVersion:3}),/revoked_grant_requires_new_basis/);checks++
 assert.equal((await db.query(`SELECT has_table_privilege('service_role','ediel_service_evidence','UPDATE') allowed`)).rows[0].allowed,false);checks++
 await assert.rejects(db.exec(`UPDATE ediel_service_assignments SET scope_basis_version=99 WHERE id='${aid}'`),/server_owned/);checks++
 await db.exec(`UPDATE ediel_service_assignments SET purpose='new purpose' WHERE id='${aid}'`);assert.equal((await db.query(`SELECT scope_basis_version,status FROM ediel_service_assignments WHERE id='${aid}'`)).rows[0].scope_basis_version,2);assert.equal((await db.query(`SELECT ediel_service_assignment_assessment_v1('${uid(1)}','${aid}') result`)).rows[0].result.status,'held');checks++
 await assert.rejects(db.exec('DELETE FROM gridex_service_administration.scope_versions'),/command_immutable/);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ediel_service_administration_command_v1(uuid,uuid,jsonb)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 console.log(`PASS ${checks} targeted service administration PostgreSQL checks; synthetic owner/helper fixtures, not native/legal evidence`)
}finally{await db.close()}
