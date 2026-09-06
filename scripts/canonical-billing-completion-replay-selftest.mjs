// Complete historical source on scoped predecessor DDL; not canonical/live parity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const extractTable = (text, name) => {
  const start = text.indexOf(`create table if not exists public.${name} (`);
  assert(start >= 0, `actual predecessor ${name}`);
  return text.slice(start, text.indexOf('\n);', start) + 4);
};
const { PGlite } = await import(pathToFileURL(process.env.GRIDEX_PGLITE_MODULE).href);
const db = new PGlite();
try {
  await db.exec('create schema auth; create table auth.users(id uuid primary key); create table companies(id uuid primary key); create table customers(id uuid primary key); create table metering_permissions(id uuid primary key); create table billing_underlays(id uuid primary key);');
  const core = read('supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql');
  const auxiliary = read('supabase/bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql');
  for (const name of ['billing_export_runs','billing_export_run_items','partner_exports']) await db.exec(extractTable(core,name));
  for (const name of ['metering_permission_sites','customer_info_requests']) await db.exec(extractTable(auxiliary,name));
  const missingAlias = await db.query("select column_name from information_schema.columns where table_name='billing_export_run_items' and column_name='billing_export_run_id'");
  assert.equal(missingAlias.rows.length,0,'core has export_run_id, not the later billing_export_run_id');
  const source = 'migrations/20260520_batch_3_4_final_completion.sql';
  // Prove that selecting the source before its real auxiliary prerequisite fails.
  await db.exec('begin');
  await assert.rejects(db.exec(read('supabase/'+source)), /billing_export_run_id/);
  await db.exec('rollback');
  const start = auxiliary.indexOf('create table if not exists public.billing_export_run_items (');
  const end = auxiliary.indexOf('\ndo $$', auxiliary.indexOf('create index if not exists billing_export_run_items_company_underlay_idx',start));
  assert(start>=0 && end>start);
  await db.exec(auxiliary.slice(start,end));
  await db.exec(`insert into companies values ('10000000-0000-0000-0000-000000000001');
    insert into customers values ('20000000-0000-0000-0000-000000000001');
    insert into metering_permissions values ('30000000-0000-0000-0000-000000000001');
    insert into metering_permission_sites(company_id,customer_id,metering_permission_id,facility_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic');
    insert into customer_info_requests(company_id,customer_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
    insert into billing_export_runs(company_id,metadata,updated_at) values ('10000000-0000-0000-0000-000000000001','{"preserve":true}','2026-01-01Z');
    insert into billing_export_run_items(company_id,billing_export_run_id,readiness_status,payload_snapshot) select company_id,id,'ready','{}' from billing_export_runs;
    insert into partner_exports(company_id,target_system,export_batch_key) values ('10000000-0000-0000-0000-000000000001','synthetic','batch');`);
  const tables=['metering_permission_sites','customer_info_requests','billing_export_runs','billing_export_run_items','partner_exports'];
  const before={}; for(const name of tables) before[name]=(await db.query(`select * from ${name}`)).rows;
  const expected={
    metering_permission_sites_company_status_facility_idx:'metering_permission_sites USING btree (company_id, status, facility_id, grid_area_code)',
    customer_info_requests_company_customer_status_idx:'customer_info_requests USING btree (company_id, customer_id, status, created_at DESC)',
    billing_export_run_items_company_run_status_idx:'billing_export_run_items USING btree (company_id, billing_export_run_id, status)',
    partner_exports_company_batch_idx:'partner_exports USING btree (company_id, export_batch_key, status, created_at DESC)',
  };
  const indexes=async()=>(await db.query('select indexname,indexdef from pg_indexes where schemaname=$1 and indexname=any($2::text[]) order by indexname',['public',Object.keys(expected)])).rows;
  assert.equal((await indexes()).length,0,'all four indexes absent from predecessor fixture');
  for(let pass=1;pass<=2;pass++) {
    await db.exec(read('supabase/'+source));
    assert.deepEqual(await indexes(),Object.keys(expected).sort().map(indexname=>({indexname,indexdef:`CREATE INDEX ${indexname} ON public.${expected[indexname]}`})));
    for(const name of tables) assert.deepEqual((await db.query(`select * from ${name}`)).rows,before[name],`${name} rows preserved`);
  }
  console.log('PASS: full billing-completion source twice; four exact indexes; all five tables preserve rows; incorrect prerequisite order rejected');
  const result=spawnSync('python3',[new URL('scripts/gridex-replay-input-accounting.py',root).pathname],{encoding:'utf8'});
  const report=JSON.parse(result.stdout);assert.deepEqual(report.errors,[]);
  const row=report.migrations.find(row=>row.path===source);assert.equal(row?.classification,'FULL_FILE_SELECTED');assert.equal(row.execution[0].stage,'foundation');
  const order=JSON.parse(read('scripts/gridex-aud-003-foundation-order.json')).foundation;
  for(const dep of ['migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql','bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql']) assert(order.indexOf(dep)>=0 && order.indexOf(dep)<order.indexOf(source));
  console.log('PASS: complete billing source selected after actual table and column prerequisites');
} finally { await db.close(); }
