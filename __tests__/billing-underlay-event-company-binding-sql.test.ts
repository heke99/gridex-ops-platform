import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Execute the actual table DDL, event constraints/policies and forward SQL.
// Parent/auth fixtures are finite: this is no native, JWT or full-finance proof.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020152427_db_billing_underlay_event_company_binding.sql', 'utf8')
const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const underlay = '33333333-3333-4333-8333-333333333333'
const otherUnderlay = '44444444-4444-4444-8444-444444444444'
const event = '55555555-5555-4555-8555-555555555555'
const legacyEvent = '66666666-6666-4666-8666-666666666666'
const constraint = 'billing_underlay_events_company_underlay_fk'
let db: PGlite

function source(pattern: RegExp): string {
  const sql = schema.match(pattern)?.[0]
  if (!sql) throw new Error('Production SQL not found: ' + pattern.source)
  return sql
}

type Transaction = Pick<PGlite, 'query' | 'exec'>
async function asTenant<T>(action: (tx: Transaction) => Promise<T>): Promise<T> {
  await db.exec('savepoint tenant_action')
  try {
    await db.query("select set_config('fixture.company_id',$1,true)", [company])
    await db.exec('set local role authenticated')
    const result = await action(db)
    await db.exec('reset role; release savepoint tenant_action')
    return result
  } catch (error) {
    await db.exec('rollback to savepoint tenant_action; release savepoint tenant_action')
    throw error
  }
}

async function insert(owner: string, parent: string | null, id = event) {
  return asTenant(tx => tx.query(`insert into public.billing_underlay_events
    (id,company_id,billing_underlay_id,event_type) values($1,$2,$3,'fixture')`, [id, owner, parent]))
}

async function events() {
  return (await db.query('select id,company_id,billing_underlay_id from public.billing_underlay_events order by id')).rows
}

describe('billing underlay event company binding', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role authenticated nologin;
      create role service_role nologin;
      create table public.companies(id uuid primary key);
      create function public.gridex_user_is_platform_admin() returns boolean language sql as 'select false';
      create function public.gridex_is_current_session_allowed() returns boolean language sql as 'select true';
      create function public.gridex_can_write_company(c uuid) returns boolean language sql
        as $$select c=nullif(current_setting('fixture.company_id',true),'')::uuid$$;
      create function public.gridex_can_read_company(c uuid) returns boolean language sql
        as $$select public.gridex_can_write_company(c)$$;
      create function public.gridex_user_company_ids() returns setof uuid language sql
        as $$select nullif(current_setting('fixture.company_id',true),'')::uuid$$;`)
    for (const table of ['billing_underlays', 'billing_underlay_events']) {
      await db.exec(source(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`)))
      await db.exec(source(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n    ADD CONSTRAINT ${table}_pkey [^;]+;`)))
    }
    await db.exec(source(/CREATE UNIQUE INDEX billing_underlays_company_id_id_uidx [^;]+;/))
    for (const name of ['billing_underlay_events_billing_underlay_id_fkey', 'billing_underlay_events_company_id_fkey']) {
      await db.exec(source(new RegExp(`ALTER TABLE ONLY public\\.billing_underlay_events\\n    ADD CONSTRAINT ${name} [^;]+;`)))
    }
    await db.exec(source(/ALTER TABLE public\.billing_underlay_events ENABLE ROW LEVEL SECURITY;/))
    for (const policy of schema.matchAll(/CREATE POLICY [^\n]+ ON public\.billing_underlay_events [^\n]+;/g)) {
      await db.exec(policy[0])
    }
    await db.exec(source(/GRANT ALL ON TABLE public\.billing_underlay_events TO authenticated;/))
    // The finite parent policy makes the foreign parent invisible to the caller.
    // FK enforcement must still reject its known ID, independently of SELECT RLS.
    await db.exec(`alter table public.billing_underlays enable row level security;
      create policy fixture_parent_select on public.billing_underlays for select to authenticated
        using(public.gridex_can_read_company(company_id));
      grant select on public.billing_underlays to authenticated;`)
  }, 30_000)

  beforeEach(async () => {
    await db.exec('begin')
    await db.query('insert into public.companies(id) values($1),($2)', [company, otherCompany])
    await db.query('insert into public.billing_underlays(id,company_id) values($1,$2),($3,$4)', [underlay, company, otherUnderlay, otherCompany])
    // Existing rows are deliberately not repaired or certified by a NOT VALID FK.
    await db.query(`insert into public.billing_underlay_events(id,company_id,billing_underlay_id,event_type)
      values($1,$2,$3,'historical_fixture')`, [legacyEvent, company, otherUnderlay])
    await db.exec(forward)
  })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('allows owned and unattached events while the caller cannot select a foreign parent', async () => {
    expect((await asTenant(tx => tx.query('select id from public.billing_underlays order by id'))).rows)
      .toEqual([{ id: underlay }])
    await insert(company, underlay)
    await insert(company, null, '77777777-7777-4777-8777-777777777777')
    expect((await events()).filter(row => row.id !== legacyEvent)).toEqual([
      { id: event, company_id: company, billing_underlay_id: underlay },
      { id: '77777777-7777-4777-8777-777777777777', company_id: company, billing_underlay_id: null },
    ])
  })

  it('rejects an own-company event referencing a known foreign parent', async () => {
    await expect(insert(company, otherUnderlay)).rejects.toMatchObject({ code: '23503', constraint })
    expect((await events()).map(row => row.id)).toEqual([legacyEvent])
  })

  it('rejects parent reassignment without changing the previously owned event', async () => {
    await insert(company, underlay)
    const before = await events()
    await expect(asTenant(tx => tx.query('update public.billing_underlay_events set billing_underlay_id=$1 where id=$2', [otherUnderlay, event])))
      .rejects.toMatchObject({ code: '23503', constraint })
    expect(await events()).toEqual(before)
  })

  it('blocks a parent company change that would leave its event under the old company', async () => {
    await insert(company, underlay)
    await db.exec('savepoint rejected_parent_change')
    await expect(db.query('update public.billing_underlays set company_id=$1 where id=$2', [otherCompany, underlay]))
      .rejects.toMatchObject({ code: '23503', constraint })
    await db.exec('rollback to savepoint rejected_parent_change')
    expect((await db.query('select company_id from public.billing_underlays where id=$1', [underlay])).rows)
      .toEqual([{ company_id: company }])
    expect((await events()).find(row => row.id === event)?.company_id).toBe(company)
  })

  it('preserves both owned-event and historical mismatched-event cascades', async () => {
    await insert(company, underlay)
    await db.query('delete from public.billing_underlays where id=$1', [otherUnderlay])
    expect((await events()).map(row => row.id)).toEqual([event])
    await db.query('delete from public.billing_underlays where id=$1', [underlay])
    expect(await events()).toEqual([])
  })

  it('leaves historical attribution unchanged and refuses to certify it', async () => {
    const before = await events()
    await db.exec('savepoint rejected_validation')
    await expect(db.exec(`alter table public.billing_underlay_events validate constraint ${constraint}`))
      .rejects.toMatchObject({ code: '23503', constraint })
    await db.exec('rollback to savepoint rejected_validation')
    expect(await events()).toEqual(before)
    expect((await db.query('select convalidated from pg_constraint where conrelid=$1::regclass and conname=$2', ['public.billing_underlay_events', constraint])).rows)
      .toEqual([{ convalidated: false }])
  })

  it('retains the existing company RLS and plain parent existence check', async () => {
    await expect(insert(otherCompany, otherUnderlay)).rejects.toMatchObject({ code: '42501' })
    await expect(insert(company, '99999999-9999-4999-8999-999999999999'))
      .rejects.toMatchObject({ code: '23503' })
    expect((await events()).map(row => row.id)).toEqual([legacyEvent])
  })
})
