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
 CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,payload jsonb,source_type text,source_id uuid,request_type text,operation_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid);
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
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930223846_ediel_cancellation_request_environment_scope.sql',import.meta.url),'utf8'));checks++
 assert.equal((await db.query("SELECT count(*) n FROM information_schema.columns WHERE table_schema='public' AND table_name='outbound_requests' AND column_name='environment'")).rows[0].n,0);checks++
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
 await db.exec(`INSERT INTO ediel_message_intents VALUES('${id(12)}','${id(1)}','test','outbound','PRODAT','Z03','supplier_switch','${id(10)}','${id(3)}','735123456789012345','TES','validated','SYNTHETIC-OLD-LI','SYNTHETIC-C-UNB','99111','54321',NULL,NULL,'${id(14)}','${id(15)}','23-DDQ-PRODAT');INSERT INTO outbound_requests VALUES('${id(13)}','${id(1)}','{"environment":"test"}','manual','${id(12)}','supplier_switch','${id(10)}','${id(3)}','${id(5)}','${id(7)}')`)
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
 for(const [column,value,restore] of [['source_id',id(99),id(12)],['operation_id',id(99),id(10)],['source_type','supplier_switch_request','manual'],['request_type','metering_request','supplier_switch'],['payload',{environment:'production'},{environment:'test'}]]){
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
 // Continue the existing component fixture; no duplicate cancellation owner.
 // These independent signed-declaration/original/legal/provider ports are
 // mechanical. Actual private method decoding and public bind/send consumers
 // below execute unchanged SQL; this does not certify genuine market inputs.
 await db.exec("ALTER TABLE public.ediel_messages ALTER COLUMN original_message_id TYPE text USING original_message_id::text");
 const bindDefinition=(await db.query("SELECT pg_get_functiondef('gridex_switch_cancellations.bind_message_v1()'::regprocedure) d")).rows[0].d;
 const align=migration('20261004202548_ediel_recovery_text_original_reference_alignment.sql');
 const oldReference='NEW.original_message_id IS DISTINCT FROM o.original_message_id';
 assert.ok(align.includes("'"+oldReference+"','"+oldReference+"::text'"));
 assert.equal(bindDefinition.split(oldReference).length,2);
 await db.exec(bindDefinition.replace(oldReference,oldReference+'::text'));
 await db.exec("CREATE OR REPLACE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('legalActorId','"+id(7)+"','legalEdielId','12345','actorRole','electricity_supplier')$$;CREATE OR REPLACE FUNCTION gridex_ediel_inbound_context.derive(public.ediel_messages,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_ediel_inbound_context.require_v1(NULL,NULL)$$;");
 const methodSource=migration('20260930234708_ediel_normal_switch_signed_method_binding.sql');
 await db.exec(methodSource.slice(methodSource.indexOf('CREATE FUNCTION gridex_received_sources.switch_requested_method_v1'),methodSource.indexOf('CREATE FUNCTION gridex_received_sources.switch_contract_request_basis_v1')));
 await db.exec(migration('20261001142650_ediel_switch_requested_method_line_dtm.sql'));
 await db.exec("CREATE SCHEMA gridex_metering_method_changes;CREATE TABLE gridex_metering_method_changes.contract_request_declarations(id uuid PRIMARY KEY,company_id uuid,environment text,contract_id uuid,contract_revision text,protected_contract_hash text,agreement_sha256 text,customer_id uuid,site_id uuid,metering_point_id uuid,point_id text,identity_agency text,legal_actor_id uuid,legal_sender_id text,legal_receiver_id text,grid_area_code text,requested_method text,source_reference text,source_version text,source_sha256 text);CREATE TABLE gridex_received_sources.switch_contract_request_bindings(message_id uuid PRIMARY KEY,company_id uuid,declaration_id uuid,requested_method text,source_basis jsonb,payload_hash text);");
 const qualifiedOriginal=old.replace("'CCI++Z13'","'CCI++Z04'CAV+Z03'CCI++Z13'");
 const qualifiedCancel=qualifiedOriginal.replace('CAV+Z22','CAV+Z24');
 await db.query("INSERT INTO public.supplier_switch_requests SELECT (jsonb_populate_record(NULL::public.supplier_switch_requests,to_jsonb(s)||jsonb_build_object('id',$1::uuid,'outbound_z03_message_id',$2::uuid,'status','submitted'))).* FROM public.supplier_switch_requests s WHERE id=$3",[id(106),id(108),id(6)]);
 await db.query("INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(m)||jsonb_build_object('id',$1::uuid,'raw_payload',$2::text,'immutable_payload_hash',encode(sha256(convert_to($2,'UTF8')),'hex'),'customer_id',$3::uuid,'site_id',$4::uuid,'metering_point_id',$5::uuid))).* FROM public.ediel_messages m WHERE id=$6",[id(108),qualifiedOriginal,id(3),id(7),id(5),id(8)]);
 await db.query("INSERT INTO gridex_received_sources.switch_originals SELECT (jsonb_populate_record(NULL::gridex_received_sources.switch_originals,to_jsonb(o)||jsonb_build_object('message_id',$1::uuid,'switch_id',$2::uuid,'payload_hash',encode(sha256(convert_to($3,'UTF8')),'hex'),'original_object',gridex_received_sources.switch_origin_wire_v1($3)#>'{objects,0}','resulting_switch',(SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=$2)))).* FROM gridex_received_sources.switch_originals o WHERE message_id=$4",[id(108),id(106),qualifiedOriginal,id(8)]);
 const declared={status:'authorized',declarationId:id(140),companyId:id(1),environment:'test',contractId:id(4),contractRevision:'signed-fixture-v1',protectedContractHash:'contract-fixture',agreementSha256:'a'.repeat(64),customerId:id(3),siteId:id(7),meteringPointId:id(5),pointId:'735123456789012345',identityAgency:'9',legalActorId:id(7),legalSenderId:'12345',legalReceiverId:'54321',gridArea:'TES',requestedMethod:'Z03',sourceReference:'mechanical-signed-source-port',sourceVersion:'v1',sourceDigest:'b'.repeat(64)};
 await db.query("INSERT INTO gridex_metering_method_changes.contract_request_declarations VALUES($1,$2,'test',$3,'signed-fixture-v1','contract-fixture',$4,$5,$6,$7,'735123456789012345','9',$6,'12345','54321','TES','Z03','mechanical-signed-source-port','v1',$8)",[id(140),id(1),id(4),declared.agreementSha256,id(3),id(7),id(5),declared.sourceDigest]);
 await db.query("INSERT INTO gridex_received_sources.switch_contract_request_bindings VALUES($1,$2,$3,'Z03',$4,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(108),id(1),id(140),declared,qualifiedOriginal]);
 const signatures=['public.ediel_switch_cancellation_source_v1(uuid,uuid,uuid)','gridex_switch_cancellations.bind_message_v1()','public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid)'];
 const metadata=async()=> (await db.query("SELECT p.oid,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=ANY($1::regprocedure[]) ORDER BY p.oid",[signatures])).rows;
 const metadataBefore=await metadata(),contextBefore=(await db.query("SELECT pg_get_functiondef('gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean)'::regprocedure) d")).rows[0].d;
 const historicalBasis=(await db.query('SELECT basis FROM gridex_switch_cancellations.origins WHERE message_id=$1',[id(16)])).rows[0].basis;
 const oldOriginalRow=(await db.query('SELECT to_jsonb(m) r FROM public.ediel_messages m WHERE id=$1',[id(8)])).rows[0].r;
 await db.exec(migration('20261007132500_ediel_switch_cancellation_original_method.sql'));checks++;
 assert.deepEqual(await metadata(),metadataBefore);assert.equal((await db.query("SELECT pg_get_functiondef('gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean)'::regprocedure) d")).rows[0].d,contextBefore);checks++;
 const projected=()=>db.query('SELECT public.ediel_switch_cancellation_source_v1($1,$2,$3) r',[id(1),id(106),id(20)]).then(r=>r.rows[0].r);
 assert.equal((await projected()).requestedMethod,'Z03');checks++;
 const method=()=>db.query("SELECT gridex_switch_cancellations.original_method_v1($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),'test') method",[id(1),id(108),qualifiedOriginal]).then(r=>r.rows[0].method);
 assert.equal(await method(),'Z03');checks++;
 // Mutate only explicitly declared evidence ports inside rollback-isolated
 // component transactions. Production originals/declarations are immutable.
 const refusedPort=async(query,values)=>{await db.exec('BEGIN');try{await db.query(query,values);assert.equal(await method(),null);assert.deepEqual((await projected()).missing,['qualified_immutable_original_requested_method']);checks++}finally{await db.exec('ROLLBACK')}};
 await refusedPort('DELETE FROM gridex_received_sources.switch_contract_request_bindings WHERE message_id=$1',[id(108)]);
 await refusedPort("UPDATE gridex_received_sources.switch_contract_request_bindings SET requested_method='Z04' WHERE message_id=$1",[id(108)]);
 await refusedPort("UPDATE gridex_received_sources.switch_contract_request_bindings SET source_basis=jsonb_set(source_basis,'{requestedMethod}','\"Z04\"') WHERE message_id=$1",[id(108)]);
 await refusedPort("UPDATE gridex_received_sources.switch_contract_request_bindings SET payload_hash=repeat('c',64) WHERE message_id=$1",[id(108)]);
 await refusedPort('UPDATE gridex_received_sources.switch_contract_request_bindings SET company_id=$1 WHERE message_id=$2',[id(2),id(108)]);
 for(const column of ['company_id','contract_id','customer_id','site_id','metering_point_id','legal_actor_id'])await refusedPort('UPDATE gridex_metering_method_changes.contract_request_declarations SET '+column+'=$1 WHERE id=$2',[id(99),id(140)]);
 for(const [column,value] of [['environment','production'],['protected_contract_hash','other'],['point_id','other'],['identity_agency','89'],['legal_sender_id','other'],['legal_receiver_id','other'],['grid_area_code','other'],['contract_revision','other'],['agreement_sha256','c'.repeat(64)],['source_reference','other'],['source_version','other'],['source_sha256','c'.repeat(64)]])await refusedPort('UPDATE gridex_metering_method_changes.contract_request_declarations SET '+column+'=$1 WHERE id=$2',[value,id(140)]);
 const decoder=raw=>db.query('SELECT gridex_received_sources.switch_requested_method_v1($1) method',[raw]).then(r=>r.rows[0].method);
 for(const raw of [qualifiedOriginal.replace("CCI++Z04'CAV+Z03'",""),qualifiedOriginal.replace("CCI++Z04'CAV+Z03'","CCI++Z04'CAV+'"),qualifiedOriginal.replace("CCI++Z04'CAV+Z03'","CCI++Z04'CAV+Z03'CCI++Z04'CAV+Z03'"),qualifiedOriginal.replace("UNT+13+1'","LIN+2++OTHER:::9'UNT+13+1'")]){assert.equal(await decoder(raw),null);checks++}
 await db.query("INSERT INTO public.ediel_message_intents SELECT (jsonb_populate_record(NULL::public.ediel_message_intents,to_jsonb(i)||jsonb_build_object('id',$1::uuid,'operation_id',$2::uuid))).* FROM public.ediel_message_intents i WHERE id=$3",[id(112),id(110),id(12)]);
 await db.query("INSERT INTO public.outbound_requests SELECT (jsonb_populate_record(NULL::public.outbound_requests,to_jsonb(r)||jsonb_build_object('id',$1::uuid,'source_id',$2::uuid,'operation_id',$3::uuid))).* FROM public.outbound_requests r WHERE id=$4",[id(113),id(112),id(110),id(13)]);
 await db.query('SELECT public.ediel_reserve_switch_cancellation_v1($1,$2,$3,$4,$5)',[id(1),id(106),id(20),id(112),id(113)]);
 const reservedBasis=(await db.query('SELECT basis FROM gridex_switch_cancellations.origins WHERE intent_id=$1',[id(112)])).rows[0].basis;
 assert.equal(Object.hasOwn(reservedBasis,'requestedMethod'),false);checks++;
 const snapshot=()=>db.query("SELECT jsonb_build_object('origins',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM gridex_switch_cancellations.origins o),'switches',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.supplier_switch_requests s),'messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.ediel_messages m),'bindings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY message_id) FROM gridex_received_sources.switch_contract_request_bindings b)) r").then(r=>r.rows[0].r);
 const insertMethod=raw=>db.query("INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(m)||jsonb_build_object('id',$1::uuid,'raw_payload',$2::text,'immutable_payload_hash',encode(sha256(convert_to($2,'UTF8')),'hex'),'intent_id',$3::uuid,'outbound_request_id',$4::uuid,'source_operation_id',$5::text,'original_message_id',$6::text,'switch_request_id',$7::uuid))).* FROM public.ediel_messages m WHERE id=$8",[id(116),raw,id(112),id(113),id(110),id(108),id(106),id(16)]);
 const invalidCancels=[qualifiedCancel.replace("CCI++Z04'CAV+Z03'",""),qualifiedCancel.replace("CCI++Z04'CAV+Z03'","CCI++Z04'CAV+Z03'CCI++Z04'CAV+Z03'"),qualifiedCancel.replace("CCI++Z04'CAV+Z03'","CCI++Z04'CAV+Z04'")];
 for(const raw of invalidCancels){const before=await snapshot();await assert.rejects(insertMethod(raw),/switch_cancellation_exact_original_method_required/);assert.deepEqual(await snapshot(),before);checks++}
 await insertMethod(qualifiedCancel);checks++;
 assert.equal((await db.query('SELECT status FROM public.supplier_switch_requests WHERE id=$1',[id(106)])).rows[0].status,'cancellation_requested');checks++;
 const fresh=()=>db.query('SELECT public.ediel_require_switch_cancellation_source_current_v1($1,$2)',[id(1),id(116)]);
 await fresh();checks++;
 // The production trigger forbids modifying a bound message. For this send
 // consumer fault-injection only, disable that guard transactionally in the
 // component DB and roll back each injection. Never alter an authentic input.
 for(const raw of invalidCancels){const before=await snapshot();await db.exec('BEGIN');try{await db.exec('ALTER TABLE public.ediel_messages DISABLE TRIGGER ediel_switch_cancellation_message_immutable');await db.query("UPDATE public.ediel_messages SET raw_payload=$1,immutable_payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2",[raw,id(116)]);await db.exec('ALTER TABLE gridex_switch_cancellations.origins DISABLE TRIGGER cancellation_origin_immutable');await db.query("UPDATE gridex_switch_cancellations.origins SET payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE message_id=$2",[raw,id(116)]);await assert.rejects(fresh(),/switch_cancellation_exact_original_method_required/);checks++}finally{await db.exec('ROLLBACK')}assert.deepEqual(await snapshot(),before)}
 // Direct private physical guard isolates missing/duplicate/different217,
 // while fresh public source above retains its earlier immutable-hash guard.
 for(const raw of invalidCancels){await assert.rejects(db.query("SELECT gridex_switch_cancellations.require_original_method_v1($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),'test',$4)",[id(1),id(108),qualifiedOriginal,raw]),/exact_original_method_required/);checks++}
 const actualReplay=(await db.query('SELECT gridex_ediel_transport.mutate_v1($1) r',[{action:'enter',companyId:id(1),messageId:id(16),fixtureProceed:false,fixtureAcceptedReceipt:{fixture:'already-established-outcome'}}])).rows[0].r;
 assert.deepEqual(actualReplay,replay);checks++;
 assert.deepEqual((await db.query('SELECT basis FROM gridex_switch_cancellations.origins WHERE message_id=$1',[id(16)])).rows[0].basis,historicalBasis);
 assert.deepEqual((await db.query('SELECT basis FROM gridex_switch_cancellations.origins WHERE message_id=$1',[id(116)])).rows[0].basis,reservedBasis);
 assert.deepEqual((await db.query('SELECT to_jsonb(m) r FROM public.ediel_messages m WHERE id=$1',[id(8)])).rows[0].r,oldOriginalRow);checks++;
 for(const role of ['anon','authenticated','service_role']){assert.equal((await db.query("SELECT has_function_privilege($1,'gridex_switch_cancellations.original_method_v1(uuid,uuid,text,text)','execute') a",[role])).rows[0].a,false);checks++}
 console.log(`PASS ${checks} cancellation SQL probes; actual owner with declared existing receipt/legal/original ports, not native/authentic acceptance`)
}finally{await db.close()}
