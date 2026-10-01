// PostgreSQL-core load/isolation proof. This is not native Supabase, a WAF
// exercise, an external provider test or a deployed performance qualification.
// Run using Node 22 with @electric-sql/pglite available through NODE_PATH.
const assert = require('node:assert/strict')
const { readdirSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { performance } = require('node:perf_hooks')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')

const migrations = resolve(__dirname, '../supabase/migrations')
function latestFunction(name) {
  const expression = new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?as (\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1;`, 'i')
  const versions = readdirSync(migrations).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort()
    .map(filename => ({ filename, sql: readFileSync(resolve(migrations, filename), 'utf8').match(expression)?.[0] }))
    .filter(candidate => candidate.sql)
  assert.ok(versions.length, `Actual function missing: ${name}`)
  return versions.at(-1)
}
const tenantA = 'ea620000-0000-4000-8000-000000000001'
const tenantB = 'ea620000-0000-4000-8000-000000000002'
const clientA = 'ea620000-0000-4000-8000-000000000011'
const clientB = 'ea620000-0000-4000-8000-000000000012'
const sameTenantClient = 'ea620000-0000-4000-8000-000000000013'

async function customerJobs() {
  const db = new PGlite()
  // Exact production claim function, deliberately focused typed prerequisites.
  // A full native history replay supplies the actual constraints and grants.
  await db.exec(`create role service_role bypassrls; create role anon; create role authenticated; create schema private;
    create table public.companies(id uuid primary key,status text);
    create table public.customer_operation_jobs(
      id uuid primary key default gen_random_uuid(),company_id uuid not null,
      status text not null default 'queued',priority smallint not null default 100,
      run_after timestamptz not null default now(),created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),attempts integer not null default 0,max_attempts integer not null default 5,
      lifecycle_blocked_by_tenant boolean not null default false,locked_at timestamptz,locked_by text,
      lock_token uuid,heartbeat_at timestamptz,completed_at timestamptz,last_error text,last_error_code text,
      last_error_message text,stale_reason text);
    insert into public.companies values('${tenantA}','active'),('${tenantB}','active');
    grant usage on schema public,private to service_role;
    grant all on public.companies,public.customer_operation_jobs to service_role;`)
  const selected = latestFunction('gridex_claim_customer_operation_jobs')
  // The new forward supplies its private turn table and real ACL as well.
  await db.exec(selected.filename === '20260930215937_customer_operation_tenant_fair_atomic_claim.sql'
    ? readFileSync(resolve(migrations, selected.filename), 'utf8') : selected.sql)
  await db.exec('set role service_role')
  return db
}
test('a quiet tenant receives customer-operation work within the first bounded batch despite an older noisy backlog', async () => {
  const db = await customerJobs()
  try {
    await db.exec(`insert into public.customer_operation_jobs(company_id,run_after,created_at)
      select '${tenantA}',now()-interval '2 hours',now()-interval '2 hours' from generate_series(1,250);
      insert into public.customer_operation_jobs(company_id,run_after,created_at)
      values('${tenantB}',now()-interval '1 hour',now()-interval '1 hour');`)
    const started = performance.now()
    const claimed = (await db.query(`select id,company_id from public.gridex_claim_customer_operation_jobs('synthetic-load-worker',20)`)).rows
    console.log(`CUSTOMER_QUEUE_CORE_SAMPLE function=${latestFunction('gridex_claim_customer_operation_jobs').filename} noisy_due=250 quiet_due=1 limit=20 claimed=${claimed.length} quiet_claimed=${claimed.filter(row => row.company_id === tenantB).length} elapsed_ms=${(performance.now()-started).toFixed(3)}`)
    assert.ok(claimed.some(row => row.company_id === tenantB), 'older noisy backlog must not consume the whole shared customer queue batch')
    assert.ok(claimed.filter(row => row.company_id === tenantA).length<=5)
  } finally { await db.close() }
})

test('limit-one customer worker invocations rotate durable turns and preserve priority within each tenant', async () => {
  const db = await customerJobs()
  try {
    await db.exec(`insert into public.customer_operation_jobs(company_id,priority,run_after,created_at)
      values('${tenantA}',100,now()-interval '2 hours',now()-interval '2 hours'),
        ('${tenantA}',50,now()-interval '1 hour',now()-interval '1 hour'),
        ('${tenantB}',100,now()-interval '1 hour',now()-interval '1 hour');`)
    const first = (await db.query(`select company_id,priority from public.gridex_claim_customer_operation_jobs('synthetic-rotation-worker',1)`)).rows
    const second = (await db.query(`select company_id,priority from public.gridex_claim_customer_operation_jobs('synthetic-rotation-worker',1)`)).rows
    assert.deepEqual(first,[{company_id:tenantA,priority:50}])
    assert.deepEqual(second,[{company_id:tenantB,priority:100}])
  } finally { await db.close() }
})

test('retry terminalization work is bounded while another tenant still receives a claim', async () => {
  const db = await customerJobs()
  try {
    await db.exec(`insert into public.customer_operation_jobs(company_id,attempts,max_attempts,run_after)
      select '${tenantA}',5,5,now()-interval '2 hours' from generate_series(1,35);
      insert into public.customer_operation_jobs(company_id,run_after) values('${tenantB}',now()-interval '1 hour');`)
    const claimed = (await db.query(`select company_id from public.gridex_claim_customer_operation_jobs('synthetic-bounded-cleanup-worker',1)`)).rows
    assert.deepEqual(claimed,[{company_id:tenantB}])
    assert.equal((await db.query("select count(*)::int as count from public.customer_operation_jobs where status='failed'")).rows[0].count,1)
  } finally { await db.close() }
})

test('customer queue keeps paused and lifecycle-blocked rows unclaimed and terminalizes exhausted retries', async () => {
  const db = await customerJobs()
  try {
    await db.exec(`update public.companies set status='paused' where id='${tenantA}';
      insert into public.customer_operation_jobs(company_id,run_after,attempts,max_attempts)
      values('${tenantA}',now()-interval '1 hour',0,5),('${tenantB}',now()-interval '1 hour',5,5);
      insert into public.customer_operation_jobs(company_id,run_after,lifecycle_blocked_by_tenant)
      values('${tenantB}',now()-interval '1 hour',true);`)
    assert.deepEqual((await db.query(`select id from public.gridex_claim_customer_operation_jobs('synthetic-isolation-worker',20)`)).rows, [])
    const rows = (await db.query('select company_id,status,attempts,lifecycle_blocked_by_tenant from public.customer_operation_jobs order by attempts,company_id')).rows
    assert.equal(rows.filter(row => row.status === 'queued').length, 2)
    assert.equal(rows.find(row => row.attempts === 5).status, 'failed')
  } finally { await db.close() }
})

test('client-route quota denies noisy requests without consuming another tenant or client bucket', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create table public.integration_api_clients(id uuid primary key,company_id uuid,status text);
      create table public.integration_api_rate_limit_buckets(api_client_id uuid,company_id uuid,route text,
        window_started_at timestamptz,request_count integer not null default 0,updated_at timestamptz,
        primary key(api_client_id,route,window_started_at));
      insert into public.integration_api_clients values('${clientA}','${tenantA}','active'),
        ('${clientB}','${tenantB}','active'),('${sameTenantClient}','${tenantA}','active');
      ${latestFunction('integration_api_rate_limit_check').sql}`)
    const elapsed = [], outcomes = []
    for (let index = 0; index < 100; index++) {
      const started = performance.now()
      outcomes.push((await db.query(`select * from public.integration_api_rate_limit_check('${clientA}','/synthetic/customer/profile',5,3600)`)).rows[0])
      elapsed.push(performance.now()-started)
    }
    assert.equal(outcomes.filter(row => row.allowed).length, 5)
    assert.equal(outcomes.filter(row => !row.allowed).length, 95)
    const quiet = (await db.query(`select * from public.integration_api_rate_limit_check('${clientB}','/synthetic/customer/profile',5,3600)`)).rows[0]
    const separateClient = (await db.query(`select * from public.integration_api_rate_limit_check('${sameTenantClient}','/synthetic/customer/profile',5,3600)`)).rows[0]
    assert.equal(quiet.allowed, true); assert.equal(quiet.request_count, 1)
    assert.equal(separateClient.allowed, true); assert.equal(separateClient.request_count, 1)
    const counters = (await db.query('select api_client_id,company_id,request_count from public.integration_api_rate_limit_buckets order by api_client_id')).rows
    assert.deepEqual(counters, [
      { api_client_id: clientA, company_id: tenantA, request_count: 100 },
      { api_client_id: clientB, company_id: tenantB, request_count: 1 },
      { api_client_id: sameTenantClient, company_id: tenantA, request_count: 1 },
    ])
    elapsed.sort((a,b) => a-b)
    console.log(`API_QUOTA_CORE_SAMPLE noisy_requests=100 allowed=5 denied=95 quiet_count=1 same_tenant_other_client_count=1 p50_ms=${elapsed[49].toFixed(3)} p95_ms=${elapsed[94].toFixed(3)}`)
  } finally { await db.close() }
})
