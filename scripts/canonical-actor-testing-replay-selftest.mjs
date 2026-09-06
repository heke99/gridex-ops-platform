// Full historical SQL on scoped predecessor fixtures, not canonical provenance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { PGlite } = await import(pathToFileURL(process.env.GRIDEX_PGLITE_MODULE).href);
const db = new PGlite();
try {
  await db.exec('create schema auth; create table auth.users(id uuid primary key); create table companies(id uuid primary key);');
  const file = read('supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql');
  const start = file.indexOf('create table if not exists public.ediel_messages (');
  assert(start >= 0);
  await db.exec(file.slice(start, file.indexOf('\n);',start)+4));
  for (const name of ['actor_test_results','ediel_test_runs','ediel_test_run_messages']) {
    await db.exec(read(`supabase/bootstrap/20260521_${name}_foundation.sql`));
  }
  await db.exec(`insert into companies values ('10000000-0000-0000-0000-000000000001');
    insert into actor_test_results(company_id,test_key,evidence) values ('10000000-0000-0000-0000-000000000001','synthetic','{"preserve":true}');
    insert into ediel_messages(company_id,direction,message_family) values ('10000000-0000-0000-0000-000000000001','outbound','PRODAT');
    insert into ediel_test_runs(company_id,role_code,test_suite,test_case_code) values ('10000000-0000-0000-0000-000000000001','supplier','synthetic','case');
    insert into ediel_test_run_messages(test_run_id,ediel_message_id) select r.id,m.id from ediel_test_runs r cross join ediel_messages m;`);
  const tables = ['actor_test_results','ediel_messages','ediel_test_runs','ediel_test_run_messages'];
  const before = {};
  for (const name of tables) before[name] = (await db.query(`select * from ${name}`)).rows;
  const indexes = {
    actor_test_results_message_refs_idx: ['company_id','contrl_message_id','aperak_message_id','utilts_err_message_id'],
    actor_test_results_run_idx: ['company_id','ediel_test_run_id'],
    ediel_test_runs_company_case_idx: ['company_id','test_suite','role_code','test_case_code','status','created_at'],
    ediel_test_run_messages_message_idx: ['ediel_message_id'],
    ediel_messages_actor_testing_lookup_idx: ['company_id','direction','message_family','message_code','created_at'],
  };
  const inspect = async () => (await db.query(`select i.relname, array_agg(a.attname order by k.ordinality) columns,
    bool_and(x.indisvalid and not x.indisunique and x.indpred is null) valid
    from pg_index x join pg_class i on i.oid=x.indexrelid
    cross join lateral unnest(x.indkey) with ordinality k(attnum,ordinality)
    join pg_attribute a on a.attrelid=x.indrelid and a.attnum=k.attnum
    where i.relname = any($1::text[]) group by i.relname order by i.relname`, [Object.keys(indexes)])).rows;
  assert.equal((await inspect()).length, 0, 'five source indexes absent from original fixture');
  const source = 'migrations/20260521_actor_testing_engine_automation.sql';
  for (let pass=1; pass<=2; pass++) {
    await db.exec(read('supabase/'+source));
    assert.deepEqual(await inspect(), Object.keys(indexes).sort().map(relname => ({relname,columns:indexes[relname],valid:true})));
    for (const name of tables) assert.deepEqual((await db.query(`select * from ${name}`)).rows,before[name]);
  }
  console.log('PASS: complete actor-testing SQL twice; five index definitions and existing evidence/messages unchanged');
  const result = spawnSync('python3',[new URL('scripts/gridex-replay-input-accounting.py',root).pathname],{encoding:'utf8'});
  const report=JSON.parse(result.stdout); assert.deepEqual(report.errors,[]);
  const row=report.migrations.find(row=>row.path===source);
  assert.equal(row?.classification,'FULL_FILE_SELECTED'); assert.equal(row.execution[0].stage,'foundation');
  const order=JSON.parse(read('scripts/gridex-aud-003-foundation-order.json')).foundation;
  for(const dep of ['migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql',...['actor_test_results','ediel_test_runs','ediel_test_run_messages'].map(name=>`bootstrap/20260521_${name}_foundation.sql`)]) {
    assert(order.indexOf(dep)>=0 && order.indexOf(dep)<order.indexOf(source),`${dep} before source`);
  }
  console.log('PASS: original actor-testing source selected after all required tables');
} finally { await db.close(); }
