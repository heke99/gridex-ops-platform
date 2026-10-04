// Actual source-binding/entry SQL with declared intent/readiness/fixture ports.
// No real contract, issuer, market activation or native replay evidence.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict'
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const fn=(file,name)=>{const s=readFileSync(new URL(file,import.meta.url),'utf8'),a=s.indexOf(`CREATE FUNCTION ${name}`),b=s.indexOf('$$;',a);if(a<0)throw Error(name);return s.slice(a,b+3)}
const wire=reason=>`UNB+UNOC:3+12345:14+54321:14+260930:1200+I++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+DOC+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++735123456789012345:::9'CCI++Z13'CAV+${reason}'RFF+LI:EXACT-LI'RFF+Z05:TES'NAD+UD+5566778899:SE1:260'DTM+92:209901010000:203'UNT+12+1'UNZ+1+I'`
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_negative_fixtures;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid,org_number text,personal_number text);
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,status text,signed_at timestamptz,signed_version text);
 CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,meter_point_id text);
 CREATE TABLE supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,contract_id uuid,customer_contract_id uuid,outbound_z03_message_id uuid,inbound_z04_message_id uuid,rff_li_reference text,requested_start_date date,lifecycle_blocked bool,status text,request_type text,prodat_variant text,prodat_reason text,updated_by uuid,updated_at timestamptz);
 CREATE TABLE ediel_message_intents(id uuid PRIMARY KEY,operation_id uuid,supplier_switch_request_id uuid);CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,payload jsonb,source_type text,source_id uuid,request_type text,operation_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,status text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,intent_id uuid,outbound_request_id uuid,source_operation_id text,switch_request_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,original_message_id uuid);
 CREATE TABLE readiness_fixture(ok bool);INSERT INTO readiness_fixture VALUES(true);CREATE TABLE native_effects(x integer);
 CREATE TABLE permission_fixture(write_enabled bool);INSERT INTO permission_fixture VALUES(true);
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS $$SELECT $3='ediel_testing.write' OR ($3='communication.write' AND (SELECT write_enabled FROM public.permission_fixture))$$;
 CREATE FUNCTION gridex_assert_supplier_switch_ready(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF (SELECT ok FROM public.readiness_fixture) IS NOT TRUE THEN RAISE EXCEPTION 'fixture_readiness_held';END IF;END$$;
 CREATE FUNCTION gridex_ediel_transport.require_message_intent_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF m.intent_id IS NULL THEN RAISE EXCEPTION 'fixture_intent_required';END IF;END$$;
 CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(c public.customer_contracts) RETURNS text LANGUAGE sql AS $$SELECT encode(sha256(convert_to((to_jsonb(c)-'status')::text,'UTF8')),'hex')$$;
 CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF i->>'frozen'='true' THEN RETURN '{"proceed":false,"providerReceipt":{"frozen":true}}'::jsonb;END IF;INSERT INTO public.native_effects VALUES(1);RETURN '{"proceed":true}'::jsonb;END$$;
 CREATE TABLE gridex_negative_fixtures.positive_consumptions(company_id uuid,message_id uuid);CREATE TABLE gridex_negative_fixtures.negative_prepared_consumptions(company_id uuid,message_id uuid);
 CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('kind','source_qualified_positive_fixture','companyId',$1,'roleCode','supplier','expectedOutcome','positive','expectedDiagnosticCodes','[]'::jsonb,'authorizesBusinessEffect',false)$$;
 CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('kind','source_qualified_negative_fixture','companyId',$1,'roleCode','supplier','expectedOutcome','negative','expectedDiagnosticCodes','["SYNTHETIC-EXPECTED"]'::jsonb,'authorizesBusinessEffect',false)$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('../supabase/migrations/20260930161624_ediel_supply_market_source_lifecycle.sql','gridex_received_sources.supply_wire_v1'))
 await db.exec(fn('../supabase/migrations/20260930201111_ediel_normal_switch_source_atomic_confirmation.sql','gridex_received_sources.normal_switch_wire_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930213949_ediel_switch_intent_original_source_binding.sql',import.meta.url),'utf8'));checks++
 await db.exec(`CREATE TABLE gridex_received_sources.prodat_recovery_operations(id uuid PRIMARY KEY,company_id uuid,kind text,original_message_id uuid,original_payload_hash text,corrected_payload_hash text,corrected_raw_payload text,environment text);
 CREATE TABLE gridex_received_sources.prodat_recovery_messages(operation_id uuid,message_id uuid);ALTER TABLE gridex_received_sources.switch_originals ADD COLUMN recovery_operation_id uuid REFERENCES gridex_received_sources.prodat_recovery_operations(id);
 CREATE TABLE correction_fixture(ok bool);INSERT INTO correction_fixture VALUES(true);
 CREATE FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE o gridex_received_sources.prodat_recovery_operations%rowtype;BEGIN SELECT * INTO o FROM gridex_received_sources.prodat_recovery_operations WHERE id=$2 AND company_id=$1;IF (SELECT ok FROM public.correction_fixture) IS NOT TRUE THEN RAISE EXCEPTION 'fixture_negative_source_held';END IF;RETURN jsonb_build_object('operationId',o.id,'correctedPayloadHash',o.corrected_payload_hash);END$$;
 CREATE FUNCTION public.ediel_require_prodat_recovery_current_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF (SELECT ok FROM public.correction_fixture) IS NOT TRUE THEN RAISE EXCEPTION 'fixture_negative_source_held';END IF;END$$;`)
 const forward=readFileSync(new URL('../supabase/migrations/20260930221158_ediel_source_qualified_switch_correction_binding.sql',import.meta.url),'utf8')
 for(const name of ['public.ediel_bind_switch_original_v1','public.ediel_require_switch_original_current_v1','gridex_received_sources.switch_original_message_immutable_v1','public.ediel_bind_switch_correction_v1']){const marker=`${name==='public.ediel_bind_switch_correction_v1'?'CREATE FUNCTION':'CREATE OR REPLACE FUNCTION'} ${name}`,a=forward.indexOf(marker),b=forward.indexOf('$$;',a);await db.exec(forward.slice(a,b+3))}

 const decode=async raw=>(await db.query('SELECT gridex_received_sources.switch_origin_wire_v1($1) w',[raw])).rows[0].w
 assert.equal((await decode(wire('Z22'))).objects[0].installationPoint,'735123456789012345');checks++
 assert.equal((await decode(wire('Z22').replace("UNT+12","NAD+IT+735123456789012345::9'UNT+13"))).objects[0].installationAgency,'9');checks++
 assert.equal(await decode(wire('Z22').replace("UNT+12","NAD+IT+OTHER::9'UNT+13")),null);checks++
 await db.exec(`INSERT INTO companies VALUES('${id(1)}');INSERT INTO user_profiles VALUES('${id(20)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(20)}','active',true,now());INSERT INTO customers VALUES('${id(3)}','${id(1)}','5566778899',NULL);INSERT INTO customer_contracts VALUES('${id(4)}','${id(1)}','${id(3)}','${id(5)}','signed',now(),'1');INSERT INTO metering_points VALUES('${id(5)}','${id(1)}','${id(3)}','${id(7)}','735123456789012345',NULL);INSERT INTO ediel_message_intents VALUES('${id(12)}','${id(6)}','${id(6)}');
 INSERT INTO supplier_switch_requests VALUES('${id(6)}','${id(1)}','${id(3)}','${id(7)}',NULL,'${id(5)}','${id(4)}','${id(4)}',NULL,NULL,NULL,'2099-01-01',false,'draft','supplier_switch','L','Z22',NULL,now());
 INSERT INTO outbound_requests VALUES('${id(13)}','${id(1)}','{"environment":"test"}','supplier_switch_request','${id(6)}','supplier_switch','${id(6)}','${id(3)}','${id(7)}','${id(5)}');`)
 await db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','draft',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,$8,$9,$10,NULL)`,[id(8),id(1),wire('Z22'),id(12),id(13),id(6),id(6),id(3),id(7),id(5)])
 const bind=async actor=> (await db.query('SELECT ediel_bind_switch_original_v1($1,$2,$3,$4) b',[id(1),id(6),id(8),actor??id(20)])).rows[0].b
 await db.exec('UPDATE readiness_fixture SET ok=false');await assert.rejects(bind(),/readiness_held/);assert.equal((await db.query('SELECT outbound_z03_message_id FROM supplier_switch_requests')).rows[0].outbound_z03_message_id,null);checks++;await db.exec('UPDATE readiness_fixture SET ok=true')
 await db.exec(`UPDATE company_memberships SET accepted_at=NULL`);await assert.rejects(bind(),/execution_actor/);checks++;await db.exec(`UPDATE company_memberships SET accepted_at=now()`)
 await db.exec('UPDATE permission_fixture SET write_enabled=false');await assert.rejects(bind(),/execution_actor/);checks++;await db.exec('UPDATE permission_fixture SET write_enabled=true')
 assert.equal((await bind()).idempotent,false);assert.equal((await bind()).idempotent,true);checks++
 const s=(await db.query('SELECT * FROM supplier_switch_requests')).rows[0];assert.equal(s.outbound_z03_message_id,id(8));assert.equal(s.rff_li_reference,'EXACT-LI');assert.equal(s.status,'prepared');checks++
 const enter=()=>db.query('SELECT gridex_ediel_transport.mutate_v1($1) b',[{action:'prepare',companyId:id(1),messageId:id(8)}])
 assert.equal((await enter()).rows[0].b.proceed,true);checks++
 await db.exec("UPDATE customer_contracts SET status='cancelled'");await assert.rejects(enter(),/current_source_required/);checks++
 assert.deepEqual((await db.query('SELECT gridex_ediel_transport.mutate_v1($1) b',[{action:'enter',companyId:id(1),messageId:id(8),frozen:true}])).rows[0].b,{proceed:false,providerReceipt:{frozen:true}});checks++
 await db.exec("UPDATE customer_contracts SET status='signed'");await db.exec("UPDATE supplier_switch_requests SET rff_li_reference='OTHER'");await assert.rejects(enter(),/current_source_required/);checks++;await db.exec("UPDATE supplier_switch_requests SET rff_li_reference='EXACT-LI'")
 await db.exec(`UPDATE outbound_requests SET operation_id='${id(99)}'`);await assert.rejects(enter(),/current_source_required/);checks++;await db.exec(`UPDATE outbound_requests SET operation_id='${id(6)}'`)
 await assert.rejects(db.exec("UPDATE ediel_messages SET raw_payload='changed'"),/bound_message_immutable/);checks++
 await assert.rejects(db.exec('DELETE FROM gridex_received_sources.switch_originals'),/immutable/);checks++
 // Real request schema: environment is only a locked payload crosscheck.
 await db.exec(`UPDATE outbound_requests SET payload='{"environment":"production"}'`);await assert.rejects(enter(),/current_source_required/);checks++;await db.exec(`UPDATE outbound_requests SET payload='{"environment":"test"}'`)
 const corrected=wire('Z22').replace('+I++','+NEW++').replace('Z03+DOC','Z03+CORRECTED').replace('LI:EXACT-LI','LI:NEW-LI')
 await db.query(`INSERT INTO gridex_received_sources.prodat_recovery_operations VALUES($1,$2,'contrl_correction',$3,(SELECT immutable_payload_hash FROM ediel_messages WHERE id=$3),encode(sha256(convert_to($4,'UTF8')),'hex'),$4,'test')`,[id(50),id(1),id(8),corrected]);
 await db.exec(`INSERT INTO ediel_message_intents VALUES('${id(51)}','${id(50)}','${id(6)}');INSERT INTO outbound_requests VALUES('${id(52)}','${id(1)}','{"environment":"test"}','manual','${id(51)}','supplier_switch','${id(50)}','${id(3)}','${id(7)}','${id(5)}');INSERT INTO gridex_received_sources.prodat_recovery_messages VALUES('${id(50)}','${id(53)}')`)
 await db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','draft',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,$8,$9,$10,$11)`,[id(53),id(1),corrected,id(51),id(52),id(50),id(6),id(3),id(7),id(5),id(8)])
 const correction=()=>db.query('SELECT ediel_bind_switch_correction_v1($1,$2,$3) b',[id(1),id(53),id(20)])
 await db.exec('UPDATE correction_fixture SET ok=false');await assert.rejects(correction(),/negative_source_held/);assert.equal((await db.query('SELECT outbound_z03_message_id FROM supplier_switch_requests')).rows[0].outbound_z03_message_id,id(8));checks++;await db.exec('UPDATE correction_fixture SET ok=true')
 await db.exec("UPDATE supplier_switch_requests SET status='failed'");assert.equal((await correction()).rows[0].b.idempotent,false);checks++
 const currentSwitch=(await db.query('SELECT * FROM supplier_switch_requests')).rows[0];assert.equal(currentSwitch.outbound_z03_message_id,id(53));assert.equal(currentSwitch.rff_li_reference,'NEW-LI');assert.equal((await db.query('SELECT count(*) n FROM gridex_received_sources.switch_originals')).rows[0].n,2);assert.equal((await db.query('SELECT raw_payload FROM ediel_messages WHERE id=$1',[id(8)])).rows[0].raw_payload,wire('Z22'));checks++
 assert.equal((await correction()).rows[0].b.idempotent,true);checks++
 const currentCorrection=()=>db.query('SELECT ediel_require_switch_original_current_v1($1,$2)',[id(1),id(53)])
 await currentCorrection();await assert.rejects(enter(),/current_source_required/);checks++
 await db.exec(`UPDATE outbound_requests SET operation_id='${id(99)}' WHERE id='${id(52)}'`);await assert.rejects(currentCorrection(),/current_source_required/);checks++;await db.exec(`UPDATE outbound_requests SET operation_id='${id(50)}' WHERE id='${id(52)}'`)
 await assert.rejects(db.exec(`UPDATE ediel_messages SET original_message_id='${id(99)}' WHERE id='${id(53)}'`),/bound_message_immutable/);checks++
 // An unrelated genuine fixture selector can only call its declared source
 // owner. Environment or parsed metadata alone cannot mint source truth.
 await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload) VALUES('${id(30)}','${id(1)}','test','outbound','edifact','PRODAT','Z03','draft','invalid fixture bytes');`)
 const fixture=()=>db.query('SELECT ediel_require_switch_original_current_v1($1,$2)',[id(1),id(30)])
 await assert.rejects(fixture(),/source_required/);checks++
 await db.exec(`INSERT INTO gridex_negative_fixtures.positive_consumptions VALUES('${id(1)}','${id(30)}')`);await fixture();checks++
 await db.exec('DELETE FROM gridex_negative_fixtures.positive_consumptions');await db.exec(`INSERT INTO gridex_negative_fixtures.negative_prepared_consumptions VALUES('${id(1)}','${id(30)}')`);await fixture();checks++
 await db.exec(`INSERT INTO gridex_negative_fixtures.positive_consumptions VALUES('${id(1)}','${id(30)}')`);await assert.rejects(fixture(),/ambiguous/);checks++
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid)','execute') a")).rows[0].a,false);checks++
 // P03 signed requested217 owner port: declared synthetic declaration data,
 // not authentic agreement, issuer, legal activation or native-replay proof.
 await db.exec(`CREATE SCHEMA gridex_metering_method_changes;
 CREATE TABLE gridex_metering_method_changes.contract_request_declarations(id uuid PRIMARY KEY);
 CREATE TABLE method_declaration_fixture(basis jsonb,prepare_ok bool,send_ok bool);
 CREATE FUNCTION gridex_metering_method_changes.contract_request_basis_v1(c uuid,ct uuid,actor uuid,phase text,environment text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN
 IF phase='prepare' AND (SELECT prepare_ok FROM public.method_declaration_fixture) IS NOT TRUE OR phase='send' AND (SELECT send_ok FROM public.method_declaration_fixture) IS NOT TRUE THEN RETURN '{"status":"held"}'::jsonb;END IF;
 IF actor IS DISTINCT FROM '${id(20)}' OR c IS DISTINCT FROM '${id(1)}' OR ct IS DISTINCT FROM '${id(4)}' OR environment IS DISTINCT FROM 'test' THEN RETURN '{"status":"held"}'::jsonb;END IF;
 SELECT basis INTO b FROM public.method_declaration_fixture;RETURN b;END$$;
 INSERT INTO gridex_metering_method_changes.contract_request_declarations VALUES('${id(120)}');
 INSERT INTO method_declaration_fixture SELECT jsonb_build_object('status','authorized','declarationId','${id(120)}','companyId','${id(1)}','environment','test','contractId','${id(4)}','protectedContractHash',gridex_received_sources.production_contract_hash_v1(ct),'customerId','${id(3)}','siteId','${id(7)}','meteringPointId','${id(5)}','pointId','735123456789012345','identityAgency','9','legalSenderId','12345','legalReceiverId','54321','gridArea','TES','requestedMethod','Z04'),true,true FROM customer_contracts ct;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930234708_ediel_normal_switch_signed_method_binding.sql',import.meta.url),'utf8'));checks++
 const methodWire=wire('Z22').replace("RFF+LI:","CCI++Z04'CAV+Z04'RFF+LI:")
 assert.equal((await db.query('SELECT gridex_received_sources.switch_requested_method_v1($1) m',[methodWire])).rows[0].m,'Z04');checks++
 assert.equal((await db.query('SELECT gridex_received_sources.switch_requested_method_v1($1) m',[wire('Z22')])).rows[0].m,null);checks++
 assert.equal((await db.query('SELECT gridex_received_sources.switch_requested_method_v1($1) m',[methodWire.replace("RFF+LI:","CCI++Z04'CAV+Z03'RFF+LI:")])).rows[0].m,null);checks++
 assert.equal((await db.query('SELECT gridex_received_sources.switch_requested_method_v1($1) m',[wire('Z22').replace("DTM+92:","CCI++Z04'CAV+Z04'DTM+92:")])).rows[0].m,null);checks++
 assert.equal((await correction()).rows[0].b.idempotent,true);assert.equal((await db.query('SELECT count(*) n FROM gridex_received_sources.switch_contract_request_bindings')).rows[0].n,0);checks++
 assert.deepEqual((await db.query('SELECT gridex_ediel_transport.mutate_v1($1) b',[{action:'enter',companyId:id(1),messageId:id(53),actorUserId:id(20),frozen:true}])).rows[0].b,{proceed:false,providerReceipt:{frozen:true}});checks++
 await assert.rejects(db.query('SELECT gridex_ediel_transport.mutate_v1($1)',[{action:'prepare',companyId:id(1),messageId:id(53),actorUserId:id(20)}]),/historical_requested_method_basis/);checks++
 await db.exec(`INSERT INTO supplier_switch_requests SELECT '${id(126)}',company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,NULL,NULL,NULL,requested_start_date,false,'draft',request_type,prodat_variant,prodat_reason,updated_by,updated_at FROM supplier_switch_requests WHERE id='${id(6)}';
 INSERT INTO ediel_message_intents VALUES('${id(127)}','${id(126)}','${id(126)}');
 INSERT INTO outbound_requests VALUES('${id(129)}','${id(1)}','{"environment":"test"}','supplier_switch_request','${id(126)}','supplier_switch','${id(126)}','${id(3)}','${id(7)}','${id(5)}');`)
 await db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','draft',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6::text,$6::uuid,$7,$8,$9,NULL)`,[id(128),id(1),methodWire,id(127),id(129),id(126),id(3),id(7),id(5)])
 const bindMethod=()=>db.query('SELECT ediel_bind_switch_original_v1($1,$2,$3,$4) b',[id(1),id(126),id(128),id(20)])
 await db.exec('UPDATE method_declaration_fixture SET prepare_ok=false');await assert.rejects(bindMethod(),/signed_new_agreement_requested_method/)
 assert.equal((await db.query('SELECT outbound_z03_message_id FROM supplier_switch_requests WHERE id=$1',[id(126)])).rows[0].outbound_z03_message_id,null);assert.equal((await db.query('SELECT count(*) n FROM gridex_received_sources.switch_originals WHERE message_id=$1',[id(128)])).rows[0].n,0);checks++
 await db.exec('UPDATE method_declaration_fixture SET prepare_ok=true');await db.query(`UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2`,[methodWire.replace("CCI++Z04'CAV+Z04'","CCI++Z04'CAV+Z03'"),id(128)])
 await assert.rejects(bindMethod(),/signed_new_agreement_requested_method/);checks++
 await db.query(`UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2`,[methodWire,id(128)])
 assert.equal((await bindMethod()).rows[0].b.idempotent,false);assert.equal((await bindMethod()).rows[0].b.idempotent,true);checks++
 assert.equal((await db.query('SELECT requested_method FROM gridex_received_sources.switch_contract_request_bindings WHERE message_id=$1',[id(128)])).rows[0].requested_method,'Z04');checks++
 const enterMethod=()=>db.query('SELECT gridex_ediel_transport.mutate_v1($1) b',[{action:'enter',companyId:id(1),messageId:id(128),actorUserId:id(20)}])
 assert.equal((await enterMethod()).rows[0].b.proceed,true);checks++
 await db.exec('UPDATE method_declaration_fixture SET send_ok=false');const effectsBefore=(await db.query('SELECT count(*) n FROM native_effects')).rows[0].n;await assert.rejects(enterMethod(),/signed_new_agreement_requested_method/);assert.equal((await db.query('SELECT count(*) n FROM native_effects')).rows[0].n,effectsBefore);checks++;await db.exec('UPDATE method_declaration_fixture SET send_ok=true')
 await db.exec(`UPDATE method_declaration_fixture SET basis=basis||'{"declarationId":"${id(999)}"}'::jsonb`);await assert.rejects(enterMethod(),/current_requested_method_declaration_changed/);checks++;await db.exec(`UPDATE method_declaration_fixture SET basis=basis||'{"declarationId":"${id(120)}"}'::jsonb`)
 await assert.rejects(db.exec('DELETE FROM gridex_received_sources.switch_contract_request_bindings'),/immutable/);checks++
 assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_received_sources.switch_contract_request_bindings','INSERT') a")).rows[0].a,false);checks++
 // A new qualified correction must obtain its own exact agreement binding;
 // failure rolls back the operative pointer and both new private authority rows.
 const methodCorrection=methodWire.replace('Z03+DOC','Z03+NEW-DOC').replace('LI:EXACT-LI','LI:METHOD-NEW-LI')
 await db.query(`INSERT INTO gridex_received_sources.prodat_recovery_operations VALUES($1,$2,'contrl_correction',$3,(SELECT immutable_payload_hash FROM ediel_messages WHERE id=$3),encode(sha256(convert_to($4,'UTF8')),'hex'),$4,'test')`,[id(150),id(1),id(128),methodCorrection]);
 await db.exec(`INSERT INTO ediel_message_intents VALUES('${id(151)}','${id(150)}','${id(126)}');INSERT INTO outbound_requests VALUES('${id(152)}','${id(1)}','{"environment":"test"}','manual','${id(151)}','supplier_switch','${id(150)}','${id(3)}','${id(7)}','${id(5)}');INSERT INTO gridex_received_sources.prodat_recovery_messages VALUES('${id(150)}','${id(153)}');UPDATE supplier_switch_requests SET status='failed' WHERE id='${id(126)}';`)
 await db.query(`INSERT INTO ediel_messages VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','draft',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,$8,$9,$10,$11)`,[id(153),id(1),methodCorrection,id(151),id(152),id(150),id(126),id(3),id(7),id(5),id(128)])
 const correctMethod=()=>db.query('SELECT ediel_bind_switch_correction_v1($1,$2,$3) b',[id(1),id(153),id(20)])
 await db.exec('UPDATE method_declaration_fixture SET prepare_ok=false');await assert.rejects(correctMethod(),/signed_new_agreement_requested_method/);assert.equal((await db.query('SELECT outbound_z03_message_id FROM supplier_switch_requests WHERE id=$1',[id(126)])).rows[0].outbound_z03_message_id,id(128));assert.equal((await db.query('SELECT count(*) n FROM gridex_received_sources.switch_originals WHERE message_id=$1',[id(153)])).rows[0].n,0);checks++
 await db.exec('UPDATE method_declaration_fixture SET prepare_ok=true');assert.equal((await correctMethod()).rows[0].b.idempotent,false);assert.equal((await db.query('SELECT requested_method FROM gridex_received_sources.switch_contract_request_bindings WHERE message_id=$1',[id(153)])).rows[0].requested_method,'Z04');checks++
 console.log(`PASS ${checks} focused actual switch-original SQL qualification/whole rollback/UUID/immutable/replay/fixture-port checks; declared ports, not native replay`)
}finally{await db.close()}
