// reality-defects: F108 (billing month = Ediel month for Ediel-qualified supply, owner decision 2026-10-23; M5, H2/H3 store variant)
// The database billing boundary around an Ediel-month value, on the protected billing input boundary of
// scripts/ediel-billing-source-sql-regression.mjs and scripts/supply-ending-billable-sql-regression.mjs (same fixture
// schema and authorities, PGlite, synthetic rows). The value is the grid owner's monthly E66 for July 2026 in fixed
// normal time (DTM+735 +0100): [2026-06-30T23:00Z, 2026-07-31T23:00Z), i.e. the Ediel month July.
// The period was started by a Z04 (market_start_at 2026-06-30T23:00Z) and ended by a Z05 DTM+93 202608010000
// (end_date 2026-08-01, market_end_at 2026-07-31T23:00Z); the supply-end follow-up terminated the contract.
// Run before and after migration 20261023196000_f108_ediel_billing_month.sql:
//   before: the gate refuses the value (its last hour 22:00Z-23:00Z lies after civil midnight, M5), and the store
//           refuses the ready underlay of the ended period (H2/H3 store variant) and a price/contract ending 31 July;
//   after:  both accept exactly the Ediel month; manual (civil) periods and everything outside stay refused.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/f108-ediel-billing-month-sql-regression.mjs [--before]
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const company = '11111111-1111-4111-8111-111111111111', source = '22222222-2222-4222-8222-222222222222', value = '33333333-3333-4333-8333-333333333333', meter = '44444444-4444-4444-8444-444444444444', customer = '55555555-5555-4555-8555-555555555555', point = '66666666-6666-4666-8666-666666666666', supply = '77777777-7777-4777-8777-777777777777', contract = '88888888-8888-4888-8888-888888888888', price = '99999999-9999-4999-8999-999999999999', priceVersion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let count = 0
const raw = "UNA:+.? 'UNB+UNOC:3+A:ZZ+B:ZZ+260930:1200+I++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'DTM+735:?+0100:406'IDE+24+OWN'LIN+++8716867000030:::9'LOC+172+735999260731000007::9'DTM+324:202607010000202608010000:719'DTM+354:1:802'M EA'".replace("M EA'", "MEA+AAZ++KWH'SEQ++1'RFF+AES:REG'QTY+136:9007199254740993'UNT+12+1'UNZ+1+I'")
const observation = { ordinal: 0, sourceOrdinal: 0, quantity: '9007199254740993', periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-07-31T23:00:00.000Z', unit: 'kWh', quality: '136', direction: 'consumption', productCode: null, registerCode: null }
const consumptionContract = { version: 2, observations: [observation], metering: { capability: 'write', customerId: customer, meteringPointId: point } }
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
await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7,$8)',[source,company,'test','inbound','UTILTS','E66',raw,'validated'])
await db.query('insert into public.fixture_contracts values($1,$2,$3,$4)',[company,source,'OWN',JSON.stringify(consumptionContract)])
const rawPayload = JSON.stringify({consumptionContract, sourceOrdinal:0, edielMessageId:source})
await db.query(`insert into public.metering_values(id,company_id,customer_id,metering_point_id,value_kwh,period_start,period_end,unit,direction,quality_code,source_ediel_message_id,source_transaction_reference,is_current,revision_status,raw_payload) values($1,$2,$3,$4,$5,$6,$7,'kWh','consumption','136',$8,'OWN',true,'current',$9)`,[meter,company,customer,point,observation.quantity,observation.periodStart,observation.periodEnd,source,rawPayload])
await db.query(`insert into public.normalized_metering_values(id,company_id,customer_id,metering_point_id,source_metering_value_id,source_message_id,source_transaction_reference,quantity_kwh,period_start,period_end,unit,direction,quality_status,raw_payload,revision_status,revision_number,supply_period_id,billing_status,billing_gate_status) values($1,$2,$3,$4,$5,$6,'OWN',$7,$8,$9,'kWh','consumption','136',$10,'current',1,$11,'billable','eligible')`,[value,company,customer,point,meter,source,observation.quantity,observation.periodStart,observation.periodEnd,rawPayload,supply])
await db.exec(`insert into public.customers values('${customer}','${company}');insert into public.metering_points values('${point}','${company}');insert into public.customer_supply_periods values('${supply}','${company}','${customer}','${point}','${contract}','active','2026-07-01',null);insert into public.customer_contracts values('${contract}','${company}','${customer}','${point}','active','2026-07-01',null);insert into public.contract_price_snapshots values('${price}','${company}','${contract}','${priceVersion}','{"price":"original"}','2026-07-01',null);insert into public.price_plan_versions values('${priceVersion}','${company}','active',now(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');`)
async function basis(){return(await db.query('select gridex_billing_source.basis_v1($1,$2) b',[company,value])).rows[0].b}
async function service(sql,args=[]){await db.exec('set role service_role');try{return await db.query(sql,args)}finally{await db.exec('reset role')}}
async function rejects(fn,pattern){await assert.rejects(fn,pattern);count++}
await db.exec(`alter table public.customer_supply_periods add column market_start_at timestamptz, add column market_end_at timestamptz, add column actual_end_date date;
 alter table public.customer_contracts add column termination_reason text, add column ended_at timestamptz;`)
await db.exec(fs.readFileSync(root+'/supabase/migrations/20261022150000_supply_ending_billable.sql','utf8'))
const contractId=(await db.query('select id from public.customer_contracts')).rows[0].id
const gate={billing_status:'billable',billing_gate_status:'eligible',source_message_id:source,supply_period_id:supply,customer_id:customer}
const setGate=()=>service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate])
const START='2026-06-30T23:00:00.000Z', END='2026-07-31T23:00:00.000Z'
async function state(period,contract={status:'active'},price={}){
 await db.query('update public.customer_supply_periods set status=$1,start_date=$2,end_date=$3,market_start_at=$4,market_end_at=$5,actual_end_date=$6 where id=$7',
  [period.status,period.start??'2026-07-01',period.end??null,period.marketStart??null,period.marketEnd??null,period.actualEnd??null,supply])
 await db.query('update public.customer_contracts set status=$1,termination_reason=$2,ended_at=$3,ends_at=$4 where id=$5',[contract.status,contract.reason??null,contract.endedAt??null,contract.endsAt??null,contractId])
 await db.query('update public.contract_price_snapshots set valid_to=$1 where id=$2',[price.validTo??null,price_])
}
const price_=(await db.query('select id from public.contract_price_snapshots')).rows[0].id
const z04={marketStart:START}
const z05Ended={...z04,status:'ended',end:'2026-08-01',marketEnd:END}
const supplyEnd={status:'terminated',reason:'supply_end',endedAt:'2026-08-01T00:00:00Z'}
const manual={status:'active'}
// A ready underlay for exactly the value's Ediel month.
const underlay=(start=START,end=END)=>({customer_id:customer,metering_point_id:point,supply_period_id:supply,contract_id:contractId,contract_price_snapshot_id:price_,pricing_snapshot_id:price_,
 price_plan_version_id:priceVersion,pricing_snapshot:{price:'original'},energy_direction:'consumption',underlay_year:2026,underlay_month:7,billing_period_start:start,billing_period_end:end,
 status:'validated',readiness_status:'ready',total_kwh:observation.quantity,payload:{billing_month:'2026-07',billing_month_frame:'ediel_fixed_normal_time'}})
const qualified=await basis()
const items=[{source_normalized_metering_value_id:value,quantity:observation.quantity,quantity_kwh:observation.quantity,unit:'kWh',product_code:qualified.productCode??null,register_code:qualified.registerCode??null,period_start:START,period_end:END}]
const store=(u=underlay())=>service('select public.gridex_store_billing_underlay($1,$2,$3,null)',[company,u,JSON.stringify(items)])
const ok=async(label,fn)=>{await fn();count++;return label}
// Fixture reset between cases only (each case binds the value anew): the immutability triggers are fixture-bypassed.
const resetUnderlays=()=>db.exec("set session_replication_role=replica;delete from public.billing_underlay_items;delete from public.billing_underlay_events;delete from gridex_billing_source.underlay_bindings;delete from public.billing_underlays;set session_replication_role=origin")
const phase=process.argv.includes('--before')?'before':'after'
if(phase==='before'){
 // Defect evidence on the shipped bodies.
 await state(z05Ended,supplyEnd);await rejects(setGate,/billing_gate_supply_contract_scope_mismatch/)
 await state(z05Ended,supplyEnd);await rejects(store,/billing_underlay_supply_contract_price_basis_required/)
 await state({...z04,status:'active'},{status:'active'},{validTo:'2026-07-31'});await rejects(store,/billing_underlay_supply_contract_price_basis_required/)
 await state({...z04,status:'active'},{status:'active',endsAt:'2026-07-31'});await rejects(setGate,/billing_gate_supply_contract_scope_mismatch/)
 console.log(`Shipped billing boundary refuses the Ediel month of an Ediel-qualified supply (F108 M5, H2/H3 store): ${count} PASS`)
}else{
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023196000_f108_ediel_billing_month.sql','utf8'))
 // M5: the value's last hour before the Z05 end (22:00Z-23:00Z on 31 July) is billable; the ended period's
 // ready underlay of the Ediel month is stored (H2/H3 rule, identical to the gate).
 await state(z05Ended,supplyEnd);await ok('M5 gate',setGate)
 await state(z05Ended,supplyEnd);await ok('H2/H3 store ended period, contract ended by this end',()=>store())
 const stored=(await db.query('select billing_period_start::text s,billing_period_end::text e,payload->>\'billing_period_end_instant\' i from public.billing_underlays')).rows
 assert.deepEqual(stored.map(r=>[r.s,r.e]),[['2026-07-01','2026-08-01']]);assert.equal(new Date(stored[0].i).toISOString(),END);count++
 await resetUnderlays()
 await state({...z05Ended,status:'ending'},supplyEnd);await ok('H2 store ending period',()=>store())
 await resetUnderlays()
 // A price or contract ending on the last day of the month covers the Ediel month of an Ediel-qualified supply.
 await state({...z04,status:'active'},{status:'active'},{validTo:'2026-07-31'});await ok('price valid_to Ediel month',()=>store())
 await resetUnderlays()
 await state({...z04,status:'active'},{status:'active',endsAt:'2026-07-31'});await ok('contract ends_at Ediel month (gate)',setGate)
 await state({...z04,status:'active'},{status:'active',endsAt:'2026-07-31'});await ok('contract ends_at Ediel month (store)',()=>store())
 await resetUnderlays()
 // Unchanged refusals.
 // A manual period (no market instant) keeps civil midnight: its manual end on 31 July ends at 22:00Z.
 await state({status:'ended',end:'2026-07-31',actualEnd:'2026-07-31'});await rejects(setGate,/billing_gate_supply_contract_scope_mismatch/)
 // A manual period with a price or contract ending 31 July does not reach 23:00Z.
 await state(manual,{status:'active'},{validTo:'2026-07-31'});await rejects(store,/billing_underlay_supply_contract_price_basis_required/)
 await state(manual,{status:'active',endsAt:'2026-07-31'});await rejects(setGate,/billing_gate_supply_contract_scope_mismatch/)
 // A Z05 one day earlier (31 July, market end 2026-07-30T23:00Z) excludes the value.
 await state({...z04,status:'ended',end:'2026-07-31',marketEnd:'2026-07-30T23:00:00Z'},{status:'terminated',reason:'supply_end',endedAt:'2026-07-31T00:00:00Z'});await rejects(setGate,/billing_gate_supply_contract_scope_mismatch/)
 // A contract terminated for another reason, a cancelled period or an ended period without an end stay refused.
 await state(z05Ended,{status:'terminated',reason:'customer_request',endedAt:'2026-08-01T00:00:00Z'});await rejects(store,/billing_underlay_supply_contract_price_basis_required/)
 await state({...z04,status:'cancelled'});await rejects(store,/billing_underlay_supply_contract_price_basis_required/)
 await state({...z04,status:'ended'});await rejects(store,/billing_underlay_supply_contract_price_basis_required/)
 // The qualified supply basis still decides.
 await state(z05Ended,supplyEnd);await db.exec('update public.fixture_authorities set legal_available=false')
 await rejects(setGate,/qualified_supply_source_required/);await rejects(store,/qualified_supply_source_required/);await db.exec('update public.fixture_authorities set legal_available=true')
 // Only the service role may set a gate or store an underlay.
 await rejects(()=>db.query('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]),/service_role_required/)
 await rejects(()=>db.query('select public.gridex_store_billing_underlay($1,$2,$3,null)',[company,underlay(),JSON.stringify(items)]),/service_role_required/)
 // Owner, ACL, security mode and configuration are unchanged; the migration refuses a second run (no predecessor).
 const meta=(await db.query(`select proname,prosecdef,proconfig,proacl::text acl from pg_proc where proname in('gridex_set_metering_billing_gate','gridex_store_billing_underlay') and pronamespace='public'::regnamespace order by 1`)).rows
 assert.ok(meta.every(r=>r.prosecdef===true));count++
 await rejects(()=>db.exec(fs.readFileSync(root+'/supabase/migrations/20261023196000_f108_ediel_billing_month.sql','utf8')),/f108_ediel_billing_month_predecessor_required/)
 console.log(`Billing boundary after 20261023196000 (F108 Ediel month, M5, H2/H3 store): ${count} PASS`)
}
} finally { await db.close() }
