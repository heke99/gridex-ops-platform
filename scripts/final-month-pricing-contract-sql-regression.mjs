// reality-defects: H3 (final month after a Z05 is priced and exported: pricing SQL and export readiness apply the gate/store rule; owner decision 2026-10-22)
// The pricing/export database readers below the billing gate and the underlay store, on the protected billing fixture of
// scripts/f108-ediel-billing-month-sql-regression.mjs (same fixture schema and authorities, PGlite, synthetic rows; the real
// gate and store bodies are installed from their migrations up to 20261023196000). The customer was supplied from
// 1 August (Z04) and a Z05 DTM+93 202610010000 +0100 ended the supply (end_date 2026-10-01, market_end_at 2026-09-30T23:00Z);
// the supply-end follow-up terminated the contract (termination_reason 'supply_end', ended_at 2026-10-01). Its ready
// underlay is the September Ediel month [2026-08-31T23:00Z, 2026-09-30T23:00Z) of a quarterly contract.
//   shipped bodies: gridex_read_interval_pricing_snapshot_v1 refuses the final underlay (selector mismatch, the contract's
//     resolution is not read), gridex_persist_pricing_run skips the interval receipt requirement, and
//     billing_export_readiness_v blocks the locked final underlay with exact_signed_contract_missing;
//   after 20261023199000: all three accept exactly the contract terminated by this supply end for a billed period inside
//     the supplied window; another tenant, another reason, another end and a period after the end stay refused.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/final-month-pricing-contract-sql-regression.mjs [--old]
//   --old runs the post-migration assertions on the shipped bodies (they fail: the defect).
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const company = '11111111-1111-4111-8111-111111111111', other = '12121212-1212-4212-8212-121212121212', customer = '55555555-5555-4555-8555-555555555555', point = '66666666-6666-4666-8666-666666666666'
const supply = '77777777-7777-4777-8777-777777777777', contract = '88888888-8888-4888-8888-888888888888', snap = '99999999-9999-4999-8999-999999999999', otherContract = '8888aaaa-8888-4888-8888-888888888888'
const sep = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', oct = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', item = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SEP = { start: '2026-08-31T23:00:00+00:00', end: '2026-09-30T23:00:00+00:00' }, OCT = { start: '2026-09-30T23:00:00+00:00', end: '2026-10-31T23:00:00+00:00' }
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
// The pricing fixture: the persist body of 20260716010000 repaired by 20261013093922 (exact predecessor md5), the read
// snapshot of 20261013093922, and the export readiness view of 20260716090000 with its security_invoker option.
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

// Synthetic rows.
await db.query(`insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,status,start_date,end_date,market_start_at,market_end_at) values($1,$2,$3,$4,$5,'ended','2026-08-01','2026-10-01','2026-07-31T22:00:00Z','2026-09-30T23:00:00Z')`,[supply,company,customer,point,contract])
await db.query(`insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,status,starts_at,termination_reason,ended_at,contract_type) values($1,$2,$3,$4,'terminated','2026-08-01','supply_end','2026-10-01T00:00:00Z','variable_quarterly')`,[contract,company,customer,point])
await db.query(`insert into public.contract_price_snapshots(id,company_id,contract_id,snapshot_json,valid_from) values($1,$2,$3,'{"price":"original"}','2026-08-01')`,[snap,company,contract])
await db.query(`insert into public.company_market_price_sources values($1,'nordpool',true,'{quarterly,hourly}',1)`,[company])
const underlayRow = (id, month, dates, instants) => db.query(`insert into public.billing_underlays(id,company_id,customer_id,metering_point_id,supply_period_id,contract_id,contract_price_snapshot_id,pricing_snapshot_id,pricing_snapshot,energy_direction,underlay_year,underlay_month,billing_period_start,billing_period_end,status,readiness_status,total_kwh,price_area,payload)
 values($1,$2,$3,$4,$5,$6,$7,$7,'{"price":"original"}','consumption',2026,$8,$9,$10,'validated','ready',1,'SE3',$11)`,
 [id,company,customer,point,supply,contract,snap,month,dates[0],dates[1],{billing_month:`2026-${String(month).padStart(2,'0')}`,billing_month_frame:'ediel_fixed_normal_time',billing_period_start_instant:instants.start,billing_period_end_instant:instants.end,billing_period_timezone:'Europe/Stockholm',billing_period_end_exclusive:true}])
await underlayRow(sep,9,['2026-09-01','2026-10-01'],SEP)
await underlayRow(oct,10,['2026-10-01','2026-11-01'],OCT)
await db.query(`insert into public.billing_underlay_items(id,billing_underlay_id,company_id,quantity,quantity_kwh,unit,period_start,period_end) values($1,$2,$3,1,1,'kWh',$4,$5)`,[item,sep,company,SEP.start,SEP.end])

const read = (id = sep, period = SEP) => db.query(`select public.gridex_read_interval_pricing_snapshot_v1($1,$2,$3,$4,'SE3','quarterly',(select to_jsonb(b) from public.billing_underlays b where b.id=$2)) r`,[company,id,period.start,period.end])
const spotLine = { line_type:'base_price', description:'Spot', quantity:1, unit:'kWh', unit_price_ex_vat:1, amount_ex_vat:1, vat_rate:0.25, vat_amount:0.25, amount_inc_vat:1.25, sort_order:1, metadata:{ source_type:'spot', weight_percent:100 } }
const persist = (receipt) => db.query(`select public.gridex_persist_pricing_run($1,$2,$3,'{}') r`,[company,sep,{ status:'success', total_ex_vat:1, vat_amount:0.25, total_inc_vat:1.25, warnings:[], errors:[], lines:[spotLine], interval_evidence:[], ...(receipt ? { interval_input_snapshot: receipt } : {}) }])
const lockRun = (id, period) => db.query(`insert into public.pricing_runs(company_id,billing_underlay_id,customer_id,billing_period_start,billing_period_end,status,locked_at) values($1,$2,$3,$4,$5,'locked',now())`,[company,id,customer,period.start,period.end])
const blockers = async (id = sep) => (await db.query(`select blockers from public.billing_export_readiness_v where company_id=$1 and billing_underlay_id=$2`,[company,id])).rows[0].blockers
const resetRuns = () => db.exec('delete from public.pricing_interval_evidence;delete from public.pricing_preview_lines;delete from public.pricing_runs;update public.billing_underlays set invoice_readiness_status=null,pricing_snapshot=\'{"price":"original"}\'')
const setContract = (fields) => db.query(`update public.customer_contracts set company_id=$1,status=$2,termination_reason=$3,ended_at=$4 where id=$5`,[fields.company??company,fields.status??'terminated','reason' in fields?fields.reason:'supply_end','endedAt' in fields?fields.endedAt:'2026-10-01T00:00:00Z',contract])
const setSupply = (fields) => db.query(`update public.customer_supply_periods set company_id=$1,contract_id=$2,status=$3,end_date=$4,market_end_at=$5 where id=$6`,[fields.company??company,fields.contract??contract,fields.status??'ended','end' in fields?fields.end:'2026-10-01','marketEnd' in fields?fields.marketEnd:'2026-09-30T23:00:00Z',supply])
const rejects = async (fn, pattern) => { await assert.rejects(fn, pattern); count++ }
const ok = async (fn) => { const r = await fn(); count++; return r }
const metadata = async () => (await db.query(`select p.proname, to_jsonb(p)-'prosrc'-'oid' m from pg_proc p where p.proname in('gridex_read_interval_pricing_snapshot_v1','gridex_persist_pricing_run') order by 1`)).rows
const viewMeta = async () => (await db.query(`select c.relowner::regrole::text o,c.relacl::text a,c.reloptions::text r from pg_class c where c.oid='public.billing_export_readiness_v'::regclass`)).rows[0]
const metaBefore = await metadata(), viewBefore = await viewMeta()

// Defect evidence on the shipped bodies (the contract terminated by exactly this supply end is not read).
await rejects(() => read(), /interval_pricing_snapshot_underlay_selector_mismatch/)
const skipped = await persist(null); count++
assert.equal((await db.query(`select count(*)::int n from public.pricing_runs where billing_underlay_id=$1 and status='success'`,[sep])).rows[0].n, 1); count++
await resetRuns()
await lockRun(sep, SEP)
assert.ok((await blockers()).includes('exact_signed_contract_missing')); count++
await resetRuns()
console.log(`Shipped pricing/export readers refuse the final month of a contract terminated by its supply end (H3): ${count} PASS (persist accepted run ${skipped.rows[0].r ? 'without receipt' : '?'})`)
const before = count

if (!process.argv.includes('--old')) await db.exec(fs.readFileSync(root+'/supabase/migrations/20261023199000_final_month_pricing_contract.sql','utf8'))
// The final month is accepted: the quarterly contract's resolution is read, persist requires the interval receipt and
// accepts the exact one, and the locked final underlay is exportable as far as the contract is concerned.
const snapshot = (await ok(() => read())).rows[0].r
assert.equal(snapshot.receipt.required_resolution, 'quarterly'); count++
await rejects(() => persist(null), /interval_pricing_snapshot_receipt_required/)
await ok(() => persist(snapshot.receipt))
assert.equal((await db.query(`select invoice_readiness_status s from public.billing_underlays where id=$1`,[sep])).rows[0].s, 'ready_for_invoice'); count++
await resetRuns()
await lockRun(sep, SEP)
assert.ok(!(await blockers()).includes('exact_signed_contract_missing')); count++
// An ended_at at Stockholm midnight (22:00Z the day before) is the same supply end.
await setContract({ endedAt: '2026-09-30T22:00:00Z' }); await ok(() => read()); assert.ok(!(await blockers()).includes('exact_signed_contract_missing')); count++
// A signed/active contract is unchanged.
await setContract({ status: 'active', reason: null, endedAt: null }); await ok(() => read()); assert.ok(!(await blockers()).includes('exact_signed_contract_missing')); count++
// Refusals: each one reads no contract (monthly fallback, selector mismatch) and keeps the export blocker.
const refused = async (label) => { await rejects(() => read(), /interval_pricing_snapshot_underlay_selector_mismatch/); assert.ok((await blockers()).includes('exact_signed_contract_missing'), label); count++ }
await setContract({ reason: 'customer_request' }); await refused('another termination reason')
await setContract({ endedAt: '2026-09-15T00:00:00Z' }); await refused('terminated by another end')
await setContract({ status: 'cancelled' }); await refused('cancelled')
await setContract({ status: 'expired' }); await refused('expired')
await setContract({ company: other }); await refused("another tenant's contract")
await setContract({})
await setSupply({ company: other }); await refused("another tenant's supply period")
await setSupply({ contract: otherContract }); await refused('a supply period of another contract')
await setSupply({ status: 'cancelled' }); await refused('a cancelled period')
await setSupply({ end: null, marketEnd: null }); await refused('an ended period without an end date')
// A Z05 one day earlier (end 30 September, market end 29 September 23:00Z) ends before the billed period ends.
await setSupply({ end: '2026-09-30', marketEnd: '2026-09-29T23:00:00Z' }); await setContract({ endedAt: '2026-09-30T00:00:00Z' }); await refused('billed period after an earlier end')
await setSupply({}); await setContract({})
// The October Ediel month lies after the supply end.
await resetRuns(); await lockRun(oct, OCT)
await rejects(() => read(oct, OCT), /interval_pricing_snapshot_underlay_selector_mismatch/)
assert.ok((await blockers(oct)).includes('exact_signed_contract_missing')); count++
await resetRuns(); await lockRun(sep, SEP)
// One hour past the market end (civil midnight 1 October, 22:00Z, is not reached; 00:00Z is past 23:00Z).
await db.query(`update public.billing_underlays set payload=jsonb_set(payload,'{billing_period_end_instant}','"2026-10-01T00:00:00+00:00"') where id=$1`,[sep])
await rejects(() => read(sep, { start: SEP.start, end: '2026-10-01T00:00:00+00:00' }), /interval_pricing_snapshot_underlay_selector_mismatch/)
await db.query(`update public.billing_underlays set payload=jsonb_set(payload,'{billing_period_end_instant}',to_jsonb($2::text)) where id=$1`,[sep,SEP.end])
await ok(() => read())

// The rule is the gate's and the store's own text (20261022150000/20261023196000), and everything else is preserved.
const statusClause = /status_replacement CONSTANT text:=\$n\$([\s\S]*?)\$n\$;/.exec(fs.readFileSync(root+'/supabase/migrations/20261022150000_supply_ending_billable.sql','utf8'))[1]
const bodies = (await db.query(`select proname,prosrc from pg_proc where proname in('gridex_read_interval_pricing_snapshot_v1','gridex_persist_pricing_run','gridex_set_metering_billing_gate','gridex_store_billing_underlay')`)).rows
assert.equal(bodies.length, 4); assert.ok(bodies.every(row => row.prosrc.includes(statusClause))); count++
assert.deepEqual(await metadata(), metaBefore); count++
assert.deepEqual(await viewMeta(), viewBefore); assert.equal(viewBefore.r, '{security_invoker=true}'); count++
await rejects(() => db.exec(fs.readFileSync(root+'/supabase/migrations/20261023199000_final_month_pricing_contract.sql','utf8')), /final_month_pricing_contract_predecessor_required/)
console.log(`Pricing/export readers after 20261023199000 (H3 final month, identical gate/store rule): ${count - before} PASS`)
} finally { await db.close() }
