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
 console.log('Actual positive ACK service-scope SQL consumer: '+scopeChecks+' PASS; synthetic source/storage dependencies, NOT native/legal approval proof')

 // All declarations below are finite synthetic dependency fixtures. Genuine
 // native multi-mission publication/storage/replay is a separate suite.
 await db.exec("CREATE TABLE public.metering_points(id uuid,company_id uuid,customer_id uuid,ediel_metering_point_id text,meter_point_id text,metering_point_id text,customer_site_id uuid,site_id uuid);CREATE TABLE gridex_ediel_inbound_context.receipts(company_id uuid,source_message_id uuid,environment text,status text,context jsonb);")
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001015846_ediel_service_scope_grant_set_and_projection_entry.sql',import.meta.url),'utf8'))
 let grantSetChecks=0
 const multiCheck=async fn=>{await fn();grantSetChecks++}
 await multiCheck(async()=>{await requireScope();assert.deepEqual(await effects(),stable)})
 const secondFields={...fields,beneficiary_company_id:uid(3),purpose:'quality-monitoring',field_sets:['quality']}
 await db.exec("INSERT INTO companies VALUES('"+uid(3)+"','active');INSERT INTO company_memberships VALUES('"+uid(3)+"','"+uid(20)+"','active',true,now())")
 const second=await command({action:'create_assignment',commandId:uid(500),fields:secondFields})
 assert.equal(second.status,'held')
 const aid2=second.assignmentId
 const kinds=['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles']
 for(let i=0;i<kinds.length;i++){
  const staged=await command({action:'stage_evidence',commandId:uid(510+i),assignmentId:aid2,expectedVersion:1,fields:{kind:kinds[i],source_reference:'DECLARED SYNTHETIC DEPENDENCY '+kinds[i],source_sha256:'d'.repeat(64),source_version:'grant-set-fixture',valid_from:'2000-01-01',valid_to:null,...(kinds[i]==='end_user_contract'?{permission_agreement_reference:'SOURCE-DECLARED-ANJ'}:{})}})
  assert.equal(staged.status,'pending')
  // The separate archive/review/issuer producer is deliberately not simulated
  // as authentic here. Its dependency is a labelled, exact finite fixture.
  await db.query("UPDATE ediel_service_evidence SET status='verified',approved_by=$1,approved_at='2000-01-01',approved_assignment_version=1 WHERE id=$2",[uid(20),staged.evidenceId])
 }
 const approved2=await command({action:'approve_assignment',commandId:uid(520),assignmentId:aid2,expectedVersion:1})
 assert.equal(approved2.status,'approved_waiting_permission')
 await db.query('INSERT INTO ediel_assignment_permission_links(id,company_id,assignment_id,permission_id) VALUES($1,$2,$3,$4)',[uid(530),uid(1),aid2,uid(201)])
 const grant2=await command({action:'create_grant',commandId:uid(531),assignmentId:aid2,expectedVersion:2,fields:{permission_link_id:uid(530),object_ids:['point-a'],product_ids:['8716867000030'],fields:['quality'],data_start:'2026-01-01',data_end:'2027-01-01',valid_from:'2000-01-01',valid_to:null}})
 const published2=await command({action:'publish_grant',commandId:uid(532),assignmentId:aid2,expectedVersion:2,grantId:grant2.grantId,expectedGrantVersion:1})
 assert.equal(published2.status,'active')
 const raw2=ackRaw.replace('+A++','+MULTI++').replace('BGM+312+A','BGM+312+MULTI').replace('UNZ+1+A','UNZ+1+MULTI')
 const projection=async(raw=raw2)=>(await db.query('SELECT gridex_ediel_ack_replay.positive_service_scope_projection_v1($1,$2,$3,$4) p',[uid(1),'test',uid(210),raw])).rows[0].p
 await multiCheck(async()=>{const p=await projection();assert.equal(p.version,2);assert.equal(p.transactions.length,1);assert.deepEqual(p.transactions[0].scopes.map(s=>s.grant.id).sort(),[grant.grantId,grant2.grantId].sort());assert.deepEqual(p.transactions[0].scopes.map(s=>s.assignment.beneficiary_company_id).sort(),[uid(2),uid(3)].sort())})
 await multiCheck(async()=>{await requireScope();const p=(await db.query('SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE ack_raw_hash=encode(sha256(convert_to($1,\'UTF8\')),\'hex\')',[ackRaw])).rows[0].projection;assert.equal(p.version,1);assert.equal(p.transactions[0].grant.id,grant.grantId)})
 await multiCheck(async()=>{await capture(raw2);await requireScope(raw2);const e=await effects();assert.equal(e.receipts,2);await capture(raw2);await requireScope(raw2);assert.deepEqual(await effects(),e)})
 const multiStable=await effects()
 const multiHeld=async(change,pattern)=>{await db.exec('BEGIN');try{await db.exec(change);await assert.rejects(requireScope(raw2),pattern)}finally{await db.exec('ROLLBACK')}assert.deepEqual(await effects(),multiStable);await requireScope(raw2)}
 await multiCheck(()=>multiHeld("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id='"+grant2.grantId+"'",/captured_grant_not_current/))
 await multiCheck(()=>multiHeld("UPDATE ediel_service_evidence SET status='revoked' WHERE assignment_id='"+aid2+"' AND kind='dso_contract'",/captured_grant_not_current/))
 await multiCheck(async()=>{await assert.rejects(db.exec("UPDATE ediel_service_assignments SET customer_id='"+uid(999)+"' WHERE id='"+aid2+"'"),/identity_immutable/);await requireScope(raw2);assert.deepEqual(await effects(),multiStable)})
 await multiCheck(()=>multiHeld("UPDATE ediel_service_assignments SET purpose='caller-change' WHERE id='"+aid2+"'",/captured_grant_not_current/))
 await multiCheck(()=>multiHeld("UPDATE tenant_ediel_profiles SET is_enabled=false",/current_captured_role_unavailable/))
 await multiCheck(()=>multiHeld("UPDATE service_actor_permission_fixture SET allowed=false",/actor_not_authorized/))
 await multiCheck(()=>multiHeld("UPDATE source_authority_fixture SET allowed=false",/current_grant_required|captured_grant_not_current/))
 await multiCheck(()=>multiHeld("UPDATE metering_permission_sites SET end_at='2026-01-15'",/current_grant_required|captured_grant_not_current/))
 const beneficiaryPage=(beneficiary,grantId,purpose,requested)=>db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,2,$4,$5,$6,$7,$8)',[beneficiary,uid(20),grantId,purpose,uid(211),requested,'2026-01-01','2026-02-01'])
 await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-02',17.250,'KWH','56','220')",[uid(540),uid(1),uid(211)])
 await multiCheck(async()=>{const rows=(await beneficiaryPage(uid(2),grant.grantId,'analysis',['quantity'])).rows[0].ediel_beneficiary_series_page_v1.rows;assert.deepEqual(rows,[{quantity:'17.250'}])})
 await multiCheck(async()=>{const rows=(await beneficiaryPage(uid(3),grant2.grantId,'quality-monitoring',['quality'])).rows[0].ediel_beneficiary_series_page_v1.rows;assert.deepEqual(rows,[{quality:'56'}])})
 await multiCheck(async()=>{await assert.rejects(beneficiaryPage(uid(3),grant2.grantId,'quality-monitoring',['quantity']),/outside_grant/);await assert.rejects(beneficiaryPage(uid(2),grant2.grantId,'quality-monitoring',['quality']),/no rows|query returned no rows/);await assert.rejects(beneficiaryPage(uid(999),grant.grantId,'analysis',['quantity']),/beneficiary_forbidden/);assert.deepEqual(await effects(),multiStable)})
 await multiCheck(async()=>{await db.exec('BEGIN');try{await db.exec("UPDATE tenant_actor_roles SET valid_to=now()");await assert.rejects(beneficiaryPage(uid(2),grant.grantId,'analysis',['quantity']),/current_captured_role_unavailable/)}finally{await db.exec('ROLLBACK')}})
 await multiCheck(async()=>{const definition=(await db.query("SELECT pg_get_functiondef('public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,uuid)'::regprocedure) body")).rows[0].body;assert.ok(definition.indexOf('lock_current_graph_v2')<definition.indexOf('beneficiary_series_page_filtered_v2'));assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_ediel_ack_replay.current_service_grant_set_v2(uuid,text,jsonb,text,text,text,timestamptz,timestamptz,jsonb,uuid[])','EXECUTE') allowed")).rows[0].allowed,false)})
 await db.exec("CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_ediel_source_rules;ALTER TABLE gridex_received_sources.permission_transitions ADD company_id uuid,ADD source_message_id uuid,ADD payload_hash text,ADD permission_id uuid,ADD qualified_expected_message_code text,ADD qualified_original_message_id uuid;")
 await db.exec(getFunction(new URL('../supabase/migrations/20260930202616_ediel_native_aperak_own_erc_scope.sql',import.meta.url),'CREATE OR REPLACE FUNCTION gridex_ack_authority.wire_v1'))
 await db.exec(getFunction(new URL('../supabase/migrations/20260930203615_ediel_ack_first14_and_committed_replay.sql',import.meta.url),'CREATE OR REPLACE FUNCTION gridex_ack_authority.source_match_v1'))
 await db.exec(getFunction(new URL('../supabase/migrations/20260930231746_ediel_native_prodat_ack_immutable_scope.sql',import.meta.url),'CREATE FUNCTION gridex_ediel_ack_guide.prodat_outcomes_v1'))
 const prodatRaw="UNB+UNOC:3+54321:14+21660:14+261001:1200+P++23-DDQ-PRODAT++++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z14+PZ14+9'DTM+137:202610011200:203'NAD+FR+54321:160:SVK'NAD+DO+21660:160:SVK'LIN+1++point-a:::9'UNT+7+1'UNZ+1+P'"
 const prodatAck="UNB+UNOC:3+21660:14+54321:14+261001:1200+PA++23-DDQ-PRODAT++++1'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++34'RFF+ACW:PZ14'NAD+FR+21660:160:SVK'NAD+DO+54321:160:SVK'ERC+100::260'FTX+AAO+++OK'RFF+Z07:point-a'UNT+9+1'UNZ+1+PA'"
 const prodatBasis={...serviceBasis,family:'PRODAT',code:'Z14',applicationReference:'23-DDQ-PRODAT',canonicalProjection:{...serviceBasis.canonicalProjection,applicationReferences:['23-DDQ-PRODAT']}}
 await db.query('INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,application_reference) VALUES($1,$2,\'test\',\'inbound\',\'PRODAT\',\'Z14\',$3,\'23-DDQ-PRODAT\')',[uid(550),uid(1),prodatRaw])
 await db.query('INSERT INTO gridex_ediel_inbound_context.fixture VALUES($1,$2,$3)',[uid(1),uid(550),prodatBasis])
 await db.exec("CREATE FUNCTION gridex_ediel_source_rules.require_v1(c uuid,s uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF c='"+uid(1)+"' AND s='"+uid(550)+"' AND EXISTS(SELECT FROM gridex_received_sources.permission_transitions WHERE company_id=c AND source_message_id=s) THEN RETURN jsonb_build_object('fixture','EXPLICIT SYNTHETIC SOURCE-RULE DEPENDENCY');END IF;RAISE EXCEPTION 'source_rules_fixture_unavailable';END$$;")
 await db.query("INSERT INTO gridex_received_sources.permission_transitions(company_id,source_message_id,payload_hash,permission_id,qualified_expected_message_code,qualified_original_message_id) VALUES($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,'Z14',$5)",[uid(1),uid(550),prodatRaw,uid(201),uid(202)])
 const requireProdat=()=>db.query('SELECT gridex_ediel_ack_replay.require_positive_service_scope_v1($1,$2,$3,$4)',[uid(1),'test',uid(550),prodatAck])
 await multiCheck(async()=>{await capture(prodatAck,uid(1),'test',uid(550));await requireProdat();const p=(await db.query('SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE source_message_id=$1',[uid(550)])).rows[0].projection;assert.equal(p.scopeKind,'prescribed_prodat_permission_ack');assert.equal(p.dataAccessGranted,false);assert.equal(p.permissionTransitions.length,1);assert.equal(p.outcomes[0].outcome,'positive');assert.equal(p.transactions,undefined)})
 await multiCheck(async()=>{await db.exec('BEGIN');try{await db.exec("DELETE FROM gridex_received_sources.permission_transitions WHERE source_message_id='"+uid(550)+"'");await assert.rejects(requireProdat(),/source_rules_fixture_unavailable|prodat_own_commit_required/)}finally{await db.exec('ROLLBACK')}await requireProdat()})
 await multiCheck(async()=>{await db.exec('BEGIN');try{await db.exec("UPDATE tenant_actor_roles SET valid_to=now()");await assert.rejects(requireProdat(),/current_captured_role_unavailable/)}finally{await db.exec('ROLLBACK')}await requireProdat()})
 await multiCheck(async()=>{await assert.rejects(capture(prodatAck.replace('RFF+Z07:point-a','RFF+Z07:OTHER'),uid(1),'test',uid(550)),/physical_scope_required/);await assert.rejects(capture(prodatAck.replace('RFF+ACW:PZ14','RFF+ACW:FORGED'),uid(1),'test',uid(550)),/physical_scope_required/)})

 let tenChecks=0
 const tenCheck=async fn=>{await fn();tenChecks++}
 let inTx=false
 const readOnly=async fn=>{if(!inTx)return fn();await db.exec('SAVEPOINT ten_read');try{await fn()}finally{await db.exec('ROLLBACK TO SAVEPOINT ten_read')}}
 const grantVersion=async id=>Number((await db.query('SELECT version FROM ediel_data_access_grants WHERE id=$1',[id])).rows[0].version)
 const tenPage=(beneficiary,grantId,version,purpose,requested)=>db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) p',[beneficiary,uid(20),grantId,version,purpose,uid(211),requested,'2026-01-01','2026-02-01'])
 // A third active tenant shares the platform and the GSRN but holds no grant.
 await db.exec("INSERT INTO companies VALUES('"+uid(4)+"','active');INSERT INTO company_memberships VALUES('"+uid(4)+"','"+uid(20)+"','active',true,now())")
 await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-03',18.500,'KWH','56','220')",[uid(640),uid(1),uid(211)])
 const ackHash=raw=>db.query("SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE ack_raw_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[raw])

 // TEN-08: one market reception/ACK, then one internal scope per valid grant.
 await tenCheck(async()=>{const rows=(await ackHash(raw2)).rows;assert.equal(rows.length,1,'one market ACK receipt')
  const scopes=rows[0].projection.transactions[0].scopes
  assert.deepEqual(scopes.map(s=>s.grant.id).sort(),[grant.grantId,grant2.grantId].sort())
  assert.deepEqual(scopes.map(s=>[s.assignment.beneficiary_company_id,s.assignment.purpose]).sort(),[[uid(2),'analysis'],[uid(3),'quality-monitoring']].sort())})
 // Prohibited: no copy to a tenant only because it shares the GSRN/platform.
 await tenCheck(async()=>{const rows=(await ackHash(raw2)).rows;assert.ok(!JSON.stringify(rows).includes(uid(4)))
  for(const g of [grant.grantId,grant2.grantId])await readOnly(()=>assert.rejects(tenPage(uid(4),g,2,'analysis',['quantity']),/beneficiary_forbidden|no rows/))})
 // Each grant distributes only its own purpose and fields.
 await tenCheck(async()=>{assert.deepEqual((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.map(r=>r.quantity).sort(),['17.250','18.500'])
  assert.deepEqual((await tenPage(uid(3),grant2.grantId,2,'quality-monitoring',['quality'])).rows[0].p.rows,[{quality:'56'},{quality:'56'}])
  await readOnly(()=>assert.rejects(tenPage(uid(2),grant.grantId,2,'quality-monitoring',['quantity']),/./))})

 // Time interval is part of the grant scope: a period outside the grant is refused.
 await tenCheck(()=>readOnly(()=>assert.rejects(db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) p',[uid(2),uid(20),grant.grantId,2,'analysis',uid(211),['quantity'],'2025-01-01','2025-02-01']),/outside_grant|series_outside_grant/)))

 // TEN-10: internal revocation is its own event, checked against the current grant version.
 await db.exec('BEGIN');inTx=true
 try {
  const historyBefore=Number((await db.query("SELECT count(*) n FROM ediel_service_history WHERE entity_id=$1",[grant2.grantId])).rows[0].n)
  await db.query("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grant2.grantId])
  const revokedVersion=await grantVersion(grant2.grantId)
  await tenCheck(async()=>{assert.equal(revokedVersion,3)
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,revokedVersion,'quality-monitoring',['quality']),/grant_not_current/))
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,2,'quality-monitoring',['quality']),/grant_not_current/))})
  // Other beneficiaries on the same market permission keep their access.
  await tenCheck(async()=>{assert.equal((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.length,2)})
  // History/audit is retained, not deleted.
  await tenCheck(async()=>{const after=Number((await db.query("SELECT count(*) n FROM ediel_service_history WHERE entity_id=$1",[grant2.grantId])).rows[0].n)
   assert.ok(after>historyBefore);assert.equal((await db.query('SELECT count(*)::int n FROM ediel_data_access_grants WHERE id=$1',[grant2.grantId])).rows[0].n,1)})
  // Market end (Z15) followed by market restoration (Z15C) never touches the internal grant.
  await db.exec("UPDATE metering_permission_sites SET end_at='2026-01-15'")
  await readOnly(()=>assert.rejects(tenPage(uid(2),grant.grantId,2,'analysis',['quantity']),/./))
  await db.exec("UPDATE metering_permission_sites SET end_at='2027-01-01',status='approved'")
  await tenCheck(async()=>{assert.equal((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.length,2,'restored market permission serves the unrevoked grant')
   const g=(await db.query('SELECT status,revoked_at FROM ediel_data_access_grants WHERE id=$1',[grant2.grantId])).rows[0];assert.equal(g.status,'revoked');assert.ok(g.revoked_at)
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,revokedVersion,'quality-monitoring',['quality']),/grant_not_current/))})
  // Prohibited: a revoked grant cannot be switched back on; access needs a new basis.
  await tenCheck(()=>readOnly(()=>assert.rejects(db.query("UPDATE ediel_data_access_grants SET status='active',revoked_at=NULL WHERE id=$1",[grant2.grantId]),/revoked_grant_requires_new_basis/)))
 } finally { await db.exec('ROLLBACK');inTx=false }
 await db.query('DELETE FROM meter_reading_values WHERE id=$1',[uid(640)])
 console.log('TEN-08/TEN-10 grant SQL: '+tenChecks+' PASS; finite synthetic fixtures, NOT native/legal approval proof')
 console.log('Grant-set forward SQL: '+grantSetChecks+' PASS; finite synthetic source/accepted/review fixtures, NOT native/legal approval proof')
 // Restore only the public filtered body and finite dependency context for the
 // unchanged historic administration regression below. No migration bytes or
 // private immutable receipts are modified.
 const oldAdmin=readFileSync(new URL('../supabase/migrations/20260930184042_ediel_service_administration_commands_v1.sql',import.meta.url),'utf8')
 const functionStart=oldAdmin.indexOf('CREATE OR REPLACE FUNCTION public.ediel_beneficiary_series_page_v1'),functionEnd=oldAdmin.indexOf('\nCREATE FUNCTION public.ediel_service_administration_command_v1',functionStart)
 await db.exec(oldAdmin.slice(functionStart,functionEnd))
 await db.query('DELETE FROM meter_reading_values WHERE id=$1',[uid(540)])
 // Existing administration checks below retain their original source fixture.
 await db.exec('UPDATE gridex_ediel_inbound_context.fixture SET basis='+json(basis))
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
