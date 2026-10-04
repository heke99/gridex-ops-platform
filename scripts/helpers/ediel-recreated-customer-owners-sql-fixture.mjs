// Explicit bounded synthetic ledger/source/permission ports. NOT native replay.
import {readFileSync} from 'node:fs'
const baseUrl=new URL('../ediel-partial-customer-life-event-sql-regression.mjs',import.meta.url)
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export function functionSql(file,name){const s=readFileSync(new URL(file,baseUrl),'utf8');const hit=new RegExp('CREATE(?: OR REPLACE)? FUNCTION '+name.replaceAll('.','\\.')+'\\(').exec(s);if(!hit)throw Error(name);const end=s.indexOf('$$;',hit.index);return s.slice(hit.index,end+3)}
export async function createRecreatedCustomerOwnerFixture(db){const fn=functionSql
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
 const append=readFileSync(new URL('../supabase/migrations/20260923114703_ediel_reviewed_closure_source.sql',baseUrl),'utf8'),a=append.indexOf('CREATE OR REPLACE FUNCTION gridex_received_sources.append_object_assessment'),b=append.indexOf('$$;',a);await db.exec(append.slice(a,b+3))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930233247_ediel_customer_life_event_source_authority.sql',baseUrl),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001010530_ediel_customer_life_event_dated_projection.sql',baseUrl),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001012053_ediel_customer_life_event_dated_brp_source.sql',baseUrl),'utf8'));;

 await db.exec(`CREATE SCHEMA gridex_ediel_ack_replay;CREATE TABLE lock_log(seq bigint GENERATED ALWAYS AS IDENTITY,label text);
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.lock_log(label)VALUES('currentgraph');END$$;
 ALTER TABLE auth.users ADD deleted_at timestamptz,ADD banned_until timestamptz;
 ALTER TABLE gridex_received_sources.validation_assessments ADD assessed_at timestamptz DEFAULT clock_timestamp();
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,metering_point_id uuid,status text,signed_at timestamptz,signed_version text);
 CREATE TABLE gridex_received_sources.prodat_source_function_facets(assessment_id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,function_facts_text text,function_facts_hash text);
 CREATE SCHEMA gridex_requested_changes;
 CREATE TABLE permissions(id uuid PRIMARY KEY,key text,is_active bool);CREATE TABLE user_permissions(id uuid,user_id uuid,company_id uuid,permission_id uuid,permission_key text,effect text,status text,is_active bool);
 CREATE TABLE user_roles(id uuid,user_id uuid,company_id uuid,role_id uuid,is_active bool,status text);CREATE TABLE roles(id uuid,is_active bool);
 CREATE TABLE role_permissions(id uuid,role_id uuid,permission_id uuid,permission_key text,effect text);CREATE TABLE user_permission_overrides(id uuid,user_id uuid,company_id uuid,is_active bool,effect text,permission_key text,valid_from timestamptz,valid_to timestamptz);
 CREATE FUNCTION gridex_received_sources.reject_mutation()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20261001023512_ediel_partial_customer_life_event_source_effects.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../supabase/migrations/20261001020309_ediel_customer_life_event_scoped_patches.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../supabase/migrations/20261001014726_ediel_customer_life_event_epoch_boundaries.sql',import.meta.url),'utf8'))
 const source=readFileSync(new URL('../../supabase/migrations/20261001010758_ediel_bilateral_customer_source_owner.sql',import.meta.url),'utf8')
 // Only the actual original archive/review owner portion; unrelated confirmed
 // customer/AI owners require full clean native replay, not this finite harness.
 await db.exec(source.slice(0,source.indexOf('-- Protected versions'))+'\nCOMMIT;')
 const ownArgs={p_company_id:'uuid',p_actor_user_id:'uuid',p_intent_id:'uuid',p_snapshot_id:'uuid',p_readset_hash:'text',p_raw_payload:'text',p_file_name:'text',p_mime_type:'text',p_row_sources:'text'}
 await db.exec(`CREATE FUNCTION public.gridex_ai_record_outbound_original_v1(${Object.entries(ownArgs).map(([a,t])=>a+' '+t).join(',')})RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'declared_independent_ai_owner_unavailable';END$$;
 CREATE FUNCTION public.gridex_ai_outbound_origin_status_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'declared_independent_ai_owner_unavailable';END$$;`)
}
