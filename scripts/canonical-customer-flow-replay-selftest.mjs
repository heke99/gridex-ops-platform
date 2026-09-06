// Isolated historical source effects; not canonical replay or live parity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const table = (file, name) => {
  const text = read(file);
  const start = text.indexOf(`create table if not exists public.${name} (`);
  assert(start >= 0, `${name} predecessor exists`);
  return text.slice(start, text.indexOf('\n);', start) + 4);
};
const { PGlite } = await import(pathToFileURL(process.env.GRIDEX_PGLITE_MODULE).href);
const db = new PGlite();
try {
  await db.exec('create schema auth; create table auth.users(id uuid primary key); create table companies(id uuid primary key); create table customers(id uuid primary key);');
  const foundation = read('supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql');
  const start = foundation.indexOf('create or replace function public.gridex_normalize_facility_id(');
  assert(start >= 0);
  await db.exec(foundation.slice(start, foundation.indexOf('$$;', start) + 3));
  await db.exec(table('supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql', 'customer_sites'));
  await db.exec(table('supabase/bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql', 'customer_info_requests'));
  await db.exec(read('supabase/bootstrap/20260528_route_decision_logs_foundation.sql'));
  await db.exec(read('supabase/bootstrap/20260528_route_decision_logs_current_supplier_foundation.sql'));
  await db.exec(`insert into companies values ('10000000-0000-0000-0000-000000000001');
    insert into customers values ('20000000-0000-0000-0000-000000000001');
    insert into customer_sites(company_id,customer_id,site_name) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic');
    insert into customer_info_requests(company_id,customer_id,blocker_reason,received_at) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','preserve','2026-01-01Z');`);
  const before = (await db.query('select * from customer_info_requests')).rows;
  const columns = ['current_supplier_response_status','current_supplier_contract_status','current_supplier_contract_end_date','current_supplier_notice_period','current_supplier_termination_fee'];
  const baseline = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='customer_sites'")).rows.map(row => row.column_name);
  assert(columns.every(name => !baseline.includes(name)), 'Narrow bootstrap omits all five supplier fields');
  const source = 'migrations/20260528_batch_1_completion_customer_flow.sql';
  for (let pass = 1; pass <= 2; pass++) {
    await db.exec(read('supabase/' + source));
    const actual = (await db.query("select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='customer_sites' and column_name like 'current_supplier_%' order by column_name")).rows.filter(row => columns.includes(row.column_name));
    assert.deepEqual(actual, columns.slice().sort().map(column_name => ({column_name, data_type: column_name.endsWith('_date') ? 'date' : column_name.endsWith('_fee') ? 'numeric' : 'text', is_nullable:'YES'})));
    assert.deepEqual((await db.query('select * from customer_info_requests')).rows, before, 'Existing request fields and rows preserved');
    if (pass === 1) await db.exec("update customer_sites set current_supplier_response_status='received',current_supplier_termination_fee=123.45");
    assert.deepEqual((await db.query('select current_supplier_response_status,current_supplier_termination_fee::text fee from customer_sites')).rows, [{current_supplier_response_status:'received',fee:'123.45'}]);
    assert.equal((await db.query("select count(*)::int n from pg_indexes where schemaname='public' and indexname='route_decision_logs_current_supplier_idx'")).rows[0].n, 1);
  }
  assert.equal((await db.query('select site_name from customer_sites')).rows[0].site_name, 'synthetic');
  console.log('PASS: complete customer-flow SQL runs twice; five supplier fields restored; request data and route index preserved');
  const result = spawnSync('python3', [new URL('scripts/gridex-replay-input-accounting.py', root).pathname], {encoding:'utf8'});
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  const row = report.migrations.find(row => row.path === source);
  assert.equal(row?.classification, 'FULL_FILE_SELECTED');
  assert.equal(row.execution[0].stage, 'foundation');
  const order = JSON.parse(read('scripts/gridex-aud-003-foundation-order.json')).foundation;
  for (const prerequisite of ['migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql','bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql','bootstrap/20260528_route_decision_logs_foundation.sql']) {
    assert(order.indexOf(prerequisite) >= 0 && order.indexOf(prerequisite) < order.indexOf(source), `${prerequisite} precedes complete source`);
  }
  console.log('PASS: entire pre-ledger source selected after required foundation tables');
} finally { await db.close(); }
