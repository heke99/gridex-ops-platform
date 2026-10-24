// reality-defects: F116 (a corrected E66 day re-sends all quarters; an unchanged quarter keeps its stored value, whose
// own origin is the ORIGINAL message, and only gets the correction as an extra source link. The gate write rebound the
// normalized value to the correction, so its source basis stayed unqualified and the quarter was never billable.)
// The billing gate fixture of scripts/h3d-contract-end-after-supply-sql-regression.mjs (PGlite, synthetic rows; the real
// gate and source basis from their migrations up to 20261023203000, the state installed in the world).
//   shipped body: a blocked gate carrying the correction rebinds normalized_metering_values.source_message_id, after
//     which the value's basis is unqualified and every eligible gate is refused (the defect, run 29: 72 quarters);
//   after 20261024090000: the gate never rebinds a value's source (it only fills a missing one); a value rebound by the
//     defect gets its own origin back when the origin and the re-sent link both exist and the payload names the origin,
//     and is then qualified and gated eligible on its origin; other mismatches are left alone.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/f116-gate-source-origin-sql-regression.mjs [--old]
//   --old runs the post-migration assertions on the shipped body (they fail: the defect).
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const company = '11111111-1111-4111-8111-111111111111', original = '22222222-2222-4222-8222-222222222222', correction = '2222cccc-2222-4222-8222-222222222222'
const value = '33333333-3333-4333-8333-333333333333', meter = '44444444-4444-4444-8444-444444444444', customer = '55555555-5555-4555-8555-555555555555'
const point = '66666666-6666-4666-8666-666666666666', supply = '77777777-7777-4777-8777-777777777777', contract = '88888888-8888-4888-8888-888888888888'
const value2 = '3333aaaa-3333-4333-8333-333333333333', meter2 = '4444aaaa-4444-4444-8444-444444444444'
const value3 = '3333bbbb-3333-4333-8333-333333333333', meter3 = '4444bbbb-4444-4444-8444-444444444444'
const migration = fs.readFileSync(root+'/supabase/migrations/20261024090000_f116_gate_keeps_value_source_origin.sql','utf8')
const raw = "UNA:+.? 'UNB+UNOC:3+A:ZZ+B:ZZ+261120:1200+I++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+D+9+AB'DTM+735:?+0100:406'IDE+24+OWN'LIN+++8716867000030:::9'LOC+172+735999260731000007::9'DTM+324:202611010000202611160000:719'DTM+354:360:805'MEA+AAZ++KWH'SEQ++1'RFF+AES:REG'QTY+136:361'UNT+12+1'UNZ+1+I'"
const observation = { ordinal: 0, sourceOrdinal: 0, quantity: '361', periodStart: '2026-10-31T23:00:00.000Z', periodEnd: '2026-11-15T23:00:00.000Z', unit: 'kWh', quality: '136', direction: 'consumption', productCode: null, registerCode: null }
const consumptionContract = { version: 2, observations: [observation], metering: { capability: 'write', customerId: customer, meteringPointId: point } }
let count = 0
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;create schema gridex_received_sources; create table gridex_received_sources.supply_source_transitions(source_message_id uuid,company_id uuid,resulting_states jsonb);create schema gridex_ediel_source_rules;
 create function public.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,status text);
 create table public.metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,value_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_code text,source_ediel_message_id uuid,source_transaction_reference text,is_current boolean,revision_status text,raw_payload jsonb,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz);
 create table public.normalized_metering_values(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,source_metering_value_id uuid,source_message_id uuid,source_transaction_reference text,quantity_kwh numeric,period_start timestamptz,period_end timestamptz,unit text,direction text,quality_status text,product_code text,register_code text,raw_payload jsonb,revision_status text,revision_number int,previous_value_id uuid,supply_period_id uuid,billing_status text,billing_gate_status text,billing_gate_reasons jsonb,billing_gate_snapshot jsonb,billing_gate_evaluated_at timestamptz,updated_at timestamptz);
 create table public.metering_value_sources(id uuid primary key default gen_random_uuid(),company_id uuid,metering_value_id uuid,normalized_metering_value_id uuid,source_ediel_message_id uuid,source_transaction_reference text,source_line_reference text,source_type text);
 create table public.customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,status text,start_date date,end_date date);
 create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text,starts_at date,ends_at date);
 create table public.contract_price_snapshots(id uuid primary key,company_id uuid,contract_id uuid,price_plan_version_id uuid,snapshot_json jsonb,valid_from date,valid_to date);
 create table public.price_plan_versions(id uuid primary key,company_id uuid,status text,locked_at timestamptz,content_sha256 text);
 create table public.customers(id uuid primary key,company_id uuid);create table public.metering_points(id uuid primary key,company_id uuid);
 create table public.billing_underlays(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,supply_period_id uuid,contract_id uuid,pricing_snapshot_id uuid,price_plan_id uuid,price_plan_version_id uuid,price_book_id uuid,contract_price_snapshot_id uuid,billing_block_reason text,campaign_id uuid,price_area text,energy_direction text,settlement_type text,underlay_month int,underlay_year int,billing_period_start date,billing_period_end date,status text,readiness_status text,readiness_issues jsonb,total_kwh numeric,currency text,source_system text,source_meter_value_count int,missing_values_count int,payload jsonb,pricing_snapshot jsonb,received_at timestamptz,validated_at timestamptz,created_by uuid,updated_by uuid,updated_at timestamptz);
 create table public.billing_underlay_items(id uuid primary key,billing_underlay_id uuid references public.billing_underlays(id),company_id uuid,source_normalized_metering_value_id uuid,quantity numeric,quantity_kwh numeric,unit text,product_code text,register_code text,period_start timestamptz,period_end timestamptz,created_at timestamptz,updated_at timestamptz);
 create table public.billing_underlay_events(company_id uuid,billing_underlay_id uuid,event_type text,message text,metadata jsonb,created_by uuid);
 create table public.fixture_contracts(company_id uuid,source_id uuid,tx text,contract jsonb);
 create function gridex_utilts_binding.stored_contract_v1(uuid,uuid,text) returns jsonb language sql as $$select contract from public.fixture_contracts where company_id=$1 and source_id=$2 and tx=$3$$;
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create function gridex_ediel_source_rules.require_v1(uuid,uuid) returns jsonb language sql as $$select '{"sourceHash":"fixture-original-only","version":"fixed-original"}'::jsonb$$;
 create function gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) returns jsonb language sql as $$select jsonb_build_object('qualified',true,'periodId',$2,'marketStateVersion',1)$$;
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

// Synthetic rows: the original E66 (the stored value's origin) and the correction that re-sent the same quantity.
for (const id of [original, correction]) {
  await db.query('insert into public.ediel_messages values($1,$2,$3,$4,$5,$6,$7,$8)',[id,company,'test','inbound','UTILTS','E66',raw,'validated'])
  await db.query('insert into public.fixture_contracts values($1,$2,$3,$4)',[company,id,'OWN',JSON.stringify(consumptionContract)])
}
const rawPayload = JSON.stringify({consumptionContract, sourceOrdinal:0, edielMessageId:original})
const seed = async (nv, mv, { resentLink = true, tx = 'OWN' } = {}) => {
  await db.query(`insert into public.metering_values(id,company_id,customer_id,metering_point_id,value_kwh,period_start,period_end,unit,direction,quality_code,source_ediel_message_id,source_transaction_reference,is_current,revision_status,raw_payload) values($1,$2,$3,$4,$5,$6,$7,'kWh','consumption','136',$8,'OWN',true,'current',$9)`,[mv,company,customer,point,observation.quantity,observation.periodStart,observation.periodEnd,original,rawPayload])
  await db.query(`insert into public.normalized_metering_values(id,company_id,customer_id,metering_point_id,source_metering_value_id,source_message_id,source_transaction_reference,quantity_kwh,period_start,period_end,unit,direction,quality_status,raw_payload,revision_status,revision_number,billing_status,billing_gate_status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'kWh','consumption','136',$11,'current',1,'pending_match','pending_match')`,[nv,company,customer,point,mv,original,tx,observation.quantity,observation.periodStart,observation.periodEnd,rawPayload])
  // gridex_ingest_metering_value_atomic: the origin link at birth, and the re-sent link for an equal-value file.
  await db.query(`insert into public.metering_value_sources(company_id,metering_value_id,normalized_metering_value_id,source_ediel_message_id,source_transaction_reference,source_type) values($1,$2,$3,$4,'OWN','ediel_utilts')`,[company,mv,nv,original])
  if (resentLink) await db.query(`insert into public.metering_value_sources(company_id,metering_value_id,normalized_metering_value_id,source_ediel_message_id,source_transaction_reference,source_type) values($1,$2,$3,$4,'OWNC','ediel_utilts')`,[company,mv,nv,correction])
}
await seed(value, meter)
await seed(value2, meter2, { resentLink: false })
await seed(value3, meter3, { tx: 'OTHER' })
await db.exec(`insert into public.customers values('${customer}','${company}');insert into public.metering_points values('${point}','${company}');
 insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,status,start_date,market_start_at) values('${supply}','${company}','${customer}','${point}','${contract}','active','2026-10-01','2026-09-30T22:00:00Z');
 insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,status,starts_at) values('${contract}','${company}','${customer}','${point}','active','2026-10-01');`)

async function service(sql,args=[]){await db.exec('set role service_role');try{return await db.query(sql,args)}finally{await db.exec('reset role')}}
const rejects = async (fn, pattern) => { await assert.rejects(fn, pattern); count++ }
const ok = async (fn) => { const r = await fn(); count++; return r }
const gate = (nv, mv, source, status = 'eligible') => service('select public.gridex_set_metering_billing_gate($1,$2,$3,$4)',[company,mv,nv,{
  billing_status: status === 'eligible' ? 'billable' : status, billing_gate_status: status, source_message_id: source, supply_period_id: supply, customer_id: customer,
  billing_gate_reasons: status === 'eligible' ? [] : [{ code: 'source_basis_unqualified' }] }])
const basis = async (nv) => (await db.query('select gridex_billing_source.basis_v1($1,$2) b',[company,nv])).rows[0].b
const sourceOf = async (nv) => (await db.query('select source_message_id s from public.normalized_metering_values where id=$1',[nv])).rows[0].s
const fnMeta = async () => (await db.query(`select to_jsonb(p)-'prosrc'-'oid' m from pg_proc p where p.oid='gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2(uuid,uuid,uuid,jsonb)'::regprocedure`)).rows[0].m

for (const nv of [value, value2, value3]) { const b = await basis(nv); assert.equal(b.qualified, nv !== value3, JSON.stringify(b)); count++ }
// Defect on the shipped body: the ingestion's gate for the unchanged quarter carried the correction (blocked: the
// TS gate compared the qualified original basis with the correction), and the write rebound the value.
for (const [nv, mv] of [[value, meter], [value2, meter2], [value3, meter3]]) await ok(() => gate(nv, mv, correction, 'blocked'))
assert.equal(await sourceOf(value), correction); count++
assert.equal((await basis(value)).qualified, false); count++
await rejects(() => gate(value, meter, original), /billing_gate_qualified_final_source_required/)
await rejects(() => gate(value, meter, correction), /billing_gate_qualified_final_source_required/)
// value2/value3 stand for mismatches the repair must not touch: no re-sent link, a different transaction reference.
const metaBefore = await fnMeta()
console.log(`Shipped gate rebinds an unchanged re-sent quarter to the correction and leaves it unbillable (F116): ${count} PASS`)
const before = count

if (!process.argv.includes('--old')) await db.exec(migration)
// Repair: the rebound value has its own origin back, is qualified and is gated eligible on its origin.
assert.equal(await sourceOf(value), original, 'repaired to its own origin'); count++
assert.equal((await basis(value)).qualified, true); count++
await ok(() => gate(value, meter, original))
assert.deepEqual((await db.query('select billing_gate_status g,billing_status b,source_message_id s from public.normalized_metering_values where id=$1',[value])).rows[0], { g: 'eligible', b: 'billable', s: original }); count++
// Other mismatches are left for review: no re-sent link, or a transaction reference that is not the origin's.
assert.equal(await sourceOf(value2), correction); count++
assert.equal(await sourceOf(value3), correction); count++
// The gate never rebinds again: a re-sent file's blocked or eligible gate leaves the value on its origin.
await ok(() => gate(value, meter, correction, 'blocked'))
assert.equal(await sourceOf(value), original); count++
assert.equal((await basis(value)).qualified, true); count++
await rejects(() => gate(value, meter, correction), /billing_gate_qualified_final_source_required/)
await ok(() => gate(value, meter, original))
// A missing source is still filled by the gate (unchanged for values stored without one).
await db.query('update public.normalized_metering_values set source_message_id=null where id=$1',[value2])
await ok(() => gate(value2, meter2, original, 'blocked'))
assert.equal(await sourceOf(value2), original); count++
// One exact replacement; owner/ACL/security/volatility/config preserved; a second run is refused.
const body = (await db.query(`select prosrc from pg_proc where oid='gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2(uuid,uuid,uuid,jsonb)'::regprocedure`)).rows[0].prosrc
assert.equal(body.split("source_message_id=coalesce(source_message_id,nullif(p_gate->>'source_message_id','')::uuid),").length, 2)
assert.ok(!body.includes("source_message_id=coalesce(nullif(p_gate->>'source_message_id','')::uuid,source_message_id),")); count++
assert.deepEqual(await fnMeta(), metaBefore); count++
await rejects(() => db.exec(migration), /f116_gate_source_origin_rule_source_changed/)
await db.exec('rollback')
console.log(`Gate source origin after 20261024090000 (F116 corrected-day equal quarters): ${count - before} PASS`)
} finally { await db.close() }
