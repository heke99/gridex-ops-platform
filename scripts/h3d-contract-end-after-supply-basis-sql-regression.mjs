// reality-defects: H3d (D8 in the qualified supply basis: an Ediel-started supply ended manually stays qualified up to
// the move-out when the contract runs on through its notice period; the close's new manual-end reason
// 'grid_contract_ended'; a later Z05 earlier than the manual end; owner decisions 2026-10-23 B1, 20)
// The H3c fixture of scripts/manual-end-ediel-basis-sql-regression.mjs (PGlite, synthetic rows; the real basis bodies,
// production_contract_hash_v1 and the two manual end writers from supabase/schema.sql, then 20261023201000, the state
// installed in the world). Only the billing gate's, the store's and the binding's qualified supply basis is read here; the
// gate/store/pricing/export rule is scripts/h3d-contract-end-after-supply-sql-regression.mjs.
//   shipped body (20261023201000): a 'move_out' contract ending after the move-out day drops the basis for the whole
//     period, also for October; 'grid_contract_ended'/'customer_termination' contracts and the 'grid_contract_ended'
//     marker are refused;
//   after 20261023203500: the basis is kept up to civil midnight after the move-out day for a contract ending on or
//     after it; a contract ended before the move-out day, other reasons and every interval after the move-out stay refused.
// Run: EDIEL_PGLITE_MODULE=$PWD/node_modules/@electric-sql/pglite/dist/index.js node scripts/h3d-contract-end-after-supply-basis-sql-regression.mjs [--old]
//   --old runs the post-migration assertions on the shipped body (they fail: the defect).
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root = fileURLToPath(new URL('..', import.meta.url)), db = new PGlite()
const schema = fs.readFileSync(root + '/supabase/schema.sql', 'utf8')
const h3c = fs.readFileSync(root + '/supabase/migrations/20261023201000_manual_end_shortens_ediel_supply_basis.sql', 'utf8')
const migration = fs.readFileSync(root + '/supabase/migrations/20261023203500_h3d_contract_end_after_supply_basis.sql', 'utf8')
const sha = (text) => createHash('sha256').update(text).digest('hex')
function definition(name) {
  const start = schema.indexOf('CREATE FUNCTION ' + name + '(')
  if (start < 0) throw Error('source_function_missing:' + name)
  const marker = /\bAS (\$[\w]*\$)/.exec(schema.slice(start))
  const end = schema.indexOf(marker[1] + ';', start + marker.index + marker[0].length)
  return schema.slice(start, end + marker[1].length + 1)
}
const company = '11111111-1111-4111-8111-111111111111', other = '12121212-1212-4212-8212-121212121212', customer = '55555555-5555-4555-8555-555555555555'
const point = '66666666-6666-4666-8666-666666666666', supply = '77777777-7777-4777-8777-777777777777', contract = '88888888-8888-4888-8888-888888888888'
const site = '44444444-4444-4444-8444-444444444444', sw = '99999999-9999-4999-8999-999999999999', actor = 'abababab-abab-4bab-8bab-abababababab', legalActor = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
const z03 = '20202020-2020-4020-8020-202020202020', z04 = '30303030-3030-4030-8030-303030303030', z05 = '50505050-5050-4050-8050-505050505050'
const z03Raw = "UNH+Z03+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+SYNTHETIC-Z03'LIN+1++735999000000000017:::9'DTM+92:202610010000:203'UNT+5+Z03'"
const z04Raw = "UNH+Z04+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+SYNTHETIC-Z04'LIN+1++735999000000000017:::9'DTM+92:202610010000:203'UNT+5+Z04'"
const sourceObject = { point: '735999000000000017', li: 'LI-SYNTHETIC-H3C', start: '202610010000', reason: 'Z22', identityAgency: '9', customerIdentity: '197001011234' }
const accepted = JSON.stringify({ syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted' })
// Intervals (UTC; Stockholm CEST until 25 October, CET after; Ediel fixed normal time +01:00).
const OCT = ['2026-09-30T23:00:00Z', '2026-10-31T23:00:00Z'], NOV_SUPPLIED = ['2026-10-31T23:00:00Z', '2026-11-15T23:00:00Z']
const MOVE_OUT_DAY = ['2026-11-14T23:00:00Z', '2026-11-15T23:00:00Z'], DAY_AFTER = ['2026-11-15T23:00:00Z', '2026-11-16T23:00:00Z']
const NOV = ['2026-10-31T23:00:00Z', '2026-11-30T23:00:00Z'], BEFORE_START = ['2026-09-30T22:00:00Z', '2026-10-01T22:00:00Z']
let count = 0
try {
await db.exec(`set timezone='UTC';create role anon;create role authenticated;create role service_role;
 create schema auth;create schema gridex_received_sources;create schema gridex_bilateral_prodat;create schema gridex_regulated_supply;create schema gridex_ediel_inbound_context;create schema gridex_ediel_transport;
 create function auth.role() returns text language sql as $$select 'service_role'::text$$;
 create table public.customers(id uuid primary key,company_id uuid,status text,moved_out_at date,lifecycle_closed_at timestamptz,lifecycle_closed_by uuid,lifecycle_status_reason text,updated_at timestamptz);
 create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid,status text,move_out_date date,closed_at timestamptz,closed_reason text,updated_by uuid);
 create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,status text,end_date date,closed_at timestamptz,closed_reason text,updated_by uuid);
 create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text,contract_version text,signed_version text,signed_at timestamptz,version_snapshot jsonb,starts_at date,binding_months int,termination_reason text,termination_notice_date timestamptz,ended_at timestamptz);
 create table public.customer_supply_periods(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_id uuid,start_date date,end_date date,source text,source_message_id uuid,status text,created_at timestamptz,updated_at timestamptz,source_process text,source_switch_request_id uuid,metadata jsonb,actual_start_date date,actual_end_date date,customer_contract_id uuid,market_start_at timestamptz,market_end_at timestamptz,market_state_version bigint,source_end_message_id uuid);
 create table public.supplier_switch_requests(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,inbound_z04_message_id uuid,outbound_z03_message_id uuid,status text,lifecycle_blocked boolean,failed_at timestamptz,failure_reason text,updated_by uuid);
 create table public.customer_operation_tasks(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,task_type text,status text,priority text,title text,description text,metadata jsonb,created_by uuid,updated_by uuid,resolved_at timestamptz);
 create table public.customer_internal_notes(company_id uuid,customer_id uuid,body text,created_by uuid,updated_by uuid);
 create table public.customer_lifecycle_events(company_id uuid,customer_id uuid,event_type text,event_status text,effective_date date,reason text,payload jsonb,created_by uuid);
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,immutable_payload_hash text);
 create table gridex_received_sources.supply_source_transitions(source_message_id uuid primary key,company_id uuid,payload_hash text,source_code text,source_objects jsonb,previous_states jsonb,resulting_states jsonb,qualified_switch_ids uuid[],actor_user_id uuid,applied_at timestamptz);
 create table gridex_received_sources.normal_switch_confirmations(source_message_id uuid,period_id uuid,company_id uuid,switch_id uuid,original_message_id uuid,original_payload_hash text,contract_id uuid,protected_contract_hash text,source_object jsonb,legal_context jsonb,market_start_at timestamptz,confirmed_period jsonb,confirmed_switch jsonb,created_at timestamptz);
 create table gridex_received_sources.normal_supply_activations(period_id uuid,company_id uuid,source_message_id uuid,actor_user_id uuid,previous_period jsonb,resulting_period jsonb,result jsonb,activated_at timestamptz);
 create table gridex_received_sources.validation_assessments(id uuid primary key default gen_random_uuid(),source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid,owner text,facts_text text,facts_hash text,assessed_at timestamptz);
 create table public.fixture_wires(message_id uuid primary key,wire jsonb);
 create function gridex_bilateral_prodat.lock_supply_v1() returns void language sql as $$select$$;
 create function gridex_regulated_supply.lock_graph_v1() returns void language sql as $$select$$;
 create function gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) returns boolean language sql as $$select false$$;
 create function gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid) returns boolean language sql as $$select true$$;
 create function gridex_ediel_inbound_context.require_v1(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('legalActorId','${legalActor}','actorRole','electricity_supplier')$$;
 create function gridex_received_sources.supply_wire_for_period_receipt_v1(uuid,uuid,uuid) returns jsonb language sql as $$select wire from public.fixture_wires where message_id=$2$$;
 create function gridex_received_sources.normal_switch_wire_v1(text) returns jsonb language sql as $$select null::jsonb$$;
 create function gridex_received_sources.supply_effect_assessment_owns_period_v1(uuid,uuid,uuid,uuid) returns boolean language sql as $$select false$$;
 create function gridex_received_sources.mixed_period_canonical_v1(uuid,uuid,uuid,uuid) returns boolean language sql as $$select false$$;
 create function gridex_received_sources.sent_source_is_current_v1(public.ediel_messages) returns boolean language sql as $$select true$$;
 create function gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages) returns jsonb language sql as $$select jsonb_build_object('observedAt','2026-09-01T10:00:00Z')$$;
 create function gridex_received_sources.billing_supply_before_normal_switch_v1(uuid,uuid,timestamptz,timestamptz) returns jsonb language sql as $$select null::jsonb$$;
 -- The 'terminated'/'cancelled' write of gridex_record_customer_contract_event_v1 (status, ended_at from ended_at/ends_at, reason).
 create function public.gridex_record_customer_contract_event_v1(p_company_id uuid,p_customer_contract_id uuid,p_customer_id uuid,p_event_type text,p_happened_at timestamptz default now(),p_note text default null,p_metadata jsonb default '{}',p_actor_user_id uuid default null,p_derived_ends_at timestamptz default null,p_idempotency_key text default null)
  returns jsonb language plpgsql as $$begin update public.customer_contracts set status=case when p_event_type='terminated' then 'terminated' else 'cancelled' end,
   ended_at=coalesce(nullif(p_metadata->>'ended_at','')::timestamptz,nullif(p_metadata->>'ends_at','')::timestamptz,ended_at),
   termination_notice_date=coalesce(nullif(p_metadata->>'termination_notice_date','')::timestamptz,termination_notice_date),
   termination_reason=coalesce(nullif(p_metadata->>'termination_reason',''),termination_reason)
   where id=p_customer_contract_id and company_id=p_company_id and customer_id=p_customer_id;return '{}'::jsonb;end$$;`)
for (const name of ['gridex_received_sources.production_contract_hash_v1', 'gridex_received_sources.supply_period_source_basis_v1', 'gridex_received_sources.billing_supply_basis_v1',
  'public.gridex_end_customer_supply_v1', 'public.gridex_close_customer_lifecycle_v1']) await db.exec(definition(name))
await db.exec(`revoke all on function gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) from public;
 revoke all on function public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid) from public;grant execute on function public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid) to service_role;
 revoke all on function public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean) from public;grant execute on function public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean) to service_role;`)

// The received normal switch: the Z03 we sent, the grid owner's Z04 that confirmed it, the confirmed and activated period.
await db.exec(`insert into public.customers values('${customer}','${company}','active',null,null,null,null,now());
 insert into public.customer_sites values('${site}','${company}','${customer}','active',null,null,null,null);
 insert into public.metering_points values('${point}','${company}','${customer}','${site}','active',null,null,null,null);
 insert into public.customer_contracts(id,company_id,customer_id,metering_point_id,status,contract_version,signed_version,signed_at,version_snapshot,starts_at,binding_months)
  values('${contract}','${company}','${customer}','${point}','active','1','1','2026-08-20T10:00:00Z','{"price":"synthetic"}','2026-10-01',0);`)
await db.query(`insert into public.ediel_messages values($1,$2,'test','outbound','PRODAT','Z03',$3,$4),($5,$2,'test','inbound','PRODAT','Z04',$6,null)`, [z03, company, z03Raw, sha(z03Raw), z04, z04Raw])
await db.query(`insert into public.fixture_wires values($1,$2)`, [z04, { sender: '7300000000001', receiver: '7300000000003', objects: [sourceObject] }])
await db.exec(`insert into public.supplier_switch_requests values('${sw}','${company}','${customer}','${point}','${z04}','${z03}','accepted',false,null,null,null);
 insert into public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,source,source_message_id,status,created_at,updated_at,source_process,source_switch_request_id,metadata,market_start_at,market_state_version)
  values('${supply}','${company}','${customer}','${point}','${contract}','${contract}','2026-10-01','ediel_qualified_source','${z04}','confirmed_by_grid_owner','2026-09-01T10:00:00Z','2026-09-01T10:00:00Z','normal_switch','${sw}','{"normalSourceBasis":{"sourceMessageId":"${z04}"}}','2026-09-30T23:00:00Z',1);`)
await db.query(`insert into gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states)
  select $1,$2,$3,'Z04',$4,'[]',jsonb_build_array(to_jsonb(p)) from public.customer_supply_periods p where id=$5`, [z04, company, sha(z04Raw), JSON.stringify([sourceObject]), supply])
await db.query(`insert into gridex_received_sources.validation_assessments(source_message_id,company_id,environment,source_payload_hash,facts_text) values($1,$2,'test',$3,$4)`, [z04, company, sha(z04Raw), accepted])
await db.query(`insert into gridex_received_sources.normal_switch_confirmations select $1,$2,$3,$4,$5,$6,$7,gridex_received_sources.production_contract_hash_v1(c),$8,$9,'2026-09-30T23:00:00Z',$10,'{"status":"accepted"}','2026-09-01T10:00:00Z'
  from public.customer_contracts c where c.id=$7`, [z04, supply, company, sw, z03, sha(z03Raw), contract, sourceObject, { legalActorId: legalActor, legalEdielId: '7300000000003' }, { customer_id: customer, metering_point_id: point }])
// Activation (activate_customer_supply_v1): the period becomes active, the switch completed; the activation records the row.
await db.exec(`update public.customer_supply_periods set status='active',actual_start_date='2026-10-01',updated_at='2026-10-01T06:00:00Z',metadata=metadata||'{"activated_at":"2026-10-01T06:00:00Z"}' where id='${supply}';
 update public.supplier_switch_requests set status='completed' where id='${sw}';
 insert into gridex_received_sources.normal_supply_activations select id,company_id,'${z04}',null,null,to_jsonb(p),'{}','2026-10-01T06:00:00Z' from public.customer_supply_periods p where id='${supply}';`)

const basisOf = async (interval, c = company) => (await db.query('select gridex_received_sources.billing_supply_basis_v1($1,$2,$3,$4) b', [c, supply, interval[0], interval[1]])).rows[0].b
const qualified = async (interval, label, c = company) => { const b = await basisOf(interval, c); assert.ok(b && b.qualified === true && b.activated === true, label + ': ' + JSON.stringify(b)); count++; return b }
const refused = async (interval, label, c = company) => { assert.equal(await basisOf(interval, c), null, label); count++ }
const service = async (sql, args) => { await db.exec('set role service_role'); try { return await db.query(sql, args) } finally { await db.exec('reset role') } }
const lifecycleClose = (date = '2026-11-15', mode = 'move_out') => service('select public.gridex_close_customer_lifecycle_v1($1,$2,$3,$4,$5,$6,$7,false) r', [company, customer, actor, mode, date, 'Kunden har meddelat flytt per telefon.', 'Syntetisk anteckning.'])
const endSupply = (date = '2026-11-15', reason = 'move_out') => service('select public.gridex_end_customer_supply_v1($1,$2,$3,$4,$5) r', [company, customer, point, date, reason])
const scenario = async (fn) => { await db.exec('begin'); try { await fn() } finally { await db.exec('rollback') } }

// The installed world state before this slice: H3c (20261023201000).
await db.exec(h3c)
const before = { oct: await qualified(OCT, 'October before the move-out') }
const notice = (endedAt, reason = 'move_out') => db.exec(`update public.customer_contracts set termination_reason='${reason}',ended_at='${endedAt}' where id='${contract}'`)
const gridMarker = () => db.exec(`update public.customer_supply_periods set metadata=jsonb_set(metadata,'{planned_end_reason}','"grid_contract_ended"') where id='${supply}'`)

// Defect evidence on the shipped body.
await scenario(async () => { await lifecycleClose(); await notice('2026-12-15'); await refused(OCT, 'shipped: move_out contract running on after the move-out (October)'); await refused(NOV_SUPPLIED, 'shipped: final month') })
await scenario(async () => { await lifecycleClose(); await notice('2026-11-15', 'grid_contract_ended'); await gridMarker(); await refused(OCT, 'shipped: grid_contract_ended') })
await scenario(async () => { await lifecycleClose(); await notice('2026-11-15', 'customer_termination'); await refused(OCT, 'shipped: customer_termination') })
console.log(`Shipped supply_period_source_basis_v1 drops the basis when the contract runs on after the move-out (H3d D8): ${count} PASS`)
const shippedCount = count
const fnMeta = async () => (await db.query(`select to_jsonb(p)-'prosrc' m from pg_proc p where oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure`)).rows[0]
const metaBefore = await fnMeta()
const installed = (await db.query(`select prosrc from pg_proc where oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure`)).rows[0].prosrc

if (!process.argv.includes('--old')) await db.exec(migration)
const accepts = async (label) => {
  assert.deepEqual(await qualified(OCT, `${label}: October`), before.oct)
  await qualified(NOV_SUPPLIED, `${label}: November up to and including the move-out day`)
  await qualified(MOVE_OUT_DAY, `${label}: the move-out day`)
  await refused(DAY_AFTER, `${label}: the day after the move-out`)
  await refused(NOV, `${label}: November past the move-out`)
  await refused(BEFORE_START, `${label}: before the received market start`)
  await refused(OCT, `${label}: another tenant`, other)
}
for (const [label, end] of [['lifecycle close', () => lifecycleClose()], ['end supply', () => endSupply()]]) {
  await scenario(async () => { await end(); await notice('2026-12-15'); await accepts(`${label}, contract running on to 15 December`) })
  await scenario(async () => { await end(); await notice('2026-11-15'); await accepts(`${label}, contract ending on the move-out day (H3c unchanged)`) })
  await scenario(async () => { await end(); await notice('2026-11-15', 'customer_termination'); await accepts(`${label}, customer_termination`) })
}
await scenario(async () => { await lifecycleClose(); await gridMarker(); await notice('2027-01-15', 'grid_contract_ended'); await accepts("close 'grid_contract_ended' marker and reason") })
// Refusals.
const refusedAfter = async (setup, label) => scenario(async () => { await setup(); await refused(OCT, label); await refused(NOV_SUPPLIED, label + ' (final month)') })
await refusedAfter(async () => { await lifecycleClose(); await notice('2026-11-10') }, 'a contract ended before the move-out day')
await refusedAfter(async () => { await lifecycleClose(); await notice('2026-12-15', 'supplier_switch') }, "'supplier_switch'")
await refusedAfter(async () => { await lifecycleClose(); await notice('2026-12-15', 'customer_request') }, "'customer_request'")
await refusedAfter(async () => { await lifecycleClose(); await db.exec(`update public.customer_supply_periods set metadata=jsonb_set(metadata,'{planned_end_reason}','"other"') where id='${supply}'`); await notice('2026-12-15') }, 'another planned-end reason')
// A received planned end stays the upper bound, also for a contract that runs on after it.
await refusedAfter(async () => {
  await db.exec(`update public.customer_supply_periods set end_date='2026-11-30' where id='${supply}';
   update gridex_received_sources.normal_supply_activations set resulting_period=jsonb_set(resulting_period,'{end_date}','"2026-11-30"') where period_id='${supply}'`)
  await lifecycleClose(); await notice('2026-12-31')
  await db.exec(`update public.customer_supply_periods set end_date='2026-12-05' where id='${supply}'`)
}, 'a manual end extended past the received end')
await refusedAfter(async () => { await endSupply(); await notice('2026-12-15'); await db.exec(`update public.customer_supply_periods set end_date='2026-11-20',actual_end_date='2026-11-20' where id='${supply}'`) }, 'an end-supply end edited without its end key')
// A later Z05 earlier than the manual move-out: the move-out contract (ending on the move-out day or later) keeps the
// basis up to the received end (the H3c open item; the contract may end after its supply).
await scenario(async () => {
  await lifecycleClose()
  const raw = "UNH+Z05+PRODAT:D:97A:UN:E2SE6A'BGM+Z05+SYNTHETIC-Z05'LIN+1++735999000000000017:::9'CAV+Z23'DTM+93:202611110000:203'UNT+6+Z05'"
  await db.query(`insert into public.ediel_messages values($1,$2,'test','inbound','PRODAT','Z05',$3,null)`, [z05, company, raw])
  await db.query(`update public.customer_supply_periods set end_date='2026-11-11',market_end_at='2026-11-10T23:00:00Z',source_end_message_id=$1,status='ended',market_state_version=market_state_version+1,updated_at=now() where id=$2`, [z05, supply])
  await db.query(`insert into gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states)
    select $1,$2,$3,'Z05','[]','[]',jsonb_build_array(to_jsonb(p)) from public.customer_supply_periods p where id=$4`, [z05, company, sha(raw), supply])
  await db.query(`insert into gridex_received_sources.validation_assessments(source_message_id,company_id,environment,source_payload_hash,facts_text) values($1,$2,'test',$3,$4)`, [z05, company, sha(raw), accepted])
  await qualified(OCT, 'Z05 earlier than the move-out, move_out contract ending on the move-out day: October')
  await qualified(['2026-10-31T23:00:00Z', '2026-11-10T23:00:00Z'], 'Z05 earlier than the move-out: up to the received end')
  await refused(NOV_SUPPLIED, 'Z05 earlier than the move-out: not past the received end')
})

const after = (await db.query(`select prosrc from pg_proc where oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure`)).rows[0].prosrc
const pick = (name) => new RegExp(name + ' constant text := \\$c\\$([\\s\\S]*?)\\$c\\$;').exec(migration)[1]
assert.equal(after, installed.replace(pick('basis_old_contract'), pick('basis_new_contract')).replace(pick('basis_old_marker'), pick('basis_new_marker'))); count++
assert.deepEqual(await fnMeta(), metaBefore); count++
await assert.rejects(() => db.exec(migration), /h3d_contract_end_after_supply_rule_source_changed/); await db.exec('rollback'); count++
console.log(`supply_period_source_basis_v1 after 20261023203500 (H3d D8, contract end after the supply end): ${count - shippedCount} PASS`)
} finally { await db.close() }
