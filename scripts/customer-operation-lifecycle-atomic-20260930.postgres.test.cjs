// Exact candidate SQL, actual effect table/index shapes, PostgreSQL core.
// No complete Supabase history/triggers/RLS/native/concurrency qualification.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')
const schema = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf8')
const migration = readFileSync(resolve(__dirname, '../supabase/migrations/20260930230204_customer_operation_lifecycle_intent_atomic.sql'), 'utf8')
const tables = ['customer_operation_events','customer_operation_jobs','domain_events','event_outbox']
const indexes = ['customer_operation_events_company_idempotency_uidx','customer_operation_jobs_active_idempotency_uidx',
  'customer_operation_jobs_lifecycle_notification_uidx','domain_events_idempotency_key_idx','event_outbox_unique_named_destination_idx']
const id = n => `ea670000-0000-4000-8000-${String(n).padStart(12,'0')}`
const a=id(1), b=id(2), customer=id(11), sibling=id(12), foreign=id(13), site=id(21), siblingSite=id(22),
  point=id(31), siblingPoint=id(32), contract=id(41), siblingContract=id(42)
function actualTable(name) {
  const definition = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(definition, `actual effect table absent:${name}`)
  return definition
}
function actualIndex(name) {
  const definition = schema.match(new RegExp(`CREATE UNIQUE INDEX ${name} [^;]+;`))?.[0]
  assert.ok(definition, `actual index absent:${name}`)
  return definition
}
async function fixture() {
  const db = new PGlite()
  await db.exec(`create schema private; create role service_role bypassrls; create role anon; create role authenticated;
    create table public.companies(id uuid primary key);
    create table public.customers(id uuid primary key,company_id uuid not null);
    create table public.customer_sites(id uuid primary key,company_id uuid not null,customer_id uuid not null);
    create table public.metering_points(id uuid primary key,company_id uuid not null,customer_id uuid not null,site_id uuid,customer_site_id uuid);
    create table public.customer_contracts(id uuid primary key,company_id uuid not null,customer_id uuid not null,site_id uuid,customer_site_id uuid,metering_point_id uuid);
    ${tables.map(actualTable).join('\n')}
    ${tables.map(table => `alter table public.${table} add primary key(id);`).join('\n')}
    ${indexes.map(actualIndex).join('\n')}
    insert into public.companies values('${a}'),('${b}');
    insert into public.customers values('${customer}','${a}'),('${sibling}','${a}'),('${foreign}','${b}');
    insert into public.customer_sites values('${site}','${a}','${customer}'),('${siblingSite}','${a}','${sibling}');
    insert into public.metering_points values('${point}','${a}','${customer}','${site}','${site}'),('${siblingPoint}','${a}','${sibling}','${siblingSite}','${siblingSite}');
    insert into public.customer_contracts values('${contract}','${a}','${customer}','${site}','${site}','${point}'),('${siblingContract}','${a}','${sibling}','${siblingSite}','${siblingSite}','${siblingPoint}');
    grant usage on schema private to service_role;
    grant all on all tables in schema public to service_role;`)
  await db.exec(migration)
  return db
}
function event(patch={}) {
  return { company_id:a,customer_id:customer,customer_site_id:site,metering_point_id:point,contract_id:contract,
    customer_operation_job_id:null,operation_id:null,actor_user_id:null,aggregate_type:'customer_site',aggregate_id:site,
    event_code:'supplier_switch.requested',title:'Approved switch prepared',message:'Unsent intent only',status:'waiting_response',
    severity:'info',action_required:false,action_url:null,source:'customer_operations',visibility:'tenant',
    payload:{ marker:'approved',nested:{ a:1,b:2 } },idempotency_key:'atomic-approved-event',source_event_id:'atomic-approved-event',notification_template:'switch.started',...patch }
}
async function record(db, input=event(), role='service_role') {
  await db.exec(`set role ${role}`)
  try { return (await db.query('select public.gridex_record_customer_operation_event_v1($1::jsonb) as value',[JSON.stringify(input)])).rows[0].value }
  finally { await db.exec('reset role') }
}
async function effects(db) {
  return (await db.query(`select jsonb_build_object(${tables.map(table => `'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.${table} t)`).join(',')}) as value`)).rows[0].value
}
test('required operation/domain/fanout/notification intent commit together without transport', async () => {
  const db=await fixture()
  try {
    const receipt=await record(db), state=await effects(db)
    assert.equal(receipt.replayed,false); assert.equal(receipt.eventKey,'switch.started')
    for (const table of tables) assert.equal(state[table].length,1)
    assert.equal(state.customer_operation_events[0].id,receipt.operationEventId)
    assert.equal(state.domain_events[0].id,receipt.domainEventId)
    assert.equal(state.event_outbox[0].domain_event_id,receipt.domainEventId)
    assert.equal(state.event_outbox[0].status,'queued'); assert.equal(state.event_outbox[0].sent_at,null)
    assert.equal(state.customer_operation_jobs[0].id,receipt.notificationJobId)
    assert.equal(state.customer_operation_jobs[0].status,'queued'); assert.equal(state.customer_operation_jobs[0].attempts,0)
    assert.equal(state.customer_operation_jobs[0].idempotency_key,'lifecycle_notification:atomic-approved-event:switch.started')
    assert.deepEqual(state.customer_operation_jobs[0].payload,{event_type:'supplier_switch.requested',source_event_id:'atomic-approved-event',contract_id:contract,payload:event().payload})
  } finally { await db.close() }
})
test('late required-intent fault rolls back preceding actual rows and clean retry commits once', async () => {
  const db=await fixture()
  try {
    await db.exec(`create function private.proof_late_intent_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic_late_intent_fault' using errcode='P0001'; end$$;
      create trigger proof_late_intent_fault before insert on public.customer_operation_jobs for each row execute function private.proof_late_intent_fault();`)
    const before=await effects(db)
    await assert.rejects(record(db),error=>error.code==='P0001' && error.message==='synthetic_late_intent_fault')
    assert.deepEqual(await effects(db),before)
    await db.exec('drop trigger proof_late_intent_fault on public.customer_operation_jobs; drop function private.proof_late_intent_fault()')
    await record(db)
    for (const table of tables) assert.equal((await effects(db))[table].length,1)
  } finally { await db.close() }
})
test('permanent replay preserves terminal job and exact rows despite reordered JSON object keys', async () => {
  const db=await fixture()
  try {
    const first=await record(db)
    await db.exec("update public.customer_operation_jobs set status='completed',completed_at=clock_timestamp(),result='{\"prepared\":true}'")
    const before=await effects(db), replay=await record(db,event({payload:{nested:{b:2,a:1},marker:'approved'}}))
    assert.equal(replay.replayed,true); assert.equal(replay.notificationJobId,first.notificationJobId)
    assert.equal(replay.operationEventId,first.operationEventId); assert.equal(replay.domainEventId,first.domainEventId)
    assert.deepEqual(await effects(db),before)
  } finally { await db.close() }
})
test('changed valid intent, event status or tenant cannot reuse the same event key', async () => {
  const db=await fixture()
  try {
    await record(db); const before=await effects(db)
    for (const patch of [{payload:{marker:'different'}},{status:'completed'},
      {company_id:b,customer_id:foreign,customer_site_id:null,metering_point_id:null,contract_id:null,aggregate_type:'customer',aggregate_id:foreign}]) {
      await assert.rejects(record(db,event(patch)),error=>error.code==='23505' && error.message==='lifecycle_event_idempotency_conflict')
      assert.deepEqual(await effects(db),before)
    }
  } finally { await db.close() }
})
test('current customer/site/point/contract graph is required before fresh write or replay', async () => {
  const db=await fixture()
  try {
    const before=await effects(db)
    for(const patch of [{customer_site_id:siblingSite},{metering_point_id:siblingPoint},{contract_id:siblingContract}]) {
      await assert.rejects(record(db,event(patch)),error=>error.code==='23503')
      assert.deepEqual(await effects(db),before)
    }
    await record(db); const committed=await effects(db)
    await db.exec(`update public.metering_points set customer_id='${sibling}' where id='${point}'`)
    await assert.rejects(record(db),error=>error.code==='23503')
    assert.deepEqual(await effects(db),committed)
  } finally { await db.close() }
})
test('malformed or unmapped template and low database roles cannot fabricate notification intent', async () => {
  const db=await fixture()
  try {
    const before=await effects(db)
    for(const role of ['anon','authenticated']) await assert.rejects(record(db,event(),role),error=>error.code==='42501')
    await assert.rejects(record(db,event(), 'postgres'),error=>error.code==='42501')
    for(const patch of [{notification_template:'customer.welcome_active'},{event_code:'customer_data.z01_prepared'},{payload:[]},{unknown_field:true}])
      await assert.rejects(record(db,event(patch)),error=>error.code==='22023')
    assert.deepEqual(await effects(db),before)
  } finally { await db.close() }
})
test('conflicting canonical point/site aliases cannot authorize a lifecycle package', async () => {
  const db=await fixture()
  try {
    await db.exec(`update public.metering_points set customer_site_id='${siblingSite}' where id='${point}'`)
    const before=await effects(db)
    await assert.rejects(record(db),error=>error.code==='23503')
    assert.deepEqual(await effects(db),before)
  } finally { await db.close() }
})
test('unrecognized aggregate cannot attach a foreign resource to an otherwise valid customer', async () => {
  const db=await fixture()
  try {
    const before=await effects(db)
    await assert.rejects(record(db,event({aggregate_type:'unscoped_custom_resource',aggregate_id:siblingContract})),error=>error.code==='22023')
    assert.deepEqual(await effects(db),before)
  } finally { await db.close() }
})
test('a site-owned parent may select its verified point later; a different already-bound point cannot be substituted', async () => {
  const db=await fixture()
  try {
    const parent=id(51)
    await db.exec(`insert into public.customer_operation_jobs(id,company_id,customer_id,customer_site_id,job_type,status,idempotency_key)
      values('${parent}','${a}','${customer}','${site}','start_supplier_switch','running','parent-approved')`)
    const operation=(await db.query(`select operation_id from public.customer_operation_jobs where id='${parent}'`)).rows[0].operation_id
    const first=await record(db,event({customer_operation_job_id:parent,operation_id:operation}))
    assert.ok(first.notificationJobId)
    const before=await effects(db)
    await db.exec(`update public.customer_operation_jobs set metering_point_id='${siblingPoint}' where id='${parent}'`)
    await assert.rejects(record(db,event({customer_operation_job_id:parent,operation_id:operation})),error=>error.code==='23503')
    const after=await effects(db)
    for(const table of ['customer_operation_events','domain_events','event_outbox'])assert.deepEqual(after[table],before[table])
    assert.deepEqual(after.customer_operation_jobs.filter(row=>row.job_type==='dispatch_lifecycle_notification'),
      before.customer_operation_jobs.filter(row=>row.job_type==='dispatch_lifecycle_notification'))
  } finally { await db.close() }
})
