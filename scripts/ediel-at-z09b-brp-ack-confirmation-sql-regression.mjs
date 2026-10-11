// masterplan: AT-Z09B-SUPPLIER
// The BRP Z09/Z27 origination fixture of ediel-brp-change-sql-regression.mjs,
// then the 20261011170000 confirm-on-positive-APERAK authority. The ACK
// authority's scope_outcomes table is a declared fixture with its installed shape.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const quote=s=>"'"+s.replaceAll("'","''")+"'",json=x=>quote(JSON.stringify(x))+'::jsonb';let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid);CREATE TABLE customer_supply_periods(id uuid PRIMARY KEY,company_id uuid);CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text,site_id uuid);CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);
 CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS 'SELECT true';
 CREATE TABLE platform_market_actors(id uuid PRIMARY KEY,status text,match_status text);CREATE TABLE platform_actor_roles(id uuid DEFAULT gen_random_uuid(),actor_id uuid,actor_role text,is_active bool);CREATE TABLE platform_actor_identifiers(id uuid DEFAULT gen_random_uuid(),actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 CREATE TABLE tenant_ediel_profiles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);CREATE TABLE tenant_actor_roles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);CREATE TABLE tenant_actor_identifiers(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE ediel_message_intents(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,operation_id uuid,customer_id uuid,metering_point_id text,validation_status text,application_reference text,communication_route_id uuid,route_profile_id uuid,interchange_reference text,message_reference text,transaction_reference text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,receiver_subaddress text,customer_site_id uuid);
 CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,request_type text,source_type text,source_id uuid,customer_id uuid,communication_route_id uuid,metering_point_id uuid,operation_id uuid,site_id uuid,payload jsonb);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,intent_id uuid,raw_payload text,source_operation_id text,outbound_request_id uuid,customer_id uuid,metering_point_id uuid,communication_route_id uuid,route_profile_id uuid,sender_ediel_id text,receiver_ediel_id text,interchange_reference text,transaction_reference text,site_id uuid);
 CREATE SCHEMA gridex_received_sources;CREATE FUNCTION gridex_received_sources.permission_transition_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'source_immutable';END$$;
 -- This single source-authority helper is declared a fixture; its actual normal
 -- and regulated immutable proofs are independently exercised by the owner.
 CREATE TABLE gridex_received_sources.supply_fixture(basis jsonb);CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS 'SELECT basis FROM gridex_received_sources.supply_fixture';CREATE SCHEMA gridex_utilts_binding;`)
 const tokenizer=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8').match(/CREATE FUNCTION gridex_utilts_binding\.wire_tokens_v1[\s\S]*?END \$\$;/)[0];await db.exec(tokenizer)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930200545_ediel_brp_change_source_origination.sql',import.meta.url),'utf8'));checks++
 await db.exec(`INSERT INTO companies VALUES('${id(1)}'),('${id(2)}');INSERT INTO auth.users VALUES('${id(20)}');INSERT INTO user_profiles VALUES('${id(20)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(20)}','active',true,now());INSERT INTO customers VALUES('${id(3)}','${id(1)}');INSERT INTO customer_supply_periods VALUES('${id(4)}','${id(1)}');INSERT INTO metering_points VALUES('${id(5)}','${id(1)}','${id(3)}','735123456789012345','54321','TES','${id(22)}');INSERT INTO customer_sites VALUES('${id(22)}','${id(1)}','${id(3)}');INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code) VALUES('${id(6)}','${id(1)}','test','inbound','PRODAT','Z04');INSERT INTO platform_market_actors VALUES('${id(7)}','active','verified'),('${id(8)}','active','verified');INSERT INTO platform_actor_roles(actor_id,actor_role,is_active) VALUES('${id(7)}','grid_owner',true),('${id(8)}','balance_responsible',true);INSERT INTO platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified,valid_from) VALUES('${id(7)}','EdielId','54321',true,'2000-01-01'),('${id(8)}','EdielId','11111',true,'2000-01-01');INSERT INTO tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES('${id(1)}','test','${id(9)}','EdielId','12345','2000-01-01');INSERT INTO tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES('${id(1)}','test','${id(9)}','electricity_supplier','2000-01-01');INSERT INTO tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES('${id(1)}','test','electricity',true,'2000-01-01')`)
 const read=()=>db.query(`SELECT ediel_brp_change_source_v1('${id(1)}','${id(10)}','${id(20)}') result`)
 assert.equal((await read()).rows[0].result.status,'held');checks++
 const supply={qualified:true,companyId:id(1),siteId:id(22),customerId:id(3),meteringPointId:id(5),legalActorId:id(9),sourceMessageId:id(6),marketStateVersion:1,dsoEdielId:'54321',sourceObjects:[{point:'735123456789012345',identityAgency:'9',gridArea:'TES'}]}
 await db.exec(`INSERT INTO gridex_received_sources.supply_fixture VALUES(${json(supply)});INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from) VALUES('${id(11)}','${id(1)}','test','${id(7)}','${id(8)}','54321','11111','TES','SYNTHETIC-REGISTRY','SYNTHETIC ORIGINAL',repeat('a',64),gridex_brp_changes.registry_snapshot_v1('${id(7)}','${id(8)}'),'${id(20)}',now(),'2000-01-01');INSERT INTO gridex_brp_changes.events(id,company_id,environment,supply_period_id,customer_id,metering_point_id,legal_actor_id,legal_sender_id,point_id,identity_agency,registry_ground_id,supply_source_message_id,supply_state_version,effective_at,brp_contract_reference,brp_contract_sha256,brp_contract_version,market_decision_reference,source_reference,source_sha256,source_version,approved_by,approved_at) VALUES('${id(10)}','${id(1)}','test','${id(4)}','${id(3)}','${id(5)}','${id(9)}','12345','735123456789012345','9','${id(11)}','${id(6)}',1,date_trunc('day',now()+interval '3 months'),'SYNTHETIC CONTRACT',repeat('b',64),'fixture','SYNTHETIC DECISION','SYNTHETIC EVENT',repeat('c',64),'fixture','${id(20)}',now())`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930211156_ediel_brp_approved_supply_physical_scope.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930230653_ediel_source_producer_physical_site_scope.sql',import.meta.url),'utf8'));checks++
 assert.equal((await read()).rows[0].result.status,'authorized');checks++
 await db.exec(`UPDATE gridex_received_sources.supply_fixture SET basis=jsonb_set(basis,'{sourceObjects,0,point}','"735999999999999999"')`);assert.equal((await read()).rows[0].result.status,'held');checks++;await db.exec(`UPDATE gridex_received_sources.supply_fixture SET basis=${json(supply)}`)
 await db.exec(`UPDATE ediel_messages SET environment='production' WHERE id='${id(6)}'`);assert.equal((await read()).rows[0].result.status,'held');checks++;await db.exec(`UPDATE ediel_messages SET environment='test' WHERE id='${id(6)}'`)
 await db.exec(`UPDATE gridex_received_sources.supply_fixture SET basis=basis||'{"marketStateVersion":2}'`);assert.equal((await read()).rows[0].result.status,'held');checks++
 await db.exec(`UPDATE gridex_received_sources.supply_fixture SET basis=${json(supply)};UPDATE platform_actor_roles SET is_active=false WHERE actor_role='balance_responsible'`);assert.equal((await read()).rows[0].result.status,'held');checks++
 await db.exec(`UPDATE platform_actor_roles SET is_active=true;INSERT INTO tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES('${id(1)}','test','${id(30)}','EdielId','22222','2000-01-01')`);assert.equal((await read()).rows[0].result.status,'held');checks++
 await db.exec(`DELETE FROM tenant_actor_identifiers WHERE actor_id='${id(30)}'`)
 await db.exec(`INSERT INTO ediel_message_intents VALUES('${id(12)}','${id(1)}','test','outbound','PRODAT','Z09','${id(10)}','${id(3)}','735123456789012345','validated','23-DDQ-PRODAT','${id(13)}','${id(14)}','SYNTHETIC-UNB','1','SYNTHETIC-LI','99111','54321',NULL,NULL,'${id(22)}');INSERT INTO outbound_requests VALUES('${id(15)}','${id(1)}','customer_masterdata','manual','${id(12)}','${id(3)}','${id(13)}','${id(5)}','${id(10)}','${id(22)}','{"environment":"test"}')`)
 const reserve=()=>db.query(`SELECT ediel_reserve_brp_change_origin_v1('${id(1)}','${id(10)}','${id(20)}','${id(12)}','${id(15)}') result`)
 for(const sql of ["UPDATE ediel_message_intents SET customer_site_id=NULL","UPDATE outbound_requests SET site_id=NULL","UPDATE outbound_requests SET payload='{\"environment\":\"production\"}'"]){await db.exec(sql);await assert.rejects(reserve(),/owned_intent_request_required/);checks++;await db.exec(`UPDATE ediel_message_intents SET customer_site_id='${id(22)}';UPDATE outbound_requests SET site_id='${id(22)}',payload='{"environment":"test"}'`)}
 assert.equal((await reserve()).rows[0].result.status,'reserved');assert.equal((await reserve()).rows[0].result.status,'reserved');checks++
 const stamp=(await db.query(`SELECT to_char(effective_at AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI') value FROM gridex_brp_changes.events`)).rows[0].value
 const raw=`UNB+UNOC:3+99111:ZZ+54321:ZZ+260930:1200+SYNTHETIC-UNB++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z09+SYNTHETIC-UNB+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++735123456789012345:SR::9'DTM+157:${stamp}:203'CCI++Z13'CAV+Z27'RFF+Z05:TES'RFF+LI:SYNTHETIC-LI'NAD+Z02+11111:160:SVK'UNT+12+1'UNZ+1+SYNTHETIC-UNB'`
 const insert=wire=>db.exec(`INSERT INTO ediel_messages VALUES('${id(16)}','${id(1)}','test','outbound','PRODAT','Z09','${id(12)}',${quote(wire)},'${id(10)}','${id(15)}','${id(3)}','${id(5)}','${id(13)}','${id(14)}','99111','54321','SYNTHETIC-UNB','SYNTHETIC-LI','${id(22)}')`)
 await assert.rejects(insert(raw.replace('NAD+Z02+11111','NAD+Z02+22222')),/exact_wire_basis_required/);checks++
 await assert.rejects(insert(raw.replace('99111:ZZ','99111:ZZ:FOREIGN')),/exact_wire_basis_required/);checks++
 assert.equal((await db.query(`SELECT gridex_brp_changes.wire_v1(${quote(raw.replace("BGM+Z09+SYNTHETIC-UNB+9'","BGM+Z09+SYNTHETIC-UNB+9'BGM+Z09+DUPLICATE+9'"))}) wire`)).rows[0].wire,null);checks++
 assert.equal((await db.query('SELECT count(*) n FROM gridex_brp_changes.period_versions')).rows[0].n,0);checks++
 await db.exec(`UPDATE outbound_requests SET source_id='${id(99)}' WHERE id='${id(15)}'`);await assert.rejects(insert(raw),/owned_request_changed/);checks++;await db.exec(`UPDATE outbound_requests SET source_id='${id(12)}' WHERE id='${id(15)}'`)
 await insert(raw);assert.equal((await db.query('SELECT count(*) n FROM gridex_brp_changes.period_versions')).rows[0].n,1);checks++
 // AT-Z09B: the dated BRP version is a declaration until its own Z09/Z27 is acknowledged.
 await db.exec(`ALTER TABLE ediel_messages ADD COLUMN status text DEFAULT 'sent',ADD COLUMN contrl_status text DEFAULT 'pending',ADD COLUMN aperak_status text DEFAULT 'pending';
  CREATE SCHEMA gridex_ack_authority;CREATE TABLE gridex_ack_authority.scope_outcomes(source_message_id uuid,ack_family text,outcome text)`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261011170000_ediel_brp_change_ack_received_confirmation.sql',import.meta.url),'utf8'));checks++
 const confirmations=async()=>(await db.query('SELECT event_id,company_id,environment,message_id FROM gridex_brp_changes.confirmations')).rows
 const versions=async()=>(await db.query(`SELECT ediel_brp_responsibility_history_v1('${id(1)}','${id(4)}','${id(20)}') result`)).rows[0].result.versions
 const ack=(status,aperak)=>db.exec(`UPDATE ediel_messages SET status='${status}',aperak_status='${aperak}' WHERE id='${id(16)}'`)
 const outcome=(family,o)=>db.exec(`INSERT INTO gridex_ack_authority.scope_outcomes VALUES('${id(16)}','${family}','${o}')`)
 const reset=()=>db.exec(`DELETE FROM gridex_ack_authority.scope_outcomes;UPDATE ediel_messages SET status='sent',contrl_status='pending',aperak_status='pending' WHERE id='${id(16)}'`)
 const v0=await versions();assert.equal(v0.length,1);assert.equal(v0[0].status,'source_declared');assert.equal(v0[0].confirmedAt,null);checks++
 // CONTRL alone confirms nothing.
 await outcome('CONTRL','positive');await db.exec(`UPDATE ediel_messages SET contrl_status='received' WHERE id='${id(16)}'`);await ack('sent','pending')
 assert.deepEqual(await confirmations(),[]);checks++;await reset()
 // A negative APERAK confirms nothing, also when acknowledged is (wrongly) reached.
 await outcome('APERAK','negative');await ack('acknowledged','received');assert.deepEqual(await confirmations(),[]);checks++;await reset()
 // A positive APERAK with any negative scope outcome confirms nothing.
 await outcome('APERAK','positive');await outcome('APERAK','negative');await ack('acknowledged','received');assert.deepEqual(await confirmations(),[]);checks++;await reset()
 // A positive APERAK outcome before the final acknowledgement confirms nothing.
 await outcome('APERAK','positive');await ack('sent','received');assert.deepEqual(await confirmations(),[]);checks++;await reset()
 // Wrong correlation: an unbound Z09 of the same tenant reaching a positive APERAK confirms nothing.
 await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload) VALUES('${id(41)}','${id(1)}','test','outbound','PRODAT','Z09',${quote(raw)});
  INSERT INTO gridex_ack_authority.scope_outcomes VALUES('${id(41)}','APERAK','positive');UPDATE ediel_messages SET status='acknowledged',aperak_status='received' WHERE id='${id(41)}'`)
 assert.deepEqual(await confirmations(),[]);checks++
 // Wrong direction: an inbound Z09 of the same bytes never confirms.
 await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload) VALUES('${id(42)}','${id(1)}','test','inbound','PRODAT','Z09',${quote(raw)});
  INSERT INTO gridex_ack_authority.scope_outcomes VALUES('${id(42)}','APERAK','positive');UPDATE ediel_messages SET status='acknowledged',aperak_status='received' WHERE id='${id(42)}'`)
 assert.deepEqual(await confirmations(),[]);checks++
 // An acknowledged AI list naming the BRP does not replace Z09B: no version, no confirmation.
 await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload) VALUES('${id(43)}','${id(1)}','test','outbound','AI_LIST','AI','SYNTHETIC AI LIST balansansvarsId=11111');
  INSERT INTO gridex_ack_authority.scope_outcomes VALUES('${id(43)}','APERAK','positive');UPDATE ediel_messages SET status='acknowledged',aperak_status='received' WHERE id='${id(43)}'`)
 assert.deepEqual(await confirmations(),[]);assert.equal((await versions()).length,1);checks++
 // A revoked event confirms nothing (rolled back so the valid receipt is proven next).
 await db.exec('BEGIN');await db.exec(`INSERT INTO gridex_brp_changes.revocations VALUES('event','${id(10)}','SYNTHETIC REVOCATION',repeat('e',64),'${id(20)}',now())`)
 await outcome('APERAK','positive');await ack('acknowledged','received');assert.deepEqual(await confirmations(),[]);checks++;await db.exec('ROLLBACK')
 // A changed original (bound bytes no longer match the origin hash) confirms nothing.
 await db.exec('BEGIN');await db.exec(`ALTER TABLE ediel_messages DISABLE TRIGGER USER;UPDATE ediel_messages SET raw_payload=replace(raw_payload,'CAV+Z27','CAV+Z28') WHERE id='${id(16)}';ALTER TABLE ediel_messages ENABLE TRIGGER USER`)
 await outcome('APERAK','positive');await ack('acknowledged','received');assert.deepEqual(await confirmations(),[]);checks++;await db.exec('ROLLBACK')
 // The valid receipt: final acknowledgement with a positive APERAK confirms exactly its own event once.
 await outcome('CONTRL','positive');await outcome('APERAK','positive');await ack('acknowledged','received')
 assert.deepEqual(await confirmations(),[{event_id:id(10),company_id:id(1),environment:'test',message_id:id(16)}]);checks++
 await ack('sent','received');await ack('acknowledged','received');assert.equal((await confirmations()).length,1);checks++
 const v1=await versions();assert.equal(v1.length,1);assert.equal(v1[0].status,'aperak_confirmed');assert.equal(v1[0].confirmationMessageId,id(16));assert.equal(v1[0].sourceMessageId,id(16))
 assert.equal(v1[0].brpEdielId,'11111');assert.equal(v1[0].marketActivationProven,false);assert.ok(v1[0].confirmedAt);checks++
 // Dated, not tenant-global: another tenant's history sees nothing and is refused for this actor.
 await assert.rejects(db.query(`SELECT ediel_brp_responsibility_history_v1('${id(2)}','${id(4)}','${id(20)}')`),/actor_forbidden/);checks++
 // The confirmation is immutable and private.
 await assert.rejects(db.exec('DELETE FROM gridex_brp_changes.confirmations'),/source_immutable/);checks++
 await assert.rejects(db.exec(`UPDATE gridex_brp_changes.confirmations SET message_id='${id(41)}'`),/source_immutable/);checks++
 for(const role of ['anon','authenticated','service_role']){assert.equal((await db.query(`SELECT has_table_privilege('${role}','gridex_brp_changes.confirmations','SELECT') allowed`)).rows[0].allowed,false);checks++}
 assert.equal((await db.query(`SELECT has_function_privilege('service_role','gridex_brp_changes.confirm_on_ack_v1()','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 // At least one calendar month ahead (fixed UTC+1): a nearer change is held before any origination.
 const event=(n,at)=>db.exec(`INSERT INTO gridex_brp_changes.events(id,company_id,environment,supply_period_id,customer_id,metering_point_id,legal_actor_id,legal_sender_id,point_id,identity_agency,registry_ground_id,supply_source_message_id,supply_state_version,effective_at,brp_contract_reference,brp_contract_sha256,brp_contract_version,market_decision_reference,source_reference,source_sha256,source_version,approved_by,approved_at) VALUES('${id(n)}','${id(1)}','test','${id(4)}','${id(3)}','${id(5)}','${id(9)}','12345','735123456789012345','9','${id(11)}','${id(6)}',1,${at},'SYNTHETIC CONTRACT',repeat('b',64),'fixture','SYNTHETIC DECISION','SYNTHETIC EVENT ${n}',repeat('c',64),'fixture','${id(20)}',now())`)
 const source=n=>db.query(`SELECT ediel_brp_change_source_v1('${id(1)}','${id(n)}','${id(20)}') result`).then(r=>r.rows[0].result)
 await event(50,"date_trunc('day',now()+interval '20 days')");assert.deepEqual(await source(50),{status:'held',missing:['one_calendar_month_notice_boundary']});checks++
 await event(51,"date_trunc('day',now()+interval '1 month'+interval '2 days')");assert.equal((await source(51)).status,'authorized');checks++
 console.log(`PASS ${checks} AT-Z09B BRP APERAK confirmation PostgreSQL checks; declared source/supply/ACK fixtures, not native/authentic evidence`)
}finally{await db.close()}
