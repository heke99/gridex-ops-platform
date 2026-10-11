// Standalone original H READ fixture base: actual registered customer/current
// actor/original INSERT owner SQL; independent legal/profile/retention ports are
// declared test fixtures. No authentic source issuance or native replay asserted.
// Run with EDIEL_PGLITE_MODULE pointing to pinned @electric-sql/pglite@0.3.14.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const repository=process.env.EDIEL_SQL_REPOSITORY?pathToFileURL(process.env.EDIEL_SQL_REPOSITORY.replace(/\/$/,'')+'/'):new URL('../',import.meta.url)
const migration=name=>readFileSync(new URL('supabase/migrations/'+name,repository),'utf8')
const extracted=(name,owner)=>{const sql=migration(name),start=sql.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+owner.replaceAll('.','\\.')));if(start<0)throw Error('function missing:'+owner);const end=sql.indexOf('$$;',start);if(end<0)throw Error('function body missing:'+owner);return sql.slice(start,end+3)}
const fn=(name,owner)=>extracted(name,owner)
const schema=readFileSync(new URL('supabase/schema.sql',repository),'utf8');
// pg_dump and pg_get_functiondef differ in CREATE spelling and dollar tags.
// This extracts the complete declaration, never just a substituted body.
const capturedDefinitions=(name,source=schema)=>{
 const pattern=new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')+'\\(', 'g');
 return [...source.matchAll(pattern)].map(match=>{const tail=source.slice(match.index),marker=tail.match(/\bAS\s+(\$[A-Za-z_]*\$)/);assert.ok(marker,'complete function declaration:'+name);const end=tail.indexOf(marker[1]+';',marker.index+marker[0].length);assert.ok(end>marker.index,'complete function body:'+name);return tail.slice(0,end+marker[1].length+1)});
};
const actualFunction=name=>{const definitions=capturedDefinitions(name);assert.equal(definitions.length,1,'one complete function declaration:'+name);return definitions[0]};
const actualTable=name=>{const start=schema.indexOf('CREATE TABLE '+name+' ('),end=schema.indexOf('\n);',start);assert.ok(start>=0&&end>start,name);return schema.slice(start,end+3)};
const sqlPath=new URL('supabase/migrations/20261010102455_ediel_prodat_customer_masterdata_original_read.sql',repository);

// Separate finite composition: authentic captured C consumers and the genuine
// ordered/hash-guarded forward; no newly introduced C guard is replaced.
const cConsumers=[
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
const cHelpers=[
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
// Immutable baseline declarations and ACLs: captured schema 291d526d, before
// genuine d1d5ed8a forward. Body replacements cannot change this metadata.
const cBaselineDeclarations={
 "gridex_customer_masterdata.bind_original_v1": {
  "header": "CREATE FUNCTION gridex_customer_masterdata.bind_original_v1() RETURNS trigger\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    ",
  "aclStatements": [
   "REVOKE ALL ON FUNCTION gridex_customer_masterdata.bind_original_v1() FROM PUBLIC;"
  ]
 },
 "gridex_customer_masterdata.prelock_new_v1": {
  "header": "CREATE FUNCTION gridex_customer_masterdata.prelock_new_v1() RETURNS trigger\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    ",
  "aclStatements": [
   "REVOKE ALL ON FUNCTION gridex_customer_masterdata.prelock_new_v1() FROM PUBLIC;"
  ]
 },
 "gridex_customer_masterdata.require_current_v1": {
  "header": "CREATE FUNCTION gridex_customer_masterdata.require_current_v1(c uuid, message uuid, actor uuid, phase text) RETURNS void\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    ",
  "aclStatements": [
   "REVOKE ALL ON FUNCTION gridex_customer_masterdata.require_current_v1(c uuid, message uuid, actor uuid, phase text) FROM PUBLIC;"
  ]
 },
 "gridex_switch_cancellations.context_v1": {
  "header": "CREATE FUNCTION gridex_switch_cancellations.context_v1(c uuid, sw uuid, actor uuid, prepare_execution boolean DEFAULT true) RETURNS jsonb\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO ''\n    SET \"TimeZone\" TO 'UTC'\n    ",
  "aclStatements": [
   "REVOKE ALL ON FUNCTION gridex_switch_cancellations.context_v1(c uuid, sw uuid, actor uuid, prepare_execution boolean) FROM PUBLIC;"
  ]
 },
 "public.ediel_prepare_customer_masterdata_recovery_v1": {
  "header": "CREATE FUNCTION public.ediel_prepare_customer_masterdata_recovery_v1(p_company_id uuid, p_operation_id uuid, p_actor_user_id uuid, p_intent_id uuid, p_route_id uuid) RETURNS jsonb\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    ",
  "aclStatements": [
   "REVOKE ALL ON FUNCTION public.ediel_prepare_customer_masterdata_recovery_v1(p_company_id uuid, p_operation_id uuid, p_actor_user_id uuid, p_intent_id uuid, p_route_id uuid) FROM PUBLIC;",
   "GRANT ALL ON FUNCTION public.ediel_prepare_customer_masterdata_recovery_v1(p_company_id uuid, p_operation_id uuid, p_actor_user_id uuid, p_intent_id uuid, p_route_id uuid) TO service_role;"
  ]
 },
 "public.ediel_prepare_customer_masterdata_v1": {
  "header": "CREATE FUNCTION public.ediel_prepare_customer_masterdata_v1(p_company_id uuid, p_customer_id uuid, p_actor_user_id uuid, p_as_of timestamp with time zone, p_environment text DEFAULT NULL::text) RETURNS jsonb\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    ",
  "aclStatements": [
   "REVOKE ALL ON FUNCTION public.ediel_prepare_customer_masterdata_v1(p_company_id uuid, p_customer_id uuid, p_actor_user_id uuid, p_as_of timestamp with time zone, p_environment text) FROM PUBLIC;",
   "GRANT ALL ON FUNCTION public.ediel_prepare_customer_masterdata_v1(p_company_id uuid, p_customer_id uuid, p_actor_user_id uuid, p_as_of timestamp with time zone, p_environment text) TO service_role;"
  ]
 },
 "public.ediel_require_switch_cancellation_source_current_v1": {
  "header": "CREATE FUNCTION public.ediel_require_switch_cancellation_source_current_v1(p_company_id uuid, p_message_id uuid) RETURNS void\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO ''\n    ",
  "aclStatements": [
   "REVOKE ALL ON FUNCTION public.ediel_require_switch_cancellation_source_current_v1(p_company_id uuid, p_message_id uuid) FROM PUBLIC;",
   "GRANT ALL ON FUNCTION public.ediel_require_switch_cancellation_source_current_v1(p_company_id uuid, p_message_id uuid) TO service_role;"
  ]
 }
};
const cHelperSignatures={
 'gridex_switch_cancellations.prelock_customer_source_v1':'gridex_switch_cancellations.prelock_customer_source_v1(uuid,uuid,uuid)',
 'gridex_switch_cancellations.prelock_customer_message_v1':'gridex_switch_cancellations.prelock_customer_message_v1(uuid,uuid)',
 'gridex_switch_cancellations.customer_source_v1':'gridex_switch_cancellations.customer_source_v1(uuid,uuid,uuid,text)',
 'public.ediel_switch_cancellation_customer_masterdata_basis_v1':'public.ediel_switch_cancellation_customer_masterdata_basis_v1(uuid,uuid,uuid)',
 'gridex_switch_cancellations.customer_draft_v1':'gridex_switch_cancellations.customer_draft_v1(uuid,uuid,uuid,text,uuid,uuid,text)',
 'public.ediel_prepare_switch_cancellation_customer_masterdata_v1':'public.ediel_prepare_switch_cancellation_customer_masterdata_v1(uuid,uuid,uuid,uuid,uuid,text)',
 'public.ediel_switch_cancellation_customer_masterdata_message_basis_v1':'public.ediel_switch_cancellation_customer_masterdata_message_basis_v1(uuid,uuid,uuid)',
 'gridex_customer_masterdata.require_cancellation_preparation_v1':'gridex_customer_masterdata.require_cancellation_preparation_v1(gridex_customer_masterdata.preparations,public.ediel_messages,uuid,text)'
};
const bodyHash=value=>createHash('sha256').update(value).digest('hex');
const actualCaptured=name=>{const definition=actualFunction(name),marker=definition.match(/\bAS (\$[A-Za-z_]*\$)/);assert.ok(marker,name);const end=definition.indexOf(marker[1]+';',marker.index+marker[0].length);assert.ok(end>marker.index,name);return {definition,body:definition.slice(marker.index+marker[0].length,end)}};
const capturedC=cConsumers.map(spec=>({...spec,...actualCaptured(spec.name)}));
const helperDeclarations=cHelpers.map(spec=>({...spec,definitions:capturedDefinitions(spec.name)}));
const isPreC=capturedC.every(spec=>bodyHash(spec.body)===spec.preimage)&&helperDeclarations.every(spec=>spec.definitions.length===0);
const isPostC=capturedC.every(spec=>bodyHash(spec.body)===spec.postimage)&&helperDeclarations.every(spec=>spec.definitions.length===1&&bodyHash(actualCaptured(spec.name).body)===spec.sha256);
assert.ok(isPreC||isPostC,'exact complete pre-C or post-C component state required; mixed, unknown or partial helper state refused');
const capturedCHelpers=isPostC?helperDeclarations.map(spec=>({...spec,...actualCaptured(spec.name),signature:cHelperSignatures[spec.name]})):[];
// The capture's function ACL statements are applied from a default PUBLIC
// baseline, so an omitted revoke cannot borrow the fixture's protected ACL.
const cNames=new Set([...cConsumers,...cHelpers].map(spec=>spec.name));
// pg_dump function bodies can themselves contain SQL-looking text. Only
// declarations outside complete function bodies supply captured ACL/ALTERs.
const capturedSecuritySource=(()=>{
 let result='',position=0;
 for(const match of schema.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION\s/gm)){
  if(match.index<position)continue;
  const tail=schema.slice(match.index),marker=tail.match(/\bAS\s+(\$[A-Za-z_]*\$)/);assert.ok(marker,'captured function dollar body');
  const end=tail.indexOf(marker[1]+';',marker.index+marker[0].length);assert.ok(end>marker.index,'captured function terminator');
  result+=schema.slice(position,match.index);position=match.index+end+marker[1].length+1;
 }
 return result+schema.slice(position);
})();
const capturedCACL=[...capturedSecuritySource.matchAll(/^(?:REVOKE|GRANT)\s+[^;]+?\s+ON\s+FUNCTION\s+[^;]+;/gm)].map(match=>match[0]).filter(statement=>{
 const targets=statement.match(/\b(?:public|gridex_[a-z_]+)\.[a-z_][a-z_0-9]*(?=\s*\()/g)||[];
 if(!targets.some(name=>cNames.has(name)))return false;
 assert.ok(targets.every(name=>cNames.has(name)),'mixed unrelated function ACL declaration refused');return true;
});
const capturedCAlter=[...capturedSecuritySource.matchAll(/^ALTER\s+FUNCTION\s+[^;]+;/gm)].map(match=>match[0]).filter(statement=>{
 const targets=statement.match(/\b(?:public|gridex_[a-z_]+)\.[a-z_][a-z_0-9]*(?=\s*\()/g)||[];
 return targets.some(name=>cNames.has(name));
});
const cScopeConstraintNames=['customer_masterdata_one_scoped_origin','customer_masterdata_preparation_actor_operation_key','preparations_cancellation_origin_id_fkey'];
const scopedStructure=async(table)=>({
 column:(await db.query("SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.atthasdef,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) default_expression FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attname='cancellation_origin_id' AND NOT a.attisdropped",[table])).rows[0],
 constraints:(await db.query("SELECT conname,contype,condeferrable,condeferred,convalidated,conislocal,connoinherit,pg_get_constraintdef(oid,true) definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=ANY($2::text[]) ORDER BY conname",[table,cScopeConstraintNames])).rows
});
const capturedCScopeAlters=[...capturedSecuritySource.matchAll(/^ALTER TABLE(?: ONLY)? gridex_customer_masterdata\.preparations\s+[^;]+;/gm)].map(match=>match[0]).filter(statement=>cScopeConstraintNames.some(name=>statement.includes('ADD CONSTRAINT '+name+' ')));
if(isPreC){
 const table=actualTable('gridex_customer_masterdata.preparations');
 const originalUnique='ALTER TABLE ONLY gridex_customer_masterdata.preparations ADD CONSTRAINT customer_masterdata_preparation_actor_operation_key UNIQUE NULLS NOT DISTINCT (company_id,customer_id,environment,as_of,actor_user_id,basis_hash,recovery_operation_id);';
 const canonicalDeclaration=value=>value.replace(/\s+/g,'').toLowerCase();
 assert.ok(!/\bcancellation_origin_id\b|\bcustomer_masterdata_one_scoped_origin\b/.test(table)&&capturedCScopeAlters.length===1&&canonicalDeclaration(capturedCScopeAlters[0])===canonicalDeclaration(originalUnique),'structurally mixed pre-C capture refused; authentic predecessor scope required');
}
const completeCIdentity=()=>db.query("SELECT n.nspname||'.'||p.proname name,p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY($1::text[]) ORDER BY name,p.oid",[[...cNames]]).then(result=>result.rows);
const catalogRecord=signature=>db.query("SELECT p.oid,to_jsonb(p)-ARRAY['prosrc','proacl'] metadata,p.prosrc,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl FROM pg_proc p WHERE p.oid=$1::regprocedure",[signature]).then(result=>result.rows[0]);
const replaceCaptured=definition=>definition.replace(/^CREATE (?:OR REPLACE )?FUNCTION /,'CREATE OR REPLACE FUNCTION ');
let postQualificationChecks=0;
let frozenPostCatalog=[];
let cCompositionChecks=0;
let checks=0
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
 for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1'])await db.exec(fn('20260930144205_ediel_permission_source_atomic_transitions.sql',name))
 await db.exec(fn('20260930164804_ediel_prodat_retry_correction_authority.sql','gridex_received_sources.prodat_recovery_wire_v1'))
 const append=migration('20260923114703_ediel_reviewed_closure_source.sql'),a=append.indexOf('CREATE OR REPLACE FUNCTION gridex_received_sources.append_object_assessment'),b=append.indexOf('$$;',a);await db.exec(append.slice(a,b+3))
 await db.exec(migration('20260930233247_ediel_customer_life_event_source_authority.sql'));checks++
 await db.exec(migration('20261001010530_ediel_customer_life_event_dated_projection.sql'));checks++
 await db.exec(migration('20261001012053_ediel_customer_life_event_dated_brp_source.sql'));checks++;
 await db.exec(`ALTER TABLE ediel_messages ADD parsed_payload jsonb,ADD execution_context_snapshot jsonb,ADD created_by uuid;
 CREATE TABLE customer_addresses(id uuid PRIMARY KEY,company_id uuid,customer_id uuid REFERENCES customers(id),type text NOT NULL DEFAULT'registered',street_1 text,street_2 text,postal_code text,city text,country text NOT NULL DEFAULT'SE',municipality text,moved_in_at date,moved_out_at date,is_active bool NOT NULL DEFAULT true,metadata jsonb NOT NULL DEFAULT'{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by uuid,updated_by uuid);
 CREATE TABLE customer_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,signed_at timestamptz,signed_version text,document_sha256 text);
 CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(ct public.customer_contracts) RETURNS text LANGUAGE sql AS $$SELECT encode(sha256(convert_to(to_jsonb(ct)::text,'UTF8')),'hex')$$;
 CREATE SCHEMA gridex_negative_fixtures;CREATE TABLE gridex_negative_fixtures.positive_witnesses(id uuid,company_id uuid,actor_user_id uuid);CREATE TABLE gridex_negative_fixtures.negative_prepared_witnesses(id uuid,company_id uuid,actor_user_id uuid);
 CREATE FUNCTION gridex_negative_fixtures.prepared_positive_fixture_v1(uuid,uuid,text,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION gridex_negative_fixtures.prepared_negative_fixture_v1(uuid,uuid,text,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION gridex_negative_fixtures.require_positive_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;CREATE FUNCTION gridex_negative_fixtures.require_negative_message_v1(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 INSERT INTO customer_addresses(id,company_id,customer_id,type,street_1,street_2,postal_code,city,country,moved_in_at) VALUES('${id(80)}','${id(1)}','${id(3)}','registered','Registered street','Own extra','12345','Registered city','SE',current_date-1);
 INSERT INTO customer_addresses(id,company_id,customer_id,type,street_1,postal_code,city,country) VALUES('${id(81)}','${id(1)}','${id(3)}','billing','Wrong invoice','99999','Wrong city','SE');`)
 await db.exec(fn('20260922095911_ediel_received_source_ledger.sql','gridex_received_sources.reject_mutation'));
 await db.exec(migration('20261001014700_ediel_registered_customer_masterdata_source.sql'));checks++;
// Current production shape used by actual customer bodies. Independent tables
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
for(const file of ['20261001025107_ediel_customer_masterdata_national_postal_shape.sql','20261001030500_ediel_customer_masterdata_actual_consumer_scope.sql','20261001030524_ediel_customer_masterdata_fresh_transport_source.sql'])await db.exec(migration(file));
await db.exec(`ALTER TABLE gridex_received_sources.prodat_recovery_operations ADD PRIMARY KEY(id),ADD kind text,ADD environment text;
 CREATE TABLE gridex_received_sources.prodat_recovery_origins(operation_id uuid,company_id uuid,intent_id uuid,outbound_request_id uuid);
 CREATE FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_recovery_port_not_available';END$$;
 CREATE FUNCTION gridex_received_sources.prelock_recovery_source_cohort_v1(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
 CREATE FUNCTION gridex_received_sources.qualified_recovery_origin_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_recovery_port_not_available';END$$;`);
await db.exec(migration('20261001112223_ediel_recovery_protected_ud_preparation.sql'));


// Genuine installed baseline C origins/schema/guards. Existing external graph,
// signed profile, provider observation and retention ports remain declared.
await db.exec(`CREATE SCHEMA gridex_ediel_ack_replay;CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT$$;`);
for(const file of ['20260930214933_ediel_switch_cancellation_source_origination.sql','20260930223846_ediel_cancellation_request_environment_scope.sql'])await db.exec(migration(file));

// Load the existing actual method dependency graph as captured, with no signed
// method rows or replacement C method guards. H READ does not qualify C.
await db.exec('CREATE SCHEMA gridex_metering_method_changes');
await db.exec(actualFunction('gridex_metering_method_changes.canonical_tuple_projection_v1'));
await db.exec(actualFunction('gridex_metering_method_changes.requested_method_supported_v1'));
for(const name of ['gridex_metering_method_changes.contract_request_declarations','gridex_received_sources.switch_contract_request_bindings'])await db.exec(actualTable(name));
const cMethodDependencies=['gridex_received_sources.switch_requested_method_v1','gridex_switch_cancellations.original_method_v1','gridex_switch_cancellations.require_original_method_v1'];
for(const name of cMethodDependencies)await db.exec(actualFunction(name).replace(/^CREATE FUNCTION /,'CREATE OR REPLACE FUNCTION '));
const cMethodSignatures=['gridex_metering_method_changes.canonical_tuple_projection_v1()','gridex_metering_method_changes.requested_method_supported_v1(text)','gridex_received_sources.switch_requested_method_v1(text)','gridex_switch_cancellations.original_method_v1(uuid,uuid,text,text)','gridex_switch_cancellations.require_original_method_v1(uuid,uuid,text,text,text)'];
const cDependencyCatalog=()=>db.query("SELECT oid,prosrc,proconfig,proargnames FROM pg_proc p WHERE oid=ANY($1::regprocedure[]) ORDER BY oid",[cMethodSignatures]).then(result=>result.rows);
const frozenCMethodCatalog=await cDependencyCatalog();
if(isPreC){
 for(const spec of capturedC)await db.exec(spec.definition.replace(/^CREATE FUNCTION /,'CREATE OR REPLACE FUNCTION '));
 for(const spec of capturedC){assert.equal((await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') h FROM pg_proc WHERE oid=$1::regprocedure",[spec.signature])).rows[0].h,spec.preimage);cCompositionChecks++}
}
const cMetadata=()=>db.query("SELECT oid,to_jsonb(p)-'prosrc' m FROM pg_proc p WHERE oid=ANY($1::regprocedure[]) ORDER BY oid",[cConsumers.map(spec=>spec.signature)]).then(result=>result.rows);
let cPreMetadata=await cMetadata();const cForward=migration('20261009082553_ediel_switch_cancellation_customer_masterdata_preparation.sql');
assert.equal(bodyHash(cForward),'d1d5ed8a3731f281826de39e4ebd4868a3090016dfef4544d6964352242cf351');
if(isPreC){
 await db.exec(cForward);assert.deepEqual(await cMetadata(),cPreMetadata);cCompositionChecks++;
}else{
 // Fresh local bootstrap executes the genuine migration's complete schema,
 // constraints, helper functions and ACLs, stopping before predecessor guards.
 // Complete postimages are installed directly; predecessor checks are never
 // weakened, rewritten or replayed over a postimage.
 const prefixEnd=cForward.indexOf('DO $consumers$');assert.ok(prefixEnd>0,'genuine consumer boundary');
 await db.exec(cForward.slice(0,prefixEnd)+'COMMIT;');
 const expectedScope=await scopedStructure('gridex_customer_masterdata.preparations');
 assert.ok(expectedScope.column&&expectedScope.constraints.length===3,'genuine prefix complete scoped structure');
 // A function-only or structurally pre-C capture cannot borrow the prefix's
 // new UUID column, exclusive origin check, scoped UNIQUE or actual origin FK.
 await db.exec('CREATE SCHEMA gridex_c_capture_qualification');
 const capturedTable='gridex_c_capture_qualification.preparations';
 await db.exec(actualTable('gridex_customer_masterdata.preparations').replace('CREATE TABLE gridex_customer_masterdata.preparations (','CREATE TABLE '+capturedTable+' ('));
 for(const statement of capturedCScopeAlters)await db.exec(statement.replace('gridex_customer_masterdata.preparations',capturedTable));
 assert.deepEqual(await scopedStructure(capturedTable),expectedScope,'captured cancellation scoped structure drift refused');postQualificationChecks++;
 await db.exec('DROP SCHEMA gridex_c_capture_qualification CASCADE');

 const expected=new Map();
 for(const spec of capturedC){
  const reference=cBaselineDeclarations[spec.name];assert.ok(reference,'baseline declaration:'+spec.name);
  await db.exec(replaceCaptured(reference.header)+'AS $reference$'+spec.body+'$reference$;');
  await db.exec(reference.aclStatements.join('\n'));
  expected.set(spec.name,await catalogRecord(spec.signature));cCompositionChecks++;
 }
 for(const spec of capturedCHelpers)expected.set(spec.name,await catalogRecord(spec.signature));
 const expectedIdentity=await completeCIdentity();assert.equal(expectedIdentity.length,15,'one genuine C function identity each');
 for(const spec of [...capturedC,...capturedCHelpers]){
  await db.exec(replaceCaptured(spec.definition));
  await db.exec('REVOKE ALL ON FUNCTION '+spec.signature+' FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION '+spec.signature+' TO PUBLIC;');
 }
 for(const statement of capturedCACL)await db.exec(statement);
 for(const statement of capturedCAlter)await db.exec(statement);
 assert.deepEqual(await completeCIdentity(),expectedIdentity,'captured argument identity/overload drift refused');postQualificationChecks++;
 for(const spec of [...capturedC,...capturedCHelpers]){
  // Full installed catalog (arguments/defaults/result/language/security/config,
  // local OID, owner, flags) and effective ACL must match genuine declarations.
  // SQL formatting is normalized by PostgreSQL, not by discarding settings.
  const actual=await catalogRecord(spec.signature);
  assert.deepEqual(actual,expected.get(spec.name),'captured declaration metadata/ACL drift refused:'+spec.name);postQualificationChecks++;
 }
 frozenPostCatalog=await Promise.all([...capturedC,...capturedCHelpers].map(spec=>catalogRecord(spec.signature)));
 cPreMetadata=await cMetadata();
 cCompositionChecks++;
}
for(const spec of capturedC){assert.equal((await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') h FROM pg_proc WHERE oid=$1::regprocedure",[spec.signature])).rows[0].h,spec.postimage);cCompositionChecks++}
for(const spec of cHelpers){assert.equal((await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') h FROM pg_proc WHERE oid=$1::regprocedure",[spec.name==='gridex_customer_masterdata.require_cancellation_preparation_v1'?spec.name+'(gridex_customer_masterdata.preparations,public.ediel_messages,uuid,text)':spec.name==='gridex_switch_cancellations.prelock_customer_source_v1'?spec.name+'(uuid,uuid,uuid)':spec.name==='gridex_switch_cancellations.prelock_customer_message_v1'?spec.name+'(uuid,uuid)':spec.name==='gridex_switch_cancellations.customer_source_v1'?spec.name+'(uuid,uuid,uuid,text)':spec.name==='public.ediel_switch_cancellation_customer_masterdata_basis_v1'?spec.name+'(uuid,uuid,uuid)':spec.name==='gridex_switch_cancellations.customer_draft_v1'?spec.name+'(uuid,uuid,uuid,text,uuid,uuid,text)':spec.name==='public.ediel_prepare_switch_cancellation_customer_masterdata_v1'?spec.name+'(uuid,uuid,uuid,uuid,uuid,text)':spec.name+'(uuid,uuid,uuid)'])).rows[0].h,spec.sha256);cCompositionChecks++}
const cPostSources=()=>db.query("SELECT oid,prosrc FROM pg_proc p WHERE oid=ANY($1::regprocedure[]) ORDER BY oid",[cConsumers.map(spec=>spec.signature)]).then(result=>result.rows);
const frozenCPostSources=await cPostSources();

// Authentic customer owner algorithms below run against the declared dated
// registered address. Only this original's customer binder is exercised.
const actorA=id(20),actorB=id(22),actorC=id(23),company=id(1),customer=id(3),site=id(7),point=id(5);
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

const original=id(508),date=(await db.query("SELECT to_char((now()+interval '1 hour')::date+10,'YYYYMMDD') d")).rows[0].d;
const originalParts=[
 'UNB+UNOC:3+12345:14+54321:14+260930:1200+DECLARED-H-UNB++23-DDQ-PRODAT',
 'UNH+1+PRODAT:D:97A:UN:E2SE6A','BGM+Z03+SOURCE+9',
 'NAD+FR+12345:160:SVK','NAD+DO+54321:160:SVK','LIN+1++POINT:::9',
 `DTM+92:${date}0000:203`,"CCI++Z04","CAV+Z03","CCI++Z13","CAV+Z25",
 'RFF+LI:DECLARED-H-OWN-LI','RFF+Z05:TES','RFF+ANJ:DECLARED-ANJ',
 'NAD+UD+5566778899:SE1:260++Old+Registered street:Own extra+Registered city++12345+SE',
 'NAD+IT+POINT::9'
];
const unhIndex=originalParts.findIndex(segment=>segment.startsWith('UNH+'));
originalParts.push(`UNT+${originalParts.length-unhIndex+1}+1`,'UNZ+1+DECLARED-H-UNB');
const raw=originalParts.join("'")+"'",old=raw;
await service("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_rendered_at,immutable_payload_hash,customer_id,site_id,metering_point_id,created_by,parsed_payload,intent_id,communication_route_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','sent',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,$8,$9,$10)",[original,company,raw,customer,site,point,actorA,{customerMasterdataSourceContextId:preparedA.sourceContextId},id(511),id(514)]);
const originalBinding=(await db.query('SELECT * FROM gridex_customer_masterdata.originals WHERE company_id=$1 AND message_id=$2',[company,original])).rows[0];
assert.equal(originalBinding.preparation_id,preparedA.sourceContextId);
assert.equal(originalBinding.payload_hash,(await db.query('SELECT immutable_payload_hash FROM ediel_messages WHERE id=$1',[original])).rows[0].immutable_payload_hash);checks++;


const readActor=id(24);let n=0;
const reader=(c=company,m=original,a=readActor)=>service('SELECT ediel_read_prodat_customer_masterdata_original_v1($1,$2,$3) r',[c,m,a]).then(r=>r.rows[0].r);
const acceptedReader=(c=company,m=original,a=readActor)=>service('SELECT ediel_read_prodat_h_accepted_original_v1($1,$2,$3) r',[c,m,a]).then(r=>r.rows[0].r);
const metadata=()=>db.query("SELECT oid,prosrc,proconfig,proacl,proargnames FROM pg_proc WHERE oid IN('public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid)'::regprocedure,'gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages)'::regprocedure,'public.ediel_customer_masterdata_message_basis_v1(uuid,uuid,uuid)'::regprocedure) ORDER BY oid").then(r=>r.rows);
const snapshot=()=>db.query("SELECT jsonb_build_object('messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM ediel_messages m),'preps',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM gridex_customer_masterdata.preparations p),'customer_originals',(SELECT jsonb_agg(to_jsonb(o) ORDER BY message_id) FROM gridex_customer_masterdata.originals o),'switches',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM supplier_switch_requests s),'c_origins',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM gridex_switch_cancellations.origins o),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM gridex_ediel_transport.attempts a),'effects',(SELECT jsonb_agg(to_jsonb(e)) FROM native_effects e)) r").then(r=>r.rows[0].r);
const refuse=async(action,pattern)=>{const before=await snapshot();await assert.rejects(action(),pattern);assert.deepEqual(await snapshot(),before);n++};
const changed=async(change,action,pattern)=>{await db.exec('BEGIN');try{await change();await assert.rejects(action(),pattern);n++}finally{await db.exec('ROLLBACK')}};
await db.exec(`ALTER TABLE company_memberships ADD id uuid DEFAULT gen_random_uuid();ALTER TABLE companies ADD status text DEFAULT'active';ALTER TABLE auth.users ADD deleted_at timestamptz,ADD banned_until timestamptz;
 CREATE TABLE permissions(id uuid PRIMARY KEY,key text,is_active bool);CREATE TABLE user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active bool,status text,effect text);
 CREATE TABLE user_roles(user_id uuid,company_id uuid,role_id uuid,is_active bool,status text);CREATE TABLE roles(id uuid PRIMARY KEY,is_active bool);CREATE TABLE role_permissions(role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE SCHEMA gridex_bilateral_prodat;CREATE FUNCTION gridex_bilateral_prodat.lock_graph_v1() RETURNS void LANGUAGE sql AS $$SELECT$$;
 INSERT INTO auth.users(id) VALUES('${readActor}');INSERT INTO user_profiles VALUES('${readActor}','active');INSERT INTO company_memberships VALUES('${company}','${readActor}','active',true,now());
 INSERT INTO actor_permissions VALUES('${readActor}','communication.read',true),('${readActor}','contracts.read',true),('${readActor}','metering.read',true),('${readActor}','communication.write',false),('${readActor}','ediel.send',false);
 CREATE TABLE gridex_bilateral_prodat.outbound_operations(message_id uuid PRIMARY KEY,company_id uuid,capability jsonb);
 CREATE TABLE original_profile_port(available bool);INSERT INTO original_profile_port VALUES(true);
 CREATE FUNCTION gridex_bilateral_prodat.outbound_required_v1(raw text) RETURNS bool LANGUAGE sql AS $$SELECT raw LIKE '%CAV+Z25%'$$;
 CREATE FUNCTION public.ediel_require_source_bytes_available_v1(c uuid,m uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF(SELECT available FROM public.retention_port) IS NOT TRUE THEN RAISE EXCEPTION 'declared_source_bytes_tombstoned';END IF;END$$;
 CREATE FUNCTION gridex_bilateral_prodat.require_recorded_outbound_source_current_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF(SELECT available FROM public.original_profile_port) IS NOT TRUE THEN RAISE EXCEPTION 'declared_current_original_profile_unavailable';END IF;END$$;
 CREATE SCHEMA gridex_outbound_dispatch;`);
for(const name of['gridex_ediel_transport.attempts','gridex_outbound_dispatch.attempts','gridex_outbound_dispatch.events','gridex_outbound_dispatch.originals'])await db.exec(actualTable(name));
await db.exec(actualFunction('gridex_ediel_transport.accepted_source_basis_v1'));
await db.exec(`CREATE TABLE read_revoke_port(active bool);INSERT INTO read_revoke_port VALUES(false);CREATE OR REPLACE FUNCTION gridex_ediel_retention.contract_copy_preparation_current_v1(uuid,uuid) RETURNS bool LANGUAGE plpgsql AS $$BEGIN IF(SELECT active FROM public.read_revoke_port) THEN UPDATE public.actor_permissions SET allowed=false WHERE actor='${readActor}' AND permission='contracts.read';END IF;RETURN(SELECT available FROM public.retention_port);END$$;`);
await db.exec(extracted('20260930220932_ediel_source_read_send_permission_contract.sql','public.gridex_ediel_accepted_transport_projection_v1'));
await db.exec('REVOKE ALL ON FUNCTION gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;REVOKE ALL ON FUNCTION public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid) TO service_role');
await db.exec(extracted('20261001013034_ediel_bilateral_prodat_archived_profile_review.sql','gridex_bilateral_prodat.actor_v1'));
await db.exec(extracted('20261001115200_ediel_national_supply_rescission_business_watch.sql','public.ediel_read_bilateral_prodat_outbound_original_v1'));
const q={version:1,owner:'immutable-bilateral-prodat-outbound-profile-v1',companyId:company,environment:'test',actorUserId:actorA,payloadHash:createHash('sha256').update(raw).digest('hex'),messageCode:'Z03',objects:[{process:'normal_start_h'}]};
await db.query('INSERT INTO gridex_bilateral_prodat.outbound_operations VALUES($1,$2,$3)',[original,company,q]);
const receiptId=id(600),receiptBinding={originalHash:q.payloadHash,to:'grid@example.invalid',businessExpectationPlan:{version:1,sourceCode:'Z03',expectedFamily:'PRODAT',anchor:'actual_accepted_smtp_observed_at'}},provider={accepted:['grid@example.invalid'],rejected:[]};
// Declared external acceptance observation, not authentic provider execution.
// The actual immutable accepted-source owner checks these private observations.
await db.query("INSERT INTO gridex_ediel_transport.attempts(id,message_id,company_id,environment,actor_user_id,owner,binding,entered_at,observed_at,classification,provider_result) VALUES($1,$2,$3,'test',$4,'{}',$5,'2026-09-30T11:59:59Z','2026-09-30T12:00:00Z','accepted',$6)",[receiptId,original,company,actorA,receiptBinding,provider]);
const oldMetadata=await metadata(),sql=readFileSync(sqlPath,'utf8');await db.exec(sql);assert.deepEqual(await metadata(),oldMetadata);n++;
await refuse(()=>service('SELECT gridex_ediel_accepted_transport_projection_v1($1,$2,$3,$4)',[company,'test',readActor,original]),/actor_forbidden/);
const ownAccepted=await acceptedReader();assert.equal(ownAccepted.owner,'immutable-prodat-h-accepted-original-read-v1');assert.equal(ownAccepted.actorUserId,readActor);assert.equal(ownAccepted.originalActorUserId,actorA);assert.equal(ownAccepted.originalHash,q.payloadHash);assert.equal(ownAccepted.authorizesProviderEntry,false);assert.equal(ownAccepted.deliveryProven,false);n++;
const before=await snapshot(),read=await reader();assert.equal(read.owner,'immutable-prodat-customer-masterdata-original-read-v1');assert.equal(read.version,1);assert.equal(read.actorUserId,readActor);assert.equal(read.originalActorUserId,actorA);assert.equal(read.sourceContextId,preparedA.sourceContextId);assert.equal(read.messageBinding.id,original);assert.deepEqual(read.customerIdentity,preparedA.customerIdentity);assert.deepEqual(read.endUserMasterdata,preparedA.endUserMasterdata);assert.equal(Object.hasOwn(read,'sourceProof'),false);assert.deepEqual(await snapshot(),before);n++;
await refuse(()=>service('SELECT ediel_customer_masterdata_message_basis_v1($1,$2,$3)',[company,original,readActor]),/actor_forbidden/);
await refuse(()=>reader(company,original,actorB),/actor_forbidden/);
await refuse(()=>reader(company,original,actorC),/actor_forbidden/);
await refuse(()=>reader(id(2)),/actor_forbidden/);
assert.equal(await reader(company,id(999)),null);n++;
await changed(()=>db.query('UPDATE actor_permissions SET allowed=false WHERE actor=$1 AND permission=$2',[readActor,'communication.read']),()=>reader(),/actor_forbidden/);
await changed(()=>db.query('UPDATE actor_permissions SET allowed=false WHERE actor=$1 AND permission=$2',[readActor,'contracts.read']),()=>reader(),/current_reader_required/);
await changed(()=>db.query('UPDATE actor_permissions SET allowed=false WHERE actor=$1 AND permission=$2',[readActor,'metering.read']),()=>reader(),/current_reader_required/);
await changed(()=>db.query('UPDATE company_memberships SET accepted_at=NULL WHERE user_id=$1',[readActor]),()=>reader(),/actor_forbidden/);
await changed(()=>db.query('UPDATE user_profiles SET user_status=$1 WHERE id=$2',['inactive',readActor]),()=>reader(),/actor_forbidden/);
await changed(()=>db.exec('UPDATE retention_port SET available=false'),()=>reader(),/tombstoned/);
await changed(()=>db.exec('UPDATE original_profile_port SET available=false'),()=>reader(),/profile_unavailable/);
await changed(()=>db.query("UPDATE gridex_ediel_transport.attempts SET binding=jsonb_set(binding,'{originalHash}','\"bad\"') WHERE message_id=$1",[original]),()=>reader(),/original_changed/);
await changed(()=>db.query("UPDATE gridex_bilateral_prodat.outbound_operations SET capability=jsonb_set(capability,'{objects,0,process}','\"closure_request_lk\"') WHERE message_id=$1",[original]),()=>reader(),/profile_scope_required/);
await changed(()=>db.query('UPDATE customer_addresses SET city=$1 WHERE id=$2',['Unexpected current address',id(80)]),()=>reader(),/current_source_changed/);
await db.exec('BEGIN');try{await db.query('DELETE FROM gridex_ediel_transport.attempts WHERE message_id=$1',[original]);assert.equal(await reader(),null);n++}finally{await db.exec('ROLLBACK')};
await changed(()=>db.query("UPDATE gridex_ediel_transport.attempts SET entered_at=NULL WHERE id=$1",[receiptId]),()=>acceptedReader(),/receipt_invalid/);
await changed(()=>db.query("UPDATE gridex_ediel_transport.attempts SET provider_result=jsonb_set(provider_result,'{accepted}','[\"foreign@example.invalid\"]') WHERE id=$1",[receiptId]),()=>acceptedReader(),/expected_recipient_required/);
await changed(()=>db.query("UPDATE gridex_ediel_transport.attempts SET provider_result=jsonb_set(provider_result,'{rejected}','[\"grid@example.invalid\"]') WHERE id=$1",[receiptId]),()=>acceptedReader(),/expected_recipient_required/);
await changed(()=>db.query("UPDATE gridex_ediel_transport.attempts SET binding=jsonb_set(binding,'{businessExpectationPlan,anchor}','\"declared_default\"') WHERE id=$1",[receiptId]),()=>acceptedReader(),/frozen_plan_invalid/);
await changed(()=>db.query("UPDATE gridex_ediel_transport.attempts SET observed_at=statement_timestamp()+interval '1 day' WHERE id=$1",[receiptId]),()=>acceptedReader(),/accepted_scope_required/);
await changed(()=>db.query("UPDATE gridex_ediel_transport.attempts SET observed_at='infinity' WHERE id=$1",[receiptId]),()=>acceptedReader(),/receipt_invalid/);
await changed(()=>db.query("INSERT INTO gridex_ediel_transport.attempts(id,message_id,company_id,environment,actor_user_id,owner,binding,entered_at,observed_at,classification,provider_result) SELECT $1,message_id,company_id,environment,actor_user_id,owner,binding,entered_at,observed_at,classification,provider_result FROM gridex_ediel_transport.attempts WHERE id=$2",[id(601),receiptId]),()=>acceptedReader(),/ambiguous/);
await db.exec('BEGIN');try{await db.query("UPDATE gridex_ediel_transport.attempts SET classification='partial' WHERE id=$1",[receiptId]);assert.equal(await acceptedReader(),null);assert.equal(await reader(),null);n++}finally{await db.exec('ROLLBACK')};
// A separately persisted physical H original with no UD owns no protected
// customer original. IV transport observation stays independently available.
const noCustomerOriginal=id(509),noCustomerRaw=raw.replace(/NAD\+UD[^']*'/,'').replace('UNT+16+1','UNT+15+1'),noCustomerHash=createHash('sha256').update(noCustomerRaw).digest('hex');
await service("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,immutable_rendered_at,immutable_payload_hash,customer_id,site_id,metering_point_id,created_by,parsed_payload,intent_id,communication_route_id) VALUES($1,$2,'test','outbound','edifact','PRODAT','Z03','sent',$3,now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,$7,'{}',$8,$9)",[noCustomerOriginal,company,noCustomerRaw,customer,site,point,actorA,id(512),id(515)]);
await db.query('INSERT INTO gridex_bilateral_prodat.outbound_operations VALUES($1,$2,$3)',[noCustomerOriginal,company,{...q,payloadHash:noCustomerHash}]);
await db.query("INSERT INTO gridex_ediel_transport.attempts(id,message_id,company_id,environment,actor_user_id,owner,binding,entered_at,observed_at,classification,provider_result) SELECT $1,$2,company_id,environment,actor_user_id,owner,jsonb_set(binding,'{originalHash}',to_jsonb($3::text)),entered_at,observed_at,classification,provider_result FROM gridex_ediel_transport.attempts WHERE id=$4",[id(602),noCustomerOriginal,noCustomerHash,receiptId]);
const unknownBefore=await snapshot();assert.equal(await reader(company,noCustomerOriginal),null);assert.equal((await acceptedReader(company,noCustomerOriginal)).originalHash,noCustomerHash);assert.deepEqual(await snapshot(),unknownBefore);n++;

await changed(()=>db.exec('UPDATE read_revoke_port SET active=true'),()=>reader(),/current_reader_required/);
assert.deepEqual(await metadata(),oldMetadata);n++;
for(const role of['anon','authenticated'])for(const name of['ediel_read_prodat_customer_masterdata_original_v1','ediel_read_prodat_h_accepted_original_v1'])assert.equal((await db.query("SELECT has_function_privilege($1,$2,'execute') a",[role,'public.'+name+'(uuid,uuid,uuid)'])).rows[0].a,false);n++;

assert.deepEqual(await cMetadata(),cPreMetadata);if(isPostC){assert.deepEqual(await Promise.all([...capturedC,...capturedCHelpers].map(spec=>catalogRecord(spec.signature))),frozenPostCatalog,'post-C complete catalog and ACL preserved through H INSERT/READ');postQualificationChecks++;}
assert.deepEqual(await cPostSources(),frozenCPostSources);cCompositionChecks++;
assert.deepEqual(await cDependencyCatalog(),frozenCMethodCatalog);cCompositionChecks++;
assert.equal((await db.query('SELECT count(*) n FROM gridex_switch_cancellations.origins')).rows[0].n,0);cCompositionChecks++;
// The actual new private guard accepts ordinary H READ, but physical Z24 cannot
// borrow its ordinary dated preparation. No replacement/no-op guard is used.
await assert.rejects(db.query("SELECT gridex_customer_masterdata.require_cancellation_preparation_v1(p,jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(m)||jsonb_build_object('raw_payload',replace(m.raw_payload,'CAV+Z25','CAV+Z24'))),$3,'read') FROM gridex_customer_masterdata.preparations p JOIN gridex_customer_masterdata.originals o ON o.preparation_id=p.id JOIN ediel_messages m ON m.id=o.message_id WHERE p.company_id=$1 AND m.id=$2",[company,original,readActor]),/cancellation_fresh_preparation_required/);cCompositionChecks++;
if(isPostC)console.log(`Exact post-C complete declaration/ACL qualification: ${postQualificationChecks} PASS (finite local fixture; captured backend OIDs not asserted)`);
console.log(`PASS ${cCompositionChecks} actual C forward/full-postimage/private-guard composition checks; C SHA256 ${bodyHash(cForward)}; ${isPreC?'baseline captured preimage applied':'exact complete captured postimage declarations installed via genuine prefix'} in finite DB, no GEN/native acceptance`);
console.log(`PASS ${checks+n} original customer native READ mechanics; SQL SHA256 ${createHash('sha256').update(sql).digest('hex')} (actual actor/original reader/customer consumers; actual immutable accepted receipt owner + public SEND permission; declared external profile/provider observation/retention ports; no authentic/native replay)`);

}catch(error){console.error(error);process.exitCode=1}finally{await db.close()}
