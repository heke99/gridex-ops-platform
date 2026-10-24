// Preserve immutable snapshots on actual source-bound and legacy pricing paths.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/qualified-underlay-pricing-snapshot-sql-regression.mjs
// Focused mechanical PostgreSQL source/atomicity/time/replay checks. Current
// legal/rule admission and legacy activation effects are declared fixtures;
// this is not native replay, authentic issuer or formal acceptance evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL,fileURLToPath} from 'node:url'
import * as fs from 'node:fs'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const SOURCE_URL=new URL('./ediel-normal-switch-source-sql-regression.mjs',import.meta.url);
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
function fn(file,name){const text=readFileSync(new URL(file,SOURCE_URL),'utf8'),a=text.indexOf(`CREATE FUNCTION ${name}`),b=text.indexOf('$$;',a);if(a<0||b<0)throw Error(name);return text.slice(a,b+3)}
const raw=(code,objects,sender='54321',receiver='12345')=>["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A",`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((own,i)=>[`LIN+${i+1}++${own.point}:::9`,"CCI++Z13",`CAV+${own.reason??'Z22'}`,`RFF+LI:${own.li}`,"RFF+Z05:TES",`NAD+UD+${own.customer}:SE1:260`,`DTM+92:${own.start}:203`]),"UNT+20+M","UNZ+1+I"].join("'")+"'"
const q=s=>`'${String(s).replaceAll("'","''")}'`
const run=(source=id(30),actor=id(2),company=id(1))=>db.query('SELECT public.ediel_apply_supply_source_v1($1,$2,$3) b',[company,source,actor])
const activate=(source=id(30),actor=id(2),date=null)=>db.query('SELECT * FROM public.activate_customer_supply_v1($1,$2,$3,$4,$5,NULL)',[id(1),id(10),source,date,actor])
async function installOuterChain(db,id,first,{mainOnly=false}={}){
const root=fileURLToPath(new URL('..',import.meta.url));
await db.exec(`alter table public.customer_contracts add column ends_at date;create schema gridex_utilts_binding;
 create function public.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;

 create table public.metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,value_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_code text,source_ediel_message_id uuid,source_transaction_reference text,is_current boolean,revision_status text,raw_payload jsonb,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz);
 create table public.normalized_metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,source_metering_value_id uuid,source_message_id uuid,source_transaction_reference text,quantity_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_status text,product_code text,register_code text,raw_payload jsonb,revision_status text,revision_number int,previous_value_id uuid,supply_period_id uuid,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz,updated_at timestamptz);


 create table public.contract_price_snapshots(id uuid primary key,company_id uuid,contract_id uuid,price_plan_version_id uuid,snapshot_json jsonb,valid_from date,valid_to date);
 create table public.price_plan_versions(id uuid primary key,company_id uuid,status text,locked_at timestamptz,content_sha256 text);

 create table public.billing_underlays(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,supply_period_id uuid,contract_id uuid,pricing_snapshot_id uuid,price_plan_id uuid,price_plan_version_id uuid,price_book_id uuid,contract_price_snapshot_id uuid,billing_block_reason text,campaign_id uuid,price_area text,energy_direction text,settlement_type text,underlay_month int,underlay_year int,billing_period_start date,billing_period_end date,status text,readiness_status text,readiness_issues jsonb,total_kwh numeric,currency text,source_system text,source_meter_value_count int,missing_values_count int,payload jsonb,pricing_snapshot jsonb,received_at timestamptz,validated_at timestamptz,created_by uuid,updated_by uuid,updated_at timestamptz);
 create unique index segment_unique on public.billing_underlays(company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end,energy_direction);
 create table public.billing_underlay_items(id uuid primary key,billing_underlay_id uuid references public.billing_underlays(id),company_id uuid,source_normalized_metering_value_id uuid,quantity numeric,quantity_kwh numeric,unit text,product_code text,register_code text,period_start timestamptz,period_end timestamptz,created_at timestamptz,updated_at timestamptz);
 create table public.billing_underlay_events(company_id uuid,billing_underlay_id uuid,event_type text,message text,metadata jsonb,created_by uuid);
 create table public.fixture_contracts(company_id uuid,source_id uuid,tx text,contract jsonb);
 create function gridex_utilts_binding.stored_contract_v1(uuid,uuid,text) returns jsonb language sql as $$select contract from public.fixture_contracts where company_id=$1 and source_id=$2 and tx=$3$$;
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create table public.fixture_authorities(rule_available boolean,legal_available boolean);insert into public.fixture_authorities values(true,true);
 create or replace function gridex_ediel_source_rules.require_v1(uuid,uuid) returns jsonb language plpgsql as $$begin if not(select rule_available from public.fixture_authorities) then raise exception 'ediel_historical_rule_pack_basis_unavailable';end if;return '{"sourceHash":"fixture-original-only","version":"fixed-original"}';end$$;
 create function public.gridex_create_billing_export_run(jsonb,jsonb default '[]') returns jsonb language sql as $$select $1$$;`)
const wireOld = fs.readFileSync(root+'/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql','utf8')
await db.exec(wireOld.slice(wireOld.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),wireOld.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
const decimal = fs.readFileSync(root+'/supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql','utf8')
await db.exec(decimal.slice(decimal.indexOf('CREATE FUNCTION gridex_utilts_binding.canonical_decimal_v2'),decimal.indexOf('CREATE FUNCTION gridex_utilts_binding.validate_contract_v1')))
const oldGate = fs.readFileSync(root+'/supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql','utf8')
await db.exec(oldGate.slice(oldGate.indexOf('create or replace function public.gridex_set_metering_billing_gate'),oldGate.indexOf('-- Every underlay segment')))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql','utf8'))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930175405_ediel_billing_qualified_exact_source_basis.sql','utf8'))
if(!mainOnly)await db.exec(fs.readFileSync(root+'/supabase/migrations/20261022150000_supply_ending_billable.sql','utf8'))
if(!mainOnly)await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023196000_f108_ediel_billing_month.sql','utf8'))
// The pricing fixture of scripts/final-month-pricing-contract-sql-regression.mjs, then H3 (20261023199000).
await db.exec(`alter table public.billing_underlays add column invoice_readiness_status text, add column invoice_readiness_issues jsonb, add column calculated_total_sek_ex_vat numeric, add column calculated_vat_sek numeric, add column calculated_total_sek_inc_vat numeric;
 alter table public.customer_contracts add column contract_type text;
 create table public.pricing_runs(id uuid primary key default gen_random_uuid(),company_id uuid,billing_underlay_id uuid,customer_id uuid,billing_period_start timestamptz,billing_period_end timestamptz,status text,total_ex_vat numeric,vat_amount numeric,total_inc_vat numeric,warnings jsonb,errors jsonb,metadata jsonb,locked_at timestamptz,created_at timestamptz default now());
 create table public.pricing_preview_lines(id uuid primary key default gen_random_uuid(),company_id uuid,pricing_run_id uuid,billing_underlay_id uuid,line_type text,description text,quantity numeric,unit text,unit_price_ex_vat numeric,amount_ex_vat numeric,vat_rate numeric,vat_amount numeric,amount_inc_vat numeric,sort_order int,metadata jsonb);
 create table public.pricing_interval_evidence(id uuid primary key default gen_random_uuid(),company_id uuid,pricing_run_id uuid,billing_underlay_id uuid,billing_underlay_item_id uuid,customer_contract_id uuid,metering_interval_start timestamptz,metering_interval_end timestamptz,resolution text,consumption_kwh numeric,price_sek_per_kwh numeric,amount_ex_vat numeric,price_source_id uuid,price_area text,evidence_sha256 text);
 create table public.spot_price_intervals(id uuid primary key default gen_random_uuid(),source text,price_area text,time_start timestamptz,time_end timestamptz,price_sek_per_kwh numeric);
 create table public.company_market_price_sources(company_id uuid,source_key text,enabled boolean,supported_resolutions text[],priority int);
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;`)
const billing = fs.readFileSync(root+'/supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql','utf8')
await db.exec(billing.slice(billing.indexOf('create or replace function public.gridex_persist_pricing_run('),billing.indexOf('create or replace function public.gridex_lock_pricing_run(')))
await db.exec(`alter function public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) set search_path=public,extensions,pg_temp;
 revoke all on function public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) from public;grant execute on function public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) to service_role;`)
await db.exec(fs.readFileSync(root+'/supabase/migrations/20261013093922_ops_api_atomic_interval_pricing_snapshot.sql','utf8'))
const mainPersistDefinition=(await db.query("select pg_get_functiondef('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure) d")).rows[0].d
const exportSql = fs.readFileSync(root+'/supabase/migrations/20260716090000_production_settlement_export_completion.sql','utf8')
await db.exec(exportSql.slice(exportSql.indexOf('create view public.billing_export_readiness_v as'),exportSql.indexOf('from evaluated;')+'from evaluated;'.length))
await db.exec(`alter view public.billing_export_readiness_v set (security_invoker = true);revoke all on public.billing_export_readiness_v from public;grant select on public.billing_export_readiness_v to service_role;`)
if(!mainOnly)await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023199000_final_month_pricing_contract.sql','utf8'))


if(!mainOnly)await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023200000_move_out_final_month_billing.sql','utf8'));
const persistDefinition=(await db.query("select prosrc,pg_get_functiondef(oid) definition from pg_proc where oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure")).rows[0];
const protectorBefore=(await db.query("select prosrc from pg_proc where oid='gridex_billing_source.protect_underlay_v1()'::regprocedure")).rows[0].prosrc;
const persistMetadataBefore=(await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure")).rows[0].metadata;
if(!process.argv.includes('--pricing-original'))await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023232114_preserve_qualified_underlay_pricing_snapshot.sql','utf8'));
assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure")).rows[0].metadata,persistMetadataBefore);
assert.equal((await db.query("select prosrc from pg_proc where oid='gridex_billing_source.protect_underlay_v1()'::regprocedure")).rows[0].prosrc,protectorBefore);
const company=id(1),customer=id(3),point=id(5),contract=id(6),supply=first.supply_period_id,source=id(500),meter=id(501),value=id(502),price=id(503),priceVersion=id(504);
const start='2026-01-31T23:00:00Z',end='2026-02-15T23:00:00Z';
const raw="UNA:+.? 'UNB+UNOC:3+A:ZZ+B:ZZ+260220:1200+I++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'DTM+735:?+0100:406'IDE+24+OWN'LIN+++8716867000030:::9'LOC+172+735123456789012345::9'DTM+324:202602010000202602160000:719'DTM+354:360:805'MEA+AAZ++KWH'SEQ++1'RFF+AES:REG'QTY+136:361'UNT+12+1'UNZ+1+I'";
const observation={ordinal:0,sourceOrdinal:0,quantity:'361',periodStart:'2026-01-31T23:00:00.000Z',periodEnd:'2026-02-15T23:00:00.000Z',unit:'kWh',quality:'136',direction:'consumption',productCode:null,registerCode:null};
const consumptionContract={version:2,observations:[observation],metering:{capability:'write',customerId:customer,meteringPointId:point}};
await db.query("insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status) values($1,$2,'test','inbound','UTILTS','E66',$3,'validated')",[source,company,raw]);
await db.query('insert into public.fixture_contracts values($1,$2,$3,$4)',[company,source,'OWN',JSON.stringify(consumptionContract)]);
const rawPayload=JSON.stringify({consumptionContract,sourceOrdinal:0,edielMessageId:source});
await db.query(`insert into public.metering_values(id,company_id,customer_id,metering_point_id,value_kwh,period_start,period_end,unit,direction,quality_code,source_ediel_message_id,source_transaction_reference,is_current,revision_status,raw_payload) values($1,$2,$3,$4,361,$5,$6,'kWh','consumption','136',$7,'OWN',true,'current',$8)`,[meter,company,customer,point,start,end,source,rawPayload]);
await db.query(`insert into public.normalized_metering_values(id,company_id,customer_id,metering_point_id,source_metering_value_id,source_message_id,source_transaction_reference,quantity_kwh,period_start,period_end,unit,direction,quality_status,raw_payload,revision_status,revision_number,supply_period_id,billing_status,billing_gate_status) values($1,$2,$3,$4,$5,$6,'OWN',361,$7,$8,'kWh','consumption','136',$9,'current',1,$10,'billable','eligible')`,[value,company,customer,point,meter,source,start,end,rawPayload,supply]);
await db.query("insert into public.contract_price_snapshots values($1,$2,$3,$4,'{\"price\":\"original\"}','2026-01-01',null)",[price,company,contract,priceVersion]);
await db.query("insert into public.price_plan_versions values($1,$2,'active',now(),$3)",[priceVersion,company,'a'.repeat(64)]);
await db.query("update public.customer_contracts set contract_type='variable_quarterly' where id=$1",[contract]);
await db.query("insert into public.company_market_price_sources values($1,'nordpool',true,'{quarterly,hourly}',1)",[company]);
const checkOuterChain=async function(){
const service=async(sql,args)=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,args)}finally{await db.exec('RESET ROLE')}};
const gate={billing_status:'billable',billing_gate_status:'eligible',source_message_id:source,supply_period_id:supply,customer_id:customer};
await service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]);
const qualified=(await db.query('select gridex_billing_source.basis_v1($1,$2) b',[company,value])).rows[0].b;assert.equal(qualified.qualified,true);
const items=[{source_normalized_metering_value_id:value,quantity:'361',quantity_kwh:'361',unit:'kWh',product_code:qualified.productCode??null,register_code:qualified.registerCode??null,period_start:start,period_end:end}];
const underlay={customer_id:customer,metering_point_id:point,supply_period_id:supply,contract_id:contract,contract_price_snapshot_id:price,pricing_snapshot_id:price,price_plan_version_id:priceVersion,pricing_snapshot:{price:'original'},energy_direction:'consumption',underlay_year:2026,underlay_month:2,billing_period_start:start,billing_period_end:end,status:'validated',readiness_status:'ready',total_kwh:'361',price_area:'SE3',payload:{billing_month:'2026-02',billing_month_frame:'ediel_fixed_normal_time'}};
const uid=(await service('select public.gridex_store_billing_underlay($1,$2,$3,null) u',[company,underlay,JSON.stringify(items)])).rows[0].u;
const snapshot=(await db.query("select public.gridex_read_interval_pricing_snapshot_v1($1,$2,$3,$4,'SE3','quarterly',(select to_jsonb(b) from public.billing_underlays b where id=$2)) r",[company,uid,start,end])).rows[0].r;
assert.equal(snapshot.receipt.required_resolution,'quarterly');
const line={line_type:'base_price',description:'Spot',quantity:361,unit:'kWh',unit_price_ex_vat:1,amount_ex_vat:361,vat_rate:0.25,vat_amount:90.25,amount_inc_vat:451.25,sort_order:1,metadata:{source_type:'spot',weight_percent:100}};
try{await db.query("select public.gridex_persist_pricing_run($1,$2,$3,$4)",[company,uid,{status:'success',total_ex_vat:361,vat_amount:90.25,total_inc_vat:451.25,warnings:[],errors:[],lines:[line],interval_evidence:[],interval_input_snapshot:snapshot.receipt},{price:'original'}]);}catch(error){console.error(JSON.stringify({gate:true,store:true,pricingRead:true,persistError:error.message,sqlstate:error.code,callerSnapshot:{price:'original'},sourceBound:true}));throw error;}
assert.equal((await db.query('select invoice_readiness_status s from public.billing_underlays where id=$1',[uid])).rows[0].s,'ready_for_invoice');
assert.deepEqual((await db.query('select pricing_snapshot s from public.billing_underlays where id=$1',[uid])).rows[0].s,{price:'original'});
await db.query('select gridex_billing_source.require_underlay_v1($1,$2)',[company,uid]);
await db.exec('SAVEPOINT protected_snapshot');await assert.rejects(db.query('update public.billing_underlays set pricing_snapshot=$2 where id=$1',[uid,{forged:true}]),/billing_source_finalized_underlay_immutable/);await db.exec('ROLLBACK TO protected_snapshot');
const persistPayload={status:'failed',total_ex_vat:0,vat_amount:0,total_inc_vat:0,warnings:['fixture_warning'],errors:['fixture_error'],lines:[],interval_evidence:[]};
const failedRun=(await db.query('select public.gridex_persist_pricing_run($1,$2,$3,$4) r',[company,uid,persistPayload,{price:'original'}])).rows[0].r;
assert.deepEqual((await db.query('select pricing_snapshot s from public.billing_underlays where id=$1',[uid])).rows[0].s,{price:'original'});
assert.deepEqual((await db.query('select warnings,errors from public.pricing_runs where id=$1',[failedRun])).rows[0],{warnings:['fixture_warning'],errors:['fixture_error']});
await db.exec('SAVEPOINT wrong_snapshot');await assert.rejects(db.query('select public.gridex_persist_pricing_run($1,$2,$3,$4)',[company,uid,persistPayload,{price:'forged'}]),/source_bound_pricing_snapshot_mismatch/);await db.exec('ROLLBACK TO wrong_snapshot');
const beforeCount=(await db.query('select count(*)::int n from public.pricing_runs')).rows[0].n;
await db.exec("CREATE FUNCTION public.fixture_fail_pricing_line() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture_pricing_line_failure';END$$;CREATE TRIGGER fixture_fail_pricing_line BEFORE INSERT ON public.pricing_preview_lines FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_pricing_line()");
await db.exec('SAVEPOINT atomic');await assert.rejects(db.query('select public.gridex_persist_pricing_run($1,$2,$3,$4)',[company,uid,{...persistPayload,lines:[line]},{price:'original'}]),/fixture_pricing_line_failure/);await db.exec('ROLLBACK TO atomic');
assert.equal((await db.query('select count(*)::int n from public.pricing_runs')).rows[0].n,beforeCount);assert.deepEqual((await db.query('select pricing_snapshot s from public.billing_underlays where id=$1',[uid])).rows[0].s,{price:'original'});
await db.exec('DROP TRIGGER fixture_fail_pricing_line ON public.pricing_preview_lines;DROP FUNCTION public.fixture_fail_pricing_line()');
const unbound=id(505);
await db.query(`INSERT INTO public.billing_underlays SELECT (jsonb_populate_record(NULL::public.billing_underlays,to_jsonb(b)||jsonb_build_object('id',$2::text,'billing_period_start','2026-02-02','payload',b.payload||'{"billing_period_start_instant":"2026-02-01T23:00:00Z"}'::jsonb))).* FROM public.billing_underlays b WHERE b.id=$1`,[uid,unbound]);
await db.query('select public.gridex_persist_pricing_run($1,$2,$3,$4)',[company,unbound,{...persistPayload,status:'success',errors:[]},{price:'original'}]);
assert.ok((await db.query('select pricing_snapshot s from public.billing_underlays where id=$1',[unbound])).rows[0].s.latest_pricing_run_id);
await db.query('select public.gridex_persist_pricing_run($1,$2,$3,$4)',[company,unbound,persistPayload,{price:'original'}]);
assert.ok((await db.query('select pricing_snapshot s from public.billing_underlays where id=$1',[unbound])).rows[0].s.latest_failed_pricing_run_id);
await db.query("update public.pricing_runs set status='locked',locked_at=now() where billing_underlay_id=$1",[uid]);
const blockers=(await db.query('select blockers from public.billing_export_readiness_v where company_id=$1 and billing_underlay_id=$2',[company,uid])).rows[0].blockers;
assert.ok(!blockers.includes('exact_signed_contract_missing'));
return {gate:true,store:true,pricingRead:true,pricingPersist:true,boundSuccessAndFailureSnapshotPreserved:true,runDiagnosticsPreserved:true,mismatchedSnapshotRejected:true,atomicRollback:true,unboundSuccessAndFailureUnchanged:true,sourceProtectorUnchanged:true,sourceBindingStillQualified:true,functionMetadataUnchanged:true,exportContractAccepted:true,otherExportBlockers:blockers};
};checkOuterChain.mainPersistDefinition=mainPersistDefinition;return checkOuterChain;}

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
 ALTER TABLE public.customer_contracts ADD COLUMN starts_at timestamptz DEFAULT '2025-12-01',ADD COLUMN binding_months int DEFAULT 0,ADD COLUMN termination_notice_date timestamptz,ADD COLUMN withdrawal_requested_at timestamptz,ADD COLUMN rejected_reason text,ADD COLUMN status_reason_code text,ADD COLUMN metadata jsonb DEFAULT '{}',ADD COLUMN updated_by uuid,ADD COLUMN updated_at timestamptz;
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

 const root=fileURLToPath(new URL('..',import.meta.url));
 const schema=readFileSync(root+'/supabase/schema.sql','utf8');
 // The new canonical schema contains patched commands. Restore only the exact
 // immutable predecessor bodies embedded in our guarded migration so this
 // isolated regression starts before the repair. All other actual source
 // functions continue to come directly from the canonical schema.
 const receiptPath=root+'/supabase/migrations/20261023232113_qualified_manual_billing_continuation.sql';
 const predecessorBodies=new Map();
 if(fs.existsSync(receiptPath)){
  const migrationSource=readFileSync(receiptPath,'utf8');
  const pattern=/DO \$guard\$ DECLARE f record;b text;needle constant text:=\$needle\$([\s\S]*?)\$needle\$;replacement constant text:=\$replacement\$[\s\S]*?\$replacement\$;\nBEGIN\n SELECT[^\n]*WHERE oid='([^']+)'::regprocedure;/g;
  for(const match of migrationSource.matchAll(pattern))predecessorBodies.set(match[2].split('(')[0],match[1]);
  assert.equal(predecessorBodies.size,3,'exact command/billing predecessor fixture anchors');
 }
 const exactFn=name=>{
  const start=schema.indexOf('CREATE FUNCTION '+name+'(');assert.ok(start>=0,name);
  const opening=/\bAS (\$[^$]*\$)/.exec(schema.slice(start));assert.ok(opening,name);
  const bodyStart=start+opening.index+opening[0].length,tag=opening[1],bodyEnd=schema.indexOf(tag+';',bodyStart);assert.ok(bodyEnd>bodyStart,name);
  return schema.slice(start,bodyStart)+(predecessorBodies.get(name)??schema.slice(bodyStart,bodyEnd))+tag+';';
 };

 const currentSource=exactFn('gridex_received_sources.supply_period_source_basis_v1')
 const billingSource=exactFn('gridex_received_sources.billing_supply_basis_v1')
 await db.exec(currentSource.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 await db.exec(billingSource.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 const currentBasis=async()=>(await db.query('SELECT gridex_received_sources.billing_supply_basis_v1($1,$2,$3,$4) b',[id(1),first.supply_period_id,'2026-01-01T12:30Z','2026-01-02T00:00Z'])).rows[0].b

 await db.exec('CREATE SCHEMA gridex_supply_rescission;CREATE SCHEMA gridex_ediel_retention;CREATE TABLE gridex_ediel_retention.blob_tombstones(company_id uuid,message_id uuid)');
 for(const name of ['gridex_bilateral_prodat.supply_effect_receipts','gridex_supply_rescission.end_receipts','gridex_supply_rescission.mandates']){const a=schema.indexOf('CREATE TABLE '+name+' ('),b=schema.indexOf('\n);',a);assert.ok(a>0&&b>a);await db.exec(schema.slice(a,b+3));}
 await db.exec('CREATE FUNCTION gridex_supply_rescission.lock_original_v1() RETURNS void LANGUAGE sql AS $$SELECT$$');
 for(const name of ['public.ediel_require_source_bytes_available_v1','gridex_supply_rescission.has_end_selector_v1','gridex_supply_rescission.recorded_end_current_v1','gridex_bilateral_prodat.recorded_supply_current_v1','public.gridex_record_customer_contract_event_v1','public.gridex_end_customer_supply_v1','public.gridex_close_customer_lifecycle_v1'])await db.exec(exactFn(name).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
 await db.exec("CREATE OR REPLACE FUNCTION gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'unexpected_regulated_source_in_normal_fixture';END$$");

 const checkOuterChain=await installOuterChain(db,id,first,{mainOnly:true});
 await db.exec('BEGIN');
 const pricingOutcome=await checkOuterChain();
 await db.exec('ROLLBACK');
 console.log(JSON.stringify({scope:'Actual normal source-qualified gate/store/read/persist/export and canonical-main pricing body; explicit legal/permission fixture ports. Source snapshot guard unchanged. No production/native/invoice execution.',result:pricingOutcome}));
}finally{await db.close()}
