import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
function capturedTable(name: string) {
  const start = schema.indexOf(`CREATE TABLE public.${name} (`)
  if (start < 0) throw new Error('captured_table_missing:' + name)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}
function capturedFunction(name: string) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  if (start < 0) throw new Error('captured_function_missing:' + name)
  return schema.slice(start, schema.indexOf('\n$$;', start) + 4)
}
const forward = readFileSync('supabase/migrations/20261020163100_forecast_point_inventory_snapshot.sql', 'utf8')
const signature = 'public.gridex_forecast_point_inventory_v1(uuid)'
const company = '11111111-1111-4111-8111-111111111111'
const foreignCompany = '33333333-3333-4333-8333-333333333333'
const customer = '22222222-2222-4222-8222-222222222222'
const foreignCustomer = '44444444-4444-4444-8444-444444444444'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Actual captured source tables/functions plus their named composite parent
  // relation. This finite hermetic foundation is not full native replay.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
  for (const name of ['gridex_new_public_resource_reference', 'gridex_normalize_email', 'gridex_normalize_org_number', 'gridex_normalize_personal_number', 'gridex_normalize_phone', 'gridex_normalize_metering_point_id']) {
    await db.exec(capturedFunction(name))
  }
  await db.exec(capturedTable('customers'))
  await db.exec(capturedTable('metering_points'))
  const compositeIndex = schema.match(/^CREATE UNIQUE INDEX customers_company_id_id_uidx .*;$/m)?.[0]
  const compositeFk = schema.match(/ALTER TABLE ONLY public\.metering_points\n    ADD CONSTRAINT metering_points_company_customer_fk [^;]+;/)?.[0]
  if (!compositeIndex || !compositeFk) throw new Error('captured_composite_parent_missing')
  await db.exec('ALTER TABLE public.customers ADD PRIMARY KEY(id); ALTER TABLE public.metering_points ADD PRIMARY KEY(id);')
  await db.exec(compositeIndex)
  await db.exec(compositeFk)
  await db.exec('GRANT SELECT ON public.metering_points,public.customers TO service_role;')
  await db.exec(forward)
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('BEGIN') })
afterEach(async () => { await db.exec('ROLLBACK') })

type Snapshot = { points: Array<Record<string, unknown>>; total_count: number | string }
async function snapshot(companyId: string | null = company, role = 'service_role') {
  await db.exec('SAVEPOINT inventory_read')
  try {
    await db.exec(`SET LOCAL ROLE ${role}`)
    return (await db.query<Snapshot>('SELECT * FROM public.gridex_forecast_point_inventory_v1($1)', [companyId])).rows
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT inventory_read; RELEASE SAVEPOINT inventory_read')
  }
}
async function insertPoints(count: number, companyId = company) {
  await db.query(`INSERT INTO public.metering_points(id,company_id,status)
    SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(n),12,'0'))::uuid,$1,'active'
    FROM generate_series(1,$2::integer) n ORDER BY n DESC`, [companyId, count])
}

describe('actual single-statement bounded point snapshot forward', () => {
  it('installs a stable invoker with fixed empty search path and service-only execute', async () => {
    const result = await db.query<{ stable: string; definer: boolean; config: string[] }>(
      'SELECT provolatile AS stable,prosecdef AS definer,proconfig AS config FROM pg_proc WHERE oid=to_regprocedure($1)', [signature])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ stable: 's', definer: false })
    expect(result.rows[0].config).toContain('search_path=""')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const grants = await db.query<{ allowed: boolean }>('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, signature])
      expect(grants.rows[0].allowed).toBe(role === 'service_role')
    }
  })

  it.each([0, 999, 1000, 1001, 10000])('returns exactly one row containing every selected point for count %i', async count => {
    await insertPoints(count)
    const rows = await snapshot()
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].total_count)).toBe(count)
    expect(rows[0].points).toHaveLength(count)
    expect(rows[0].points.map(row => row.id)).toEqual(Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`))
  })

  it('fails explicitly over 10000 rather than returning a successful partial company', async () => {
    await insertPoints(10001)
    await expect(snapshot()).rejects.toMatchObject({ code: '22023', message: 'forecast_point_inventory_limit_exceeded' })
  })

  it('preserves the exact company/status/selected-field and composite-parent semantics', async () => {
    await db.query(`INSERT INTO public.customers(id,company_id,source,email,personal_number) VALUES
      ($1,$2,'ediel_portal_test','private@example.test','private'),($3,$4,'foreign-secret','foreign@example.test','foreign')`, [customer, company, foreignCustomer, foreignCompany])
    await db.query(`INSERT INTO public.metering_points(id,company_id,customer_id,status,bidding_zone_code,is_test_data,archived_at,metadata) VALUES
      ('00000000-0000-4000-8000-000000000001',$1,$2,'active','SE1',true,now(),'{"secret":"unused"}'),
      ('00000000-0000-4000-8000-000000000002',$1,NULL,'live','SE2',false,NULL,'{}'),
      ('00000000-0000-4000-8000-000000000003',$1,NULL,'ongoing','SE3',false,NULL,'{}'),
      ('00000000-0000-4000-8000-000000000004',$1,NULL,'draft','SE4',false,NULL,'{}'),
      ('00000000-0000-4000-8000-000000000005',$3,$4,'active','SE4',false,NULL,'{}')`, [company, customer, foreignCompany, foreignCustomer])
    const rows = await snapshot()
    expect(Number(rows[0].total_count)).toBe(3)
    expect(rows[0].points).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', customer_id: customer, site_id: null, grid_owner_id: null, bidding_zone_code: 'SE1', source_customer: { company_id: company, source: 'ediel_portal_test' } },
      { id: '00000000-0000-4000-8000-000000000002', customer_id: null, site_id: null, grid_owner_id: null, bidding_zone_code: 'SE2', source_customer: null },
      { id: '00000000-0000-4000-8000-000000000003', customer_id: null, site_id: null, grid_owner_id: null, bidding_zone_code: 'SE3', source_customer: null },
    ])
    const foreignRows = await snapshot(foreignCompany)
    expect(Number(foreignRows[0].total_count)).toBe(1)
    expect(foreignRows[0].points[0].source_customer).toEqual({ company_id: foreignCompany, source: 'foreign-secret' })
    expect(JSON.stringify(rows)).not.toContain('private@example.test')
    expect(JSON.stringify(rows)).not.toContain('foreign-secret')
  })

  it('retains an unmatched point without leaking a parent from another tenant', async () => {
    await db.query('INSERT INTO public.customers(id,company_id,source) VALUES ($1,$2,\'foreign-secret\')', [foreignCustomer, foreignCompany])
    // The actual FK rejects this state. Drop only that fixture constraint to
    // exercise the SELECT join against a retained inconsistent legacy row.
    await expect(db.query('INSERT INTO public.metering_points(company_id,customer_id,status) VALUES ($1,$2,\'active\')', [company, foreignCustomer]))
      .rejects.toMatchObject({ code: '23503' })
    await db.exec('ROLLBACK; BEGIN; ALTER TABLE public.metering_points DROP CONSTRAINT metering_points_company_customer_fk;')
    await db.query('INSERT INTO public.customers(id,company_id,source) VALUES ($1,$2,\'foreign-secret\')', [foreignCustomer, foreignCompany])
    await db.query('INSERT INTO public.metering_points(company_id,customer_id,status) VALUES ($1,$2,\'active\')', [company, foreignCustomer])
    const rows = await snapshot()
    expect(Number(rows[0].total_count)).toBe(1)
    expect(rows[0].points[0]).toMatchObject({ customer_id: foreignCustomer, source_customer: null })
    expect(JSON.stringify(rows)).not.toContain('foreign-secret')
  })

  it.each(['anon', 'authenticated'])('refuses %s even if both tables are separately readable', async role => {
    await db.exec(`GRANT SELECT ON public.metering_points,public.customers TO ${role}`)
    await expect(snapshot(company, role)).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['metering_points', 'customers'])('does not elevate a service caller lacking SELECT on %s', async table => {
    await db.exec(`REVOKE SELECT ON public.${table} FROM service_role`)
    await expect(snapshot()).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects an unspecified tenant instead of returning a cross-company inventory', async () => {
    await expect(snapshot(null)).rejects.toMatchObject({ code: '22023' })
  })
})
