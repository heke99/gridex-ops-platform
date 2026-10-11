// Actual registered UD SQL with declared independent prior owner/actor ports.
// Synthetic records are not authentic signed declarations or native acceptance.
import{readFileSync}from'node:fs';import{pathToFileURL}from'node:url';import{resolve}from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const repoRoot=process.env.EDIEL_SQL_REPOSITORY||new URL('..',import.meta.url).pathname;
const migration=n=>readFileSync(resolve(repoRoot,'supabase/migrations',n),'utf8');
const schema=readFileSync(resolve(repoRoot,'supabase/schema.sql'),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
function actualCaptured(name){
 const start=schema.indexOf(`CREATE FUNCTION ${name}(`);if(start<0)throw Error('customer_masterdata_cancellation_captured_function_required:'+name);
 const tail=schema.slice(start),marker=tail.match(/\bAS (\$[A-Za-z_]*\$)/);if(!marker)throw Error('customer_masterdata_cancellation_captured_body_required:'+name);
 const end=tail.indexOf(marker[1]+';',marker.index+marker[0].length);if(end<0)throw Error('customer_masterdata_cancellation_captured_body_end_required:'+name);
 return{definition:tail.slice(0,end+marker[1].length+1),body:tail.slice(marker.index+marker[0].length,end)};
}
const consumers=[
 {
  "name": "public.ediel_prepare_customer_masterdata_v1",
  "signature": "public.ediel_prepare_customer_masterdata_v1(uuid,uuid,uuid,timestamptz,text)",
  "preimage": "3bf53aa7df75a909ae4e4fd107ca8a7152fb40d6fcc199f3ceb3f4de88324872",
  "postimage": "558af171232fc8767eb8fe8e56e1a303922f890a767b2cf0424aaab2a6e3d6dd"
 },
 {
  "name": "public.ediel_prepare_customer_masterdata_recovery_v1",
  "signature": "public.ediel_prepare_customer_masterdata_recovery_v1(uuid,uuid,uuid,uuid,uuid)",
  "preimage": "6a1eb5ffccdba6d7233fff7d7f6426427cc234a79cbbca0015f5fecbd8cd28b3",
  "postimage": "86b83d5876b5abc5797605d39d85ff4750dcb65dd304d67bd52b7a0a0c8c71d3"
 },
 {
  "name": "gridex_customer_masterdata.bind_original_v1",
  "signature": "gridex_customer_masterdata.bind_original_v1()",
  "preimage": "1e607fe2f3a2c8afa873b695eb07e2cbeab46d874a101892ca624bd67dd48a96",
  "postimage": "b49e086aee9f0e58106c0bf16c76a9546416a94b4ad44321e70e67151772da84"
 },
 {
  "name": "gridex_customer_masterdata.require_current_v1",
  "signature": "gridex_customer_masterdata.require_current_v1(uuid,uuid,uuid,text)",
  "preimage": "32803540e65f19b2f0d08f555f5cc9c5ac58a8fc4c650bef10275229becae3ad",
  "postimage": "2e2164318fa69e5fe1bb5c2f7f2b288c06cf8b8b8e84840880855abae2370159"
 },
 {
  "name": "public.ediel_require_switch_cancellation_source_current_v1",
  "signature": "public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid)",
  "preimage": "d06be59b55bb6f8360c147ddd60862a73737e4a9a634ed1749cf8f7fd891aafa",
  "postimage": "cdf016fbe519fcdc79c0f630d8600dc3c11506dd0b3dd94241f7a99bded4149f"
 },
 {
  "name": "gridex_customer_masterdata.prelock_new_v1",
  "signature": "gridex_customer_masterdata.prelock_new_v1()",
  "preimage": "fd36a8f0e60adde16822aa473862af432db6fe92a9eca69f42c07ced1726b83d",
  "postimage": "48a69fbf042ebb8734c7ffc7b42887486223f2b026038a4344fd42c9265dd673"
 },
 {
  "name": "gridex_switch_cancellations.context_v1",
  "signature": "gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean)",
  "preimage": "36268e59a33cdba60f6b4e4c2e420a42b09f81e6efe5ccfc164fe149aaae560b",
  "postimage": "600e83702ed4695229aeaa133b258867d9736ac1939b8196e7d2e56ca145aa4e"
 }
];
const capturedConsumers=consumers.map(spec=>({...spec,...actualCaptured(spec.name)}));
const isPreimage=capturedConsumers.every(spec=>hash(spec.body)===spec.preimage),isPostimage=capturedConsumers.every(spec=>hash(spec.body)===spec.postimage);
if(!isPreimage&&!isPostimage)throw Error('customer_masterdata_cancellation_captured_predecessor_required');
const migrationApplication=isPostimage?'already_captured_postimage':'applied_forward_to_captured_preimage';
const helperSpecs=[
 {
  "name": "gridex_switch_cancellations.prelock_customer_source_v1",
  "sha256": "a2e8610c2b307d2d63aad7e9a8163c531ab3bd3f4858f2f2fcbbaf5c2a2ace83"
 },
 {
  "name": "gridex_switch_cancellations.prelock_customer_message_v1",
  "sha256": "ba84c83dd9777e57842d00d3cac90234517644e85226c82fdfbe46b4523e2ca9"
 },
 {
  "name": "gridex_switch_cancellations.customer_source_v1",
  "sha256": "dc242fa2eab284cdfdc50952afe7895d5d3d1b20ae0f3783e0cd21a1afe29e0b"
 },
 {
  "name": "public.ediel_switch_cancellation_customer_masterdata_basis_v1",
  "sha256": "83f5e76364403117fd415c4927cd38bd28e909c5b7185acee2eb024cbe0f0b28"
 },
 {
  "name": "gridex_switch_cancellations.customer_draft_v1",
  "sha256": "d6c233b64b4cb8e40796426266cb62e6ad4c46c65a3491672db4c092746caba9"
 },
 {
  "name": "public.ediel_prepare_switch_cancellation_customer_masterdata_v1",
  "sha256": "474b98f12c3b4daab5af8c89cb331436fa2c3841808a16a7085162b85a2b089a"
 },
 {
  "name": "public.ediel_switch_cancellation_customer_masterdata_message_basis_v1",
  "sha256": "aba1b5b5e93c77e6f358ac4470fb8cb69ac209c17618b4a6a450036475832ad4"
 },
 {
  "name": "gridex_customer_masterdata.require_cancellation_preparation_v1",
  "sha256": "a32f0b01a42f19d6f26200e40e5ef9165a446b55188466b04961b6c6184ac72a"
 }
];
const capturedHelpers=isPostimage?helperSpecs.map(spec=>({...spec,...actualCaptured(spec.name)})):[];
if(capturedHelpers.some(spec=>hash(spec.body)!==spec.sha256))throw Error('customer_masterdata_cancellation_captured_helper_required');

const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const fn=(file,name)=>{const s=readFileSync(resolve(repoRoot,'scripts',file),'utf8'),a=s.indexOf(`CREATE FUNCTION ${name}`),b=s.indexOf('$$;',a);if(a<0)throw Error(name);return s.slice(a,b+3)}

let n=0;
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_transport;
 CREATE TABLE companies(id uuid PRIMARY KEY);CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid,name text,full_name text,company_name text,org_number text,personal_number text,metadata jsonb,billing_street text,billing_city text,billing_country text,billing_postal_code text,updated_by uuid,updated_at timestamptz);
 CREATE TABLE customer_operation_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,task_type text,status text,priority text,title text,description text,assigned_to uuid,due_at timestamptz,metadata jsonb,created_by uuid,updated_by uuid);
 CREATE TABLE customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid);CREATE TABLE metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,meter_point_id text,grid_owner_ediel_id text,grid_area_code text);
 CREATE TABLE customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,source_message_id uuid,market_state_version bigint);
 CREATE TABLE platform_actor_identifiers(id uuid PRIMARY KEY,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 CREATE TABLE tenant_bilateral_agreements(id uuid PRIMARY KEY,company_id uuid,environment text,counterparty_actor_id uuid,capability_code text,is_enabled bool,source_reference text,terms jsonb,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE ediel_message_intents(id uuid PRIMARY KEY,company_id uuid,environment text,message_family text,message_code text,direction text,operation_id uuid,validation_status text,customer_id uuid,customer_site_id uuid,metering_point_id text,interchange_reference text,message_reference text,transaction_reference text,communication_route_id uuid,route_profile_id uuid,ediel_message_id uuid,outbound_request_id uuid);
 CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,payload jsonb,source_type text,source_id uuid,operation_id uuid,request_type text,customer_id uuid,site_id uuid,metering_point_id uuid);
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz,status text,intent_id uuid,outbound_request_id uuid,source_operation_id text,customer_id uuid,site_id uuid,metering_point_id uuid,message_received_at timestamptz,original_message_id uuid,communication_route_id uuid,route_profile_id uuid);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,facts_hash text,previous_assessment_id uuid);
 CREATE TABLE gridex_received_sources.supply_source_transitions(source_message_id uuid,company_id uuid,resulting_states jsonb);CREATE TABLE gridex_received_sources.normal_switch_confirmations(company_id uuid,period_id uuid,original_message_id uuid);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid,company_id uuid,environment text,payload_hash text,received_context jsonb,source_received_at timestamptz);
 CREATE TABLE gridex_received_sources.object_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid,company_id uuid,environment text,source_payload_hash text,canonical_assessment_id uuid,previous_assessment_id uuid,facts_text text,facts_hash text,owner_readsets jsonb);
 CREATE SCHEMA gridex_brp_sources;CREATE TABLE brp_fixture(value text);INSERT INTO brp_fixture VALUES('BRP');
 CREATE FUNCTION gridex_brp_sources.require_source_v1(c uuid,ct uuid,actor uuid,phase text,env text,customer uuid,site uuid,point uuid,at timestamptz,period uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','authorized','sourceKind','accepted_supply_brp','companyId',c,'environment',env,'customerId',customer,'siteId',site,'meteringPointId',point,'supplyPeriodId',period,'at',at,'pointId','POINT','identityAgency','9','gridArea','TES','legalActorId','${id(21)}','legalSenderId','12345','legalReceiverId','54321','brpEdielId',(SELECT value FROM public.brp_fixture))$$;
 CREATE TABLE actor_fixture(write_ok bool,send_ok bool);INSERT INTO actor_fixture VALUES(true,true);
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS $$SELECT CASE WHEN $1='${id(20)}' AND $2='${id(1)}' THEN CASE $3 WHEN 'communication.write' THEN (SELECT write_ok FROM public.actor_fixture) WHEN 'ediel.send' THEN (SELECT send_ok FROM public.actor_fixture) ELSE false END ELSE false END$$;
 CREATE TABLE basis_ports(period uuid PRIMARY KEY,basis jsonb);CREATE TABLE legal_ports(message uuid PRIMARY KEY,basis jsonb);
 CREATE FUNCTION gridex_ediel_inbound_context.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN SELECT basis INTO b FROM public.legal_ports WHERE message=m;IF b IS NULL OR b->>'companyId' IS DISTINCT FROM c::text THEN RAISE EXCEPTION 'declared_historical_identity_basis_unavailable';END IF;RETURN b;END$$;
 CREATE FUNCTION gridex_ediel_inbound_context.derive(m public.ediel_messages,at timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('actorRole','electricity_supplier','legalActorId','${id(21)}','legalEdielId','12345')$$;
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"declaredRulePort":true}'::jsonb$$;
 CREATE FUNCTION gridex_received_sources.supply_period_source_at_v1(c uuid,p uuid,at timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT basis FROM public.basis_ports WHERE period=p AND basis->>'companyId'=c::text$$;
 CREATE FUNCTION gridex_ediel_transport.require_message_intent_v1(public.ediel_messages) RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE TABLE gridex_received_sources.prodat_recovery_operations(id uuid,company_id uuid,original_message_id uuid,corrected_raw_payload text,corrected_payload_hash text);
 CREATE FUNCTION ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION ediel_prodat_recovery_original_basis_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 CREATE TABLE gridex_received_sources.object_availability_witnesses(assessment_id uuid,company_id uuid,environment text,source_message_id uuid,facts_hash text);
 CREATE TABLE native_effects(x int);CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF i->>'frozen'='true' THEN RETURN '{"proceed":false,"providerReceipt":{"frozen":true}}';END IF;INSERT INTO public.native_effects VALUES(1);RETURN '{"proceed":true}';END$$;
 INSERT INTO companies VALUES('${id(1)}'),('${id(2)}');INSERT INTO auth.users VALUES('${id(20)}');INSERT INTO user_profiles VALUES('${id(20)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(20)}','active',true,now());
 INSERT INTO customers VALUES('${id(3)}','${id(1)}','Old','Old','Old','5566778899',NULL,'{}','Invoice street','Invoice city','SE','99999',NULL,now());INSERT INTO customer_sites VALUES('${id(7)}','${id(1)}','${id(3)}');INSERT INTO metering_points VALUES('${id(5)}','${id(1)}','${id(3)}','${id(7)}','POINT',NULL,'54321','TES');
 INSERT INTO customer_supply_periods VALUES('${id(6)}','${id(1)}','${id(3)}','${id(5)}','${id(8)}',1);`)
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('../supabase/migrations/20260930164804_ediel_prodat_retry_correction_authority.sql','gridex_received_sources.prodat_recovery_wire_v1'))
 const append=readFileSync(new URL('../supabase/migrations/20260923114703_ediel_reviewed_closure_source.sql',pathToFileURL(resolve(repoRoot,'scripts/ediel-customer-masterdata-sql-regression.mjs')).href),'utf8'),a=append.indexOf('CREATE OR REPLACE FUNCTION gridex_received_sources.append_object_assessment'),b=append.indexOf('$$;',a);await db.exec(append.slice(a,b+3))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930233247_ediel_customer_life_event_source_authority.sql',pathToFileURL(resolve(repoRoot,'scripts/ediel-customer-masterdata-sql-regression.mjs')).href),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001010530_ediel_customer_life_event_dated_projection.sql',pathToFileURL(resolve(repoRoot,'scripts/ediel-customer-masterdata-sql-regression.mjs')).href),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001012053_ediel_customer_life_event_dated_brp_source.sql',pathToFileURL(resolve(repoRoot,'scripts/ediel-customer-masterdata-sql-regression.mjs')).href),'utf8'));
 await db.exec(`ALTER TABLE ediel_messages ADD parsed_payload jsonb,ADD execution_context_snapshot jsonb,ADD created_by uuid;
 CREATE TABLE customer_addresses(id uuid PRIMARY KEY,company_id uuid,customer_id uuid REFERENCES customers(id),type text NOT NULL DEFAULT'registered',street_1 text,street_2 text,postal_code text,city text,country text NOT NULL DEFAULT'SE',municipality text,moved_in_at date,moved_out_at date,is_active bool NOT NULL DEFAULT true,metadata jsonb NOT NULL DEFAULT'{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by uuid,updated_by uuid);
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,signed_at timestamptz,signed_version text,document_sha256 text);
 CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(ct public.customer_contracts) RETURNS text LANGUAGE sql AS $$SELECT encode(sha256(convert_to(to_jsonb(ct)::text,'UTF8')),'hex')$$;
 CREATE SCHEMA gridex_negative_fixtures;CREATE TABLE gridex_negative_fixtures.positive_witnesses(id uuid,company_id uuid,actor_user_id uuid);CREATE TABLE gridex_negative_fixtures.negative_prepared_witnesses(id uuid,company_id uuid,actor_user_id uuid);
 CREATE FUNCTION gridex_negative_fixtures.prepared_positive_fixture_v1(uuid,uuid,text,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION gridex_negative_fixtures.prepared_negative_fixture_v1(uuid,uuid,text,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 INSERT INTO customer_addresses(id,company_id,customer_id,type,street_1,street_2,postal_code,city,country,moved_in_at) VALUES('${id(80)}','${id(1)}','${id(3)}','registered','Registered street','Own extra','12345','Registered city','SE',current_date-1);
 INSERT INTO customer_addresses(id,company_id,customer_id,type,street_1,postal_code,city,country) VALUES('${id(81)}','${id(1)}','${id(3)}','billing','Wrong invoice','99999','Wrong city','SE');`)
 await db.exec(fn('../supabase/migrations/20260922095911_ediel_received_source_ledger.sql','gridex_received_sources.reject_mutation'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001014700_ediel_registered_customer_masterdata_source.sql',pathToFileURL(resolve(repoRoot,'scripts/ediel-customer-masterdata-sql-regression.mjs')).href),'utf8'));
const extracted=(n,name)=>{const s=migration(n);const a=s.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')));if(a<0)throw Error('function missing:'+name);const b=s.indexOf('$$;',a);return s.slice(a,b+3)};
// Current production shape used by actual customer+C bodies. Independent tables
// below represent ports only; no native declaration/provider acceptance claimed.
await db.exec(`
 ALTER TABLE customer_contracts ADD metering_point_id uuid;
 ALTER TABLE ediel_messages ADD switch_request_id uuid, ADD interchange_reference text,ADD transaction_reference text,ADD application_reference text,ADD sender_ediel_id text,ADD receiver_ediel_id text,ADD sender_sub_address text,ADD receiver_sub_address text;
 ALTER TABLE ediel_messages ALTER COLUMN original_message_id TYPE text USING original_message_id::text;
 ALTER TABLE ediel_message_intents ADD business_process text,ADD grid_area_code text,ADD sender_ediel_id text,ADD receiver_ediel_id text,ADD sender_subaddress text,ADD receiver_subaddress text,ADD application_reference text;
 CREATE TABLE supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,customer_contract_id uuid,contract_id uuid,outbound_z03_message_id uuid,rff_li_reference text,requested_start_date date,lifecycle_blocked bool,status text,updated_by uuid,updated_at timestamptz);
 CREATE TABLE gridex_received_sources.switch_originals(message_id uuid PRIMARY KEY,company_id uuid,switch_id uuid,intent_id uuid,outbound_request_id uuid,payload_hash text,contract_id uuid,contract_hash text,original_object jsonb,previous_switch jsonb,resulting_switch jsonb,actor_user_id uuid);
 CREATE TABLE gridex_negative_fixtures.positive_consumptions(message_id uuid,company_id uuid);CREATE TABLE gridex_negative_fixtures.negative_prepared_consumptions(message_id uuid,company_id uuid);
 CREATE SCHEMA gridex_utilts_binding;
 CREATE SCHEMA gridex_ediel_ack_replay;CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE TABLE actor_permissions(actor uuid,permission text,allowed bool,PRIMARY KEY(actor,permission));
 INSERT INTO auth.users VALUES('${id(22)}'),('${id(23)}');INSERT INTO user_profiles VALUES('${id(22)}','active'),('${id(23)}','active');INSERT INTO company_memberships VALUES('${id(1)}','${id(22)}','active',true,now()),('${id(1)}','${id(23)}','active',true,now());
 INSERT INTO actor_permissions VALUES('${id(20)}','communication.write',true),('${id(20)}','ediel.send',true),('${id(22)}','communication.write',true),('${id(22)}','ediel.send',false),('${id(23)}','communication.write',false),('${id(23)}','ediel.send',true);
 CREATE OR REPLACE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS $$SELECT $2='${id(1)}' AND coalesce((SELECT allowed FROM public.actor_permissions WHERE actor=$1 AND permission=$3),false)$$;
 CREATE FUNCTION gridex_received_sources.sent_source_is_current_v1(m public.ediel_messages) RETURNS bool LANGUAGE sql AS $$SELECT m.status='sent'$$;
 CREATE FUNCTION gridex_received_sources.permission_date_v1(t text) RETURNS date LANGUAGE sql AS $$SELECT to_date(left(t,8),'YYYYMMDD')$$;
 CREATE FUNCTION gridex_received_sources.permission_time_v1(t text) RETURNS timestamptz LANGUAGE sql AS $$SELECT to_timestamp(t,'YYYYMMDDHH24MI')-interval '1 hour'$$;
 CREATE OR REPLACE FUNCTION gridex_received_sources.production_contract_hash_v1(ct public.customer_contracts) RETURNS text LANGUAGE sql AS $$SELECT 'contract-fixture'$$;
 CREATE TABLE gridex_ediel_transport.reservations(message_id uuid,state text);
 CREATE SCHEMA gridex_ediel_retention;
 CREATE TABLE retention_port(available bool);INSERT INTO retention_port VALUES(true);
 CREATE FUNCTION gridex_ediel_retention.contract_copy_preparation_current_v1(uuid,uuid) RETURNS bool LANGUAGE sql AS $$SELECT available FROM public.retention_port$$;
`);
await db.exec(extracted('20260923135706_ediel_utilts_consumption_binding_v1.sql','gridex_utilts_binding.wire_tokens_v1'));
for(const [file,name]of[
 ['20260930161624_ediel_supply_market_source_lifecycle.sql','gridex_received_sources.supply_wire_v1'],
 ['20260930201111_ediel_normal_switch_source_atomic_confirmation.sql','gridex_received_sources.normal_switch_wire_v1'],
 ['20260930213949_ediel_switch_intent_original_source_binding.sql','gridex_received_sources.switch_origin_wire_v1']])await db.exec(extracted(file,name));
for(const file of ['20261001025107_ediel_customer_masterdata_national_postal_shape.sql','20261001030500_ediel_customer_masterdata_actual_consumer_scope.sql','20261001030524_ediel_customer_masterdata_fresh_transport_source.sql','20260930214933_ediel_switch_cancellation_source_origination.sql','20260930223846_ediel_cancellation_request_environment_scope.sql'])await db.exec(migration(file));
// Production already has text original IDs. Apply that exact successor body,
// retaining all metadata; no fixture substitution for current consumers.
let bind=(await db.query("SELECT pg_get_functiondef('gridex_switch_cancellations.bind_message_v1()'::regprocedure) d")).rows[0].d;
const reference='NEW.original_message_id IS DISTINCT FROM o.original_message_id';
assert.equal(bind.split(reference).length,2);await db.exec(bind.replace(reference,reference+'::text'));
await db.exec(`ALTER TABLE gridex_received_sources.prodat_recovery_operations ADD PRIMARY KEY(id),ADD kind text,ADD environment text;
 CREATE TABLE gridex_received_sources.prodat_recovery_origins(operation_id uuid,company_id uuid,intent_id uuid,outbound_request_id uuid);
 CREATE FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_recovery_port_not_available';END$$;
 CREATE FUNCTION gridex_received_sources.prelock_recovery_source_cohort_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE FUNCTION gridex_received_sources.qualified_recovery_origin_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_recovery_port_not_available';END$$;`);
await db.exec(migration('20261001112223_ediel_recovery_protected_ud_preparation.sql'));
// Current accepted signed-method original is a declared source port; actual
// original_method_v1 and consumer equality below remain production SQL.
await db.exec(`CREATE SCHEMA gridex_metering_method_changes;
 CREATE TABLE gridex_metering_method_changes.contract_request_declarations(id uuid PRIMARY KEY,company_id uuid,environment text,contract_id uuid,contract_revision text,protected_contract_hash text,agreement_sha256 text,customer_id uuid,site_id uuid,metering_point_id uuid,point_id text,identity_agency text,legal_actor_id uuid,legal_sender_id text,legal_receiver_id text,grid_area_code text,requested_method text,source_reference text,source_version text,source_sha256 text);
 CREATE TABLE gridex_received_sources.switch_contract_request_bindings(message_id uuid PRIMARY KEY,company_id uuid,declaration_id uuid,requested_method text,source_basis jsonb,payload_hash text);`);
await db.exec(extracted('20260930234708_ediel_normal_switch_signed_method_binding.sql','gridex_received_sources.switch_requested_method_v1'));
await db.exec(migration('20261001142650_ediel_switch_requested_method_line_dtm.sql'));
await db.exec(migration('20261007132500_ediel_switch_cancellation_original_method.sql'));

// Run real captured declarations, including their actual retention/graph calls.
// A genuine postcapture gets only the actual forward's new schema/helpers; its
// already installed consumer bodies are never rewritten/reapplied.
const donor=migration('20261009082553_ediel_switch_cancellation_customer_masterdata_preparation.sql');
if(isPostimage){const prefix=donor.slice(0,donor.indexOf('DO $consumers$'));await db.exec(prefix+'COMMIT;');for(const spec of capturedHelpers)await db.exec(spec.definition.replace(/^CREATE FUNCTION /,'CREATE OR REPLACE FUNCTION '))}
for(const spec of capturedConsumers)await db.exec(spec.definition.replace(/^CREATE FUNCTION /,'CREATE OR REPLACE FUNCTION '));
for(const spec of capturedConsumers)assert.equal((await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') h FROM pg_proc WHERE oid=$1::regprocedure",[spec.signature])).rows[0].h,isPostimage?spec.postimage:spec.preimage);

// Customer observed history is the genuine existing owner algorithm on declared
// source/history records. The actual registered address bytes qualify the wire.
const actorA=id(20),actorB=id(22),actorC=id(23),company=id(1),customer=id(3),site=id(7),point=id(5),original=id(108),switchId=id(106),contract=id(104),intent=id(112),request=id(113),operation=id(110),route=id(114),routeProfile=id(115),cMessage=id(116);
const service=async(query,values)=>{await db.exec('SET ROLE service_role');let failed=false;try{return await db.query(query,values)}catch(error){failed=true;throw error}finally{try{await db.exec('RESET ROLE')}catch(resetError){if(!failed)throw resetError}}};
const at=(await db.query('SELECT statement_timestamp() t')).rows[0].t;
await db.exec('GRANT INSERT ON ediel_messages TO service_role');
const ordinaryPreparedA=(await service('SELECT ediel_prepare_customer_masterdata_v1($1,$2,$3,$4,$5) b',[company,customer,actorA,at,'test'])).rows[0].b;
assert.equal(ordinaryPreparedA.status,'authorized');
// DECLARED historical source snapshot: actual basis algorithm computes its
// dated proof; fixture seeding does not prove authentic prior issuance.
const historicalAt=(await db.query("SELECT statement_timestamp()-interval '1 day' t")).rows[0].t;
await db.exec("CREATE FUNCTION declared_fixture_historical_basis(c uuid,u uuid,a uuid,t timestamptz) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT gridex_customer_masterdata.basis_v1(c,u,a,t,'test','prepare',t,'[]')$$;GRANT EXECUTE ON FUNCTION declared_fixture_historical_basis(uuid,uuid,uuid,timestamptz) TO service_role");
const historicalBasis=(await service("SELECT declared_fixture_historical_basis($1,$2,$3,$4) b",[company,customer,actorA,historicalAt])).rows[0].b;
assert.equal(historicalBasis.status,'authorized');
const historicalPrep=(await db.query("INSERT INTO gridex_customer_masterdata.preparations(company_id,customer_id,environment,as_of,observed_at,actor_user_id,basis,basis_hash) VALUES($1,$2,'test',$3,$3,$4,$5,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex')) RETURNING id",[company,customer,historicalAt,actorA,historicalBasis])).rows[0];
const preparedA={...historicalBasis,sourceContextId:historicalPrep.id};
const date=(await db.query("SELECT to_char((now()+interval '1 hour')::date+10,'YYYYMMDD') d")).rows[0].d;
const old=`UNB+UNOC:3+12345:14+54321:14+260930:1200+SYNTHETIC-C-UNB++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+SOURCE+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++POINT:::9'DTM+92:${date}0000:203'CCI++Z04'CAV+Z03'CCI++Z13'CAV+Z22'RFF+LI:SYNTHETIC-OLD-LI'RFF+Z05:TES'RFF+ANJ:SYNTHETIC-ANJ'NAD+UD+5566778899:SE1:260++Old+Registered street:Own extra+Registered city++12345+SE'NAD+IT+POINT::9'UNT+16+1'UNZ+1+SYNTHETIC-C-UNB'`;
const cancel=old.replace('CAV+Z22','CAV+Z24').replace('BGM+Z03+SOURCE','BGM+Z03+SYNTHETIC-C-UNB');
await db.query("INSERT INTO customer_contracts(id,company_id,customer_id,status,metering_point_id) VALUES($1,$2,$3,'signed',$4)",[contract,company,customer,point]);
await db.query("INSERT INTO supplier_switch_requests(id,company_id,customer_id,site_id,metering_point_id,customer_contract_id,contract_id,outbound_z03_message_id,rff_li_reference,requested_start_date,lifecycle_blocked,status) VALUES($1,$2,$3,$4,$5,$6,$6,$7,'SYNTHETIC-OLD-LI',to_date($8,'YYYYMMDD'),false,'submitted')",[switchId,company,customer,site,point,contract,original,date]);
await service("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_rendered_at,immutable_payload_hash,customer_id,site_id,metering_point_id,created_by,parsed_payload,intent_id,communication_route_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','sent',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,$8,$9,$10)",[original,company,old,customer,site,point,actorA,{customerMasterdataSourceContextId:preparedA.sourceContextId},id(191),id(194)]);
await db.query("INSERT INTO gridex_received_sources.switch_originals VALUES($1,$2,$3,$4,$5,encode(sha256(convert_to($6,'UTF8')),'hex'),$7,'contract-fixture',gridex_received_sources.switch_origin_wire_v1($6)#>'{objects,0}','{}',(SELECT to_jsonb(s) FROM supplier_switch_requests s WHERE s.id=$3),$8)",[original,company,switchId,id(191),id(192),old,contract,actorA]);
await db.query('INSERT INTO legal_ports(message,basis) VALUES($1,$2)',[original,{companyId:company,actorRole:'electricity_supplier',legalActorId:id(21),legalEdielId:'12345'}]);
await db.query("INSERT INTO ediel_message_intents(id,company_id,environment,direction,message_family,message_code,business_process,operation_id,customer_id,metering_point_id,grid_area_code,validation_status,transaction_reference,interchange_reference,sender_ediel_id,receiver_ediel_id,communication_route_id,route_profile_id,application_reference,message_reference) VALUES($1,$2,'test','outbound','PRODAT','Z03','supplier_switch',$3,$4,'POINT','TES','validated','SYNTHETIC-OLD-LI','SYNTHETIC-C-UNB','12345','54321',$5,$6,'23-DDQ-PRODAT','1')",[intent,company,operation,customer,route,routeProfile]);
await db.query("INSERT INTO outbound_requests(id,company_id,payload,source_type,source_id,request_type,operation_id,customer_id,metering_point_id,site_id) VALUES($1,$2,'{\"environment\":\"test\"}','manual',$3,'supplier_switch',$4,$5,$6,$7)",[request,company,intent,operation,customer,point,site]);
const reserve=actor=>service('SELECT ediel_reserve_switch_cancellation_v1($1,$2,$3,$4,$5) b',[company,switchId,actor,intent,request]).then(r=>r.rows[0].b);
const reservedB=await reserve(actorB);assert.equal(reservedB.status,'reserved');
const insertCancellation=async(preparation,actor=actorB,raw=cancel)=>service("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_rendered_at,immutable_payload_hash,intent_id,outbound_request_id,source_operation_id,original_message_id,switch_request_id,customer_id,site_id,metering_point_id,created_by,parsed_payload,interchange_reference,transaction_reference,application_reference,sender_ediel_id,receiver_ediel_id,communication_route_id,route_profile_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','draft',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'SYNTHETIC-C-UNB','SYNTHETIC-OLD-LI','23-DDQ-PRODAT','12345','54321',$14,$15)",[cMessage,company,raw,intent,request,operation,original,switchId,customer,site,point,actor,{customerMasterdataSourceContextId:preparation},route,routeProfile]);
const declared={status:'authorized',declarationId:id(140),companyId:company,environment:'test',contractId:contract,contractRevision:'signed-fixture-v1',protectedContractHash:'contract-fixture',agreementSha256:'a'.repeat(64),customerId:customer,siteId:site,meteringPointId:point,pointId:'POINT',identityAgency:'9',legalActorId:id(21),legalSenderId:'12345',legalReceiverId:'54321',gridArea:'TES',requestedMethod:'Z03',sourceReference:'mechanical-signed-source-port',sourceVersion:'v1',sourceDigest:'b'.repeat(64)};
await db.query("INSERT INTO gridex_metering_method_changes.contract_request_declarations VALUES($1,$2,'test',$3,'signed-fixture-v1','contract-fixture',$4,$5,$6,$7,'POINT','9',$8,'12345','54321','TES','Z03','mechanical-signed-source-port','v1',$9)",[id(140),company,contract,declared.agreementSha256,customer,site,point,id(21),declared.sourceDigest]);
await db.query("INSERT INTO gridex_received_sources.switch_contract_request_bindings VALUES($1,$2,$3,'Z03',$4,encode(sha256(convert_to($5,'UTF8')),'hex'))",[original,company,id(140),declared,old]);


const snapshot=()=>db.query("SELECT jsonb_build_object('messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM ediel_messages m),'preps',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM gridex_customer_masterdata.preparations p),'origins',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM gridex_switch_cancellations.origins o),'switches',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM supplier_switch_requests s)) r").then(r=>r.rows[0].r);
const refused=async(action,pattern)=>{const before=await snapshot();await assert.rejects(action(),pattern);assert.deepEqual(await snapshot(),before);n++};
const prep=(actor=actorB,raw=cancel,op=operation,ownIntent=intent,ownRoute=route,c=company)=>service('SELECT ediel_prepare_switch_cancellation_customer_masterdata_v1($1,$2,$3,$4,$5,$6) b',[c,op,actor,ownIntent,ownRoute,raw]).then(r=>r.rows[0].b);
const readSource=actor=>service('SELECT ediel_switch_cancellation_customer_masterdata_basis_v1($1,$2,$3) b',[company,switchId,actor]).then(r=>r.rows[0].b);
const send=actor=>service('SELECT ediel_customer_masterdata_message_basis_v1($1,$2,$3) b',[company,cMessage,actor]).then(r=>r.rows[0].b);
const transactionRefusal=async(change,action,pattern)=>{await db.exec('BEGIN');try{await change();await assert.rejects(action(),pattern);n++}finally{await db.exec('ROLLBACK')}};
await refused(()=>insertCancellation(preparedA.sourceContextId),/customer_masterdata_prepared_source_scope_required/);
await refused(()=>service('SELECT ediel_customer_masterdata_message_basis_v1($1,$2,$3)',[company,original,actorB]),/actor_forbidden/);
const productionFunctions=['public.ediel_prepare_customer_masterdata_v1(uuid,uuid,uuid,timestamptz,text)','public.ediel_prepare_customer_masterdata_recovery_v1(uuid,uuid,uuid,uuid,uuid)','gridex_customer_masterdata.bind_original_v1()','gridex_customer_masterdata.require_current_v1(uuid,uuid,uuid,text)','gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean)','gridex_customer_masterdata.prelock_new_v1()','public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid)'];
const metadata=()=>db.query("SELECT oid,to_jsonb(p)-'prosrc' m FROM pg_proc p WHERE oid=ANY($1::regprocedure[]) ORDER BY oid",[productionFunctions]).then(r=>r.rows);
const beforeMetadata=await metadata();
// Unknown full predecessor must fail even when its substitution needle remains.
if(isPreimage)for(const spec of capturedConsumers){
 await db.exec('BEGIN');try{
  await db.exec(spec.definition.replace(/^CREATE FUNCTION /,'CREATE OR REPLACE FUNCTION ').replace(spec.body,spec.body+'\n-- finite unknown full predecessor\n'));
  await assert.rejects(db.exec(donor),/customer_masterdata_cancellation_predecessor_required/);n++;
 }finally{await db.exec('ROLLBACK')}
 assert.deepEqual(await metadata(),beforeMetadata);
}
if(isPreimage)await db.exec(donor);
assert.deepEqual(await metadata(),beforeMetadata);
for(const spec of capturedConsumers)assert.equal((await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') h FROM pg_proc WHERE oid=$1::regprocedure",[spec.signature])).rows[0].h,spec.postimage);n++;

await transactionRefusal(()=>db.exec('UPDATE retention_port SET available=false'),()=>readSource(actorB),/consumed_original_copy_tombstoned/);
const source=await readSource(actorB);assert.equal(source.sourceContextId,preparedA.sourceContextId);assert.equal(source.cancellationSourceBinding.actorUserId,actorB);n++;
await refused(()=>insertCancellation(preparedA.sourceContextId,actorA),/cancellation_fresh_preparation_required/);
for(const[action,pattern]of[
 [()=>prep(actorB,cancel,id(99)),/private_origin_required/],
 [()=>prep(actorB,cancel,operation,id(99)),/private_scope_required/],
 [()=>prep(actorB,cancel,operation,intent,id(99)),/private_scope_required/],
 [()=>prep(actorB,cancel,operation,intent,route,id(2)),/private_origin_required/],
 [()=>prep(actorC),/actor_forbidden/],
])await refused(action,pattern);
for(const raw of[
 cancel.replace('LI:SYNTHETIC-OLD-LI','LI:OTHER'),cancel.replace('POINT:::9','OTHER:::9'),cancel.replace('POINT:::9','POINT:::89'),
 cancel.replace('5566778899:SE1:260','9988776655:SE1:260'),cancel.replace('CAV+Z24','CAV+Z22'),cancel.replace('CAV+Z03','CAV+Z04'),
 cancel.replace('ANJ:SYNTHETIC-ANJ','ANJ:OTHER'),cancel.replace('Registered street','Unrelated street'),cancel.replace('BGM+Z03+SYNTHETIC-C-UNB','BGM+Z03+OTHER'),
])await refused(()=>prep(actorB,raw),/actual_wire|exact_original_method/);
// Physical envelope checks are independent of the normal renderer's syntax call.
for(const raw of[cancel.replace('UNT+16+1','UNT+999+1'),cancel.replace('UNT+16+1','UNT+16+OTHER'),cancel.replace('UNZ+1+SYNTHETIC-C-UNB','UNZ+2+SYNTHETIC-C-UNB')])
 await refused(()=>prep(actorB,raw),/actual_wire|syntax|envelope/);
await transactionRefusal(()=>db.query('UPDATE actor_permissions SET allowed=false WHERE actor=$1 AND permission=$2',[actorB,'communication.write']),()=>readSource(actorB),/actor_forbidden/);
await transactionRefusal(()=>db.query('UPDATE company_memberships SET accepted_at=NULL WHERE user_id=$1',[actorB]),()=>readSource(actorB),/actor_forbidden/);
await transactionRefusal(()=>db.query('UPDATE customer_addresses SET city=$1 WHERE id=$2',['Unrelated city',id(80)]),()=>readSource(actorB),/current_source_changed/);
await transactionRefusal(()=>db.query('UPDATE ediel_messages SET status=$1 WHERE id=$2',['unknown',original]),()=>readSource(actorB),/source_held/);
await db.exec('BEGIN');try{await db.query("UPDATE customer_contracts SET status='cancelled' WHERE id=$1",[contract]);assert.equal((await readSource(actorB)).status,'authorized');n++}finally{await db.exec('ROLLBACK')};
const ordinaryPrepA=(await db.query('SELECT * FROM gridex_customer_masterdata.preparations WHERE id=$1',[preparedA.sourceContextId])).rows[0];
const fresh=await prep();assert.notEqual(fresh.sourceContextId,preparedA.sourceContextId);assert.equal((await prep()).sourceContextId,fresh.sourceContextId);n++;
const scoped=(await db.query('SELECT * FROM gridex_customer_masterdata.preparations WHERE id=$1',[fresh.sourceContextId])).rows[0];
assert.equal(scoped.actor_user_id,actorB);assert.equal(scoped.cancellation_origin_id,operation);assert.equal(scoped.recovery_operation_id,null);
assert.deepEqual(scoped.as_of,ordinaryPrepA.as_of);assert.deepEqual(scoped.observed_at,ordinaryPrepA.observed_at);assert.deepEqual(scoped.basis,ordinaryPrepA.basis);assert.equal(scoped.basis_hash,ordinaryPrepA.basis_hash);
assert.ok(new Date(scoped.observed_at).getTime()<Date.now()-20*3600*1000);n++;
const freshSameCreator=await prep(actorA);assert.notEqual(freshSameCreator.sourceContextId,preparedA.sourceContextId);assert.notEqual(freshSameCreator.sourceContextId,fresh.sourceContextId);n++;
const originalBefore=(await db.query('SELECT to_jsonb(m) r FROM ediel_messages m WHERE id=$1',[original])).rows[0].r;
await insertCancellation(fresh.sourceContextId);n++;
const boundReplay=actor=>service('SELECT ediel_switch_cancellation_customer_masterdata_message_basis_v1($1,$2,$3) b',[company,cMessage,actor]).then(r=>r.rows[0].b);
const replayBefore=await snapshot();
for(const actor of[actorB,actorA]){const replay=await boundReplay(actor);assert.equal(replay.sourceContextId,fresh.sourceContextId);assert.equal(replay.cancellationBinding.actorUserId,actor);assert.equal(replay.cancellationBinding.preparerId,actorB);assert.deepEqual(await snapshot(),replayBefore);n++}
await refused(()=>boundReplay(actorC),/actor_forbidden/);
await refused(()=>service('SELECT ediel_switch_cancellation_customer_masterdata_message_basis_v1($1,$2,$3)',[company,original,actorB]),/bound_draft_required/);
const ordinary=(await service('SELECT ediel_prepare_customer_masterdata_v1($1,$2,$3,$4,$5) b',[company,customer,actorA,at,'test'])).rows[0].b;
assert.equal(ordinary.sourceContextId,ordinaryPreparedA.sourceContextId);assert.notEqual(ordinary.sourceContextId,freshSameCreator.sourceContextId);n++;
await db.query('INSERT INTO gridex_received_sources.prodat_recovery_operations(id,company_id,kind) VALUES($1,$2,$3)',[id(900),company,'contrl_correction']);
await refused(()=>db.query("INSERT INTO gridex_customer_masterdata.preparations(company_id,customer_id,environment,as_of,observed_at,actor_user_id,basis,basis_hash,recovery_operation_id,cancellation_origin_id) SELECT company_id,customer_id,environment,as_of,observed_at,actor_user_id,basis,basis_hash,$1,$2 FROM gridex_customer_masterdata.preparations WHERE id=$3",[id(900),operation,fresh.sourceContextId]),/customer_masterdata_one_scoped_origin/);
await transactionRefusal(()=>db.exec('UPDATE retention_port SET available=false'),()=>send(actorC),/consumed_original_copy_tombstoned/);
const sent=await send(actorC);assert.equal(sent.sourceContextId,fresh.sourceContextId);n++;
await refused(()=>send(actorB),/actor_forbidden/);
await transactionRefusal(()=>db.query('UPDATE actor_permissions SET allowed=false WHERE actor=$1 AND permission=$2',[actorC,'ediel.send']),()=>send(actorC),/actor_forbidden/);
await transactionRefusal(()=>db.query('UPDATE customer_addresses SET city=$1 WHERE id=$2',['Post-preparation drift',id(80)]),()=>send(actorC),/current_source_changed/);
assert.deepEqual((await db.query('SELECT to_jsonb(m) r FROM ediel_messages m WHERE id=$1',[original])).rows[0].r,originalBefore);n++;
assert.equal((await db.query('SELECT preparation_id FROM gridex_customer_masterdata.originals WHERE message_id=$1',[original])).rows[0].preparation_id,preparedA.sourceContextId);n++;
for(const role of['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,'gridex_switch_cancellations.customer_draft_v1(uuid,uuid,uuid,text,uuid,uuid,text)','execute') a",[role])).rows[0].a,false);n++;
for(const role of['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.ediel_prepare_switch_cancellation_customer_masterdata_v1(uuid,uuid,uuid,uuid,uuid,text)','execute') a",[role])).rows[0].a,false);n++;
console.log(`PASS ${n} C customer preparation finite mechanics; ${migrationApplication}; donor SHA256 ${createHash('sha256').update(donor).digest('hex')} (declared external actor/history/legal/provider/retention/method ports and historical snapshot; no native acceptance)`);
}catch(e){console.error('FAIL after',n,'checks:',e.message,e.where);process.exitCode=1}finally{await db.close()}
