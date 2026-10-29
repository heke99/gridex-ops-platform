// Targeted embedded PostgreSQL owner-command fixtures, not native/real approval evidence.
import{readFileSync}from'node:fs';import{pathToFileURL,fileURLToPath}from'node:url';import assert from'node:assert/strict'
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
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930231633_ediel_service_permission_authentic_agreement_reference.sql',import.meta.url),'utf8'));checks++
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
 const evidence={action:'stage_evidence',commandId:uid(103),assignmentId:aid,expectedVersion:1,fields:{kind:'end_user_contract',permission_agreement_reference:'SOURCE-DECLARED-ANJ',source_reference:'SYNTHETIC pending claim',source_sha256:'a'.repeat(64),source_version:'fixture',valid_from:'2000-01-01',valid_to:null}}
 const pending=await command(evidence);assert.equal(pending.status,'pending');assert.equal(pending.approvalGranted,false);assert.equal((await db.query(`SELECT permission_agreement_reference FROM ediel_service_evidence WHERE id='${pending.evidenceId}'`)).rows[0].permission_agreement_reference,'SOURCE-DECLARED-ANJ');checks++
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

 await db.exec("CREATE SCHEMA extensions;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_ediel_technical_ack;CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.permission_transitions(id uuid);CREATE TABLE gridex_received_sources.validation_assessments(id uuid);CREATE TABLE public.admin_users(id uuid);CREATE TABLE public.user_roles(id uuid);CREATE TABLE public.roles(id uuid);CREATE TABLE public.role_permissions(id uuid);CREATE TABLE public.permissions(id uuid);CREATE TABLE public.user_permissions(id uuid);CREATE TABLE public.service_actor_permission_fixture(company_id uuid,actor_id uuid,allowed boolean);INSERT INTO public.service_actor_permission_fixture VALUES('"+uid(1)+"','"+uid(20)+"',true);ALTER TABLE public.companies ADD status text DEFAULT 'active';ALTER TABLE public.ediel_messages ADD application_reference text;CREATE TABLE gridex_utilts_binding.receipts(source_message_id uuid);ALTER TABLE gridex_utilts_binding.contracts ADD contract_hash text;CREATE TABLE public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,persisted_series_id uuid,disposition text,persistence_status text,planned_response_type text);");
 await db.exec("CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,p text) RETURNS boolean LANGUAGE sql AS $$ SELECT CASE WHEN p='communication.write' THEN coalesce((SELECT allowed FROM public.service_actor_permission_fixture WHERE company_id=c AND actor_id=a),false) ELSE true END $$");
 const getFunction=(path,prefix)=>{const s=readFileSync(path,'utf8'),start=s.indexOf(prefix),end=s.indexOf('END $$;',start);assert.ok(start>=0&&end>start);return s.slice(start,end+7)}
 await db.exec(getFunction(new URL('../supabase/migrations/20260930184410_ediel_protected_technical_contrl_source_basis.sql',import.meta.url),'CREATE FUNCTION gridex_ediel_technical_ack.require_current_endpoint_v1'))
 const atomic=process.env.EDIEL_ATOMIC_ACK_FORWARD||fileURLToPath(new URL('../supabase/migrations/20260930231958_ediel_atomic_ack_owner_persistence.sql',import.meta.url))
 await db.exec(getFunction(atomic,'CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2'))
 await db.exec(getFunction(atomic,'CREATE FUNCTION gridex_ediel_ack_replay.require_current_source_role_v2'))
 // The separate accepted/native owner authority is a finite synthetic fixture.
 // No claim that these fixture rows were minted by its real producer is made.
 await db.exec("CREATE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(c uuid,env text,s uuid,t text,a uuid,r text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.ediel_ack_transaction_results x WHERE x.company_id=c AND x.environment=env AND x.source_message_id=s AND x.source_transaction_id=t AND x.disposition='accepted' AND x.persistence_status='persisted' AND x.planned_response_type='positive_aperak') THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;RETURN jsonb_build_object('authorityVersion',1);END$$;")
 const serviceBasis={...basis,basisKind:'observed_source_persistence',companyId:uid(1),legalEdielId:'21660',applicationReference:'23-DGI-E66-T',transportActorId:uid(30),transportEdielId:'21660',canonicalProjection:{receiverRoles:['esco'],applicationReferences:['23-DGI-E66-T','23-DDQ-E66-T']},facts:{profile:{id:uid(40)}}}
 await db.exec("UPDATE ediel_messages SET application_reference='23-DGI-E66-T' WHERE id='"+uid(210)+"'")
 await db.exec('UPDATE gridex_ediel_inbound_context.fixture SET basis='+json(serviceBasis)+';UPDATE gridex_utilts_binding.contracts SET contract_hash=encode(sha256(convert_to(contract::text,\'UTF8\')),\'hex\');INSERT INTO ediel_ack_transaction_results VALUES(\''+uid(1)+'\',\'test\',\''+uid(210)+'\',\'tx\',\''+uid(211)+'\',\'accepted\',\'persisted\',\'positive_aperak\');')
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930235702_ediel_positive_ack_service_scope.sql',import.meta.url),'utf8'))

 // Missing schema / original-admission ports are declared fixtures, not private
 // receipt results produced by the source/transport owners. Timing and separate
 // archive/review/assignment approval below still run through real commands.
 await db.exec("ALTER TABLE customers ADD UNIQUE(company_id,id);ALTER TABLE ediel_messages ADD IF NOT EXISTS status text,ADD IF NOT EXISTS outbound_request_id uuid,ADD IF NOT EXISTS message_sent_at timestamptz,ADD IF NOT EXISTS immutable_payload_hash text,ADD IF NOT EXISTS immutable_rendered_at timestamptz;ALTER TABLE metering_permissions ADD IF NOT EXISTS source_z13_message_id uuid,ADD IF NOT EXISTS outbound_z13_message_id uuid;CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,source_type text,source_id uuid,request_type text,operation_id uuid,payload jsonb);CREATE TABLE customer_operation_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,task_type text,status text,priority text,title text,description text,assigned_to uuid,metadata jsonb,created_by uuid,updated_by uuid);CREATE SCHEMA gridex_ediel_outbound_owner;CREATE TABLE gridex_ediel_outbound_owner.sc015_original_port(company_id uuid,message_id uuid,sha text);CREATE FUNCTION gridex_ediel_outbound_owner.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.sc015_original_port f JOIN public.ediel_messages e ON e.company_id=f.company_id AND e.id=f.message_id WHERE f.company_id=c AND f.message_id=m AND f.sha=encode(sha256(convert_to(e.raw_payload,'UTF8')),'hex') AND f.sha=e.immutable_payload_hash AND e.immutable_rendered_at IS NOT NULL) THEN RAISE EXCEPTION 'sc015_declared_original_byte_witness_unavailable';END IF;RETURN '{}'::jsonb;END$$;")

 const ackRaw="UNB+UNOC:3+21660:14+54321:14+261001:1200+A++23-DGI-E66-T++++1'UNH+1+APERAK:D:04A:UN:E5SE5A'BGM+312+A+9'ERC+100::260'RFF+DM:OWN'RFF+ACW:tx'UNT+6+1'UNZ+1+A'"
 const capture=(raw=ackRaw,c=uid(1),env='test',s=uid(210),actor=uid(20))=>db.query('SELECT gridex_ediel_ack_replay.capture_positive_service_scope_v1($1,$2,$3,$4,$5)',[c,env,s,raw,actor])
 const requireScope=(raw=ackRaw)=>db.query('SELECT gridex_ediel_ack_replay.require_positive_service_scope_v1($1,$2,$3,$4)',[uid(1),'test',uid(210),raw])
 const effects=async()=>(await db.query('SELECT (SELECT count(*) FROM gridex_ediel_ack_replay.positive_service_scope_receipts) receipts,(SELECT count(*) FROM ediel_messages) messages,(SELECT count(*) FROM ediel_data_access_grants) grants')).rows[0]
 const check=async fn=>{await fn();scopeChecks++};let scopeChecks=0
 await check(async()=>{await capture();await requireScope();assert.equal((await effects()).receipts,1)})
 const stable=await effects()
 await check(async()=>{await capture();await requireScope();assert.deepEqual(await effects(),stable)})
 await check(async()=>{await assert.rejects(capture(ackRaw,uid(2)),/actor_not_authorized/);await assert.rejects(capture(ackRaw,uid(1),'production'),/historical_identity_basis_unavailable|current_captured_role_unavailable/);assert.deepEqual(await effects(),stable)})
 await check(async()=>{await assert.rejects(capture(ackRaw.replace('RFF+ACW:tx','RFF+ACW:tx\'RFF+ACW:tx')),/positive_reference_invalid/);await assert.rejects(capture(ackRaw.replace('ERC+100','ERC+40')),/positive_reference_unavailable/);assert.deepEqual(await effects(),stable)})
 const held=async(change,restore,pattern)=>{await db.exec(change);await assert.rejects(requireScope(),pattern);assert.deepEqual(await effects(),stable);await db.exec(restore);await requireScope()}
 await check(()=>held("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(1)+"'","UPDATE company_memberships SET is_active=true WHERE company_id='"+uid(1)+"'",/actor_not_authorized/))
 await check(()=>held("UPDATE service_actor_permission_fixture SET allowed=false","UPDATE service_actor_permission_fixture SET allowed=true",/actor_not_authorized/))
 await check(()=>held("UPDATE user_profiles SET user_status='suspended'","UPDATE user_profiles SET user_status='active'",/actor_not_authorized/))
 await check(()=>held("UPDATE tenant_ediel_profiles SET is_enabled=false","UPDATE tenant_ediel_profiles SET is_enabled=true",/current_captured_role_unavailable/))
 await check(()=>held("UPDATE tenant_actor_roles SET valid_to=now()","UPDATE tenant_actor_roles SET valid_to=null",/current_captured_role_unavailable/))
 await check(()=>held("UPDATE tenant_actor_identifiers SET valid_to=now()","UPDATE tenant_actor_identifiers SET valid_to=null",/endpoint_unqualified/))
 await check(()=>held("UPDATE source_authority_fixture SET allowed=false","UPDATE source_authority_fixture SET allowed=true",/unique_current_grant_required/))
 await check(()=>held("UPDATE metering_permission_sites SET end_at='2026-01-15'","UPDATE metering_permission_sites SET end_at='2027-01-01'",/unique_current_grant_required/))
 await check(()=>held("UPDATE ediel_ack_transaction_results SET persistence_status='failed'","UPDATE ediel_ack_transaction_results SET persistence_status='persisted'",/storage_unavailable/))
 const rolledBackHold=async(change,pattern)=>{await db.exec('BEGIN');try{await db.exec(change);await assert.rejects(requireScope(),pattern)}finally{await db.exec('ROLLBACK')}assert.deepEqual(await effects(),stable);await requireScope()}
 await check(()=>rolledBackHold("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now()",/unique_current_grant_required/))
 await check(()=>rolledBackHold("UPDATE ediel_data_access_grants SET valid_from='2001-01-01'",/receipt_changed/))
 await check(()=>rolledBackHold("UPDATE ediel_service_evidence SET status='revoked' WHERE kind='dso_contract'",/unique_current_grant_required/))
 await check(()=>rolledBackHold("UPDATE ediel_service_assignments SET purpose='changed'",/unique_current_grant_required/))
 await check(()=>rolledBackHold("INSERT INTO ediel_data_access_grants(company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,valid_to,status) SELECT company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,valid_to,'active' FROM ediel_data_access_grants",/unique_current_grant_required/))
 await check(()=>rolledBackHold("UPDATE ediel_messages SET application_reference='23-DDQ-E66-T' WHERE id='"+uid(210)+"'",/source_unqualified/))
 await check(async()=>{await db.exec("UPDATE ediel_messages SET execution_context_snapshot='{"+'"serviceAssignmentId":"FORGED","authorized":true'+"}' WHERE id='"+uid(210)+"'");await requireScope();assert.deepEqual(await effects(),stable)})
 await check(async()=>{const mixedRaw=ackRaw.replace("UNT+6+1'","ERC+40::260'RFF+DM:OTHER'RFF+ACW:UNACCEPTED'UNT+9+1'");const proof=(await db.query('SELECT gridex_ediel_ack_replay.positive_service_scope_projection_v1($1,$2,$3,$4) p',[uid(1),'test',uid(210),mixedRaw])).rows[0].p;assert.deepEqual(proof.transactions.map(t=>t.transactionId),['tx']);assert.deepEqual(await effects(),stable)})
 await check(async()=>{await assert.rejects(db.exec('DELETE FROM gridex_ediel_ack_replay.positive_service_scope_receipts'),/scope_immutable/);await assert.rejects(db.exec('TRUNCATE gridex_ediel_ack_replay.positive_service_scope_receipts'),/scope_immutable/)})
 await check(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_ediel_ack_replay.positive_service_scope_receipts','INSERT') direct,has_function_privilege('service_role','gridex_ediel_ack_replay.capture_positive_service_scope_v1(uuid,text,uuid,text,uuid)','EXECUTE') capture,has_function_privilege('authenticated','gridex_ediel_ack_replay.require_positive_service_scope_v1(uuid,text,uuid,text)','EXECUTE') replay")).rows[0];assert.deepEqual(acl,{direct:false,capture:false,replay:false})})

 const {createHash,createHmac}=await import('node:crypto')
 await db.exec("ALTER TABLE permissions ADD key text UNIQUE,ADD name text,ADD description text,ADD category text,ADD is_active boolean DEFAULT true;ALTER TABLE user_permissions ADD user_id uuid,ADD company_id uuid,ADD permission_id uuid,ADD permission_key text,ADD is_active boolean DEFAULT true,ADD status text DEFAULT 'active',ADD effect text DEFAULT 'allow';ALTER TABLE user_roles ADD user_id uuid,ADD role_id uuid,ADD company_id uuid,ADD is_active boolean DEFAULT true,ADD status text DEFAULT 'active';ALTER TABLE roles ADD is_active boolean DEFAULT true;ALTER TABLE role_permissions ADD role_id uuid,ADD permission_id uuid,ADD permission_key text,ADD effect text DEFAULT 'allow';")
 await db.exec("ALTER TABLE ediel_service_evidence ADD IF NOT EXISTS permission_agreement_reference text,ADD IF NOT EXISTS permission_requested_method text;CREATE SCHEMA gridex_metering_method_changes;CREATE FUNCTION gridex_metering_method_changes.requested_method_supported_v1(method text) RETURNS boolean LANGUAGE sql AS 'SELECT $1 IN (''Z03'',''Z04'')'")
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000926_ediel_service_evidence_archive_review.sql',import.meta.url),'utf8'))
 await db.exec(getFunction(new URL('../supabase/migrations/20260930235816_ediel_service_permission_source_requested_method.sql',import.meta.url),'CREATE OR REPLACE FUNCTION public.ediel_service_administration_command_v1'))
 if(process.env.EDIEL_PERMISSION_TERMS_BASELINE!=='1') await db.exec(readFileSync(new URL('../supabase/migrations/20261001041436_ediel_service_evidence_source_permission_terms.sql',import.meta.url),'utf8'))
 await db.exec("UPDATE metering_permissions SET metadata=jsonb_set(metadata,'{marketPermission,mode}','\"S17\"'::jsonb)")
 let evidenceChecks=0;const echeck=async f=>{await f();evidenceChecks++}
 const reviewer=uid(320),keyid=uid(321),nativeScope=(await db.query('SELECT gridex_service_administration.scope_v1(a) s FROM ediel_service_assignments a WHERE a.id=$1',[aid])).rows[0].s,scopeHash=(await db.query('SELECT encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,\'UTF8\')),\'hex\') h FROM ediel_service_assignments a WHERE a.id=$1',[aid])).rows[0].h
 const pdf=Buffer.from('%PDF-1.7\nSynthetic bounded ESCO contract archive. NOT external issuer approval.\n%%EOF'),pdfHash=createHash('sha256').update(pdf).digest('hex'),syntheticKey=Buffer.alloc(32,0x49)
 // Explicit synthetic trusted issuer provisioning is distinct from review or
 // acceptance receipts. No service evidence is inserted as verified.
 await db.query('INSERT INTO auth.users VALUES($1)',[reviewer]);await db.query("INSERT INTO user_profiles VALUES($1,'active')",[reviewer]);await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[uid(1),reviewer])
 await db.query("INSERT INTO gridex_ediel_services.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES($1,$2,'test','synthetic-ESCO-issuer','SYNTHETIC LOCAL FIXTURE NOT EXTERNAL AUTHORITY',$3,$4,'2000-01-01','2099-01-01')",[keyid,uid(1),pdfHash,syntheticKey])
 const heldAssessment=async()=>(await db.query('SELECT ediel_service_assignment_assessment_v1($1,$2) r',[uid(1),aid])).rows[0].r
 await echeck(async()=>{assert.equal((await heldAssessment()).status,'held');await assert.rejects(requireScope(),/unique_current_grant_required/)})
 const archive=(submission,actor=uid(20),company=uid(1))=>db.query('SELECT ediel_archive_service_evidence_v1($1,$2,$3) r',[company,actor,submission]).then(r=>r.rows[0].r)
 const review=(artifact,evidence,actor=reviewer,changes={})=>db.query('SELECT ediel_review_service_evidence_v1($1,$2,$3,$4,$5) r',[uid(1),actor,artifact.artifactId,evidence,{decision:'approve',reason:'Independent synthetic mechanism review, not legal certification',sourceHash:artifact.sourceHash,scopeHash:artifact.scopeHash,...changes}]).then(r=>r.rows[0].r)
 const nativeTerms=(await db.query("SELECT gridex_ediel_services.evidence_terms_v1(jsonb_populate_record(NULL::public.ediel_service_evidence,'{\"valid_from\":\"2000-01-01T00:00:00Z\",\"valid_to\":null}')) t")).rows[0].t
 let lastArtifact,lastEvidence,lastSubmission;const nativeArtifacts=[]
 const staged=await command({action:'stage_evidence',commandId:uid(329),assignmentId:aid,expectedVersion:2,fields:{kind:'end_user_contract',source_reference:'missing-external-issuer',source_sha256:pdfHash,source_version:'synthetic-v1',valid_from:'2000-01-01',valid_to:null}})
 const unauth=await archive({assignmentId:aid,scopeBasisVersion:1,kind:'end_user_contract',terms:nativeTerms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'missing-external-issuer',version:'synthetic-v1'}})
 await echeck(async()=>{assert.ok(unauth.missing.includes('authentic_current_issuer_and_representation_receipt'));await assert.rejects(review(unauth,staged.evidenceId),/reviewer_forbidden/)})
 // Materialized permission gets no default role/user grants.
 await echeck(async()=>{assert.equal((await db.query("SELECT count(*) n FROM user_permissions WHERE permission_key='ediel.service_evidence.review'")).rows[0].n,0)})
 await db.query("INSERT INTO user_permissions(id,user_id,company_id,permission_id,permission_key) SELECT $1,$2,$3,id,key FROM permissions WHERE key='ediel.service_evidence.review'",[uid(322),reviewer,uid(1)])
 await echeck(async()=>{assert.equal((await review(unauth,staged.evidenceId)).status,'held');assert.equal((await db.query('SELECT status FROM ediel_service_evidence WHERE id=$1',[staged.evidenceId])).rows[0].status,'pending')})
 let index=0
 for(const kind of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles']){
  index++;const representationId=uid(330+index),reference='synthetic-ESCO-'+kind,sourceVersion='synthetic-v1'
  await db.query("INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES($1,$2,'test',$3,$4,$5,$6,$7,$8,$9,'SYNTHETIC LOCAL LEGAL REPRESENTATION FIXTURE',$10,'2000-01-01','2099-01-01')",[representationId,uid(1),keyid,uid(30),uid(2),uid(10),uid(31),kind,scopeHash,pdfHash])
  const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-ESCO-issuer',receiptId:uid(350+index),companyId:uid(1),environment:'test',assignmentId:aid,scopeBasisVersion:1,scope:nativeScope,evidenceKind:kind,evidenceTerms:nativeTerms,sourceHash:pdfHash,sourceReference:reference,sourceVersion,transportRelationId:null,transportActorId:null,issuedAt:'2026-01-01T00:00:00Z',expiresAt:'2090-01-01T00:00:00Z'},raw=Buffer.from(JSON.stringify(payload))
  const submission={assignmentId:aid,scopeBasisVersion:1,kind,terms:nativeTerms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:sourceVersion},issuerReceipt:{keyId:keyid,representationId,payloadBase64:raw.toString('base64'),signatureHex:createHmac('sha256',syntheticKey).update(raw).digest('hex')}}
  const artifact=await archive(submission),evidence=await command({action:'stage_evidence',commandId:uid(370+index),assignmentId:aid,expectedVersion:2,fields:{kind,source_reference:reference,source_sha256:pdfHash,source_version:sourceVersion,valid_from:'2000-01-01',valid_to:null}})
  assert.deepEqual(artifact.missing,['separate_qualified_reviewer_required']);assert.equal((await review(artifact,evidence.evidenceId)).status,'verified');evidenceChecks++
  nativeArtifacts.push({artifact,evidence:evidence.evidenceId,submission});lastArtifact=artifact;lastEvidence=evidence.evidenceId;lastSubmission=submission
 }
 await echeck(async()=>{assert.equal((await heldAssessment()).status,'authorized');await assert.rejects(requireScope(),/receipt_changed/);const freshRaw=ackRaw.replace('+A+', '+NATIVE-REVIEW-A+');await capture(freshRaw);await requireScope(freshRaw)})
 await echeck(async()=>{const got=(await db.query('SELECT ediel_read_service_evidence_archive_v1($1,$2,$3,true) r',[uid(1),reviewer,lastArtifact.artifactId])).rows[0].r;assert.equal(got.sourceHash,pdfHash);assert.equal(got.bytesBase64,pdf.toString('base64'));assert.equal(got.issuerCurrent,true);assert.equal(got.marketActivationGranted,false)})
 await echeck(async()=>{await assert.rejects(review(lastArtifact,lastEvidence,uid(20)),/reviewer_forbidden/);await assert.rejects(review(lastArtifact,lastEvidence,reviewer,{sourceHash:'f'.repeat(64)}),/actual_hash_required/);await assert.rejects(archive({...lastSubmission,scopeBasisVersion:2}),/current_scope_required/)})
 const eEffects=async()=>(await db.query('SELECT (SELECT count(*) FROM gridex_ediel_services.artifacts) archives,(SELECT count(*) FROM gridex_ediel_services.reviews) reviews,(SELECT count(*) FROM gridex_ediel_ack_replay.positive_service_scope_receipts) ack_receipts')).rows[0]
 const eRollback=async(change,verify)=>{const stableE=await eEffects();await db.exec('BEGIN');try{await db.exec(change);await verify()}finally{await db.exec('ROLLBACK')}assert.deepEqual(await eEffects(),stableE);assert.equal((await heldAssessment()).status,'authorized')}
 await echeck(()=>eRollback("UPDATE user_permissions SET is_active=false WHERE user_id='"+reviewer+"'",async()=>{assert.equal((await heldAssessment()).status,'held');await assert.rejects(review(lastArtifact,lastEvidence),/reviewer_forbidden/)}))
 await echeck(()=>eRollback("UPDATE company_memberships SET is_active=false WHERE user_id='"+reviewer+"'",async()=>{assert.equal((await heldAssessment()).status,'held')}))
 await echeck(()=>eRollback("INSERT INTO gridex_ediel_services.issuer_revocations VALUES('representation','"+uid(335)+"','SYNTHETIC REVOKED',repeat('c',64),now())",async()=>{assert.equal((await heldAssessment()).status,'held');assert.equal((await review(lastArtifact,lastEvidence)).status,'held')}))
 await echeck(()=>eRollback("INSERT INTO gridex_ediel_services.issuer_revocations VALUES('key','"+keyid+"','SYNTHETIC REVOKED',repeat('c',64),now())",async()=>{assert.equal((await heldAssessment()).status,'held')}))
 await echeck(async()=>{await assert.rejects(db.exec('UPDATE gridex_ediel_services.artifacts SET source_bytes=source_bytes||decode(\'00\',\'hex\')'),/original_immutable/);await assert.rejects(db.exec('DELETE FROM gridex_ediel_services.reviews'),/original_immutable/);await assert.rejects(db.exec('TRUNCATE gridex_ediel_services.issuer_keys CASCADE'),/original_immutable/)})
 await echeck(async()=>{const tampered={...lastSubmission,source:{...lastSubmission.source,reference:'tampered-external-contract'},issuerReceipt:{...lastSubmission.issuerReceipt,signatureHex:'a'.repeat(64)}},a=await archive(tampered),e=await command({action:'stage_evidence',commandId:uid(390),assignmentId:aid,expectedVersion:2,fields:{kind:'privacy_roles',source_reference:tampered.source.reference,source_sha256:pdfHash,source_version:'synthetic-v1',valid_from:'2000-01-01',valid_to:null}});assert.ok(a.missing.includes('authentic_current_issuer_and_representation_receipt'));assert.equal((await review(a,e.evidenceId)).status,'held')})
 await echeck(async()=>{const native=(await db.query('SELECT encode(gridex_ediel_services.receipt_hmac_sha256_v1($1,$2),\'hex\') h',[Buffer.from('Independent RFC2104 '+String.fromCodePoint(0x00e5)+' raw payload'),Buffer.alloc(80,0x6b)])).rows[0].h;assert.equal(native,createHmac('sha256',Buffer.alloc(80,0x6b)).update('Independent RFC2104 '+String.fromCodePoint(0x00e5)+' raw payload').digest('hex'))})
 await echeck(async()=>{await db.exec('BEGIN');try{await db.query("INSERT INTO user_permissions(id,user_id,company_id,permission_id,permission_key) SELECT $1,$2,$3,id,key FROM permissions WHERE key='ediel.service_evidence.review'",[uid(399),uid(20),uid(1)]);await assert.rejects(review(lastArtifact,lastEvidence,uid(20)),/separate_owned_review_required/)}finally{await db.exec('ROLLBACK')}})
 await echeck(()=>eRollback("UPDATE ediel_service_evidence SET status='revoked' WHERE id='"+lastEvidence+"'",async()=>{assert.equal((await heldAssessment()).status,'held')}))
 await echeck(async()=>{const changed={...lastSubmission,source:{...lastSubmission.source,reference:'claimed-unbound-terms'},terms:{...lastSubmission.terms,permission_reporting_frequency:'invented'}},a=await archive(changed),e=await command({action:'stage_evidence',commandId:uid(398),assignmentId:aid,expectedVersion:2,fields:{kind:'privacy_roles',source_reference:changed.source.reference,source_sha256:pdfHash,source_version:'synthetic-v1',valid_from:'2000-01-01',valid_to:null,permission_reporting_frequency:'invented'}});assert.ok(a.missing.includes('authentic_current_issuer_and_representation_receipt'));assert.equal((await review(a,e.evidenceId)).status,'held')})
 await echeck(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_ediel_services.reviews','INSERT') receipt,has_table_privilege('service_role','gridex_ediel_services.issuer_keys','SELECT') secrets,has_function_privilege('authenticated','public.ediel_review_service_evidence_v1(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') review")).rows[0];assert.deepEqual(acl,{receipt:false,secrets:false,review:false})})
 await echeck(()=>eRollback("UPDATE metering_permissions SET metadata=jsonb_set(metadata,'{marketPermission,mode}','\"V\"'::jsonb)",async()=>{await assert.rejects(db.query('SELECT gridex_ediel_ack_replay.positive_service_scope_projection_v1($1,$2,$3,$4)',[uid(1),'test',uid(210),ackRaw]),/unique_current_grant_required/)}))

 await db.exec("ALTER TABLE metering_permissions ADD UNIQUE(company_id,id);CREATE TABLE public.user_permission_overrides(id uuid);")
 // The retained resolver above is an explicitly finite READ-ONLY boundary. It
 // grants no archive/source/assignment authority; actual producer gates below
 // exercise new SQL and genuine archive/stage/separate review commands.
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001020640_ediel_service_permission_manual_source_commands.sql',import.meta.url),'utf8'))
 const forward=readFileSync(new URL('../supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql',import.meta.url),'utf8'),producerEnd=forward.indexOf('CREATE TABLE gridex_service_permission.request_timing_receipts(')
 const baseline=process.env.EDIEL_SERVICE_TIMING_BASELINE==='1'
 await db.exec(getFunction(new URL('../supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql',import.meta.url),'CREATE FUNCTION gridex_service_permission.lock_request_writer_v1'))
 const oidBefore=(await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'::regprocedure")).rows[0]
 if(baseline)await db.exec(forward.slice(0,producerEnd)+'COMMIT;');else await db.exec(forward.replace('CREATE FUNCTION gridex_service_permission.lock_request_writer_v1','CREATE OR REPLACE FUNCTION gridex_service_permission.lock_request_writer_v1'))
 let timingChecks=0,serial=0;const tcheck=async f=>{await f();timingChecks++}
 const effectCount=async()=>(await db.query("SELECT jsonb_build_object('permissions',(SELECT count(*) FROM metering_permissions),'links',(SELECT count(*) FROM ediel_assignment_permission_links),'origins',(SELECT count(*) FROM gridex_service_permission.origins)) c")).rows[0].c
 const approveFresh=async({mode='V',start='2020-01-01T00:00:00Z',end=null,networkStart='2026-01-01',networkEnd=null,extra=null}={})=>{
  const count=++serial,created=await command({action:'create_assignment',commandId:uid(5000+count*100),fields:{...fields,mode,data_start:start,data_end:end,purpose:'Synthetic bounded timing purpose '+count,...(extra||{})}}),assignment=created.assignmentId
  const scope=(await db.query('SELECT gridex_service_administration.scope_v1(a) s FROM ediel_service_assignments a WHERE id=$1',[assignment])).rows[0].s,scopehash=(await db.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[scope])).rows[0].h
  if(count===1)await tcheck(async()=>{const before=(await db.query('SELECT count(*) n FROM gridex_ediel_services.artifacts')).rows[0].n;await assert.rejects(archive({assignmentId:assignment,scopeBasisVersion:1,kind:'service_contract',terms:{valid_from:'2000-01-01',valid_to:null,permission_network_contract_start:'2026-01-01',permission_network_contract_end:null},source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'Wrong actual contract kind must not archive DSO timing',version:'synthetic-v1'}}),/ediel_service_archive_network_period_kind_invalid/);assert.equal((await db.query('SELECT count(*) n FROM gridex_ediel_services.artifacts')).rows[0].n,before)})
  for(const [index,kind] of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'].entries()){
   const repr=uid(5001+count*100+index),reference='bounded-network-period-'+count+'-'+kind,terms={valid_from:'2000-01-01',valid_to:null,permission_agreement_reference:kind==='end_user_contract'?'SYN-SIGNED-TIMING-AGREEMENT':null,permission_requested_method:kind==='end_user_contract'?'Z04':null,permission_network_contract_start:kind==='dso_contract'?networkStart:null,permission_network_contract_end:kind==='dso_contract'?networkEnd:null}
   await db.query("INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES($1,$2,'test',$3,$4,$5,$6,$7,$8,$9,'SYNTHETIC EXTERNAL PERIOD FACTS ONLY',$10,'2000-01-01','2099-01-01')",[repr,uid(1),keyid,scope.providerActorId,scope.beneficiaryCompanyId,scope.customerId,scope.dsoActorId,kind,scopehash,pdfHash])
   const normalized=(await db.query('SELECT gridex_ediel_services.evidence_terms_v1(jsonb_populate_record(NULL::public.ediel_service_evidence,$1)) t',[terms])).rows[0].t
   const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-ESCO-issuer',receiptId:uid(5010+count*100+index),companyId:uid(1),environment:'test',assignmentId:assignment,scopeBasisVersion:1,scope,evidenceKind:kind,evidenceTerms:normalized,sourceHash:pdfHash,sourceReference:reference,sourceVersion:'synthetic-v1',transportRelationId:null,transportActorId:null,issuedAt:new Date().toISOString(),expiresAt:'2090-01-01T00:00:00Z'},raw=Buffer.from(JSON.stringify(payload))
   const artifact=await archive({assignmentId:assignment,scopeBasisVersion:1,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:'synthetic-v1'},issuerReceipt:{keyId:keyid,representationId:repr,payloadBase64:raw.toString('base64'),signatureHex:createHmac('sha256',syntheticKey).update(raw).digest('hex')}})
   const staged=await command({action:'stage_evidence',commandId:uid(5020+count*100+index),assignmentId:assignment,expectedVersion:1,fields:{kind,source_reference:reference,source_sha256:pdfHash,source_version:'synthetic-v1',...terms}})
   const reviewed=await review(artifact,staged.evidenceId);assert.equal(reviewed.status,'verified',JSON.stringify({kind,missing:reviewed.missing,artifactMissing:artifact.missing}))
  }
  assert.equal((await command({action:'approve_assignment',commandId:uid(5030+count*100),assignmentId:assignment,expectedVersion:1})).status,'approved_waiting_permission')
  const request=async()=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_coordinate_service_permission_v1($1,$2,$3,2,\'request_access\') r',[uid(1),assignment,uid(20)])).rows[0].r}finally{await db.exec('RESET ROLE')}}
  return{assignment,request}
 }
 await tcheck(async()=>{const f=await approveFresh(),before=await effectCount(),r=await f.request();assert.equal(r.status,'held','old coordinator must not authorize a source period outside three years/network contract');assert.deepEqual(await effectCount(),before)})
 if(baseline)throw Error('baseline unexpectedly passed actual missing timing consumer')
 await tcheck(async()=>{await requireScope(ackRaw.replace('+A+', '+NATIVE-REVIEW-A+'))})
 await tcheck(async()=>{const after=(await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'::regprocedure")).rows[0];assert.deepEqual(after,oidBefore)})
 const period=async(mode,start,end,day,networkStart='2000-01-01',networkEnd=null)=>(await db.query('SELECT gridex_service_permission.evaluate_request_period_v1($1,$2,$3,$4,$5,$6) r',[mode,start,end,day,networkStart,networkEnd])).rows[0].r
 for(const [mode,start,end,day,networkStart,networkEnd,expected] of [
  ['V','2023-02-28T00:00:00Z',null,'2026-02-28','2000-01-01',null,'authorized'],
  ['V','2023-02-27T00:00:00Z',null,'2026-02-28','2000-01-01',null,'held'],
  ['V','2021-02-28T00:00:00Z',null,'2024-02-29','2000-01-01',null,'authorized'],
  ['V','2021-02-27T00:00:00Z',null,'2024-02-29','2000-01-01',null,'held'],
  ['V','2026-03-28T23:30:00Z',null,'2026-03-29','2026-03-29',null,'authorized'],
  ['V','2026-03-28T22:30:00Z',null,'2026-03-29','2026-03-29',null,'held'],
  ['V','2026-10-25T00:00:00Z','2026-10-26T00:00:00Z','2026-10-25','2026-10-25','2026-10-26','authorized'],
  ['V','2026-10-25T00:00:00Z','2026-10-25T12:00:00Z','2026-10-25','2026-10-25',null,'held'],
  ['V','2026-10-24T00:00:00Z',null,'2026-10-25','2000-01-01','2026-10-24','held'],
  ['V','2026-10-26T00:00:00Z',null,'2026-10-25','2000-01-01',null,'held'],
  ['V','2026-10-25T00:00:00Z','2026-10-27T00:00:00Z','2026-10-25','2000-01-01','2026-10-26','held'],
  ['VH','2026-10-24T00:00:00Z','2026-10-24T23:00:00+01:00','2026-10-25','2026-10-24','2026-10-24','authorized'],
  ['VH','2026-10-24T00:00:00Z',null,'2026-10-25','2000-01-01',null,'held'],
  ['VH','2026-10-25T00:00:00Z','2026-10-26T00:00:00Z','2026-10-25','2000-01-01',null,'held'],
  ['VH','2026-10-23T00:00:00Z','2026-10-25T00:00:00Z','2026-10-25','2000-01-01',null,'held'],
  ['VH','2026-10-23T00:00:00Z','2026-10-24T00:00:00Z','2026-10-25','2026-10-24',null,'held'],
  ['VH','2026-10-23T00:00:00Z','2026-10-24T00:00:00Z','2026-10-25','2000-01-01','2026-10-23','held'],
 ])await tcheck(async()=>assert.equal((await period(mode,start,end,day,networkStart,networkEnd)).status,expected))
 const valid=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01'}),first=await valid.request()
 assert.equal(first.status,'permission_required')

 await db.exec(readFileSync(new URL('../supabase/migrations/20261004170000_ediel_service_resolve_permission_request_timing.sql',import.meta.url),'utf8'))
 {
 const valid=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01'}),first=await valid.request()
 assert.equal(first.status,'permission_required')
 let sc015=0
 const probe=async(name,f)=>{await f();sc015++;console.log('SC015 PASS '+name)}
 const purpose=(await db.query('SELECT purpose FROM ediel_service_assignments WHERE id=$1',[valid.assignment])).rows[0].purpose
 const retainedId=uid(88001),retainedIntent=uid(88002),retainedRequest=uid(88003)
 const retainedWire="UNB+UNOC:3+12345:14+54321:14+261003:1200+PENDING++23-DGI-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z13+PENDING-DOC+9'NAD+FR+21660:160:SVK'NAD+DO+54321:160:SVK'LIN+1++point-a:::9'RFF+LI:SC015-RETAINED'UNT+7+M'UNZ+1+PENDING'"
 // Explicit retained source/binding facts stand in for a prior transport owner.
 // They are NOT newly minted authority/results from this finite scenario. No
 // private service archive/review/assignment approval is seeded.
 await db.query('INSERT INTO ediel_message_intents(id) VALUES($1)',[retainedIntent])
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,intent_id,customer_id,raw_payload,status,outbound_request_id,message_sent_at,immutable_rendered_at,immutable_payload_hash) VALUES($1,$2,'test','outbound','PRODAT','Z13',$3,$4,$5,'sent',$6,now()-interval '2 days',now()-interval '2 days',encode(sha256(convert_to($5,'UTF8')),'hex'))",[retainedId,uid(1),retainedIntent,uid(10),retainedWire,retainedRequest])
 await db.query("INSERT INTO outbound_requests VALUES($1,$2,$3,'manual',$4,'metering_access',$5,$6)",[retainedRequest,uid(1),uid(10),retainedIntent,first.permissionId,{servicePermissionCommandKey:retainedIntent,environment:'test'}])
 await db.query("INSERT INTO gridex_service_permission.origins(intent_id,company_id,assignment_id,permission_id,actor_user_id,message_code,command_key,basis,message_id) VALUES($1,$2,$3,$4,$5,'Z13','SC015-DECLARED-PRIOR-ORIGIN',$6,$7)",[retainedIntent,uid(1),valid.assignment,first.permissionId,uid(20),{scopeBasisVersion:1},retainedId])
 await db.query("INSERT INTO gridex_ediel_outbound_owner.sc015_original_port SELECT company_id,id,immutable_payload_hash FROM ediel_messages WHERE id=$1",[retainedId])
 await db.query("UPDATE metering_permissions SET status='waiting_for_customer_approval',source_z13_message_id=$1,outbound_z13_message_id=$1 WHERE id=$2",[retainedId,first.permissionId])
 const old=async()=>(await db.query("SELECT jsonb_build_object('message',(SELECT to_jsonb(m) FROM ediel_messages m WHERE id=$1),'permission',(SELECT to_jsonb(p) FROM metering_permissions p WHERE id=$2),'origin',(SELECT to_jsonb(o) FROM gridex_service_permission.origins o WHERE message_id=$1),'request',(SELECT to_jsonb(r) FROM outbound_requests r WHERE id=$3),'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY id),'[]') FROM ediel_data_access_grants g)) b",[retainedId,first.permissionId,retainedRequest])).rows[0].b
 const before=await old()
 await probe('declared retained original is pending inside its 21-day handling window',async()=>{const row=before.message;assert.equal(before.permission.status,'waiting_for_customer_approval');assert.ok(Date.parse(row.message_sent_at)>Date.now()-21*86400000);assert.equal(row.raw_payload,retainedWire)})
 await db.query('INSERT INTO companies(id) VALUES($1),($2)',[uid(88004),uid(88005)])
 const same=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose,beneficiary_company_id:uid(88004)}})
 const reused=await same.request()
 await probe('other independently reviewed beneficiary shares the retained pending request',async()=>{assert.equal(reused.status,'reuse_permission',JSON.stringify(reused));assert.equal(reused.permissionId,first.permissionId);assert.equal(reused.messageId,retainedId);assert.equal(reused.marketPermissionState,'pending');assert.equal(reused.accessGranted,false);assert.deepEqual(await old(),before)})
 await probe('current immutable timing retry has zero new permission/origin/request/grant effects',async()=>{const count=await effectCount();assert.deepEqual(await same.request(),reused);assert.deepEqual(await effectCount(),count);assert.deepEqual(await old(),before)})
 const third=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose,beneficiary_company_id:uid(88005)}})
 await probe('another tenant identifier cannot bypass same-object pending coordination',async()=>{const r=await third.request();assert.equal(r.status,'reuse_permission');assert.equal(r.permissionId,first.permissionId);assert.equal(r.messageId,retainedId);assert.equal(r.accessGranted,false);assert.deepEqual(await old(),before)})
 const added=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose,beneficiary_company_id:uid(88004),object_ids:['point-a','point-extra']}})
 const next=await added.request()
 await probe('relevant extra object obtains its own source-scoped request immediately',async()=>{assert.equal(next.status,'permission_required',JSON.stringify(next));assert.notEqual(next.permissionId,first.permissionId);const rows=(await db.query('SELECT a.id,a.company_id,a.customer_id,a.provider_actor_id,a.dso_actor_id,a.environment,a.object_ids,p.permission_scope,p.metadata FROM ediel_service_assignments a JOIN ediel_assignment_permission_links l ON l.assignment_id=a.id JOIN metering_permissions p ON p.id=l.permission_id WHERE a.id=ANY($1::uuid[]) ORDER BY a.id',[[valid.assignment,added.assignment]])).rows;assert.equal(rows.length,2);for(const key of ['company_id','customer_id','provider_actor_id','dso_actor_id','environment','permission_scope'])assert.equal(rows[0][key],rows[1][key]);assert.deepEqual((await db.query('SELECT object_ids FROM ediel_service_assignments WHERE id=$1',[added.assignment])).rows[0].object_ids,['point-a','point-extra']);assert.deepEqual(await old(),before)})
 await probe('additional-object request replay retains its immutable owner and does not duplicate',async()=>{const count=await effectCount();assert.deepEqual(await added.request(),next);assert.deepEqual(await effectCount(),count);assert.deepEqual(await old(),before)})
 await probe('current resolver holds missing current timing and gives no beneficiary authority',async()=>{await db.exec('BEGIN');try{await db.query("INSERT INTO gridex_ediel_services.issuer_revocations VALUES('representation',$1,'SC015 current revocation',repeat('c',64),now())",[(await db.query("SELECT r.id FROM gridex_ediel_services.issuer_representations r JOIN ediel_service_assignments a ON r.scope_hash=encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex') WHERE a.id=$1 AND r.evidence_kind='dso_contract'",[same.assignment])).rows[0].id]);const r=await same.request();assert.equal(r.status,'held');assert.deepEqual(await old(),before)}finally{await db.exec('ROLLBACK')}})
 await probe('retained original byte witness cannot be replaced by a current caller',async()=>{await db.exec('BEGIN');try{await db.query('UPDATE ediel_messages SET raw_payload=raw_payload||$1 WHERE id=$2',['forged',retainedId]);await db.exec('SET ROLE service_role');await assert.rejects(db.query("SELECT public.ediel_coordinate_service_permission_v1($1,$2,$3,2,'request_access') r",[uid(1),same.assignment,uid(20)]),/sc015_declared_original_byte_witness_unavailable/)}finally{await db.exec('ROLLBACK')}assert.deepEqual(await old(),before)})
 const currentOwners=[]
 const {readdirSync}=await import('node:fs')
 for(const [file,name,signature,installedSignature] of [
  ['20261001043917_ediel_service_source_network_period_timing.sql','public.ediel_coordinate_service_permission_v1','public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'],
  ['20261004170000_ediel_service_resolve_permission_request_timing.sql','public.ediel_resolve_service_permission_command_v1','public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid)'],
  ['20261001043917_ediel_service_source_network_period_timing.sql','gridex_service_permission.current_request_timing_v1','gridex_service_permission.current_request_timing_v1(uuid,uuid,uuid,bigint,boolean)'],
  ['20261001043917_ediel_service_source_network_period_timing.sql','gridex_service_permission.lock_request_writer_v1','gridex_service_permission.lock_request_writer_v1()'],
  ['20261001020640_ediel_service_permission_manual_source_commands.sql','gridex_service_administration.require_manual_actor_v1','gridex_service_administration.require_manual_actor_v1(uuid,uuid)'],
  ['20261001020640_ediel_service_permission_manual_source_commands.sql','public.ediel_resolve_service_permission_command_v1','public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid)','gridex_service_permission.resolve_before_request_timing_v1(uuid,uuid,uuid,bigint,uuid)'],
  ['20261001020640_ediel_service_permission_manual_source_commands.sql','public.ediel_coordinate_service_permission_v1','public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)','gridex_service_administration.coordinate_before_source_timing_v1(uuid,uuid,uuid,bigint,text)'],
 ]){
  const source=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'),pattern=new RegExp('CREATE(?: OR REPLACE)? FUNCTION '+name.replaceAll('.','\\.')+'\\(','gi'),matches=[...source.matchAll(pattern)]
  assert.equal(matches.length,1);const start=matches[0].index,end=source.indexOf('$$;',source.indexOf('$$',start)+2),definition=source.slice(start,end+3),body=definition.slice(definition.indexOf('$$')+2,definition.lastIndexOf('$$'))
  const actual=(await db.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[installedSignature||signature])).rows[0].prosrc;assert.equal(actual,body,'entire installed body equals exact production owner')
  const names=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort().filter(n=>{pattern.lastIndex=0;return pattern.test(readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8'))})
  if(!installedSignature)assert.equal(names.at(-1),file,'latest explicit current owner definition')
  currentOwners.push({signature:installedSignature||signature,migration:file,latestExplicitDefinition:names.at(-1),definitionSha256:createHash('sha256').update(definition).digest('hex'),installedBodySha256:createHash('sha256').update(actual).digest('hex'),exactBody:true,privatePredecessor:!!installedSignature})
 }
 console.log('SC015_RESULT '+JSON.stringify({checks:sc015,owners:currentOwners,source:{messageId:retainedId,permissionId:first.permissionId,rawAndBindingUnchanged:true,distinctNewObjectPermission:next.permissionId,pendingReuseAccessGranted:false},ports:'Synthetic issuer registry and retained original/binding/transport source; actual archive/review/timing/current coordinator/resolver; NOT native/legal acceptance'}))
 console.log('SC015 pending request current SQL: '+sc015+' PASS; actual owners with finite declared upstream ports; NOT native/legal proof')
 }
 await db.exec("CREATE FUNCTION public.timing_insert_tripwire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'timing_replay_insert_attempt';END $$;CREATE TRIGGER timing_no_link_insert BEFORE INSERT ON ediel_assignment_permission_links FOR EACH ROW EXECUTE FUNCTION timing_insert_tripwire();CREATE TRIGGER timing_no_receipt_insert BEFORE INSERT ON gridex_service_permission.request_timing_receipts FOR EACH ROW EXECUTE FUNCTION timing_insert_tripwire()")
 await tcheck(async()=>{const before=await effectCount();assert.deepEqual(await valid.request(),first);assert.deepEqual(await effectCount(),before)})
 await tcheck(async()=>{const before=await effectCount();await db.exec('BEGIN');try{await db.query("UPDATE user_profiles SET user_status='inactive' WHERE id=$1",[reviewer]);assert.equal((await valid.request()).status,'held');assert.deepEqual(await effectCount(),before)}finally{await db.exec('ROLLBACK')}})
 await db.exec('DROP TRIGGER timing_no_link_insert ON ediel_assignment_permission_links')
 await tcheck(async()=>{const f=await approveFresh({start:'2026-07-01T00:00:00Z',networkStart:'2026-01-01'}),before=await effectCount();await assert.rejects(f.request(),/timing_replay_insert_attempt/);assert.deepEqual(await effectCount(),before);assert.equal((await db.query('SELECT count(*) n FROM gridex_service_permission.request_timing_receipts WHERE assignment_id=$1',[f.assignment])).rows[0].n,0)})
 await tcheck(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_service_permission.request_timing_receipts','SELECT') r,has_table_privilege('service_role','gridex_service_permission.request_timing_receipts','INSERT') w")).rows[0];assert.deepEqual(acl,{r:false,w:false})})
 console.log('Actual timing producer/consumer forward: '+timingChecks+' checks PASS; '+(checks+scopeChecks+evidenceChecks)+' inherited checks PASS; finite retained-source boundary NOT native')
 await db.close();process.exit(0)

 console.log('Actual ESCO archived-source/issuer/separate-review/current-grant mechanism: '+evidenceChecks+' PASS; synthetic trusted catalog/source-storage fixtures, NOT native/external approval proof')
 console.log('Actual positive ACK service-scope SQL consumer: '+scopeChecks+' PASS; synthetic source/storage dependencies, NOT native/legal approval proof')
 // Existing administration checks below retain their original source fixture.
 await db.exec('UPDATE gridex_ediel_inbound_context.fixture SET basis='+json(basis))
 const page=()=>db.query(`SELECT ediel_beneficiary_series_page_v1('${uid(2)}','${uid(20)}','${grant.grantId}',2,'analysis','${uid(211)}',ARRAY['quantity'],'2026-01-01','2026-02-01') result`)
 assert.deepEqual((await page()).rows[0].result.rows,[]);checks++
 // SC020: actual retained reader over the existing qualified finite source;
 // current filtered reader keeps the same permission-phase predicate.
 await db.exec('BEGIN');try{
  await db.query('INSERT INTO meter_reading_values(id,company_id,series_id,reading_at,quantity,unit) VALUES($1,$2,$3,$4,$5,$6)',[uid(212),uid(1),uid(211),'2026-01-02','123.45','KWH'])
  assert.deepEqual((await page()).rows[0].result.rows,[{quantity:'123.45'}])
  await db.query("UPDATE metering_permissions SET status='z13_sent' WHERE id=$1",[uid(201)])
  const readStateSql="SELECT jsonb_build_object('permissions',(SELECT jsonb_agg(p ORDER BY p.id) FROM metering_permissions p),'sites',(SELECT jsonb_agg(s ORDER BY s.id) FROM metering_permission_sites s),'grants',(SELECT jsonb_agg(g ORDER BY g.id) FROM ediel_data_access_grants g),'series',(SELECT jsonb_agg(s ORDER BY s.id) FROM meter_reading_series s),'values',(SELECT jsonb_agg(v ORDER BY v.id) FROM meter_reading_values v)) state"
  const waitingState=(await db.query(readStateSql)).rows[0].state;let disclosed
  await db.exec('SAVEPOINT waiting_read')
  await assert.rejects(async()=>{disclosed=(await page()).rows[0].result},/ediel_market_permission_not_approved/)
  await db.exec('ROLLBACK TO SAVEPOINT waiting_read')
  assert.equal(disclosed,undefined)
  assert.equal((await db.query('SELECT status FROM metering_permissions WHERE id=$1',[uid(201)])).rows[0].status,'z13_sent')
  assert.deepEqual((await db.query(readStateSql)).rows[0].state,waitingState)
 }finally{await db.exec('ROLLBACK')}
 checks++;console.log('SC020 actual retained READ phase: 1 PASS; active quantity123.45 disclosed, z13_sent denied, no data or scope/storage effects; finite fixture, not latest whole-RPC/native proof')
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
 // Named synthetic source-context port isolates the new source field qualifier;
 // no actual issuer/document/approval is invented by this harness.
 await db.exec(`CREATE TABLE fixture_agreement_basis(basis jsonb);INSERT INTO fixture_agreement_basis VALUES('{"status":"authorized","evidenceId":"${pending.evidenceId}","scopeBasisVersion":1}');CREATE OR REPLACE FUNCTION gridex_service_permission.context_before_agreement_reference_v1(c uuid,aid uuid,actor uuid,expected_version bigint,code text,pid uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT basis FROM public.fixture_agreement_basis'`)
 const agreementContext=()=>db.query(`SELECT gridex_service_permission.context_v1('${uid(1)}','${aid}','${uid(20)}',2,'Z13','${uid(202)}') result`)
 assert.equal((await agreementContext()).rows[0].result.agreementReference,'SOURCE-DECLARED-ANJ');checks++
 await assert.rejects(db.exec(`UPDATE ediel_service_evidence SET permission_agreement_reference='EDITED' WHERE id='${pending.evidenceId}'`),/new_source_record/);checks++
 await db.exec(`INSERT INTO ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,status,approved_by,approved_at,approved_assignment_version,permission_agreement_reference) VALUES('${uid(1)}','${aid}','end_user_contract','SYNTHETIC CONFLICT',repeat('c',64),'fixture','2000-01-01','verified','${uid(20)}','2000-01-01',1,'CONFLICT-ANJ')`)
 assert.equal((await agreementContext()).rows[0].result.status,'held');checks++
 // Actual bounded parser tokens, not the earlier grammar fixture, qualify ANJ.
 const root=process.env.EDIEL_SQL_REPOSITORY
 if(!root)throw Error('EDIEL_SQL_REPOSITORY required for actual bounded decoder')
 await db.exec('CREATE SCHEMA IF NOT EXISTS gridex_received_sources')
 const decoder=readFileSync(root+'/supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','utf8');await db.exec(decoder.slice(decoder.indexOf('CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'),decoder.indexOf('-- Keep the existing closure budget')))
 await db.exec(`INSERT INTO ediel_messages(id,company_id,message_code,raw_payload) VALUES('${uid(900)}','${uid(1)}','Z13',$wire$UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z13+SYNTHETIC+9'RFF+ANJ:SOURCE-DECLARED-ANJ'LIN+1'UNT+5+1'$wire$)`)
 const checkWire=()=>db.query(`SELECT gridex_service_permission.require_agreement_reference_v1(m,'{"agreementReference":"SOURCE-DECLARED-ANJ"}') FROM ediel_messages m WHERE id='${uid(900)}'`)
 await checkWire();checks++
 for(const raw of ["UNH+1+PRODAT:D:96B:UN:E2SE6A'RFF+ANJ:FORGED-INTENT-ANJ'", "UNH+1+PRODAT:D:96B:UN:E2SE6A'LIN+1'", "UNH+1+PRODAT:D:96B:UN:E2SE6A'RFF+ANJ:SOURCE-DECLARED-ANJ'RFF+ANJ:SOURCE-DECLARED-ANJ'"]){await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[raw,uid(900)]);await assert.rejects(checkWire(),/authentic_agreement_reference_required/);checks++}
 // The requested-method enum port is a declared synthetic copy of the
 // separate source-generated canonical tuple projection, not legal evidence.
 await db.exec(`CREATE SCHEMA gridex_metering_method_changes;CREATE FUNCTION gridex_metering_method_changes.requested_method_supported_v1(method text) RETURNS boolean LANGUAGE sql AS 'SELECT $1 IN (''Z03'',''Z04'')';`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930235816_ediel_service_permission_source_requested_method.sql',import.meta.url),'utf8'));checks++
 assert.equal((await agreementContext()).rows[0].result.status,'held');checks++
 await assert.rejects(db.exec(`UPDATE ediel_service_evidence SET permission_requested_method='Z04' WHERE id='${pending.evidenceId}'`),/new_source_record/);checks++
 // A separate synthetic new owner scope leaves all old evidence unchanged.
 await db.exec(`INSERT INTO ediel_service_assignments(id,company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,valid_from,status) SELECT '${uid(951)}',company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,valid_from,'held' FROM ediel_service_assignments WHERE id='${aid}';`)
 const newStage={action:'stage_evidence',commandId:uid(950),assignmentId:uid(951),expectedVersion:1,fields:{...evidence.fields,permission_requested_method:'Z04'}}
 const stagedMethod=await command(newStage);assert.equal(stagedMethod.status,'pending');assert.equal(stagedMethod.approvalGranted,false);assert.equal((await db.query(`SELECT permission_requested_method FROM ediel_service_evidence WHERE id='${stagedMethod.evidenceId}'`)).rows[0].permission_requested_method,'Z04');checks++
 await assert.rejects(command({...newStage,commandId:uid(952),fields:{...newStage.fields,permission_requested_method:'Z01'}}),/check constraint/);checks++
 await db.exec(`UPDATE ediel_service_evidence SET status='verified',approved_by='${uid(20)}',approved_at='2000-01-01',approved_assignment_version=1 WHERE id='${stagedMethod.evidenceId}';UPDATE fixture_agreement_basis SET basis='{"status":"authorized","evidenceId":"${stagedMethod.evidenceId}","scopeBasisVersion":1}';`)
 const methodContext=()=>db.query(`SELECT gridex_service_permission.context_v1('${uid(1)}','${uid(951)}','${uid(20)}',1,'Z13','${uid(202)}') result`)
 assert.equal((await methodContext()).rows[0].result.requestedMethod,'Z04');checks++
 await assert.rejects(db.exec(`UPDATE ediel_service_evidence SET permission_requested_method='Z03' WHERE id='${stagedMethod.evidenceId}'`),/new_source_record/);checks++
 await db.exec(`INSERT INTO ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,status,approved_by,approved_at,approved_assignment_version,permission_agreement_reference,permission_requested_method) VALUES('${uid(1)}','${uid(951)}','end_user_contract','SYNTHETIC METHOD CONFLICT',repeat('d',64),'fixture','2000-01-01','verified','${uid(20)}','2000-01-01',1,'SOURCE-DECLARED-ANJ','Z03')`)
 assert.equal((await methodContext()).rows[0].result.status,'held');checks++
 const methodWire=()=>db.query(`SELECT gridex_service_permission.require_requested_method_v1(m,'{"requestedMethod":"Z04","objects":[{},{}]}') FROM ediel_messages m WHERE id='${uid(900)}'`)
 const exactMethodRaw="UNH+1+PRODAT:D:96B:UN:E2SE6A'LIN+1'CCI++Z04'CAV+Z04'LIN+2'CCI++Z04'CAV+Z04'UNT+8+1'"
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[exactMethodRaw,uid(900)]);await methodWire();checks++
 for(const raw of [exactMethodRaw.replace("LIN+2'CCI++Z04'CAV+Z04'","LIN+2'"),exactMethodRaw.replace("CAV+Z04'","CAV+Z03'"),exactMethodRaw.replace("LIN+2'", "CCI++Z04'CAV+Z04'LIN+2'"),exactMethodRaw.replace("LIN+2'CCI++Z04'CAV+Z04'",'')]){await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[raw,uid(900)]);await assert.rejects(methodWire(),/authentic_requested_method_required/);checks++}
 if(process.env.EDIEL_SERVICE_ORIGIN_PROBE_MODULE){const probe=await import(pathToFileURL(process.env.EDIEL_SERVICE_ORIGIN_PROBE_MODULE).href);await probe.default({db,uid,json,command})}
 console.log(`PASS ${checks} targeted service administration PostgreSQL checks; synthetic owner/helper fixtures, not native/legal evidence`)
}finally{await db.close()}
