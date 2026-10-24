// Focused mechanical PostgreSQL source/atomicity/time/replay checks. Current
// legal/rule admission and legacy activation effects are declared fixtures;
// this is not native replay, authentic issuer or formal acceptance evidence.
import {readFileSync,originalIO} from './h3-fixture-io.mjs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const SOURCE_URL=new URL('./h3-final-actual-sql.mjs',import.meta.url).href;
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
function fn(file,name){const text=readFileSync(new URL(file,SOURCE_URL),'utf8'),a=text.indexOf(`CREATE FUNCTION ${name}`),b=text.indexOf('$$;',a);if(a<0||b<0)throw Error(name);return text.slice(a,b+3)}
const raw=(code,objects,sender='54321',receiver='12345')=>["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A",`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((own,i)=>[`LIN+${i+1}++${own.point}:::9`,"CCI++Z13",`CAV+${own.reason??'Z22'}`,`RFF+LI:${own.li}`,"RFF+Z05:TES",`NAD+UD+${own.customer}:SE1:260`,`DTM+92:${own.start}:203`]),"UNT+20+M","UNZ+1+I"].join("'")+"'"
const q=s=>`'${String(s).replaceAll("'","''")}'`
const run=(source=id(30),actor=id(2),company=id(1))=>db.query('SELECT public.ediel_apply_supply_source_v1($1,$2,$3) b',[company,source,actor])
const activate=(source=id(30),actor=id(2),date=null)=>db.query('SELECT * FROM public.activate_customer_supply_v1($1,$2,$3,$4,$5,NULL)',[id(1),id(10),source,date,actor])
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_outbound_dispatch;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid,org_number text,personal_number text);
 CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);
 CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text);
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,status text,contract_version text,signed_version text,signed_at timestamptz,version_snapshot jsonb);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,status text,message_sent_at timestamptz,message_received_at timestamptz,immutable_rendered_at timestamptz,immutable_payload_hash text,customer_id uuid,metering_point_id uuid);
 CREATE TABLE supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid,customer_site_id uuid,contract_id uuid,customer_contract_id uuid,outbound_z03_message_id uuid,inbound_z04_message_id uuid,rff_li_reference text,status text,lifecycle_blocked bool,confirmed_start_date date,updated_at timestamptz,updated_by uuid);
 CREATE TABLE customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,customer_contract_id uuid,start_date date,actual_start_date date,end_date date,market_start_at timestamptz,market_end_at timestamptz,source text,source_process text,source_message_id uuid,source_end_message_id uuid,source_switch_request_id uuid,status text,market_state_version bigint,metadata jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE gridex_received_sources.supply_source_transitions(source_message_id uuid PRIMARY KEY,company_id uuid,payload_hash text,source_code text,source_objects jsonb,previous_states jsonb,resulting_states jsonb,qualified_switch_ids uuid[],actor_user_id uuid);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid);
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
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"applied":false,"reason":"preserved_other_source"}'::jsonb$$;
 CREATE FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"updated":0}'::jsonb$$;
 CREATE FUNCTION gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 CREATE FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date DEFAULT NULL,uuid DEFAULT NULL,text DEFAULT NULL) RETURNS TABLE(supplier_switch_request_id uuid,supply_period_id uuid,contract_id uuid,customer_application_id uuid,workflow_id uuid,domain_event_id uuid,notification_job_id uuid) LANGUAGE plpgsql AS $$DECLARE p public.customer_supply_periods%rowtype;BEGIN SELECT * INTO STRICT p FROM public.customer_supply_periods WHERE company_id=$1 AND source_switch_request_id=$2 FOR UPDATE;UPDATE public.customer_supply_periods SET status='active',actual_start_date=$4,updated_at=now(),metadata=metadata||jsonb_build_object('activationKey',$6) WHERE id=p.id;UPDATE public.supplier_switch_requests SET status='completed' WHERE id=$2;RETURN QUERY SELECT $2,p.id,p.contract_id,NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid;END$$;`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('../supabase/migrations/20260930161624_ediel_supply_market_source_lifecycle.sql','gridex_received_sources.supply_wire_v1'))
 await db.exec(fn('../supabase/migrations/20260930174333_ediel_production_contract_source_commands.sql','gridex_received_sources.production_contract_hash_v1'))
 await db.exec(fn('../supabase/migrations/20260930204937_ediel_shared_accepted_source_basis.sql','gridex_ediel_transport.accepted_source_basis_v1'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930201111_ediel_normal_switch_source_atomic_confirmation.sql',SOURCE_URL),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930211830_ediel_supply_source_initial_scope_continuity.sql',SOURCE_URL),'utf8'));checks++
 await db.exec(`INSERT INTO companies VALUES('${id(1)}');INSERT INTO user_profiles VALUES('${id(2)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(2)}','active',true,now());INSERT INTO tenant_ediel_profiles VALUES('${id(70)}','${id(1)}','test','electricity',true,'2000-01-01',NULL);INSERT INTO tenant_actor_roles VALUES('${id(71)}','${id(1)}','test','${id(50)}','electricity_supplier','2000-01-01',NULL);INSERT INTO tenant_actor_identifiers VALUES('${id(72)}','${id(1)}','test','${id(50)}','EdielId','12345','2000-01-01',NULL);`)
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
 const facts={syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:own.map(o=>({disposition:'accepted',messageIndex:0,objectId:o.point,identityAgency:'9',registers:[{}]}))}}
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL)",[id(40),id(30),id(1),incoming,JSON.stringify(facts)])
 await db.exec(`UPDATE supplier_switch_requests SET status='cancelled_before_start' WHERE id='${id(110)}'`)
 assert.equal((await run()).rows[0].b.applied,false);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM customer_supply_periods')).rows[0].n,0);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.normal_switch_confirmations')).rows[0].n,0);checks++
 await db.exec(`UPDATE supplier_switch_requests SET status='sent',site_id=NULL,customer_site_id='${id(104)}' WHERE id='${id(110)}';UPDATE ediel_messages SET status='acknowledged' WHERE id IN('${id(20)}','${id(120)}','${id(220)}')`)
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='partial' WHERE message_id='${id(20)}'`);assert.equal((await run()).rows[0].b.applied,false);checks++;await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='accepted' WHERE message_id='${id(20)}'`);
 await db.exec('ALTER TABLE public.customer_supply_periods ADD COLUMN actual_end_date date;ALTER TABLE public.customer_contracts ADD COLUMN termination_reason text,ADD COLUMN ended_at timestamptz');

 await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA extensions;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 SELECT set_config('request.jwt.claim.role','service_role',false);
 CREATE FUNCTION public.digest(text,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
 ALTER TABLE public.customers ADD COLUMN status text DEFAULT 'active',ADD COLUMN moved_out_at date,ADD COLUMN lifecycle_status_reason text,ADD COLUMN updated_at timestamptz,ADD COLUMN lifecycle_closed_at timestamptz,ADD COLUMN lifecycle_closed_by uuid;
 ALTER TABLE public.customer_contracts ADD COLUMN starts_at date DEFAULT '2025-12-01',ADD COLUMN binding_months int DEFAULT 0,ADD COLUMN termination_notice_date date DEFAULT '2026-01-01',ADD COLUMN withdrawal_requested_at timestamptz,ADD COLUMN rejected_reason text,ADD COLUMN status_reason_code text,ADD COLUMN metadata jsonb DEFAULT '{}',ADD COLUMN updated_by uuid,ADD COLUMN updated_at timestamptz;
 ALTER TABLE public.customer_sites ADD COLUMN status text,ADD COLUMN move_out_date date,ADD COLUMN closed_at timestamptz,ADD COLUMN closed_reason text,ADD COLUMN updated_by uuid;
 ALTER TABLE public.metering_points ADD COLUMN status text,ADD COLUMN end_date date,ADD COLUMN closed_at timestamptz,ADD COLUMN closed_reason text,ADD COLUMN updated_by uuid;
 ALTER TABLE public.supplier_switch_requests ADD COLUMN failed_at timestamptz,ADD COLUMN failure_reason text;
 CREATE TABLE public.customer_contract_events(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,company_id uuid,customer_contract_id uuid,customer_id uuid,event_type text,happened_at timestamptz, note text,metadata jsonb,actor_user_id uuid,created_at timestamptz DEFAULT now());
 CREATE TABLE public.domain_events(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,actor_user_id uuid,source text,idempotency_key text UNIQUE,payload jsonb);
 CREATE TABLE public.event_outbox(id uuid DEFAULT gen_random_uuid(),company_id uuid,domain_event_id uuid,destination_type text,destination_key text,payload jsonb);
 CREATE TABLE public.customer_operation_tasks(id uuid DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,metering_point_id uuid,site_id uuid,task_type text,status text,priority text,title text,description text,metadata jsonb,created_by uuid,updated_by uuid,resolved_at timestamptz);
 CREATE TABLE public.customer_internal_notes(company_id uuid,customer_id uuid,body text,created_by uuid,updated_by uuid);
 CREATE TABLE public.customer_lifecycle_events(company_id uuid,customer_id uuid,event_type text,event_status text,effective_date date,reason text,payload jsonb,created_by uuid);
 CREATE TABLE permission_fixture(allowed bool);INSERT INTO permission_fixture VALUES(true);
 CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT allowed AND $1='00000000-0000-0000-0000-000000000002'::uuid AND $2='00000000-0000-0000-0000-000000000001'::uuid FROM public.permission_fixture$$;
 `)
 const result=(await run()).rows[0].b;assert.equal(result.applied,true);assert.equal(result.commits.length,3);checks++
 assert.equal(result.periods.find(p=>p.metering_point_id===id(5)).market_start_at,'2026-01-01T12:30:00+00:00');checks++
 assert.ok(result.periods.every(p=>p.status==='confirmed_by_grid_owner'));checks++
 assert.equal((await run()).rows[0].b.idempotent,true);checks++;await assert.rejects(db.query('SELECT * FROM public.activate_customer_supply_v1($1,$2,$3,NULL,$4,NULL)',[id(1),id(210),id(30),id(2)]),/not_due/);checks++
 await assert.rejects(activate(id(30),id(2),'2026-01-02'),/current_confirmation_changed/);checks++
 await db.exec(`UPDATE supplier_switch_requests SET customer_site_id='${id(999)}' WHERE id='${id(10)}'`)
 await assert.rejects(activate(),/current_confirmation_changed/);checks++
 await db.exec(`UPDATE supplier_switch_requests SET customer_site_id=NULL WHERE id='${id(10)}';UPDATE customer_contracts SET status=\'cancelled\' WHERE id='${id(6)}'`)
 await assert.rejects(activate(),/current_confirmation_changed/);checks++
 await db.exec(`UPDATE customer_contracts SET status='signed' WHERE id='${id(6)}'`)
 await db.exec('BEGIN')
 const ordered=(await db.query('SELECT c.period_id,c.contract_id FROM gridex_received_sources.normal_switch_confirmations c ORDER BY c.market_start_at,c.period_id')).rows
 await db.query('UPDATE customer_contracts SET status=\'cancelled\' WHERE id=$1',[ordered[0].contract_id]);
 const sweep=()=>db.query('SELECT public.ediel_advance_supply_deadlines_v1($1,$2,1) b',[id(1),id(2)])
 assert.equal((await sweep()).rows[0].b.normalActivated,0);checks++
 assert.equal((await sweep()).rows[0].b.normalActivated,1);checks++
 await db.exec('ROLLBACK')
 await db.exec(`UPDATE customer_contracts SET status='signed' WHERE id='${id(6)}'`)
 const first=(await activate()).rows[0];assert.ok(first.supply_period_id);checks++
 assert.deepEqual((await activate()).rows[0],first);checks++
 await db.exec(fn('../supabase/migrations/20260930221158_ediel_source_qualified_switch_correction_binding.sql','gridex_received_sources.supply_period_source_at_v1'))
 const at=async(company,instant)=>(await db.query('SELECT gridex_received_sources.supply_period_source_at_v1($1,$2,$3) b',[company,first.supply_period_id,instant])).rows[0].b
 assert.equal((await at(id(1),'2026-01-01T12:30Z')).basisKind,'exact_source_point');checks++
 assert.equal(await at(id(1),'2026-01-01T12:29:59.999999Z'),null);checks++
 assert.equal(await at(id(99),'2026-01-01T12:30Z'),null);checks++
 assert.equal(await at(id(1),'infinity'),null);checks++
 const bounds=await db.query('SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3,$4) b',[id(1),first.supply_period_id,'2026-01-01T12:30Z','2026-01-02T00:00Z']);assert.equal(bounds.rows[0].b.qualified,true);assert.equal(bounds.rows[0].b.activated,true);assert.equal(bounds.rows[0].b.dsoEdielId,'54321');assert.equal(bounds.rows[0].b.sourceObjects[0].identityAgency,'9');assert.ok(bounds.rows[0].b.originalAcceptedAt);checks++
 assert.equal((await db.query('SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3,$4) b',[id(1),first.supply_period_id,'2026-01-01T12:29Z','2026-01-02T00:00Z'])).rows[0].b,null);checks++

 // Authority ports only: actual source-basis functions below are NOT replaced.
 await db.exec(`CREATE SCHEMA gridex_bilateral_prodat;CREATE SCHEMA gridex_regulated_supply;
 CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.lock_supply_v1() RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE OR REPLACE FUNCTION gridex_regulated_supply.lock_graph_v1() RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE OR REPLACE FUNCTION gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE OR REPLACE FUNCTION gridex_received_sources.supply_wire_for_period_receipt_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 CREATE OR REPLACE FUNCTION gridex_received_sources.supply_effect_assessment_owns_period_v1(uuid,uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE OR REPLACE FUNCTION gridex_received_sources.mixed_period_canonical_v1(uuid,uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`)
 const currentSource=readFileSync('fixture-input/gridex_received_sources_supply_period_source_basis_v1.sql','utf8')
 const billingSource=readFileSync('fixture-input/gridex_received_sources_billing_supply_basis_v1.sql','utf8')
 await db.exec(currentSource.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 await db.exec(billingSource.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 const currentBasis=async()=>(await db.query('SELECT gridex_received_sources.billing_supply_basis_v1($1,$2,$3,$4) b',[id(1),first.supply_period_id,'2026-01-01T12:30Z','2026-01-02T00:00Z'])).rows[0].b

 const root='fixture-input/';
 const schema=readFileSync(root+'pinned-schema.sql','utf8');
 const exactFn=name=>{const a=schema.indexOf('CREATE FUNCTION '+name+'('),b=schema.indexOf('$$;',a);assert.ok(a>0&&b>a);return schema.slice(a,b+3)};
 await db.exec('CREATE SCHEMA gridex_supply_rescission;CREATE SCHEMA gridex_ediel_retention;CREATE TABLE gridex_ediel_retention.blob_tombstones(company_id uuid,message_id uuid)');
 for(const name of ['gridex_bilateral_prodat.supply_effect_receipts','gridex_supply_rescission.end_receipts','gridex_supply_rescission.mandates']){const a=schema.indexOf('CREATE TABLE '+name+' ('),b=schema.indexOf('\n);',a);assert.ok(a>0&&b>a);await db.exec(schema.slice(a,b+3));}
 await db.exec('CREATE FUNCTION gridex_supply_rescission.lock_original_v1() RETURNS void LANGUAGE sql AS $$SELECT$$');
 for(const name of ['public.ediel_require_source_bytes_available_v1','gridex_supply_rescission.has_end_selector_v1','gridex_supply_rescission.recorded_end_current_v1','gridex_bilateral_prodat.recorded_supply_current_v1','public.gridex_record_customer_contract_event_v1','public.gridex_end_customer_supply_v1','public.gridex_close_customer_lifecycle_v1'])await db.exec(exactFn(name).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
 await db.exec("CREATE OR REPLACE FUNCTION gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'unexpected_regulated_source_in_normal_fixture';END$$");
 const end=()=>db.query('select public.gridex_end_customer_supply_v1($1,$2,$3,$4,$5,NULL,$6) b',[id(1),id(3),id(5),'2026-02-15','move_out',id(2)]);
 const close=()=>db.query('select public.gridex_close_customer_lifecycle_v1($1,$2,$3,$4,$5,$6,$7,false) b',[id(1),id(3),id(2),'move_out','2026-02-15','fixture','fixture']);


 await db.exec(readFileSync(root+'latest-h3c/supabase/migrations/20261023201000_manual_end_shortens_ediel_supply_basis.sql','utf8'));
 const actualFn=name=>{const start=schema.indexOf('CREATE FUNCTION '+name+'(');assert.ok(start>=0,name);const marker=/\bAS (\$[^$]*\$)/.exec(schema.slice(start));assert.ok(marker,name);const bodyStart=start+marker.index+marker[0].length,stop=schema.indexOf(marker[1]+';',bodyStart);return schema.slice(start,stop+marker[1].length+1).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')};
 for(const name of ['gridex_received_sources.supply_object_partitions','gridex_received_sources.supply_object_effect_receipts','gridex_received_sources.object_assessments']){const a=schema.indexOf('CREATE TABLE '+name+' ('),b=schema.indexOf('\n);',a);await db.exec(schema.slice(a,b+3));}
 await db.exec(`ALTER TABLE public.company_memberships ADD COLUMN id uuid DEFAULT gen_random_uuid();
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,payload_hash text);
 CREATE TABLE public.application_admission_fixture(company_id uuid,source_id uuid,canonical_id uuid,scope jsonb);
 CREATE FUNCTION gridex_received_sources.require_supply_scope_admission_v1(uuid,uuid,jsonb) RETURNS uuid LANGUAGE plpgsql AS $$DECLARE v uuid;BEGIN SELECT canonical_id INTO v FROM public.application_admission_fixture WHERE company_id=$1 AND source_id=$2 AND scope=$3;IF v IS NULL THEN RAISE EXCEPTION 'fixture_scope_admission_unavailable';END IF;RETURN v;END$$;
 CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('assessmentId',canonical_id,'headerDecision','accepted','objects',jsonb_build_array(scope)) FROM public.application_admission_fixture WHERE company_id=$1 AND source_id=$2$$;
 CREATE FUNCTION gridex_received_sources.prodat_application_object_accepted_v1(uuid,uuid,uuid,jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.application_admission_fixture WHERE company_id=$1 AND source_id=$2 AND canonical_id=$3 AND scope=$4)$$;`);
 for(const name of ['gridex_received_sources.supply_wire_for_scope_v1','gridex_received_sources.other_supply_scope_effect_v1','gridex_bilateral_prodat.apply_supply_before_h_v1','public.gridex_supply_end_followup_v1'])await db.exec(actualFn(name));
 await db.exec('CREATE TRIGGER actual_supply_end_followup AFTER UPDATE OF end_date,actual_end_date,status ON public.customer_supply_periods FOR EACH ROW EXECUTE FUNCTION public.gridex_supply_end_followup_v1()');
 await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',encode(sha256(convert_to($3,'UTF8')),'hex'))",[id(30),id(1),incoming]);
 const acceptedObject={disposition:'accepted',object:{objectId:own[0].point,identityAgency:'9'},business:{supplyPeriodId:first.supply_period_id,customerId:id(3),meteringPointId:id(5),owner:'inbound-z04-switch-confirmation-v1'},party:{parties:{legalSender:'54321',legalReceiver:'12345'}}};
 const oldFacts=JSON.stringify({objects:[acceptedObject]});
 await db.query("INSERT INTO gridex_received_sources.object_assessments(source_message_id,company_id,environment,source_payload_hash,canonical_assessment_id,facts_text,facts_hash,owner_readsets) VALUES($1,$2,'test',encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'),'[]')",[id(30),id(1),incoming,id(40),oldFacts]);
 const receivedEnd=raw('Z05',[{...own[0],start:'202602160000'}]).replace('DTM+92:','DTM+93:');
 await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at,customer_id,metering_point_id) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z05',$3,'received','2026-01-03',$4,$5)",[id(600),id(1),receivedEnd,id(3),id(5)]);
 await db.query('INSERT INTO public.legal_context_fixture VALUES($1,$2)',[id(600),{companyId:id(1),family:'PRODAT',code:'Z05',actorRole:'electricity_supplier',legalActorId:id(50),legalEdielId:'12345'}]);
 const linIndex=(await db.query("SELECT (t->>'index')::int i FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2($1)) t WHERE t->>'tag'='LIN'",[receivedEnd])).rows[0].i;
 const scope={messageIndex:0,objectId:own[0].point,identityAgency:'9',registers:[{segmentIndex:linIndex}]};
 await db.query('INSERT INTO public.application_admission_fixture VALUES($1,$2,$3,$4)',[id(1),id(600),id(601),scope]);
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL)",[id(601),id(600),id(1),receivedEnd,JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})]);
 await db.exec('CREATE FUNCTION public.fixture_actual_z05_route(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_bilateral_prodat.apply_supply_before_h_v1($1,$2,$3)$$');
 const receive=async()=>{await db.exec('SET ROLE service_role');try{return (await db.query('SELECT public.fixture_actual_z05_route($1,$2,$3) r',[id(1),id(600),id(2)])).rows[0].r}catch(error){console.error('ACTUAL_ERROR',error.message,error.code,error.where);throw error}finally{try{await db.exec('RESET ROLE')}catch{}}};
 await db.exec('CREATE TABLE gridex_ediel_retention.record_tombstones(company_id uuid,contract_id uuid)');await db.exec(actualFn('public.ediel_require_contract_records_available_v1'));
 const {installOuterChain}=await import('./manual-received-consumers-outer-chain.mjs');const checkOuterChain=await installOuterChain(db,id,first);
 const consumers=(await db.query("SELECT oid::regprocedure::text signature,prosrc,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('gridex_set_metering_billing_gate','gridex_store_billing_underlay','gridex_read_interval_pricing_snapshot_v1','gridex_persist_pricing_run') ORDER BY proname")).rows;
 const exportDefinition=(await db.query("SELECT pg_get_viewdef('public.billing_export_readiness_v') definition")).rows[0].definition;
 await Promise.resolve(originalIO).then(fs=>fs.writeFileSync(root+'reconciliation-consumer-predecessors.json',JSON.stringify({consumers,exportDefinition},null,2)));
 await db.exec(`ALTER TABLE public.customer_contracts ADD actual_start_at date,ADD confirmed_start_at date,ADD expected_start_at date;ALTER TABLE public.customers ADD customer_type text NOT NULL DEFAULT 'private';`);
 await db.exec(readFileSync(root+'latest-h3d/supabase/migrations/20261023202000_move_out_fee_review_and_final_invoice.sql','utf8'));
 // Current receiver dec74 PART2, exact original SQL. Notice side-table ownership/RLS
 // is a separate fixture port; actual pure notice functions execute unchanged.
 await db.exec('ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS ends_at date,ADD COLUMN IF NOT EXISTS notice_months int DEFAULT 0,ADD COLUMN IF NOT EXISTS customer_site_id uuid,ADD COLUMN IF NOT EXISTS site_id uuid;ALTER TABLE public.supplier_switch_requests ADD COLUMN IF NOT EXISTS process_type text,ADD COLUMN IF NOT EXISTS request_type text; CREATE TABLE public.customer_contract_notice_terms(customer_contract_id uuid,company_id uuid,notice_days int);ALTER TABLE public.customer_lifecycle_events ADD CONSTRAINT customer_lifecycle_events_type_check CHECK(event_type IS NOT NULL)');
 const notice=readFileSync('20261023204000_h3d_contract_notice_days.sql','utf8');
 for(const name of ['gridex_contract_notice_end_v1','gridex_contract_termination_end_v1','gridex_customer_contract_notice_days_v1']){
   const a=notice.indexOf('create function public.'+name+'('),b=notice.indexOf('$$;',a);assert.ok(a>=0&&b>a);await db.exec(notice.slice(a,b+3));
 }
 await db.exec('REVOKE ALL ON FUNCTION public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean) TO service_role');
 for(const name of ['20261023203000_h3d_contract_end_after_supply_end.sql','20261023203500_h3d_contract_end_after_supply_basis.sql','20261023205000_h3d_move_out_notice_and_termination.sql'])await db.exec(readFileSync(name,'utf8'));
 await db.exec(readFileSync(root+'final-h3/supabase/migrations/20261024002647_h3_manual_01_continuation.sql','utf8'));
 await db.exec(readFileSync(root+'final-h3/supabase/migrations/20261024002649_h3_manual_02_received_end.sql','utf8'));
 // Actual private governance DDL + canonical finance guard/redaction SQL.
 // The full legal owner transition is independently exercised by the finance
 // harness. Here exact tombstone creation is a declared legal-owner fixture port
 // so actual source consumers can be exercised after native governed redaction.
 await db.exec('CREATE ROLE gridex_ediel_retention_owner BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE public.permissions(key text UNIQUE,name text,category text,is_active bool);ALTER TABLE gridex_received_sources.supply_object_effect_receipts ADD PRIMARY KEY(id)');
 await db.query('INSERT INTO auth.users VALUES($1)',[id(2)]);
 const mainSchema=readFileSync('fixture-repository/supabase/schema.sql','utf8');
 const mainFn=name=>{const a=mainSchema.indexOf('CREATE FUNCTION '+name+'('),m=/\bAS (\$[^$]*\$)/.exec(mainSchema.slice(a));assert.ok(a>=0&&m);const b=a+m.index+m[0].length,e=mainSchema.indexOf(m[1]+';',b);return mainSchema.slice(a,e+m[1].length+1)};
 for(const name of ['gridex_ediel_retention.finance_class_catalog','gridex_ediel_retention.finance_tombstones']){const a=mainSchema.indexOf('CREATE TABLE '+name+' ('),b=mainSchema.indexOf('\n);',a);await db.exec(mainSchema.slice(a,b+3));}
 for(const name of ['gridex_ediel_retention.finance_basis_v1','gridex_ediel_retention.finance_redacted_v1','gridex_ediel_retention.finance_target_guard_v1','public.ediel_is_qualified_finance_retention_transition_v1'])await db.exec(mainFn(name));
 await db.exec(readFileSync(root+'final-h3/supabase/migrations/20261024002650_h3_manual_03_retention.sql','utf8'));
 await db.exec(readFileSync(root+'final-h3/supabase/migrations/20261024002651_h3_manual_04_billing_consumers.sql','utf8'));
 for(const name of ['public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid)','public.gridex_close_customer_lifecycle_v2(uuid,uuid,uuid,text,date,text,text,boolean,date)','public.gridex_supply_end_followup_v1()'])assert.ok((await db.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[name])).rows[0].prosrc.includes('H3d (20261023202000)'));
 const results=[];const governanceResults=[];
 for(const [name,manual] of [['normal_source_before_manual',null],['after_actual_end_supply',end],['after_actual_lifecycle_close',close]]){
  await db.exec('BEGIN');if(manual)await manual();const result=await receive();const outer=result.applied?await checkOuterChain():null;const after=(await db.query('SELECT to_jsonb(p) p FROM public.customer_supply_periods p WHERE id=$1',[first.supply_period_id])).rows[0].p;const basis=await currentBasis();const contract=(await db.query('SELECT status,termination_reason,ended_at FROM public.customer_contracts WHERE id=$1',[id(6)])).rows[0];
  if(manual){
   for(const [tab,k,cols]of [['manual_billing_continuations_v1','manual_billing_continuation_body',['original_period','original_basis']],['manual_received_end_successors_v1','manual_received_end_successor_body',['resulting_period']]]){
    await db.exec('SAVEPOINT governed_redaction');
    const row=(await db.query('SELECT to_jsonb(r) b FROM gridex_received_sources.'+tab+' r')).rows[0].b;
    const originalState=(await db.query('SELECT to_jsonb(p) p FROM public.customer_supply_periods p WHERE id=$1',[first.supply_period_id])).rows[0].p;
    const ownHash=(await db.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[JSON.stringify(Object.fromEntries(cols.map(col=>[col,row[col]])))])).rows[0].h;
    await db.query("INSERT INTO gridex_ediel_retention.finance_tombstones(retention_class,target_id,company_id,decision_id,review_id,source_hash,target_hash,scope_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference) VALUES($1,$2,$3,$4,$4,$5,encode(sha256(convert_to($6::jsonb::text,'UTF8')),'hex'),$5,1,$4,now()+interval '1 hour','SYNTHETIC owner fixture only')",[k,row.id,id(1),id(2),ownHash,JSON.stringify(row)]);
    const redacted=(await db.query('SELECT gridex_ediel_retention.finance_redacted_v1($1,$2,$3) b',[k,JSON.stringify(row),ownHash])).rows[0].b;
    await db.query('UPDATE gridex_received_sources.'+tab+' SET ('+cols.join(',')+')=(SELECT '+cols.join(',')+' FROM jsonb_populate_record(NULL::gridex_received_sources.'+tab+',$1)) WHERE id=$2',[JSON.stringify(redacted),row.id]);
    await db.exec('SAVEPOINT hold_observation');let refused=false;try{refused=await currentBasis()===null}catch(error){assert.match(error.message,/manual_billing_record_scope_required|tombstoned/);refused=true}assert.equal(refused,true,'redacted '+k+' cannot grant billing');await db.exec('ROLLBACK TO hold_observation');
    assert.deepEqual((await db.query('SELECT to_jsonb(p) p FROM public.customer_supply_periods p WHERE id=$1',[first.supply_period_id])).rows[0].p,originalState,'copy cleanup never mutates actual market or commercial state');
    await db.exec('SAVEPOINT restore_attempt');await assert.rejects(()=>db.query('UPDATE gridex_received_sources.'+tab+' SET '+cols[0]+'=$1 WHERE id=$2',[JSON.stringify(row[cols[0]]),row.id]),/tombstoned|immutable/);await db.exec('ROLLBACK TO restore_attempt');
    governanceResults.push({writer:name,retentionClass:k,sourceBasisHeld:true,originalMarketStatePreserved:true,restoreDenied:true});
    await db.exec('ROLLBACK TO governed_redaction');assert.equal((await currentBasis()).qualified,true);
   }
  }
  results.push({name,manualRecord:manual?(await db.query('select to_jsonb(r) r from gridex_received_sources.manual_billing_continuations_v1 r')).rows[0].r:null,successorRecord:manual?(await db.query('select to_jsonb(r) r from gridex_received_sources.manual_received_end_successors_v1 r')).rows[0].r:null,contractFull:(await db.query('select to_jsonb(c) c from public.customer_contracts c where id=$1',[id(6)])).rows[0].c,outer,result,basisQualified:basis?.qualified??false,contract,periodEnd:after.end_date,actualEnd:after.actual_end_date,marketEnd:after.market_end_at,status:after.status,sourceEndId:after.source_end_message_id});await db.exec('ROLLBACK');
 }
 assert.equal(results[0].result.applied,true);assert.equal(results[0].basisQualified,true);
 const continuationCounts=await db.query('SELECT count(*)::int n FROM gridex_received_sources.manual_billing_continuations_v1');
 console.log(JSON.stringify({mode:'actual qualified-manual followed by actual owned-Z05 producer',results}));
 assert.equal(results[1].result.applied,true,'actual received Z05 must reconcile certified manual end');
 assert.equal(results[1].basisQualified,true);assert.equal(results[2].result.applied,true);assert.equal(results[2].basisQualified,true);
 const proof={latestH3dCommandsPreserved:true,governanceInstalled:true,governanceResults,head:'6645ca3cafbf2103c0291fa7ac91b1f9ec62d738',scope:'Actual newest owned-object Z05 producer apply_supply_before_h_v1 plus actual scoped effect, wire parser, source basis, manual commands, contract-event recorder and supply-end followup. Source/application admission and legal/permission availability are declared fixture ports bound to actual source IDs/scope/canonical assessment. Actual producer writes transitions/effect receipts; no fixture period/transition rewrite. Not native/backend production proof.',results};
 await Promise.resolve(originalIO).then(fs=>fs.writeFileSync(root+'final-h3/governance-source-result.json',JSON.stringify(proof,null,2)));console.log(JSON.stringify(results));
}finally{await db.close()}
