// Execute the actual PR164 job suffix and complete production fair-claim SQL.
// PostgreSQL core only: full replay, production triggers and Supabase are not run.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')

const root = resolve(__dirname, '..')
const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8')
const claimSql = readFileSync(resolve(root, 'supabase/migrations/20260930215937_customer_operation_tenant_fair_atomic_claim.sql'), 'utf8')
const regressionSql = readFileSync(resolve(__dirname, 'pr164-review-remediation-regression.sql'), 'utf8')

function actualTable(name) {
  const definition = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(definition, `actual typed table absent: ${name}`)
  return definition
}
function actualJobCorridor() {
  const start = regressionSql.indexOf('  -- Job claiming: first claim and stale reclaim each increment attempts.')
  const declaration = regressionSql.match(/do \$regression\$\s*([\s\S]*?)\nbegin\n/)?.[1]
  assert.ok(start >= 0 && declaration, 'actual PR164 job corridor absent')
  // Only the earlier pricing/spot statements are omitted. Keep the real DO
  // declaration, job seed, claim/retry assertions, role commands and rollback.
  return `begin;\ndo $regression$\n${declaration}\nbegin\n${regressionSql.slice(start)}`
}
async function fixture() {
  const db = new PGlite()
  await db.exec(`create schema private;
    create role service_role bypassrls; create role anon; create role authenticated;
    create table public.companies(id uuid primary key,name text,slug text,status text,lifecycle_status text);
    create table public.customers(id uuid primary key,company_id uuid not null,customer_type text,status text,name text,email text,is_test_data boolean);
    ${actualTable('customer_operation_jobs')}
    ${actualTable('spot_price_monthly_summaries')}
    alter table public.customer_operation_jobs add primary key(id);
    grant usage on schema private to service_role;
    grant select on public.companies to service_role;
    grant select,insert,update on public.customer_operation_jobs to service_role;`)
  await db.exec(claimSql)
  return db
}
async function jobState(db) {
  return (await db.query(`select jsonb_build_object(
    'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by id),'[]'::jsonb) from public.customer_operation_jobs j),
    'turns',(select coalesce(jsonb_agg(to_jsonb(t) order by company_id),'[]'::jsonb) from private.customer_operation_tenant_turns t)
  ) as state`)).rows[0].state
}

test('actual PR164 first claim, stale reclaim and retry ceilings execute in the required service role and fully roll back', async () => {
  const db = await fixture()
  try {
    await db.exec(actualJobCorridor())
    assert.deepEqual(await jobState(db), { jobs: [], turns: [] })
    assert.equal((await db.query('select current_user as role')).rows[0].role, 'postgres')
    assert.equal((await db.query('select count(*)::int as count from public.companies')).rows[0].count, 0)
    assert.equal((await db.query('select count(*)::int as count from public.customers')).rows[0].count, 0)
  } finally { await db.close() }
})

test('postgres stays explicitly forbidden by the unmodified production claim guard', async () => {
  const db = await fixture()
  try {
    const before = await jobState(db)
    await assert.rejects(db.query("select * from public.gridex_claim_customer_operation_jobs('pr164-worker',1)"),
      error => error.code === '42501' && error.message === 'customer_operation_claim_service_required')
    assert.deepEqual(await jobState(db), before)
  } finally { await db.close() }
})

test('anonymous and authenticated roles retain denied EXECUTE with no queue or tenant-turn effects', async () => {
  const db = await fixture()
  try {
    const before = await jobState(db)
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1,'public.gridex_claim_customer_operation_jobs(text,integer)','EXECUTE') as allowed", [role])).rows[0].allowed, false)
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query("select * from public.gridex_claim_customer_operation_jobs('pr164-worker',1)"), error => error.code === '42501')
      await db.exec('reset role')
    }
    assert.deepEqual(await jobState(db), before)
  } finally { await db.close() }
})
