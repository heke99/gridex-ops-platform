// Scoped historical status DDL verification; no production execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const source='migrations/20260521_final_customer_info_request_status_check.sql';
const prerequisite='bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql';
const statuses=['draft','missing_authorization','ready_to_send','z01_prepared','route_missing','sent_to_grid_owner','waiting_for_contrl','waiting_for_aperak','waiting_for_z02','z02_received','negative_aperak','manual_review_required','missing_binding_info','missing_termination_info','ready_for_switch','cancelled','rejected','completed','blocked'];
const {PGlite}=await import(pathToFileURL(process.env.GRIDEX_PGLITE_MODULE).href);
const db=new PGlite();
try {
  await db.exec('create schema auth; create table auth.users(id uuid primary key); create table companies(id uuid primary key); create table customers(id uuid primary key);');
  const ddl=read('supabase/'+prerequisite); const start=ddl.indexOf('create table if not exists public.customer_info_requests ('); assert(start>=0);
  await db.exec(ddl.slice(start,ddl.indexOf('\n);',start)+4));
  await db.exec(`insert into companies values ('10000000-0000-0000-0000-000000000001'); insert into customers values ('20000000-0000-0000-0000-000000000001');
    insert into customer_info_requests(company_id,customer_id,status,notes) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','draft','preserve');`);
  const inspect=async()=>(await db.query("select conname,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='customer_info_requests'::regclass order by conname")).rows;
  const baseline=await inspect(); const touched=baseline.filter(row=>/status/i.test(row.definition));
  assert.deepEqual(touched.map(row=>row.conname),['customer_info_requests_status_check'],'the historical broad removal has exactly one target at this foundation point');
  for(const value of ['z01_prepared','route_missing']) await assert.rejects(db.query('update customer_info_requests set status=$1',[value]),/customer_info_requests_status_check/);
  const before=(await db.query('select * from customer_info_requests')).rows;
  for(let pass=1;pass<=2;pass++) {
    await db.exec(read('supabase/'+source));
    assert.deepEqual((await db.query('select * from customer_info_requests')).rows,before,'DDL preserves existing requests');
    const constraints=await inspect();
    assert.deepEqual(constraints.filter(row=>row.conname!=='customer_info_requests_status_check'),baseline.filter(row=>row.conname!=='customer_info_requests_status_check'),'PK and FKs unchanged');
    const statusCheck=constraints.find(row=>row.conname==='customer_info_requests_status_check');assert.equal(statusCheck.convalidated,true);
    assert.deepEqual([...statusCheck.definition.matchAll(/'([^']+)'::text/g)].map(match=>match[1]),statuses,'exact allowed business states');
    await db.exec('begin');
    for(const value of statuses) await db.query('update customer_info_requests set status=$1',[value]);
    await assert.rejects(db.query('update customer_info_requests set status=$1',['unknown_state']),/customer_info_requests_status_check/);
    await db.exec('rollback');
  }
  // An invalid pre-existing value must stop and roll back the entire DO statement.
  await db.exec('alter table customer_info_requests drop constraint customer_info_requests_status_check; update customer_info_requests set status=\'unknown_state\';');
  await assert.rejects(db.exec(read('supabase/'+source)),/customer_info_requests_status_check/);
  assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='customer_info_requests'::regclass and conname='customer_info_requests_status_check'")).rows[0].n,0,'failed validation rolls back new constraint');
  assert.equal((await db.query('select status from customer_info_requests')).rows[0].status,'unknown_state','invalid data not silently rewritten');
  console.log('PASS: complete status source twice; 19 exact states; rows/PK/FKs preserved; dirty data blocks atomically');
  const result=spawnSync('python3',[new URL('scripts/gridex-replay-input-accounting.py',root).pathname],{encoding:'utf8'});const report=JSON.parse(result.stdout);assert.deepEqual(report.errors,[]);
  const row=report.migrations.find(row=>row.path===source);assert.equal(row?.classification,'FULL_FILE_SELECTED');assert.equal(row.execution[0].stage,'foundation');
  const order=JSON.parse(read('scripts/gridex-aud-003-foundation-order.json')).foundation;
  assert.equal(order.indexOf(source),order.indexOf(prerequisite)+1,'status source immediately follows first request-table definition');
  for(const name of order.slice(0,order.indexOf(prerequisite))) assert(!read('supabase/'+name).includes('customer_info_requests'),'review earlier request-table consumers if foundation changes');
  console.log('PASS: status source selected at the reviewed foundation boundary');
} finally {await db.close();}
