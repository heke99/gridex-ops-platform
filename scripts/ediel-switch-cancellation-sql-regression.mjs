// Actual cancellation owner SQL, with named normal-original/legal/receipt ports
// represented by mechanical fixtures. No authentic or native approval evidence.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import{resolve}from'node:path';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const quote=s=>"'"+s.replaceAll("'","''")+"'"
const migration=n=>readFileSync(resolve(process.env.EDIEL_SQL_REPOSITORY||new URL('..',import.meta.url).pathname,'supabase/migrations',n),'utf8');let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS 'SELECT $3=''communication.write''';
 CREATE TABLE supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,customer_contract_id uuid,contract_id uuid,outbound_z03_message_id uuid,rff_li_reference text,requested_start_date date,lifecycle_blocked bool,status text,updated_by uuid,updated_at timestamptz);
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,status text);CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid);CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,meter_point_id text,grid_area_code text,grid_owner_ediel_id text);
 CREATE TABLE ediel_message_intents(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,business_process text,operation_id uuid,customer_id uuid,metering_point_id text,grid_area_code text,validation_status text,transaction_reference text,interchange_reference text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,receiver_subaddress text,communication_route_id uuid,route_profile_id uuid,application_reference text);
 CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,environment text,source_type text,source_id uuid,request_type text,operation_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,status text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,intent_id uuid,outbound_request_id uuid,source_operation_id text,original_message_id uuid,switch_request_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,interchange_reference text,transaction_reference text,application_reference text,sender_ediel_id text,receiver_ediel_id text,sender_sub_address text,receiver_sub_address text,communication_route_id uuid,route_profile_id uuid);
 CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.switch_originals(message_id uuid PRIMARY KEY,company_id uuid,switch_id uuid,intent_id uuid,outbound_request_id uuid,payload_hash text,contract_id uuid,contract_hash text,original_object jsonb,previous_switch jsonb,resulting_switch jsonb,actor_user_id uuid);
 CREATE FUNCTION gridex_received_sources.sent_source_is_current_v1(m public.ediel_messages) RETURNS bool LANGUAGE sql AS 'SELECT m.status=''sent''';CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(public.customer_contracts) RETURNS text LANGUAGE sql AS 'SELECT ''contract-fixture''';
 CREATE FUNCTION gridex_received_sources.permission_date_v1(t text) RETURNS date LANGUAGE sql AS $$SELECT to_date(left(t,8),'YYYYMMDD')$$;CREATE FUNCTION gridex_received_sources.permission_time_v1(t text) RETURNS timestamptz LANGUAGE sql AS $$SELECT to_timestamp(t,'YYYYMMDDHH24MI')-interval '1 hour'$$;
 CREATE SCHEMA gridex_ediel_inbound_context;CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"legalActorId":"source-supplier","legalEdielId":"12345","actorRole":"electricity_supplier"}'::jsonb$$;
 CREATE FUNCTION gridex_ediel_inbound_context.derive(public.ediel_messages,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"legalActorId":"source-supplier","legalEdielId":"12345","actorRole":"electricity_supplier"}'::jsonb$$;
 CREATE SCHEMA gridex_negative_fixtures;CREATE TABLE gridex_negative_fixtures.positive_consumptions(message_id uuid,company_id uuid);CREATE TABLE gridex_negative_fixtures.negative_prepared_consumptions(message_id uuid,company_id uuid);CREATE TABLE gridex_negative_fixtures.fixture_basis(message_id uuid,company_id uuid,payload_hash text,q jsonb);
 CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(c uuid,m uuid,expected text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE q jsonb;BEGIN SELECT b.q INTO q FROM gridex_negative_fixtures.fixture_basis b JOIN public.ediel_messages source ON source.id=b.message_id AND source.company_id=b.company_id WHERE b.message_id=m AND b.company_id=c AND b.payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') AND source.message_code=expected;IF q IS NULL THEN RAISE EXCEPTION 'fixture_original_source_required';END IF;RETURN q;END$$;
 CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS 'SELECT gridex_negative_fixtures.require_positive_message_v1($1,$2,$3)';
 CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_transport;CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('proceed',coalesce((i->>'fixtureProceed')::bool,true),'acceptedReceipt',i->'fixtureAcceptedReceipt')$$;`)
 const tok=migration('20260923135706_ediel_utilts_consumption_binding_v1.sql');await db.exec(tok.slice(tok.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),tok.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 await db.exec(`CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v2(raw text) RETURNS jsonb LANGUAGE sql AS 'SELECT gridex_utilts_binding.wire_tokens_v1($1)'`)
 for(const[name,start,end]of[
 ['20260930161624_ediel_supply_market_source_lifecycle.sql','CREATE FUNCTION gridex_received_sources.supply_wire_v1','REVOKE ALL ON FUNCTION gridex_received_sources.supply_wire_v1'],
 ['20260930201111_ediel_normal_switch_source_atomic_confirmation.sql','CREATE FUNCTION gridex_received_sources.normal_switch_wire_v1','REVOKE ALL ON FUNCTION gridex_received_sources.normal_switch_wire_v1'],
 ['20260930213949_ediel_switch_intent_original_source_binding.sql','CREATE FUNCTION gridex_received_sources.switch_origin_wire_v1','REVOKE ALL ON FUNCTION gridex_received_sources.switch_origin_wire_v1']]){const s=migration(name);await db.exec(s.slice(s.indexOf(start),s.indexOf(end)))}
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930214933_ediel_switch_cancellation_source_origination.sql',import.meta.url),'utf8'));checks++
 const date=(await db.query(`SELECT to_char((now()+interval '1 hour')::date+10,'YYYYMMDD') d`)).rows[0].d
 const wire=reason=>`UNB+UNOC:3+99111:ZZ+54321:ZZ+260930:1200+SYNTHETIC-C-UNB++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z03+SOURCE+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++735123456789012345:::9'DTM+92:${date}0000:203'CCI++Z13'CAV+${reason}'RFF+LI:SYNTHETIC-OLD-LI'RFF+Z05:TES'NAD+UD+5566778899:SE1:260++SYNTHETIC CUSTOMER'NAD+IT+735123456789012345::9'UNT+13+1'UNZ+1+SYNTHETIC-C-UNB'`
 const old=wire('Z22'),cancel=wire('Z24')
 await db.exec(`INSERT INTO companies VALUES('${id(1)}'),('${id(2)}');INSERT INTO user_profiles VALUES('${id(20)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(20)}','active',true,now());INSERT INTO customer_contracts VALUES('${id(4)}','${id(1)}','${id(3)}','${id(5)}','signed');INSERT INTO customer_sites VALUES('${id(7)}','${id(1)}');INSERT INTO metering_points VALUES('${id(5)}','${id(1)}','${id(3)}','${id(7)}','735123456789012345',NULL,'TES','54321');
 INSERT INTO supplier_switch_requests VALUES('${id(6)}','${id(1)}','${id(3)}','${id(7)}',NULL,'${id(5)}','${id(4)}','${id(4)}','${id(8)}','SYNTHETIC-OLD-LI',to_date('${date}','YYYYMMDD'),false,'submitted',NULL,now());
 INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_rendered_at,immutable_payload_hash) VALUES('${id(8)}','${id(1)}','test','outbound','edifact','PRODAT','Z03','sent',${quote(old)},now(),encode(sha256(convert_to(${quote(old)},'UTF8')),'hex'));
 INSERT INTO gridex_received_sources.switch_originals VALUES('${id(8)}','${id(1)}','${id(6)}','${id(91)}','${id(92)}',encode(sha256(convert_to(${quote(old)},'UTF8')),'hex'),'${id(4)}','contract-fixture',gridex_received_sources.switch_origin_wire_v1(${quote(old)})#>'{objects,0}','{}',(SELECT to_jsonb(s) FROM supplier_switch_requests s),'${id(20)}');`)
 const read=async()=>(await db.query('SELECT ediel_switch_cancellation_source_v1($1,$2,$3) r',[id(1),id(6),id(20)])).rows[0].r
 const b=await read();assert.equal(b.status,'authorized');assert.equal(b.li,'SYNTHETIC-OLD-LI');assert.equal(b.originalSubtype,'L');checks++
 await db.exec(`UPDATE ediel_messages SET status='unknown' WHERE id='${id(8)}'`);assert.equal((await read()).status,'held');checks++;await db.exec(`UPDATE ediel_messages SET status='sent' WHERE id='${id(8)}'`)
 await db.exec(`UPDATE metering_points SET ediel_metering_point_id='OTHER'`);assert.equal((await read()).status,'held');checks++;await db.exec(`UPDATE metering_points SET ediel_metering_point_id='735123456789012345'`)
 await db.exec(`UPDATE supplier_switch_requests SET rff_li_reference='OTHER'`);assert.equal((await read()).status,'held');checks++;await db.exec(`UPDATE supplier_switch_requests SET rff_li_reference='SYNTHETIC-OLD-LI'`)
 await db.exec(`UPDATE company_memberships SET accepted_at=NULL`);await assert.rejects(read(),/actor_forbidden/);checks++;await db.exec(`UPDATE company_memberships SET accepted_at=now()`)
 await assert.rejects(db.query('SELECT ediel_switch_cancellation_source_v1($1,$2,$3)',[id(2),id(6),id(20)]),/actor_forbidden/);checks++
 // Frozen historical source/contract remains the authority for withdrawal;
 // revoking the current customer contract cannot turn withdrawal into a new
 // contract-approval requirement.
 await db.exec(`UPDATE customer_contracts SET status='cancelled'`);assert.equal((await read()).status,'authorized');checks++
 const originalScope=async(reason,offset)=>{
  const day=(await db.query("SELECT to_char((now()+interval '1 hour')::date+$1::int,'YYYYMMDD') d",[offset])).rows[0].d
  const source=old.replace(`DTM+92:${date}0000`,`DTM+92:${day}0000`).replace('CAV+Z22',`CAV+${reason}`)
  await db.query("UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2",[source,id(8)])
  await db.query("UPDATE supplier_switch_requests SET requested_start_date=to_date($1,'YYYYMMDD')",[day])
  await db.query("UPDATE gridex_received_sources.switch_originals SET payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex'),original_object=gridex_received_sources.switch_origin_wire_v1($1)#>'{objects,0}',resulting_switch=(SELECT to_jsonb(s) FROM supplier_switch_requests s)",[source])
 }
 await originalScope('Z22',4);assert.equal((await read()).status,'authorized');checks++
 await originalScope('Z22',3);assert.deepEqual((await read()).missing,['source_z03_cancellation_calendar_window']);checks++
 await originalScope('Z23',0);assert.equal((await read()).status,'authorized');checks++
 await originalScope('Z23',-1);assert.deepEqual((await read()).missing,['source_z03_cancellation_calendar_window']);checks++
 await originalScope('Z22',10)
 await db.exec(`INSERT INTO ediel_message_intents VALUES('${id(12)}','${id(1)}','test','outbound','PRODAT','Z03','supplier_switch','${id(10)}','${id(3)}','735123456789012345','TES','validated','SYNTHETIC-OLD-LI','SYNTHETIC-C-UNB','99111','54321',NULL,NULL,'${id(14)}','${id(15)}','23-DDQ-PRODAT');INSERT INTO outbound_requests VALUES('${id(13)}','${id(1)}','test','manual','${id(12)}','supplier_switch','${id(10)}','${id(3)}','${id(5)}','${id(7)}')`)
 const reserve=async()=>(await db.query('SELECT ediel_reserve_switch_cancellation_v1($1,$2,$3,$4,$5) r',[id(1),id(6),id(20),id(12),id(13)])).rows[0].r
 assert.equal((await reserve()).status,'reserved');assert.equal((await reserve()).messageId,null);checks++
 const insert=raw=>db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','draft',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,$8,$9,$10,$11,'SYNTHETIC-C-UNB','SYNTHETIC-OLD-LI','23-DDQ-PRODAT','99111','54321',NULL,NULL,$12,$13)`,[id(16),id(1),raw,id(12),id(13),id(10),id(8),id(6),id(3),id(7),id(5),id(14),id(15)])
 await assert.rejects(insert(cancel.replace('SYNTHETIC-OLD-LI','OTHER')),/exact_original_wire_required/);checks++
 await assert.rejects(insert(cancel.replace('CAV+Z24','CAV+Z23')),/exact_original_wire_required/);checks++
 await assert.rejects(insert(cancel.replace(':SE1:260',':SE2:260')),/exact_original_wire_required/);checks++
 await insert(cancel);assert.equal((await reserve()).messageId,id(16));checks++
 const sw=(await db.query('SELECT * FROM supplier_switch_requests')).rows[0];assert.equal(sw.status,'cancellation_requested');assert.equal(sw.outbound_z03_message_id,id(8));assert.equal(sw.rff_li_reference,'SYNTHETIC-OLD-LI');checks++
 assert.equal((await db.query('SELECT raw_payload,status FROM ediel_messages WHERE id=$1',[id(8)])).rows[0].status,'sent');assert.equal((await db.query('SELECT raw_payload FROM ediel_messages WHERE id=$1',[id(8)])).rows[0].raw_payload,old);checks++
 await db.query('SELECT ediel_require_switch_cancellation_source_current_v1($1,$2)',[id(1),id(16)]);checks++
 // A later authorized sender owns provider permissions; the historical
 // preparer is not reauthorized by this read-only source qualifier.
 await db.exec("UPDATE user_profiles SET user_status='inactive'");await assert.rejects(read(),/actor_forbidden/);await db.query('SELECT ediel_require_switch_cancellation_source_current_v1($1,$2)',[id(1),id(16)]);checks++;await db.exec("UPDATE user_profiles SET user_status='active'")
 for(const [column,value,restore] of [['source_id',id(99),id(12)],['operation_id',id(99),id(10)],['source_type','supplier_switch_request','manual'],['request_type','metering_request','supplier_switch']]){
  await db.query(`UPDATE outbound_requests SET ${column}=$1 WHERE id=$2`,[value,id(13)]);await assert.rejects(db.query('SELECT ediel_require_switch_cancellation_source_current_v1($1,$2)',[id(1),id(16)]),/current_intent_request_required/);checks++;await db.query(`UPDATE outbound_requests SET ${column}=$1 WHERE id=$2`,[restore,id(13)])
 }
 await assert.rejects(db.exec(`UPDATE ediel_messages SET original_message_id='${id(99)}' WHERE id='${id(16)}'`),/bound_message_immutable/);checks++
 await assert.rejects(db.exec('DELETE FROM gridex_switch_cancellations.origins'),/origin_immutable/);checks++
 await db.exec(`UPDATE supplier_switch_requests SET status='cancelled_before_start'`);await assert.rejects(db.query('SELECT ediel_require_switch_cancellation_source_current_v1($1,$2)',[id(1),id(16)]),/current_source_held/);checks++
 const replay=(await db.query('SELECT gridex_ediel_transport.mutate_v1($1) r',[{action:'enter',companyId:id(1),messageId:id(16),fixtureProceed:false,fixtureAcceptedReceipt:{fixture:'already-established-outcome'}}])).rows[0].r;assert.equal(replay.proceed,false);checks++
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.ediel_switch_cancellation_source_v1(uuid,uuid,uuid)','execute') a")).rows[0].a,false);checks++
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','draft',$3)",[id(50),id(1),cancel])
 const guard=()=>db.query('SELECT ediel_require_switch_cancellation_source_current_v1($1,$2)',[id(1),id(50)])
 await assert.rejects(guard(),/private_origin_required/);checks++
 await db.query('INSERT INTO gridex_negative_fixtures.positive_consumptions VALUES($1,$2)',[id(50),id(1)])
 const q={kind:'source_qualified_positive_fixture',version:1,companyId:id(1),roleCode:'supplier',expectedOutcome:'positive',expectedDiagnosticCodes:[],authorizesBusinessEffect:false}
 await db.query("INSERT INTO gridex_negative_fixtures.fixture_basis VALUES($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[id(50),id(1),cancel,q]);await guard();checks++
 assert.equal((await db.query('SELECT count(*) n FROM gridex_switch_cancellations.origins')).rows[0].n,1);assert.equal((await db.query('SELECT status FROM supplier_switch_requests')).rows[0].status,'cancelled_before_start');checks++
 await db.exec(`UPDATE gridex_negative_fixtures.fixture_basis SET q=jsonb_set(q,'{roleCode}','"grid_owner"')`);await assert.rejects(guard(),/fixture_source_required/);checks++
 await db.query('UPDATE gridex_negative_fixtures.fixture_basis SET q=$1',[q]);await db.exec('TRUNCATE gridex_negative_fixtures.positive_consumptions');await db.query('INSERT INTO gridex_negative_fixtures.negative_prepared_consumptions VALUES($1,$2)',[id(50),id(1)])
 await db.query('UPDATE gridex_negative_fixtures.fixture_basis SET q=$1',[{...q,kind:'source_qualified_negative_fixture',expectedOutcome:'negative',expectedDiagnosticCodes:['SOURCE DECLARED NEGATIVE DIAGNOSTIC']}]);await guard();checks++
 await db.exec(`UPDATE gridex_negative_fixtures.fixture_basis SET q=jsonb_set(q,'{expectedDiagnosticCodes}','[]')`);await assert.rejects(guard(),/fixture_source_required/);checks++
 await db.query("UPDATE gridex_negative_fixtures.fixture_basis SET q=$1",[{...q,kind:'source_qualified_negative_fixture',expectedOutcome:'negative',expectedDiagnosticCodes:['SOURCE DECLARED NEGATIVE DIAGNOSTIC']}]);await db.exec(`UPDATE ediel_messages SET environment='production' WHERE id='${id(50)}'`);await assert.rejects(guard(),/private_origin_required/);checks++
 // A real cancellation origin whose current source fails cannot substitute a
 // registered test pointer for its independent production cancellation basis.
 await db.query('INSERT INTO gridex_negative_fixtures.positive_consumptions VALUES($1,$2)',[id(16),id(1)]);await assert.rejects(db.query('SELECT ediel_require_switch_cancellation_source_current_v1($1,$2)',[id(1),id(16)]),/current_source_held/);checks++
 console.log(`PASS ${checks} cancellation SQL probes; actual owner with declared existing receipt/legal/original ports, not native/authentic acceptance`)
}finally{await db.close()}
