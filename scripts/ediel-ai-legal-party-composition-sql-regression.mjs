/** Executes actual composed customer/history/original SQL with finite synthetic
 * registry, purpose and actor boundaries. No issuer/legal/native approval. */
import {readFileSync} from 'node:fs'
const composedUrl=new URL('./ediel-ai-composed-customer-owners-sql-regression.mjs',import.meta.url)
let outer=readFileSync(composedUrl,'utf8'),source
const oldFinal="await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))"
if(outer.split(oldFinal).length!==2)throw Error('ai_composition_fixture_drift')
globalThis.__gridexCaptureAiSource=value=>{source=value}
try {await import('data:text/javascript;base64,'+Buffer.from(outer.replace("const priorUrl=new URL('./ediel-ai-origination-embedded-check.mjs',import.meta.url)","const priorUrl=new URL('./ediel-ai-origination-embedded-check.mjs',"+JSON.stringify(composedUrl.href)+")").replace(oldFinal,'globalThis.__gridexCaptureAiSource(source)')).toString('base64'))} finally {delete globalThis.__gridexCaptureAiSource}
function before(marker,addition){if(source.split(marker).length!==2)throw Error('ai_legal_fixture_port_drift:'+marker);source=source.replace(marker,()=>addition+'\n'+marker)}
function actual(file,name){const s=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'),a=s.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.'))),b=s.indexOf('$$;',a);if(a<0||b<0)throw Error(name);return s.slice(a,b+3)}
const purposeFile='20261001020550_ediel_ai_purpose_source_owner.sql'
const setup=String.raw`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
ALTER TABLE public.companies ADD COLUMN status text DEFAULT 'active',ADD COLUMN is_active bool DEFAULT true;
CREATE SCHEMA gridex_bilateral_customer_sources;
CREATE FUNCTION gridex_bilateral_customer_sources.classified_actor_wallclock_v1(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c uuid,a uuid,k text) RETURNS boolean LANGUAGE sql AS $$SELECT public.gridex_actor_has_company_permission(a,c,k)$$;
CREATE SCHEMA gridex_ai_purpose_sources;
CREATE SCHEMA gridex_ediel_ack_replay;
CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
CREATE FUNCTION gridex_requested_changes.actor_v1(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION gridex_requested_changes.scoped_permission_v1(c uuid,a uuid,k text) RETURNS boolean LANGUAGE sql AS $$SELECT public.gridex_actor_has_company_permission(a,c,k)$$;
CREATE FUNCTION gridex_ai_purpose_sources.legal_scope_v1(uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('syntheticUnqualified',true)$$;
CREATE FUNCTION gridex_ai_purpose_sources.current_for_scope_v1(c uuid,l text,p text,e text) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN current_setting('gridex.synthetic_current_purpose',true)='held' THEN jsonb_build_object('status','held','blocker','synthetic_current_purpose_held') ELSE gridex_ai_processing.purpose_decision_after_actor_v1(c,l,p) END$$;
ALTER FUNCTION gridex_ai_processing.require_original_draft_v1(uuid,uuid,uuid,jsonb) RENAME TO require_original_before_purpose_owner_v1;
ALTER TABLE public.ediel_messages ADD COLUMN parsed_payload jsonb;
DROP FUNCTION IF EXISTS gridex_ediel_readiness.source_scope(public.ediel_messages);
`
const registrySetup="CREATE TABLE public.tenant_counterparty_relations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz,counterparty_actor_id uuid);\nCREATE TABLE public.platform_actor_identifiers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);\nCREATE TABLE public.ediel_route_profiles(id uuid PRIMARY KEY,company_id uuid,sender_ediel_id text);\nCREATE SCHEMA gridex_registry_import;\nCREATE FUNCTION gridex_registry_import.dispatch_source_v1(c uuid,communication uuid,profile uuid,env text,family text,application text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','source_qualified','market','EL','legalEdielId','54321','legalName','Network','syntheticUnqualified',true,'wire',jsonb_build_object('family','AI','applicationReference',NULL,'interchangePartyId',coalesce(nullif(current_setting('gridex.synthetic_ai_network_transport',true),''),'54321')))$$;\nCREATE FUNCTION gridex_registry_import.current_el_actor_source_v1(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','source_qualified','legalEdielId','12345','legalName','Supplier','syntheticUnqualified',true)$$;\nCREATE FUNCTION gridex_registry_import.require_message_market_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('status','source_qualified','legalEdielId','54321','syntheticUnqualified',true)$$;\nCREATE FUNCTION gridex_ediel_readiness.source_scope(m public.ediel_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('actorId',m.company_id,'family',m.message_family,'code',m.message_code,'syntheticUnqualified',true)$$;"
const registryScopedAlias="CREATE FUNCTION gridex_registry_import.current_el_tenant_actor_source_v1(c uuid,legal_actor uuid,env text) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_registry_import.current_el_actor_source_v1(legal_actor)||jsonb_build_object('companyId',c,'environment',env,'legalActorId',legal_actor,'syntheticUnqualified',true)$$;"
const currentFunctions=['gridex_ai_purpose_sources.consumer_v1','gridex_ai_processing.require_export_decision_for_intent_v1','gridex_ai_processing.require_original_draft_v1','gridex_ai_processing.require_ai_outbound_source_before_origin_v1'].map(n=>actual(purposeFile,n).replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION')).join('\n')
const graphPrefix=String.raw`DO $prefix$DECLARE sig text;d text;BEGIN
FOR sig IN SELECT unnest(ARRAY['public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text)','public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid)']) LOOP
 d:=pg_get_functiondef(sig::regprocedure);EXECUTE regexp_replace(d,'BEGIN',E'BEGIN\n PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();');END LOOP;END$prefix$;`
const forwardUrl=new URL('../supabase/migrations/20261001092522_ediel_ai_legal_technical_party_composition.sql',import.meta.url)
before('const id=n=>', 'await db.exec('+JSON.stringify(registrySetup+'\n'+registryScopedAlias+'\n'+setup+'\n'+currentFunctions+'\n'+readFileSync(new URL('./fixtures/ediel-ai-current-readiness-source-scope.sql',import.meta.url),'utf8')+'\n'+graphPrefix)+')\n'+"if(!process.argv.includes('--red'))await db.exec("+JSON.stringify(readFileSync(forwardUrl,'utf8'))+')')
before("await db.query('INSERT INTO public.companies VALUES($1)',[company])","await db.query(\"INSERT INTO public.ediel_route_profiles VALUES($1,$2,'12345')\",[profileId,company])")
before("assert.equal((await jointRows()).rows[0].refs[2].customerSourceMessageId,fullId)",String.raw`
await db.query("UPDATE public.ediel_message_intents SET receiver_ediel_id='NETWORK-GATEWAY' WHERE id=$1",[intent])
assert.equal((await jointRows()).rows[0].refs[2].customerSourceMessageId,fullId)
await db.query("UPDATE public.ediel_message_intents SET receiver_ediel_id='54321' WHERE id=$1",[intent])
`)
source=source.replace("INSERT INTO public.companies VALUES($1)","INSERT INTO public.companies(id) VALUES($1)")
before("await db.query('INSERT INTO public.companies(id) VALUES($1)',[company])","await db.query('INSERT INTO auth.users(id) VALUES($1)',[actor])")
// Existing legacy WRITE/TEST fixture assertions are replaced by actual catalog
// phase/read facts. All prior physical cell/history/composed-facet tests stay.
const a=source.indexOf('// Sender-only capabilities'),b=source.indexOf("await db.exec('SET ROLE service_role;')\nassert.equal((await db.query('SELECT public.gridex_ai_outbound_origin_status_v1",a)
if(a<0||b<0)throw Error('ai_prior_phase_fixture_drift')
source=source.slice(0,a)+String.raw`
await db.exec("CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT CASE current_setting('gridex.synthetic_permissions',true) WHEN 'read' THEN $3='communication.read' WHEN 'write_alias' THEN $3='communication.write' ELSE true END$$;")
// Actual immutable bound read survives current purpose withdrawal, while fresh
// prepare/send continues to require that current source and catalog capability.
await db.exec("SET gridex.synthetic_permissions='read';SET gridex.synthetic_current_purpose='held';SET ROLE service_role;")
assert.equal((await db.query('SELECT public.gridex_ai_outbound_origin_status_v1($1,$2,$3) AS result',[company,actor,intent])).rows[0].result.messageId,source)
assert.equal((await record(snapshot)).rows[0].result.status,'original')
await assert.rejects(()=>prospective(),/ai_purpose_current_consumer_forbidden/)
await db.exec("RESET ROLE;SET gridex.synthetic_permissions='write_alias';SET gridex.synthetic_current_purpose='all';")
await assert.rejects(()=>db.query('SELECT gridex_ai_processing.require_ai_outbound_source_v1($1,$2,$3)',[company,source,actor]),/ai_purpose_current_consumer_forbidden/)
await db.exec("SET gridex.synthetic_permissions='all';")
await db.query("UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id=$1",[actor])
await db.exec('SET ROLE service_role;')
await assert.rejects(()=>db.query('SELECT public.gridex_ai_outbound_origin_status_v1($1,$2,$3)',[company,actor,intent]),/ediel_tenant_actor_forbidden/)
await db.exec('RESET ROLE;')
await db.query('UPDATE auth.users SET banned_until=NULL WHERE id=$1',[actor])
const changedIntent=(await db.query('SELECT to_jsonb(gridex_ai_processing.legal_history_intent_v1(jsonb_populate_record(NULL::public.ediel_message_intents,jsonb_build_object(\'sender_ediel_id\',\'HOST\',\'receiver_ediel_id\',\'NETWORK-GATEWAY\',\'id\',$1::uuid)),$2)) AS i',[intent,csv])).rows[0].i
assert.equal(changedIntent.sender_ediel_id,'12345');assert.equal(changedIntent.receiver_ediel_id,'54321');assert.equal(changedIntent.id,intent)
assert.equal((await db.query("SELECT position('gridex_ediel_ack_replay.lock_current_graph_v2' IN prosrc)>0 AS yes FROM pg_proc WHERE oid='public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid)'::regprocedure")).rows[0].yes,true)
assert.equal((await db.query("SELECT position('gridex_ai_purpose_sources.current_for_scope_v1' IN prosrc)>0 AS yes FROM pg_proc WHERE oid='gridex_ai_processing.require_ai_outbound_source_before_origin_v1(uuid,uuid,uuid)'::regprocedure")).rows[0].yes,true)
`+source.slice(b)
source=source.replace("import assert from 'node:assert/strict'","import strictAssert from 'node:assert/strict';let aiMechanicalAssertionCount=0;const assert=new Proxy(strictAssert,{get(target,key){const method=Reflect.get(target,key);return typeof method==='function'?((...args)=>{aiMechanicalAssertionCount++;return method.apply(target,args)}):method}})")
before('await db.close()',"console.log(JSON.stringify({kind:'ai_legal_technical_current_composition',mechanicalAssertions:aiMechanicalAssertionCount,native:false,authenticIssuer:false,wholeAcceptance:false}))")
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
