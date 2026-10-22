import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const tableStart = schema.indexOf('CREATE TABLE public.metering_values (')
if (tableStart < 0) throw new Error('captured_metering_values_table_missing')
const table = schema.slice(tableStart, schema.indexOf('\n);', tableStart) + 3)
const forward = readFileSync('supabase/migrations/20261020160626_forecast_metering_period_totals.sql', 'utf8')
const signature = 'public.gridex_forecast_metering_period_totals_v1(uuid,uuid,timestamptz,timestamptz)'
const company = '11111111-1111-4111-8111-111111111111'
const point = '22222222-2222-4222-8222-222222222222'
const foreignCompany = '33333333-3333-4333-8333-333333333333'
const foreignPoint = '44444444-4444-4444-8444-444444444444'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Actual captured table DDL and exact new forward. Only the finite role/table
  // foundation is installed; this is hermetic SQL, not native replay or PostgREST.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; SET TimeZone TO UTC;')
  await db.exec(table)
  await db.exec('ALTER TABLE public.metering_values ADD PRIMARY KEY(id); GRANT SELECT ON public.metering_values TO service_role;')
  await db.exec(forward)
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('BEGIN') })
afterEach(async () => { await db.exec('ROLLBACK') })

async function totals(start: string | null, end: string | null, options: { companyId?: string | null; pointId?: string | null; role?: string } = {}) {
  await db.exec('SAVEPOINT scoped_total')
  try {
    await db.exec(`SET LOCAL ROLE ${options.role ?? 'service_role'}`)
    const result = await db.query<{ total_kwh: string | number; value_count: string | number }>(
      'SELECT * FROM public.gridex_forecast_metering_period_totals_v1($1,$2,$3,$4)',
      [options.companyId === undefined ? company : options.companyId, options.pointId === undefined ? point : options.pointId, start, end])
    return result.rows
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT scoped_total; RELEASE SAVEPOINT scoped_total')
  }
}
async function insertQuarters(count: number, start: string) {
  await db.query(`INSERT INTO public.metering_values(company_id,metering_point_id,period_start,value_kwh,quantity_kwh)
    SELECT $1::uuid,$2::uuid,$3::timestamptz + n * interval '15 minutes',1,99 FROM generate_series(0,$4::integer-1) n`, [company, point, start, count])
}

describe('actual same-scope forecast aggregate forward', () => {
  it('installs a stable invoker function with a fixed empty search path and service-only execute', async () => {
    const result = await db.query<{ stable: string; definer: boolean; config: string[] }>(
      "SELECT provolatile AS stable,prosecdef AS definer,proconfig AS config FROM pg_proc WHERE oid=to_regprocedure($1)", [signature])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ stable: 's', definer: false })
    expect(result.rows[0].config).toContain('search_path=""')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const grants = await db.query<{ allowed: boolean }>('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, signature])
      expect(grants.rows[0].allowed).toBe(role === 'service_role')
    }
  })

  it.each([999, 1000, 1001, 2880, 35040, 35136])('sums every one of %i quarters into one uncapped result row', async count => {
    const start = count === 35136 ? '2024-01-01T00:00:00Z' : '2025-01-01T00:00:00Z'
    const end = new Date(Date.parse(start) + count * 900_000).toISOString()
    await insertQuarters(count, start)
    const result = await totals(start, end)
    expect(result).toHaveLength(1)
    expect(Number(result[0].total_kwh)).toBe(count)
    expect(Number(result[0].value_count)).toBe(count)
  })

  it('preserves both canonical zero and NULL fallback, decimals and the existing raw row selection', async () => {
    await db.query(`INSERT INTO public.metering_values(company_id,metering_point_id,period_start,value_kwh,quantity_kwh,quantity,is_current,reading_type)
      VALUES ($1,$2,'2026-10-01T00:00:00Z',120,1,999,true,'consumption'),
      ($1,$2,'2026-10-01T00:00:00Z',0,99,999,true,'consumption'),
      ($1,$2,'2026-10-01T00:00:00Z',NULL,20,999,true,'consumption'),
      ($1,$2,'2026-10-01T00:00:00Z',NULL,NULL,999,true,'consumption'),
      ($1,$2,'2026-10-01T00:00:00Z',-5,NULL,NULL,false,'production'),
      ($1,$2,'2026-10-01T00:00:00Z',0.1,NULL,NULL,true,'consumption'),
      ($1,$2,'2026-10-01T00:00:00Z',0.2,NULL,NULL,true,'consumption')`, [company, point])
    const result = await totals('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')
    expect(Number(result[0].total_kwh)).toBe(135.3)
    expect(Number(result[0].value_count)).toBe(7)
  })

  it('keeps tenant, point and inclusive-start/exclusive-end scope in the database', async () => {
    await db.query(`INSERT INTO public.metering_values(company_id,metering_point_id,period_start,value_kwh) VALUES
      ($1,$2,'2026-10-01T00:00:00Z',1), ($1,$2,'2026-09-30T23:59:59.999Z',100),
      ($1,$2,'2026-11-01T00:00:00Z',200), ($3,$4,'2026-10-01T00:00:00Z',300),
      ($1,$4,'2026-10-01T00:00:00Z',400)`, [company, point, foreignCompany, foreignPoint])
    expect((await totals('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).map(row => [Number(row.total_kwh), Number(row.value_count)]))
      .toEqual([[1, 1]])
    expect((await totals('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', { companyId: foreignCompany })).map(row => [Number(row.total_kwh), Number(row.value_count)]))
      .toEqual([[0, 0]])
  })

  it.each([
    ['2026-03-01T00:00:00+01:00', '2026-04-01T00:00:00+02:00', 2972],
    ['2026-10-01T00:00:00+02:00', '2026-11-01T00:00:00+01:00', 2980],
  ] as const)('uses the actual instants supplied for the DST period %s', async (start, end, count) => {
    await insertQuarters(count, start)
    const result = await totals(start, end)
    expect([Number(result[0].total_kwh), Number(result[0].value_count)]).toEqual([count, count])
  })

  it('returns an explicit zero total and zero count for a successful empty selection', async () => {
    const result = await totals('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')
    expect(result.map(row => [Number(row.total_kwh), Number(row.value_count)])).toEqual([[0, 0]])
  })

  it.each(['anon', 'authenticated'])('refuses execution as %s even if the table is separately readable', async role => {
    await db.exec(`GRANT SELECT ON public.metering_values TO ${role}`)
    await expect(totals('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', { role })).rejects.toMatchObject({ code: '42501' })
  })

  it('does not elevate a service caller that lacks SELECT on the source table', async () => {
    await db.exec('REVOKE SELECT ON public.metering_values FROM service_role')
    await expect(totals('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).rejects.toMatchObject({ code: '42501' })
  })

  it.each([
    [null, '2026-11-01T00:00:00Z', {}], ['2026-10-01T00:00:00Z', null, {}],
    ['2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', {}], ['2026-11-01T00:00:00Z', '2026-10-01T00:00:00Z', {}],
    ['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', { companyId: null }],
    ['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', { pointId: null }],
  ] as const)('rejects invalid aggregate scope %j/%j/%j', async (start, end, options) => {
    await expect(totals(start, end, options)).rejects.toMatchObject({ code: '22023' })
  })
})
