// local/041: real helper against embedded SQL; ancillary PostgREST tables are stubbed.
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const port = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: port.from } }))
vi.mock('@/lib/tenant/scope', () => ({
  isMissingRelationError: (error: { code?: string } | null) => error?.code === '42P01',
}))
import { getActorTestingSummary, listActorTestingSummaries } from '@/lib/ediel/actorTesting'

const own = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const canonicalColumns = [
  'id', 'name', 'slug', 'org_number', 'status', 'primary_contact_email',
  'primary_contact_name', 'support_email', 'billing_contact_email', 'ediel_id',
  'actor_role', 'sender_sub_address', 'ediel_mailbox', 'operating_environment',
  'market_role', 'brp_name', 'brp_ediel_id', 'brp_status', 'esett_status',
  'technical_contact_name', 'technical_contact_email', 'production_status',
  'live_approved_at', 'live_blocked_reason', 'test_ediel_id', 'production_ediel_id',
  'test_sender_sub_address', 'production_sender_sub_address', 'test_mailbox',
  'production_mailbox', 'test_application_reference', 'production_application_reference',
  'test_counterparty_ediel_id', 'production_counterparty_ediel_id', 'created_at', 'updated_at',
]
let database: PGlite
let forcedError: { code: string; message: string } | null = null

beforeAll(async () => { database = new PGlite(); await database.waitReady })
afterAll(async () => { await database.close() })
beforeEach(async () => {
  forcedError = null
  await database.exec('DROP TABLE IF EXISTS companies; CREATE TABLE companies (' +
    canonicalColumns.map(name => '"' + name + '" text').join(',') + ', live_ediel_enabled boolean)')
  await database.query('INSERT INTO companies(id,name,status) VALUES ($1,$2,$3),($4,$5,$3)',
    [own, 'Own synthetic tenant', 'onboarding', other, 'Other synthetic tenant'])
  port.from.mockImplementation((table: string) => {
    let columns = '*'
    let single = false
    const predicates: string[] = []
    const values: unknown[] = []
    const comparison = (column: string, value: unknown, op: string) => {
      values.push(value); predicates.push('"' + column + '" ' + op + ' $' + values.length)
      return query
    }
    const execute = async () => {
      if (table !== 'companies') return { data: single ? null : [], error: null, count: 0 }
      if (forcedError) return { data: null, error: forcedError }
      try {
        const result = await database.query('SELECT ' + columns + ' FROM companies' +
          (predicates.length ? ' WHERE ' + predicates.join(' AND ') : ''), values)
        return { data: single ? result.rows[0] ?? null : result.rows, error: null }
      } catch (error) {
        return { data: null, error }
      }
    }
    const query = {
      select(value: string) { columns = value; return query },
      eq: (column: string, value: unknown) => comparison(column, value, '='),
      neq: (column: string, value: unknown) => comparison(column, value, '<>'),
      in(column: string, items: string[]) {
        const placeholders = items.map(value => { values.push(value); return '$' + values.length })
        predicates.push('"' + column + '" IN (' + placeholders.join(',') + ')'); return query
      },
      order: () => query,
      limit: () => query,
      is: () => query,
      async maybeSingle() { single = true; return execute() },
      then(onfulfilled: Parameters<Promise<Awaited<ReturnType<typeof execute>>>['then']>[0],
        onrejected: Parameters<Promise<Awaited<ReturnType<typeof execute>>>['then']>[1]) {
        return execute().then(onfulfilled, onrejected)
      },
    }
    return query
  })
})

describe('canonical company projection without optional white-label schema', () => {
  it('reads a company summary without inventing readiness or white-label data', async () => {
    const result = await getActorTestingSummary(own)
    expect(result?.company.id).toBe(own)
    expect(result?.company.white_label_platform_id).toBeNull()
    expect(result?.productionReadiness).toBe('not_ready')
    expect(result?.totalPassed).toBe(0)
  })
  it('preserves the explicitly selected company list scope', async () => {
    const results = await listActorTestingSummaries({ scope: 'company', companyIds: [own] })
    expect(results.map(row => row.company.id)).toEqual([own])
  })
  it('returns null for a genuinely absent company', async () => {
    expect(await getActorTestingSummary('absent')).toBeNull()
  })
  it('preserves the white-label filter when that legacy schema exists', async () => {
    await database.exec('ALTER TABLE companies ADD COLUMN white_label_platform_id text')
    await database.query('UPDATE companies SET white_label_platform_id=$1 WHERE id=$2', ['platform-own', own])
    const results = await listActorTestingSummaries({ scope: 'whitelabel', whiteLabelPlatformId: 'platform-own' })
    expect(results.map(row => row.company.id)).toEqual([own])
    expect(results[0].company.white_label_platform_id).toBe('platform-own')
  })
  it('retains the legacy field used by the single-company identity card', async () => {
    await database.exec('ALTER TABLE companies ADD COLUMN white_label_platform_id text')
    await database.query('UPDATE companies SET white_label_platform_id=$1 WHERE id=$2', ['platform-own', own])
    expect((await getActorTestingSummary(own))?.company.white_label_platform_id).toBe('platform-own')
  })
  it('never drops a white-label filter when canonical schema lacks its column', async () => {
    await expect(listActorTestingSummaries({ scope: 'whitelabel', whiteLabelPlatformId: 'platform-own' }))
      .rejects.toMatchObject({ code: '42703' })
  })
  it('propagates unrelated missing-column errors', async () => {
    await database.exec('ALTER TABLE companies DROP COLUMN name')
    await expect(getActorTestingSummary(own)).rejects.toMatchObject({ code: '42703' })
  })
  it('propagates permission denial rather than substituting an empty success', async () => {
    forcedError = { code: '42501', message: 'Synthetic permission denial' }
    await expect(getActorTestingSummary(own)).rejects.toEqual(forcedError)
  })
})
