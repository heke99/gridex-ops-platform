// reality-defects: (reality scenario H "the customer leaves", FINDINGS H2/H3/H1)
// The database billing gate (public.gridex_set_metering_billing_gate) around a received end of supply, on
// the protected billing input boundary of scripts/ediel-billing-source-sql-regression.mjs (same fixture
// schema and authorities, PGlite, synthetic rows). It is run before and after migration
// 20261022150000_supply_ending_billable.sql:
//   before: a value of an 'ending' period, or of a contract terminated by this very supply end, is refused;
//   after:  both are billable inside the period; everything outside it stays refused.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/supply-ending-billable-sql-regression.mjs
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const company = '11111111-1111-4111-8111-111111111111', source = '22222222-2222-4222-8222-222222222222', value = '33333333-3333-4333-8333-333333333333', meter = '44444444-4444-4444-8444-444444444444', customer = '55555555-5555-4555-8555-555555555555', point = '66666666-6666-4666-8666-666666666666', supply = '77777777-7777-4777-8777-777777777777', contract = '88888888-8888-4888-8888-888888888888', price = '99999999-9999-4999-8999-999999999999', priceVersion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let count = 0
const raw = "UNA:+.? 'UNB+UNOC:3+A:ZZ+B:ZZ+260930:1200+I++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'DTM+735:?+0200:406'IDE+24+OWN'LIN+++8716867000030:::9'LOC+172+735999260731000007::9'DTM+324:202607010000202608010000:719'DTM+354:1:802'M EA'".replace("M EA'", "MEA+AAZ++KWH'SEQ++1'RFF+AES:REG'QTY+136:9007199254740993'UNT+12+1'UNZ+1+I'")
const observation = { ordinal: 0, sourceOrdinal: 0, quantity: '9007199254740993', periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-07-31T22:00:00.000Z', unit: 'kWh', quality: '136', direction: 'consumption', productCode: null, registerCode: null }
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
// Columns the received-end path writes (customer_supply_periods.market_end_at/actual_end_date, the supply-end
// follow-up's contract termination fields), absent from the shared minimal fixture.
await db.exec(`alter table public.customer_supply_periods add column market_end_at timestamptz, add column actual_end_date date;
 alter table public.customer_contracts add column termination_reason text, add column ended_at timestamptz;`)
const gate={billing_status:'billable',billing_gate_status:'eligible',source_message_id:source,supply_period_id:supply,customer_id:customer}
const setGate=()=>service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate])
async function state(period,contract){
 await db.query('update public.customer_supply_periods set status=$1,end_date=$2,market_end_at=$3,actual_end_date=$4 where id=$5',[period.status,period.end??null,period.marketEnd??null,period.actualEnd??null,supply])
 await db.query('update public.customer_contracts set status=$1,termination_reason=$2,ended_at=$3 where id=$4',[contract.status,contract.reason??null,contract.endedAt??null,contract.id??contract])
}
// The value is July 2026 (Stockholm month, ends 2026-07-31T22:00Z). A Z05 with DTM+93:202608010000 (Ediel
// normal time) writes end_date 2026-08-01 and market_end_at 2026-07-31T23:00Z; its follow-up terminates the
// contract with ended_at 2026-08-01. In summer that Ediel midnight is 01:00 CEST: still the exclusive end of 31 July.
const z05Ending={status:'ending',end:'2026-08-01',marketEnd:'2026-07-31T23:00:00Z'}
const supplyEnd={status:'terminated',reason:'supply_end',endedAt:'2026-08-01T00:00:00Z'}
const ok=async(label,period,contract)=>{await state(period,{...contract,id:contractId});await setGate();count++;return label}
const refused=async(label,period,contract,pattern=/billing_gate_supply_contract_scope_mismatch/)=>{await state(period,{...contract,id:contractId});await rejects(setGate,pattern);return label}
const contractId=(await db.query('select id from public.customer_contracts')).rows[0].id
const phase=process.argv.includes('--before')?'before':'after'
if(phase==='before'){
 // Defect evidence on the shipped gate: the remaining supply after a Z05 can never be billed.
 await refused('H2 ending period',z05Ending,{status:'active'})
 await refused('H3 supply-end terminated contract',{...z05Ending,status:'ended'},supplyEnd)
 console.log(`Shipped billing gate refuses the remaining supply after a Z05 (H2/H3): ${count} PASS`)
}else{
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261022150000_supply_ending_billable.sql','utf8'))
 await ok('H2 ending period, contract still active',z05Ending,{status:'active'})
 await ok('H2+H3 ending period, contract terminated by this end',z05Ending,supplyEnd)
 await ok('H3 ended period, contract terminated by this end',{...z05Ending,status:'ended'},supplyEnd)
 await ok('manual end keeps its end date as the last supplied day',{status:'ended',end:'2026-07-31',actualEnd:'2026-07-31'},{status:'active'})
 await refused('H1 a Z05 end one day earlier excludes the last day',{status:'ended',end:'2026-07-31',marketEnd:'2026-07-30T23:00:00Z'},{status:'terminated',reason:'supply_end',endedAt:'2026-07-31T00:00:00Z'})
 await refused('manual end one day earlier',{status:'ended',end:'2026-07-30',actualEnd:'2026-07-30'},{status:'active'})
 await refused('ended without an end date',{status:'ended'},{status:'active'})
 await refused('cancelled period',{status:'cancelled'},{status:'active'})
 await refused('contract terminated for another reason',{...z05Ending,status:'ended'},{status:'terminated',reason:'customer_request',endedAt:'2026-08-01T00:00:00Z'})
 await refused('contract terminated by another end date',{...z05Ending,status:'ended'},{status:'terminated',reason:'supply_end',endedAt:'2026-09-01T00:00:00Z'})
 await refused('cancelled contract',z05Ending,{status:'cancelled'})
 // The qualified supply basis still decides: without it nothing is billable.
 await state(z05Ending,{...supplyEnd,id:contractId});await db.exec('update public.fixture_authorities set legal_available=false')
 await rejects(setGate,/qualified_supply_source_required/);await db.exec('update public.fixture_authorities set legal_available=true')
 // Only the service role may set a gate.
 await rejects(()=>db.query('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,meter,value,gate]),/service_role_required/)
 console.log(`Billing gate after 20261022150000 (H2/H3, exclusive Z05 end): ${count} PASS`)
}
} finally { await db.close() }
