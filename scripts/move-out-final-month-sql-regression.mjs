// reality-defects: H3 (H3b: the final month after a manual move-out is gated, stored, priced and exported under the Z05 rule; owner decision 2026-10-23)
// The whole database billing chain for the final month, on the protected billing fixture of
// scripts/f108-ediel-billing-month-sql-regression.mjs and scripts/final-month-pricing-contract-sql-regression.mjs (same
// fixture schema and authorities, PGlite, synthetic rows; the real gate, store, pricing readers and export view are
// installed from their migrations up to 20261023199000). The customer was supplied from 1 October (Z04) and moved out
// on 15 November (a winter month, so the Ediel month and the civil month coincide). The manual move-out wrote what
// gridex_end_customer_supply_v1(p_end_reason 'move_out') and gridex_close_customer_lifecycle_v1 write:
//   period end_date (and actual_end_date) = 2026-11-15, the last supplied day, no market_end_at;
//   contract status 'terminated', termination_reason 'move_out', ended_at = '2026-11-15'::timestamptz.
// The grid owner's E66 for the supplied part of November [2026-10-31T23:00Z, 2026-11-15T23:00Z) is qualified.
//   shipped bodies: the gate and the store refuse the value and the ready underlay (contract scope), the interval
//     pricing read refuses the final underlay (selector mismatch), persist skips the interval receipt, and the export
//     view blocks the locked final underlay with exact_signed_contract_missing;
//   after 20261023200000: all five accept exactly the contract the move-out ended on this period's end date, for a
//     billed period inside the supplied window; another reason, another date, another tenant/contract and a period
//     past the move-out stay refused, and a Z05 'supply_end' contract is unchanged.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/move-out-final-month-sql-regression.mjs [--old]
//   --old runs the post-migration assertions on the shipped bodies (they fail: the defect).
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const company = '11111111-1111-4111-8111-111111111111', other = '12121212-1212-4212-8212-121212121212', source = '22222222-2222-4222-8222-222222222222', value = '33333333-3333-4333-8333-333333333333'
const meter = '44444444-4444-4444-8444-444444444444', customer = '55555555-5555-4555-8555-555555555555', point = '66666666-6666-4666-8666-666666666666', supply = '77777777-7777-4777-8777-777777777777'
const contract = '88888888-8888-4888-8888-888888888888', price = '99999999-9999-4999-8999-999999999999', priceVersion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherContract = '8888aaaa-8888-4888-8888-888888888888'
const nov = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', item = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const migration = fs.readFileSync(root+'/supabase/migrations/20261023200000_move_out_final_month_billing.sql','utf8')
const NOV = { start: '2026-10-31T23:00:00+00:00', end: '2026-11-15T23:00:00+00:00' }
const raw = "UNA:+.? 'UNB+UNOC:3+A:ZZ+B:ZZ+261120:1200+I++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'DTM+735:?+0100:406'IDE+24+OWN'LIN+++8716867000030:::9'LOC+172+735999260731000007::9'DTM+324:202611010000202611160000:719'DTM+354:360:805'M EA'".replace("M EA'", "MEA+AAZ++KWH'SEQ++1'RFF+AES:REG'QTY+136:361'UNT+12+1'UNZ+1+I'")
const observation = { ordinal: 0, sourceOrdinal: 0, quantity: '361', periodStart: '2026-10-31T23:00:00.000Z', periodEnd: '2026-11-15T23:00:00.000Z', unit: 'kWh', quality: '136', direction: 'consumption', productCode: null, registerCode: null }
const consumptionContract = { version: 2, observations: [observation], metering: { capability: 'write', customerId: customer, meteringPointId: point } }
let count = 0
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;create schema gridex_received_sources; create table gridex_received_sources.supply_source_transitions(source_message_id uuid,company_id uuid,resulting_states jsonb);create schema gridex_ediel_source_rules;
 create function public.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,status text);
 create table public.metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,value_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_code text,source_ediel_message_id uuid,source_transaction_reference text,is_current boolean,revision_status text,raw_payload jsonb,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz);
 create table public.normalized_metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,source_metering_value_id uuid,source_message_id uuid,source_transaction_reference text,quantity_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_status text,product_code text,register_code text,raw_payload jsonb,revision_status text,revision_number int,previous_value_id uuid,supply_period_id uuid,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz,updated_at timestamptz);
 create table public.customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,status text,start_date date,end_date date);
 create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text,starts_at date,ends_at date);
 create table public.contract_price_snapshots(id uuid primary key,company_id uuid,contract_id uuid,price_plan_version_id uuid,snapshot_json jsonb,valid_from date,valid_to date);
 create table public.price_plan_versions(id uuid primary key,company_id uuid,status text,locked_at timestamptz,content_sha256 text);
 create table public.customers(id uuid primary key,company_id uuid);create table public.metering_points(id uuid primary key,company_id uuid);
 create table public.billing_underlays(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,supply_period_id uuid,contract_id uuid,pricing_snapshot_id uuid,price_plan_id uuid,price_plan_version_id uuid,price_book_id uuid,contract_price_snapshot_id uuid,billing_block_reason text,campaign_id uuid,price_area text,energy_direction text,settlement_type text,underlay_month int,underlay_year int,billing_period_start date,billing_period_end date,status text,readiness_status text,readiness_issues jsonb,total_kwh numeric,currency text,source_system text,source_meter_value_count int,missing_values_count int,payload jsonb,pricing_snapshot jsonb,received_at timestamptz,validated_at timestamptz,created_by uuid,updated_by uuid,updated_at timestamptz);
 create unique index segment_unique on public.billing_underlays(company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end,energy_direction);
 create table public.billing_underlay_items(id uuid primary key,billing_underlay_id uuid references public.billing_underlays(id),company_id uuid,source_normalized_metering_value_id uuid,quantity numeric,quantity_kwh numeric,unit text,product_code text,register_code text,period_start timestamptz,period_end timestamptz,created_at timestamptz,updated_at timestamptz);
 create table public.billing_underlay_events(company_id uuid,billing_underlay_id uuid,event_type text,message text,metadata jsonb,created_by uuid);
 create table public.fixture_contracts(company_id uuid,source_id uuid,tx text,contract jsonb);
 create function gridex_utilts_binding.stored_contract_v1(uuid,uuid,text) returns jsonb language sql as $$select contract from public.fixture_contracts where company_id=$1 and source_id=$2 and tx=$3$$;
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create table public.fixture_authorities(rule_available boolean,legal_available boolean);insert into public.fixture_authorities values(true,true);
 create function gridex_ediel_source_rules.require_v1(uuid,uuid) returns jsonb language plpgsql as $$begin if not(select rule_available from public.fixture_authorities) then raise exception 'ediel_historical_rule_pack_basis_unavailable';end if;return '{"sourceHash":"fixture-original-only","version":"fixed-original"}';end$$;
 create function gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) returns jsonb language sql as $$select case when legal_available then jsonb_build_object('qualified',true,'periodId',$2,'marketStateVersion',1) else null end from public.fixture_authorities$$;
 create function public.gridex_create_billing_export_run(jsonb,jsonb default '[]') returns jsonb language sql as $$select $1$$;`)
const wireOld = fs.readFileSync(root+'/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql','utf8')
await db.exec(wireOld.slice(wireOld.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),wireOld.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
const decimal = fs.readFileSync(root+'/supabase/migrations/20260930145350_ediel_utilts_exact_decimal_contract_v2.sql','utf8')
await db.exec(decimal.slice(decimal.indexOf('CREATE FUNCTION gridex_utilts_binding.canonical_decimal_v2'),decimal.indexOf('CREATE FUNCTION gridex_utilts_binding.validate_contract_v1')))
const oldGate = fs.readFileSync(root+'/supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql','utf8')
await db.exec(oldGate.slice(oldGate.indexOf('create or replace function public.gridex_set_metering_billing_gate'),oldGate.indexOf('-- Every underlay segment')))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260901152500_canonicalize_billing_underlay_stockholm_period_semantics.sql','utf8'))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930175405_ediel_billing_qualified_exact_source_basis.sql','utf8'))
await db.exec(`alter table public.customer_supply_periods add column market_start_at timestamptz, add column market_end_at timestamptz, add column actual_end_date date;
 alter table public.customer_contracts add column termination_reason text, add column ended_at timestamptz;`)
await db.exec(fs.readFileSync(root+'/supabase/migrations/20261022150000_supply_ending_billable.sql','utf8'))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023196000_f108_ediel_billing_month.sql','utf8'))
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
const exportSql = fs.readFileSync(root+'/supabase/migrations/20260716090000_production_settlement_export_completion.sql','utf8')
await db.exec(exportSql.slice(exportSql.indexOf('create view public.billing_export_readiness_v as'),exportSql.indexOf('from evaluated;')+'from evaluated;'.length))
await db.exec(`alter view public.billing_export_readiness_v set (security_invoker = true);revoke all on public.billing_export_readiness_v from public;grant select on public.billing_export_readiness_v to service_role;`)
await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023199000_final_month_pricing_contract.sql','utf8'))

// Synthetic rows: the qualified E66 for 1-15 November, the moved-out period and its move-out contract.
await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7,$8)',[source,company,'test','inbound','UTILTS','E66',raw,'validated'])
await db.query('insert into public.fixture_contracts values($1,$2,$3,$4)',[company,source,'OWN',JSON.stringify(consumptionContract)])
const rawPayload = JSON.stringify({consumptionContract, sourceOrdinal:0, edielMessageId:source})
await db.query(`insert into public.metering_values(id,company_id,customer_id,metering_point_id,value_kwh,period_start,period_end,unit,direction,quality_code,source_ediel_message_id,source_transaction_reference,is_current,revision_status,raw_payload) values($1,$2,$3,$4,$5,$6,$7,'kWh','consumption','136',$8,'OWN',true,'current',$9)`,[meter,company,customer,point,observation.quantity,observation.periodStart,observation.periodEnd,source,rawPayload])
await db.query(`insert into public.normalized_metering_values(id,company_id,customer_id,metering_point_id,source_metering_value_id,source_message_id,source_transaction_reference,quantity_kwh,period_start,period_end,unit,direction,quality_status,raw_payload,revision_status,revision_number,supply_period_id,billing_status,billing_gate_status) values($1,$2,$3,$4,$5,$6,'OWN',$7,$8,$9,'kWh','consumption','136',$10,'current',1,$11,'billable','eligible')`,[value,company,customer,point,meter,source,observation.quantity,observation.periodStart,observation.periodEnd,rawPayload,supply])
await db.exec(`insert into public.customers values('${customer}','${company}');insert into public.metering_points values('${point}','${company}');
 insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,status,start_date,end_date,actual_end_date,market_start_at) values('${supply}','${company}','${customer}','${point}','${contract}','ended','2026-10-01','2026-11-15','2026-11-15','2026-09-30T22:00:00Z');
 insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,status,starts_at,termination_reason,ended_at,contract_type) values('${contract}','${company}','${customer}','${point}','terminated','2026-10-01','move_out','2026-11-15T00:00:00Z','variable_quarterly');
 insert into public.contract_price_snapshots values('${price}','${company}','${contract}','${priceVersion}','{"price":"original"}','2026-10-01',null);
 insert into public.price_plan_versions values('${priceVersion}','${company}','active',now(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
 insert into public.company_market_price_sources values('${company}','nordpool',true,'{quarterly,hourly}',1);`)

async function service(sql,args=[]){await db.exec('set role service_role');try{return await db.query(sql,args)}finally{await db.exec('reset role')}}
const rejects = async (fn, pattern) => { await assert.rejects(fn, pattern); count++ }
const ok = async (fn) => { const r = await fn(); count++; return r }
const gate = {billing_status:'billable',billing_gate_status:'eligible',source_message_id:source,supply_period_id:supply,customer_id:customer}
const setGate = () => service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate])
const qualified = (await db.query('select gridex_billing_source.basis_v1($1,$2) b',[company,value])).rows[0].b
assert.equal(qualified.qualified, true, JSON.stringify(qualified))
const items = [{source_normalized_metering_value_id:value,quantity:observation.quantity,quantity_kwh:observation.quantity,unit:'kWh',product_code:qualified.productCode??null,register_code:qualified.registerCode??null,period_start:NOV.start,period_end:NOV.end}]
const storeUnderlay = {customer_id:customer,metering_point_id:point,supply_period_id:supply,contract_id:contract,contract_price_snapshot_id:price,pricing_snapshot_id:price,
 price_plan_version_id:priceVersion,pricing_snapshot:{price:'original'},energy_direction:'consumption',underlay_year:2026,underlay_month:11,billing_period_start:NOV.start,billing_period_end:NOV.end,
 status:'validated',readiness_status:'ready',total_kwh:observation.quantity,payload:{billing_month:'2026-11',billing_month_frame:'ediel_fixed_normal_time'}}
const store = () => service('select public.gridex_store_billing_underlay($1,$2,$3,null)',[company,storeUnderlay,JSON.stringify(items)])
const resetUnderlays = () => db.exec("set session_replication_role=replica;delete from public.pricing_interval_evidence;delete from public.pricing_preview_lines;delete from public.pricing_runs;delete from public.billing_underlay_items;delete from public.billing_underlay_events;delete from gridex_billing_source.underlay_bindings;delete from public.billing_underlays;set session_replication_role=origin")
// The ready final underlay as the store writes it, for the pricing readers and the export view.
const pricingUnderlay = async () => {
  await resetUnderlays()
  await db.query(`insert into public.billing_underlays(id,company_id,customer_id,metering_point_id,supply_period_id,contract_id,contract_price_snapshot_id,pricing_snapshot_id,pricing_snapshot,energy_direction,underlay_year,underlay_month,billing_period_start,billing_period_end,status,readiness_status,total_kwh,price_area,payload)
   values($1,$2,$3,$4,$5,$6,$7,$7,'{"price":"original"}','consumption',2026,11,'2026-11-01','2026-11-16','validated','ready',361,'SE3',$8)`,
   [nov,company,customer,point,supply,contract,price,{billing_month:'2026-11',billing_month_frame:'ediel_fixed_normal_time',billing_period_start_instant:NOV.start,billing_period_end_instant:NOV.end,billing_period_timezone:'Europe/Stockholm',billing_period_end_exclusive:true}])
  await db.query(`insert into public.billing_underlay_items(id,billing_underlay_id,company_id,quantity,quantity_kwh,unit,period_start,period_end) values($1,$2,$3,361,361,'kWh',$4,$5)`,[item,nov,company,NOV.start,NOV.end])
}
const read = () => db.query(`select public.gridex_read_interval_pricing_snapshot_v1($1,$2,$3,$4,'SE3','quarterly',(select to_jsonb(b) from public.billing_underlays b where b.id=$2)) r`,[company,nov,NOV.start,NOV.end])
const spotLine = { line_type:'base_price', description:'Spot', quantity:361, unit:'kWh', unit_price_ex_vat:1, amount_ex_vat:361, vat_rate:0.25, vat_amount:90.25, amount_inc_vat:451.25, sort_order:1, metadata:{ source_type:'spot', weight_percent:100 } }
const persist = (receipt) => db.query(`select public.gridex_persist_pricing_run($1,$2,$3,'{}') r`,[company,nov,{ status:'success', total_ex_vat:361, vat_amount:90.25, total_inc_vat:451.25, warnings:[], errors:[], lines:[spotLine], interval_evidence:[], ...(receipt ? { interval_input_snapshot: receipt } : {}) }])
const lockRun = () => db.query(`insert into public.pricing_runs(company_id,billing_underlay_id,customer_id,billing_period_start,billing_period_end,status,locked_at) values($1,$2,$3,$4,$5,'locked',now())`,[company,nov,customer,NOV.start,NOV.end])
const blockers = async () => (await db.query(`select blockers from public.billing_export_readiness_v where company_id=$1 and billing_underlay_id=$2`,[company,nov])).rows[0].blockers
const setContract = (fields = {}) => db.query(`update public.customer_contracts set company_id=$1,status=$2,termination_reason=$3,ended_at=$4 where id=$5`,[fields.company??company,fields.status??'terminated','reason' in fields?fields.reason:'move_out','endedAt' in fields?fields.endedAt:'2026-11-15T00:00:00Z',contract])
// gridex_end_customer_supply_v1 ends the period ('ended', actual_end_date); gridex_close_customer_lifecycle_v1 plans it.
const endSupply = { status:'ended', end:'2026-11-15', actualEnd:'2026-11-15' }, lifecycleClose = { status:'active', end:'2026-11-15', actualEnd:null }
const setSupply = (fields = endSupply) => db.query(`update public.customer_supply_periods set company_id=$1,contract_id=$2,status=$3,end_date=$4,actual_end_date=$5,market_end_at=$6 where id=$7`,
  [fields.company??company,fields.contract??contract,fields.status,fields.end,fields.actualEnd??null,fields.marketEnd??null,supply])
const fnMeta = async () => (await db.query(`select p.proname, to_jsonb(p)-'prosrc'-'oid' m from pg_proc p where p.proname in('gridex_set_metering_billing_gate','gridex_store_billing_underlay','gridex_read_interval_pricing_snapshot_v1','gridex_persist_pricing_run') and p.pronamespace='public'::regnamespace order by 1`)).rows
const viewMeta = async () => (await db.query(`select c.relowner::regrole::text o,c.relacl::text a,c.reloptions::text r,(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0) cols from pg_class c where c.oid='public.billing_export_readiness_v'::regclass`)).rows[0]
const metaBefore = await fnMeta(), viewBefore = await viewMeta()

// Defect evidence on the shipped bodies: the move-out contract carries nothing of the final month.
for (const period of [endSupply, lifecycleClose]) {
  await setSupply(period); await setContract()
  await rejects(setGate, /billing_gate_supply_contract_scope_mismatch/)
  await rejects(store, /billing_underlay_supply_contract_price_basis_required/)
}
await setSupply(); await pricingUnderlay()
await rejects(() => read(), /interval_pricing_snapshot_underlay_selector_mismatch/)
await persist(null); count++
assert.equal((await db.query(`select count(*)::int n from public.pricing_runs where billing_underlay_id=$1 and status='success'`,[nov])).rows[0].n, 1); count++
await pricingUnderlay(); await lockRun()
assert.ok((await blockers()).includes('exact_signed_contract_missing')); count++
console.log(`Shipped gate/store/pricing/export refuse the final month after a manual move-out (H3b): ${count} PASS (persist accepted a run without the interval receipt)`)
const before = count

if (!process.argv.includes('--old')) await db.exec(migration)
// The final month is accepted, for both move-out writers.
for (const period of [endSupply, lifecycleClose]) {
  await resetUnderlays(); await setSupply(period); await setContract()
  await ok(setGate)
  await ok(store)
  const stored = (await db.query(`select billing_period_start::text s,billing_period_end::text e,contract_id from public.billing_underlays`)).rows
  assert.deepEqual(stored, [{ s:'2026-11-01', e:'2026-11-16', contract_id:contract }]); count++
}
await setSupply(); await pricingUnderlay()
const snapshot = (await ok(() => read())).rows[0].r
assert.equal(snapshot.receipt.required_resolution, 'quarterly'); count++
await rejects(() => persist(null), /interval_pricing_snapshot_receipt_required/)
await ok(() => persist(snapshot.receipt))
assert.equal((await db.query(`select invoice_readiness_status s from public.billing_underlays where id=$1`,[nov])).rows[0].s, 'ready_for_invoice'); count++
await pricingUnderlay(); await lockRun()
assert.ok(!(await blockers()).includes('exact_signed_contract_missing')); count++
// ended_at at Stockholm midnight (23:00Z the day before in winter) is the same move-out date.
await setContract({ endedAt: '2026-11-14T23:00:00Z' }); await ok(setGate); await ok(() => read()); assert.ok(!(await blockers()).includes('exact_signed_contract_missing')); count++
// Unchanged: a Z05 supply end on the same date and an active contract.
await setContract({ reason: 'supply_end' }); await ok(setGate); await ok(() => read())
await setContract({ status: 'active', reason: null, endedAt: null }); await ok(setGate); await ok(() => read())

// Refusals: every one keeps the gate, the store, the pricing read and the export view closed.
const refused = async (label) => {
  await resetUnderlays()
  await rejects(setGate, /billing_gate_supply_contract_scope_mismatch/)
  await rejects(store, /billing_underlay_supply_contract_price_basis_required/)
  await pricingUnderlay(); await lockRun()
  await rejects(() => read(), /interval_pricing_snapshot_underlay_selector_mismatch/)
  assert.ok((await blockers()).includes('exact_signed_contract_missing'), label); count++
}
await setContract({ reason: 'supplier_switch' }); await refused('the manual supplier-switch end')
await setContract({ reason: 'customer_request' }); await refused('another termination reason')
await setContract({ reason: null }); await refused('no termination reason')
await setContract({ reason: 'MOVE_OUT' }); await refused('not the exact reason')
await setContract({ endedAt: '2026-11-10T00:00:00Z' }); await refused('a move-out on another date')
await setContract({ endedAt: null }); await refused('a move-out without ended_at')
await setContract({ status: 'cancelled' }); await refused('cancelled')
await setContract({ status: 'expired' }); await refused('expired')
await setContract({ company: other }); await refused("another tenant's contract")
await setContract()
await setSupply({ ...endSupply, contract: otherContract }); await refused('a period of another contract')
await setSupply({ ...endSupply, status: 'cancelled' }); await refused('a cancelled period')
// A move-out one day earlier (14 November) ends before the billed period ends (civil midnight 2026-11-14T23:00Z).
await setSupply({ ...endSupply, end: '2026-11-14', actualEnd: '2026-11-14' }); await setContract({ endedAt: '2026-11-14T00:00:00Z' }); await refused('billed period past the move-out')
await setSupply(); await setContract()

// The rule is text-identical in the four functions, metadata is preserved, and a second run is refused.
const bodies = (await db.query(`select proname,prosrc from pg_proc where proname in('gridex_read_interval_pricing_snapshot_v1','gridex_persist_pricing_run','gridex_set_metering_billing_gate','gridex_store_billing_underlay')`)).rows
const newClause = /new_status constant text := \$c\$([\s\S]*?)\$c\$;/.exec(migration)[1]
assert.equal(bodies.length, 4); assert.ok(bodies.every(row => row.prosrc.split(newClause).length === 2 && !row.prosrc.includes("termination_reason='supply_end'"))); count++
assert.deepEqual(await fnMeta(), metaBefore); count++
assert.deepEqual(await viewMeta(), viewBefore); assert.equal(viewBefore.r, '{security_invoker=true}'); count++
await rejects(() => db.exec(migration), /move_out_final_month_rule_source_changed/)
await db.exec('rollback')
console.log(`Gate/store/pricing/export after 20261023200000 (H3b move-out final month, identical rule): ${count - before} PASS`)
} finally { await db.close() }
