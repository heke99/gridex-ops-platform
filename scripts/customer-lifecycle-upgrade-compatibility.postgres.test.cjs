// Focused PostgreSQL-core regression, not a native Supabase/restore proof.
// Run with Node 22 and @electric-sql/pglite available through NODE_PATH.
// No network, hosted database, application worker or external dispatch is used.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')

const root = resolve(__dirname, '..')
const read = filename => readFileSync(resolve(root, 'supabase/migrations', filename), 'utf8')
const foundation = read('01_db1_schema_repair_core_helpers_and_canonical_tables.sql')
const historicalLifecycle = read('20260519_customer_move_out_lifecycle.sql')
const historicalBilling = read('20260522_batch4_multisite_duplicate_billing_hardening.sql')
const profile = read('20260930144853_customer_profile_facility_atomic_commands.sql')
const billing = read('20260930161500_customer_billing_profile_command.sql')
function required(source, expression) {
  const value = source.match(expression)?.[0]
  assert.ok(value, `SQL regression input not found: ${expression}`)
  return value
}
const customerTable = required(foundation, /create table if not exists public\.customers \([\s\S]*?\n\);/)
const normalizers = ['email', 'phone', 'personal_number', 'org_number'].map(name =>
  required(foundation, new RegExp(`create or replace function public\\.gridex_normalize_${name}\\([\\s\\S]*?\\$\\$;`)))
const prerequisites = profile.slice(0, profile.indexOf('-- Revisions cover every existing writer'))
  .match(/alter table public\.customers\b[^;]*;/g)?.join('\n')
assert.ok(prerequisites, 'customer prerequisites before revision writers must remain executable')
const trigger = required(profile, /create function private\.gridex_customer_legal_lifecycle_revision_v1\(\)[\s\S]*?\$function\$;/)
const triggerBinding = required(profile, /create trigger gridex_customer_legal_lifecycle_revision[\s\S]*?;/)
const billingColumns = required(billing, /alter table public\.customers\b[^;]*;/)
const billingInitializer = required(billing, /create function private\.gridex_billing_default_from_legacy_v1\([\s\S]*?\$initial\$;/)
const billingBackfill = required(billing, /update public\.customers c set billing_profile=[^;]*;/)
const id = 'ea610000-0000-4000-8000-000000000001'
const actor = 'ea610000-0000-4000-8000-000000000002'
const missingActor = 'ea610000-0000-4000-8000-000000000003'

async function fixture(shape) {
  const db = new PGlite()
  await db.exec(`create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create table public.companies(id uuid primary key);
    ${normalizers.join('\n')}
    ${customerTable}
    alter table public.customers add column name text;
    ${['billing_street', 'billing_postal_code', 'billing_city', 'billing_country'].map(name =>
      required(historicalBilling, new RegExp(`alter table public\\.customers add column if not exists ${name}\\b[^;]*;`))).join('\n')}`)
  // Test both reconstructed canonical absence and existing live legacy fields.
  // The 8-digit historical lifecycle source is intentionally NOT a canonical
  // replay input; its field definitions are used only for compatibility cases.
  if (shape !== 'absent') {
    const fields = shape === 'partial' ? ['lifecycle_closed_at', 'lifecycle_status_reason']
      : ['moved_out_at', 'lifecycle_closed_at', 'lifecycle_closed_by', 'lifecycle_status_reason']
    await db.exec(fields.map(name => required(historicalLifecycle,
      new RegExp(`alter table public\\.customers add column if not exists ${name}\\b[^;]*;`))).join('\n'))
  }
  await db.exec(`insert into auth.users(id) values('${actor}');
    insert into public.customers(id,name,first_name,last_name,full_name,email,billing_country,billing_street)
    values('${id}','Synthetic upgrade customer','Synthetic','Customer','Synthetic Customer',
      'contact-only@example.invalid','NO','Synthetic Norway Street');`)
  if (shape !== 'absent') {
    await db.exec(`update public.customers set lifecycle_closed_at='2026-08-21T12:34:56.123456Z',
      lifecycle_status_reason='Synthetic retained historical reason'${shape === 'complete'
        ? `,moved_out_at='2026-08-21',lifecycle_closed_by='${actor}'` : ''};`)
  }
  return db
}
async function installAndBackfill(db) {
  // These are exact candidate statements. In particular, trigger NEW/OLD
  // field access is evaluated by PostgreSQL, rather than a mocked RPC result.
  await db.exec(`${prerequisites}\n${trigger}\n${triggerBinding}\n${billingColumns}\n${billingInitializer}`)
  await db.exec(billingBackfill)
}
async function row(db) {
  return (await db.query(`select to_jsonb(c) as value from public.customers c where id='${id}'`)).rows[0].value
}

for (const shape of ['absent', 'partial', 'complete']) {
  test(`billing backfill succeeds on ${shape} lifecycle prerequisites without inventing or replacing closure data`, async () => {
    const db = await fixture(shape)
    try {
      const before = await row(db)
      await installAndBackfill(db)
      const after = await row(db)
      assert.equal(after.email, before.email)
      assert.equal(after.billing_country, 'NO')
      assert.deepEqual(after.billing_profile, { recipient: 'Synthetic Customer', street: 'Synthetic Norway Street', country: 'NO' })
      assert.equal(after.profile_revision, 0)
      assert.equal(after.legal_profile_revision, 0)
      assert.equal(after.lifecycle_revision, 0)
      assert.equal(after.billing_profile_revision, 0)
      for (const field of ['moved_out_at', 'lifecycle_closed_at', 'lifecycle_closed_by', 'lifecycle_status_reason']) {
        assert.equal(after[field], before[field] ?? null, `${field} existing value or intentional null must be preserved`)
      }
      const columns = (await db.query(`select column_name,data_type,is_nullable from information_schema.columns
        where table_schema='public' and table_name='customers'
          and column_name in ('moved_out_at','lifecycle_closed_at','lifecycle_closed_by','lifecycle_status_reason')
        order by column_name`)).rows
      assert.deepEqual(columns, [
        { column_name: 'lifecycle_closed_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
        { column_name: 'lifecycle_closed_by', data_type: 'uuid', is_nullable: 'YES' },
        { column_name: 'lifecycle_status_reason', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'moved_out_at', data_type: 'date', is_nullable: 'YES' },
      ])
    } finally { await db.close() }
  })
}

test('legal and lifecycle revisions stay separate, ignore forged counters and retain actor referential integrity', async () => {
  const db = await fixture('absent')
  try {
    await installAndBackfill(db)
    await db.exec(`update public.customers set first_name='Corrected',legal_profile_revision=999,lifecycle_revision=999 where id='${id}'`)
    let current = await row(db)
    assert.equal(current.legal_profile_revision, 1)
    assert.equal(current.lifecycle_revision, 0)
    await db.exec(`update public.customers set status='moved',moved_out_at='2026-09-30',
      lifecycle_closed_at='2026-09-30T12:00:00Z',lifecycle_closed_by='${actor}',
      lifecycle_status_reason='Synthetic closure' where id='${id}'`)
    current = await row(db)
    assert.equal(current.legal_profile_revision, 1)
    assert.equal(current.lifecycle_revision, 1)
    await db.exec(`update public.customers set moved_out_at='2026-09-30',legal_profile_revision=999,
      lifecycle_revision=999 where id='${id}'`)
    assert.equal((await row(db)).lifecycle_revision, 1)
    await assert.rejects(db.exec(`update public.customers set lifecycle_closed_by='${missingActor}' where id='${id}'`),
      error => error.code === '23503')
    assert.deepEqual(await row(db), current)
    await db.exec(`delete from auth.users where id='${actor}'`)
    const withoutActor = await row(db)
    assert.equal(withoutActor.lifecycle_closed_by, null)
    assert.equal(withoutActor.lifecycle_revision, 2)
    assert.equal(withoutActor.moved_out_at, '2026-09-30')
    assert.equal(withoutActor.lifecycle_status_reason, 'Synthetic closure')
  } finally { await db.close() }
})
