import {originalIO as fs} from './h3-fixture-io.mjs';import assert from 'node:assert/strict';
export async function installOuterChain(db,id,first,{mainOnly=false}={}){
const root='fixture-input';
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
if(!mainOnly)fs.writeFileSync(root+'/h3b-installed-persist-definition.json',JSON.stringify(persistDefinition,null,2));
const protectorBefore=(await db.query("select prosrc from pg_proc where oid='gridex_billing_source.protect_underlay_v1()'::regprocedure")).rows[0].prosrc;
const persistMetadataBefore=(await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure")).rows[0].metadata;
if(!process.argv.includes('--pricing-original'))await db.exec(fs.readFileSync(root+'/20261023232114_preserve_qualified_underlay_pricing_snapshot.sql','utf8'));
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
// Mirror exact table ACLs from pinned canonical schema for invoker-view reads.
await db.exec('GRANT ALL ON TABLE public.customer_contracts,public.customer_supply_periods,public.billing_underlays,public.billing_underlay_items,public.contract_price_snapshots,public.pricing_interval_evidence,public.pricing_preview_lines,public.pricing_runs TO service_role');
const checkOuterChain=async function(){
const service=async(sql,args)=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,args)}finally{try{await db.exec('RESET ROLE')}catch{}}};
const gate={billing_status:'billable',billing_gate_status:'eligible',source_message_id:source,supply_period_id:supply,customer_id:customer};
await service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]);
const qualified=(await db.query('select gridex_billing_source.basis_v1($1,$2) b',[company,value])).rows[0].b;assert.equal(qualified.qualified,true);
const serverValueRows=(await service('select public.gridex_read_billing_source_values_v1($1,$2) r',[company,[value]])).rows[0].r;
const items=[{source_normalized_metering_value_id:value,quantity:'361',quantity_kwh:'361',unit:'kWh',product_code:qualified.productCode??null,register_code:qualified.registerCode??null,period_start:start,period_end:end}];
const underlay={customer_id:customer,metering_point_id:point,supply_period_id:supply,contract_id:contract,contract_price_snapshot_id:price,pricing_snapshot_id:price,price_plan_version_id:priceVersion,pricing_snapshot:{price:'original'},energy_direction:'consumption',underlay_year:2026,underlay_month:2,billing_period_start:start,billing_period_end:end,status:'validated',readiness_status:'ready',total_kwh:'361',price_area:'SE3',payload:{billing_month:'2026-02',billing_month_frame:'ediel_fixed_normal_time'}};
const uid=(await service('select public.gridex_store_billing_underlay($1,$2,$3,null) u',[company,underlay,JSON.stringify(items)])).rows[0].u;
const snapshot=(await db.query("select public.gridex_read_interval_pricing_snapshot_v1($1,$2,$3,$4,'SE3','quarterly',(select to_jsonb(b) from public.billing_underlays b where id=$2)) r",[company,uid,start,end])).rows[0].r;
assert.equal(snapshot.receipt.required_resolution,'quarterly');
const line={line_type:'base_price',description:'Spot',quantity:361,unit:'kWh',unit_price_ex_vat:1,amount_ex_vat:361,vat_rate:0.25,vat_amount:90.25,amount_inc_vat:451.25,sort_order:1,metadata:{source_type:'spot',weight_percent:100}};
try{await db.query("select public.gridex_persist_pricing_run($1,$2,$3,$4)",[company,uid,{status:'success',total_ex_vat:361,vat_amount:90.25,total_inc_vat:451.25,warnings:[],errors:[],lines:[line],interval_evidence:[],interval_input_snapshot:snapshot.receipt},{price:'original'}]);}catch(error){fs.writeFileSync(root+'/bound-pricing-red.json',JSON.stringify({gate:true,store:true,pricingRead:true,persistError:error.message,sqlstate:error.code,callerSnapshot:{price:'original'},sourceBound:true},null,2));throw error;}
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
const blockers=(await service('select blockers from public.billing_export_readiness_v where company_id=$1 and billing_underlay_id=$2',[company,uid])).rows[0].blockers;
assert.ok(!blockers.includes('exact_signed_contract_missing'));
const serverUnderlayRows=(await service('select public.gridex_read_billing_underlay_source_basis_v1($1,$2) r',[company,[uid]])).rows[0].r;
const persistedUnderlay=(await db.query('select to_jsonb(b) b from public.billing_underlays b where id=$1',[uid])).rows[0].b;
return {persistedUnderlay,serverValueRows,serverUnderlayRows,gate:true,store:true,pricingRead:true,pricingPersist:true,boundSuccessAndFailureSnapshotPreserved:true,runDiagnosticsPreserved:true,mismatchedSnapshotRejected:true,atomicRollback:true,unboundSuccessAndFailureUnchanged:true,sourceProtectorUnchanged:true,sourceBindingStillQualified:true,functionMetadataUnchanged:true,exportContractAccepted:true,otherExportBlockers:blockers};
};checkOuterChain.mainPersistDefinition=mainPersistDefinition;return checkOuterChain;}
