// Focused mechanical PostgreSQL source/atomicity/time/replay checks. Current
// legal/rule admission and legacy activation effects are declared fixtures;
// this is not native replay, authentic issuer or formal acceptance evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
function fn(file,name){const text=readFileSync(new URL(file,import.meta.url),'utf8'),a=text.indexOf(`CREATE FUNCTION ${name}`),b=text.indexOf('$$;',a);if(a<0||b<0)throw Error(name);return text.slice(a,b+3)}
const raw=(code,objects,sender='54321',receiver='12345')=>["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A",`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((own,i)=>[`LIN+${i+1}++${own.point}:::9`,"CCI++Z13",`CAV+${own.reason??'Z22'}`,`RFF+LI:${own.li}`,"RFF+Z05:TES",`NAD+UD+${own.customer}:SE1:260`,`DTM+92:${own.start}:203`]),"UNT+20+M","UNZ+1+I"].join("'")+"'"
const q=s=>`'${String(s).replaceAll("'","''")}'`
const run=(source=id(30),actor=id(2),company=id(1))=>db.query('SELECT public.ediel_process_prodat_mixed_z04_v1($1,$2,$3) b',[company,source,actor])
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;CREATE SCHEMA gridex_ediel_ack_guide;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE admin_users(user_id uuid);CREATE TABLE user_roles(id uuid,user_id uuid,company_id uuid,role_id uuid);CREATE TABLE roles(id uuid);CREATE TABLE role_permissions(role_id uuid,permission_id uuid);CREATE TABLE permissions(id uuid);CREATE TABLE user_permissions(id uuid PRIMARY KEY,user_id uuid,company_id uuid,permission_key text,effect text);
 CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid,org_number text,personal_number text);
 CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);
 CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text);
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,status text,contract_version text,signed_version text,signed_at timestamptz,version_snapshot jsonb);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,status text,message_sent_at timestamptz,message_received_at timestamptz,immutable_rendered_at timestamptz,immutable_payload_hash text,customer_id uuid,metering_point_id uuid,related_message_id uuid);
 CREATE TABLE ediel_outbox(id uuid PRIMARY KEY,company_id uuid,environment text,ediel_message_id uuid,source_message_id uuid,message_family text,status text);
 CREATE TABLE supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid,customer_site_id uuid,contract_id uuid,customer_contract_id uuid,outbound_z03_message_id uuid,inbound_z04_message_id uuid,rff_li_reference text,status text,lifecycle_blocked bool,confirmed_start_date date,updated_at timestamptz,updated_by uuid);
 CREATE TABLE customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,customer_contract_id uuid,start_date date,actual_start_date date,end_date date,market_start_at timestamptz,market_end_at timestamptz,source text,source_process text,source_message_id uuid,source_end_message_id uuid,source_switch_request_id uuid,status text,market_state_version bigint,metadata jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE gridex_received_sources.supply_source_transitions(source_message_id uuid PRIMARY KEY,company_id uuid,payload_hash text,source_code text,source_objects jsonb,previous_states jsonb,resulting_states jsonb,qualified_switch_ids uuid[],actor_user_id uuid);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,facts_hash text,previous_assessment_id uuid);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,payload_hash text,received_context jsonb,source_received_at timestamptz);
 CREATE TABLE gridex_received_sources.object_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid,company_id uuid,environment text,source_payload_hash text,canonical_assessment_id uuid,previous_assessment_id uuid,facts_text text,facts_hash text,owner_readsets jsonb);
 CREATE TABLE gridex_received_sources.regulated_supply_ground_versions(id uuid,company_id uuid,legal_actor_id uuid);
 CREATE TABLE legal_context_fixture(message_id uuid PRIMARY KEY,basis jsonb);
 CREATE TABLE tenant_ediel_profiles(id uuid PRIMARY KEY,company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE tenant_actor_roles(id uuid PRIMARY KEY,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE tenant_actor_identifiers(id uuid PRIMARY KEY,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN SELECT basis INTO b FROM public.legal_context_fixture WHERE message_id=$2;IF b IS NULL THEN RAISE EXCEPTION 'captured_legal_fixture_unavailable';END IF;RETURN b;END$$;
 CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,binding jsonb,classification text,provider_result jsonb,entered_at timestamptz,observed_at timestamptz);
 CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb);
 CREATE TABLE gridex_outbound_dispatch.originals(message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text);
 CREATE TABLE gridex_outbound_dispatch.events(attempt_id uuid,company_id uuid,environment text,message_id uuid,kind text,facts jsonb,observed_at timestamptz);
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.user_permissions WHERE user_id=$1 AND company_id=$2 AND permission_key=$3 AND effect='allow')$$;
 CREATE FUNCTION gridex_ediel_ack_guide.require_v1(public.ediel_messages) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"applied":false,"reason":"preserved_other_source"}'::jsonb$$;
 CREATE FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"updated":0}'::jsonb$$;
 CREATE FUNCTION gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 CREATE FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date DEFAULT NULL,uuid DEFAULT NULL,text DEFAULT NULL) RETURNS TABLE(supplier_switch_request_id uuid,supply_period_id uuid,contract_id uuid,customer_application_id uuid,workflow_id uuid,domain_event_id uuid,notification_job_id uuid) LANGUAGE plpgsql AS $$DECLARE p public.customer_supply_periods%rowtype;BEGIN SELECT * INTO STRICT p FROM public.customer_supply_periods WHERE company_id=$1 AND source_switch_request_id=$2 FOR UPDATE;UPDATE public.customer_supply_periods SET status='active',actual_start_date=$4,updated_at=now(),metadata=metadata||jsonb_build_object('activationKey',$6) WHERE id=p.id;UPDATE public.supplier_switch_requests SET status='completed' WHERE id=$2;RETURN QUERY SELECT $2,p.id,p.contract_id,NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid;END$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('../supabase/migrations/20260930161624_ediel_supply_market_source_lifecycle.sql','gridex_received_sources.supply_wire_v1'))
 await db.exec(fn('../supabase/migrations/20260930174333_ediel_production_contract_source_commands.sql','gridex_received_sources.production_contract_hash_v1'))
 await db.exec(fn('../supabase/migrations/20260930204937_ediel_shared_accepted_source_basis.sql','gridex_ediel_transport.accepted_source_basis_v1'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930201111_ediel_normal_switch_source_atomic_confirmation.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930211830_ediel_supply_source_initial_scope_continuity.sql',import.meta.url),'utf8'));checks++
 await db.exec(`INSERT INTO companies VALUES('${id(1)}');INSERT INTO auth.users VALUES('${id(2)}');INSERT INTO user_permissions VALUES('${id(500)}','${id(2)}','${id(1)}','metering.write','allow');INSERT INTO user_profiles VALUES('${id(2)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(2)}','active',true,now());INSERT INTO tenant_ediel_profiles VALUES('${id(70)}','${id(1)}','test','electricity',true,'2000-01-01',NULL);INSERT INTO tenant_actor_roles VALUES('${id(71)}','${id(1)}','test','${id(50)}','electricity_supplier','2000-01-01',NULL);INSERT INTO tenant_actor_identifiers VALUES('${id(72)}','${id(1)}','test','${id(50)}','EdielId','12345','2000-01-01',NULL);`)
 const own=[{point:'735123456789012345',li:'LI-A',customer:'PERSON-A',start:'202601011330'},{point:'735123456789012352',li:'LI-B',customer:'PERSON-B',start:'202601011330'},{point:'735123456789012369',li:'LI-FUTURE',customer:'PERSON-FUTURE',start:'209901011330'}]
 for(const [index,o]of own.entries()){
  const n=index*100
  await db.exec(`INSERT INTO customers VALUES('${id(3+n)}','${id(1)}',NULL,'${o.customer}');INSERT INTO customer_sites VALUES('${id(4+n)}','${id(1)}','${id(3+n)}');INSERT INTO metering_points VALUES('${id(5+n)}','${id(1)}','${id(3+n)}','${id(4+n)}','${o.point}','54321','TES');INSERT INTO customer_contracts VALUES('${id(6+n)}','${id(1)}','${id(3+n)}','${id(5+n)}','signed','1','1','2025-12-01','{}');`)
  const original=raw('Z03',[o],'12345','54321')
  await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id,metering_point_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03',$3,'sent','2025-12-15','2025-12-15',encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5)",[id(20+n),id(1),original,id(3+n),id(5+n)])
  await db.query("INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,'test',jsonb_build_object('originalHash',encode(sha256(convert_to($4,'UTF8')),'hex'),'to','dso@example.invalid'),'accepted','{\"accepted\":[\"dso@example.invalid\"],\"rejected\":[]}',now(),now())",[id(80+n),id(20+n),id(1),original])
  await db.exec(`INSERT INTO supplier_switch_requests VALUES('${id(10+n)}','${id(1)}','${id(3+n)}','${id(5+n)}','${id(4+n)}',NULL,'${id(6+n)}',NULL,'${id(20+n)}',NULL,'${o.li}','sent',false,NULL,now(),NULL)`)
 }
 const incoming=raw('Z04',own)
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z04',$3,'received','2025-12-16')",[id(30),id(1),incoming])
 await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[id(30),{companyId:id(1),family:'PRODAT',code:'Z04',actorRole:'electricity_supplier',legalActorId:id(50),legalEdielId:'12345'}])
 const facts={syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted',reasonCodes:['PRODAT_REQUIRED_FIELD_MISSING'],registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:own.map((o,index)=>({disposition:index===1?'rejected':'accepted',messageIndex:0,messageReference:'M',objectId:o.point,identityAgency:'9',registers:[{lineIndex:index,lineNumber:String(index+1),segmentIndex:index}]}))}}
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,encode(sha256(convert_to($5,'UTF8')),'hex'),NULL)",[id(40),id(30),id(1),incoming,JSON.stringify(facts)])

 // All fixture issuer/context/transport/canonical facts above are declared
 // synthetic. Real full-guide projection is separately tested in Vitest; this
 // mechanical run verifies the COMPLETE forward migration and native mechanics.
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930224726_ediel_prodat_mixed_own_object_processing.sql',import.meta.url),'utf8'));checks++
 const guides={version:1,owner:'canonical-full-prodat-object-validation-v1',coverage:'full_canonical_guide_objects_only',sharedAccepted:true,reasonCodes:facts.reasonCodes,
  objects:own.map((o,index)=>({objectId:o.point,identityAgency:'9',messageReference:'M',firstLineIndex:index,lineItemReference:o.li,disposition:index===1?'rejected':'accepted',reasons:index===1?facts.reasonCodes:[],negativeFields:index===1?['213']:[]}))}
 // Declared synthetic PRIMARY canonical issuer for this mechanical diagnostic.
 // It appends a new leaf inside the same v3 transaction; actual canonical/registry
 // source admission is exercised by the separate native fixture and runtime unit.
 await db.exec(`CREATE FUNCTION gridex_received_sources.append_prodat_validation_v2(uuid,text,uuid,text,text,text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE prior gridex_received_sources.validation_assessments%rowtype;next_id uuid:=gen_random_uuid();BEGIN
 SELECT a.* INTO prior FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=$3 AND a.company_id=$1 AND a.environment=$2 AND a.source_payload_hash=$4 AND a.facts_text=$5 AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
 IF prior.id IS NULL THEN RAISE EXCEPTION 'declared_primary_original_required';END IF;
 INSERT INTO gridex_received_sources.validation_assessments VALUES(next_id,$3,$1,$2,$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'),prior.id);
 RETURN jsonb_build_object('assessmentId',next_id,'companyId',$1,'environment',$2,'sourceMessageId',$3,'sourcePayloadHash',$4,'factsHash',encode(sha256(convert_to($5,'UTF8')),'hex'),'ignoredFieldsHash',NULL,'sourceDisposition','not_established');END$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000148_ediel_prodat_primary_full_object_capture_and_grant_lock.sql',import.meta.url),'utf8'));checks++
 const record=(g=guides,company=id(1))=>db.query("SELECT gridex_received_sources.append_prodat_validation_v3($1,$2,$3,encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL,$6) b",[company,'test',id(30),incoming,JSON.stringify(facts),JSON.stringify(g)])
 const ackWire=(positive=[own[0],own[2]],negative=true,bgm='34')=>`UNB+UNOC:3+12345:14+54321:14+261001:1200+ACK'UNH+ACK+APERAK:D:96A:UN:E2SE6A'BGM+++${bgm}'${negative?`ERC+41::260'RFF+LI:LI-B'RFF+Z07:${own[1].point}'`:''}${positive.map(o=>`ERC+100::260'RFF+LI:${o.li}'RFF+Z07:${o.point}'`).join('')}UNT+14+ACK'UNZ+1+ACK'`
 const ackGuard=wire=>db.query('SELECT gridex_ediel_ack_guide.require_v1(row_value) FROM (SELECT e AS row_value FROM ediel_messages e WHERE id=$1) scoped',[id(90)])
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,related_message_id) VALUES($1,$2,'test','outbound','edifact','APERAK','APERAK',$3,$4)",[id(90),id(1),ackWire(),id(30)])
 await assert.rejects(ackGuard(),/committed_own_results_required/);checks++
 assert.equal((await run()).rows[0].b.applied,false);checks++
 await assert.rejects(record({...guides,objects:guides.objects.map((o,i)=>i===0?{...o,objectId:'foreign'}:o)}),/scope|decision/);checks++
 await assert.rejects(record({...guides,objects:guides.objects.map((o,i)=>i===0?{...o,disposition:null}:o)}),/facet_invalid/);checks++
 await assert.rejects(record(guides,id(999)), /original_required/);checks++
 const recorded=(await record()).rows[0].b;assert.equal(recorded.version,3);assert.ok(recorded.objectFactsHash);const currentCanonicalId=recorded.assessmentId;checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','public.gridex_record_prodat_object_validation_v1(uuid,text,uuid,text,uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 const promoted={...guides,objects:guides.objects.map((o,i)=>i===1?{...o,disposition:'accepted',reasons:[],negativeFields:[]}:o)}
 await db.exec('SET ROLE service_role');await assert.rejects(db.query("SELECT public.gridex_record_prodat_object_validation_v1($1,'test',$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5)",[id(1),id(30),incoming,currentCanonicalId,JSON.stringify(promoted)]),/permission denied/);await db.exec('RESET ROLE');checks++
 const originalLeafCount=(await db.query('SELECT count(*)::int n FROM gridex_received_sources.validation_assessments')).rows[0].n
 await assert.rejects(record(promoted),/own_decision/);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.validation_assessments')).rows[0].n,originalLeafCount);checks++
 const unchanged=async()=>assert.equal((await db.query('SELECT count(*)::int n FROM customer_supply_periods')).rows[0].n,0)
 assert.equal((await run(id(30),id(2),id(999))).rows[0].b.applied,false);checks++;await unchanged()
 await db.exec(`UPDATE user_profiles SET user_status='inactive' WHERE id='${id(2)}'`);assert.equal((await run()).rows[0].b.applied,false);checks++;await unchanged();await db.exec(`UPDATE user_profiles SET user_status='active' WHERE id='${id(2)}'`)
 await db.exec(`UPDATE user_permissions SET effect='deny'`);assert.equal((await run()).rows[0].b.applied,false);checks++;await unchanged();await db.exec(`UPDATE user_permissions SET effect='allow'`)
 await db.exec(`UPDATE supplier_switch_requests SET status='cancelled_before_start' WHERE id='${id(210)}'`);assert.equal((await run()).rows[0].b.applied,false);checks++;await unchanged();await db.exec(`UPDATE supplier_switch_requests SET status='sent' WHERE id='${id(210)}'`)
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='partial' WHERE message_id='${id(20)}'`);assert.equal((await run()).rows[0].b.applied,false);checks++;await unchanged();await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='accepted' WHERE message_id='${id(20)}'`)
 // Failing final outbox insertion rolls back preceding periods, switch mutation,
 // actual confirmation and audit, rather than exposing only a partial commit.
 await db.exec(`CREATE FUNCTION reject_mixed_outbox_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_outbox_failure';END$$;CREATE TRIGGER fixture_reject_outbox BEFORE INSERT ON gridex_received_sources.prodat_mixed_reply_outbox FOR EACH ROW EXECUTE FUNCTION reject_mixed_outbox_fixture();`)
 await assert.rejects(run(),/declared_outbox_failure/);checks++;await unchanged()
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.normal_switch_confirmations')).rows[0].n,0);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.prodat_mixed_object_receipts')).rows[0].n,0);checks++
 await db.exec('DROP TRIGGER fixture_reject_outbox ON gridex_received_sources.prodat_mixed_reply_outbox')
 const result=(await run()).rows[0].b;assert.equal(result.applied,true);assert.equal(result.commits.length,2);checks++
 assert.deepEqual(result.processedObjects.map(o=>o.disposition),['accepted','rejected','accepted']);checks++
 assert.equal(result.periods.length,2);assert.ok(result.periods.every(p=>p.metering_point_id!==id(105)));checks++
 assert.equal((await db.query('SELECT status FROM supplier_switch_requests WHERE id=$1',[id(110)])).rows[0].status,'sent');checks++
 assert.equal((await db.query('SELECT raw_payload FROM ediel_messages WHERE id=$1',[id(30)])).rows[0].raw_payload,incoming);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.prodat_mixed_reply_outbox')).rows[0].n,1);checks++
 assert.equal((await run()).rows[0].b.idempotent,true);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM customer_supply_periods')).rows[0].n,2);checks++
 await db.exec(`UPDATE user_profiles SET user_status='inactive' WHERE id='${id(2)}'`);assert.equal((await run()).rows[0].b.applied,false);checks++;await db.exec(`UPDATE user_profiles SET user_status='active' WHERE id='${id(2)}'`)
 await db.exec(`UPDATE company_memberships SET is_active=false`);assert.equal((await run()).rows[0].b.applied,false);checks++;await db.exec(`UPDATE company_memberships SET is_active=true`)
 await assert.rejects(db.exec("UPDATE gridex_received_sources.prodat_mixed_reply_outbox SET own_outcomes='[]'"),/immutable/);checks++
 await assert.rejects(db.exec("UPDATE gridex_received_sources.prodat_mixed_object_receipts SET result='{}'"),/immutable/);checks++
 await assert.rejects(db.exec("UPDATE gridex_received_sources.prodat_object_validation_facets SET facts_text='{}'"),/immutable/);checks++
 const readReply=(company=id(1),actor=id(2))=>db.query('SELECT public.ediel_read_prodat_mixed_reply_v1($1,$2,$3) b',[company,id(30),actor])
 const consume=(ack=id(90))=>db.query('SELECT public.ediel_consume_prodat_mixed_reply_v1($1,$2,$3,$4) b',[id(1),id(30),ack,id(2)])
 assert.ok((await readReply()).rows[0].b.replyIntentId);checks++
 assert.equal((await readReply(id(999))).rows[0].b,null);checks++
 await db.exec(`UPDATE user_profiles SET user_status='inactive' WHERE id='${id(2)}'`);assert.equal((await readReply()).rows[0].b,null);checks++;await db.exec(`UPDATE user_profiles SET user_status='active' WHERE id='${id(2)}'`)
 await ackGuard();checks++
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[ackWire(own,false),id(90)]);await assert.rejects(ackGuard(),/whole_source_success_forbidden/);checks++
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[ackWire([own[1]]),id(90)]);await assert.rejects(ackGuard(),/own_commit_mismatch/);checks++
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[ackWire(undefined,true,'27'),id(90)]);await assert.rejects(consume(),/own_ack_required/);checks++
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[ackWire(),id(90)]);await assert.rejects(consume(),/actual_dispatch_outbox_required/);checks++
 await db.query("INSERT INTO ediel_outbox VALUES($1,$2,'test',$3,$4,'APERAK','queued')",[id(91),id(1),id(90),id(30)])
 assert.equal((await consume()).rows[0].b.consumed,true);checks++
 assert.equal((await consume()).rows[0].b.idempotent,true);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.prodat_mixed_reply_consumptions')).rows[0].n,1);checks++
 await assert.rejects(db.exec('DELETE FROM gridex_received_sources.prodat_mixed_reply_consumptions'),/immutable/);checks++
 const p=result.commits.find(c=>c.switchRequestId===id(10)).supplyPeriodId
 const bounds=async()=>db.query('SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3,$4) b',[id(1),p,'2026-01-01T12:30Z','2026-01-02T00:00Z'])
 assert.equal((await bounds()).rows[0].b.qualified,true);checks++
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,encode(sha256(convert_to($5,'UTF8')),'hex'),$6)",[id(41),id(30),id(1),incoming,JSON.stringify(facts),currentCanonicalId])
 assert.equal((await bounds()).rows[0].b,null);checks++;assert.equal((await run()).rows[0].b.applied,false);checks++ // new canonical leaf must have its own exact fresh facet
 await record()
 assert.equal((await run()).rows[0].b.idempotent,true);checks++ // exact new primary facet content can revalidate the existing actual effect
 assert.equal((await bounds()).rows[0].b.qualified,true);checks++
 await ackGuard();checks++
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.ediel_process_prodat_mixed_z04_v1(uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 console.log(`PASS ${checks} mixed own-object complete-migration/tenant/revocation/zero-forbidden-sibling-effects/immutable-replay/atomic-outbox/continuity PostgreSQL checks; declared synthetic fixtures, not authentic native acceptance`)
}finally{await db.close()}
