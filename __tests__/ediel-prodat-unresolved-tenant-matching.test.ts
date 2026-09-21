import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { createOrUpdateInboundProdatCase, parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import { alphabets, common, line, qty, raw, type Parts } from './fixtures/prodat-register'

type Row = Record<string, unknown>
type Query = { table: string; operation: 'select' | 'insert' | 'update'; filters: [string, unknown][]; payload?: Row }
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const emptyMatch = { customerId: null, siteId: null, meteringPointId: null, confidence: 0 }
const db = vi.hoisted(() => ({
  from: vi.fn(), event: vi.fn(), link: vi.fn(), queries: [] as Query[],
  pointFound: true, errorTable: null as string | null, existing: null as Row | null,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: db }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: db.event, linkEdielMessage: db.link }))

function result(query: Query): { data: Row | null; error: Error | null } {
  if (query.table === db.errorTable) return { data: null, error: new Error('SYNTHETIC_DATABASE_UNAVAILABLE') }
  if (query.table === 'ediel_inbound_cases') return {
    data: query.operation === 'select' ? db.existing : { id: 'synthetic-case', ...query.payload }, error: null,
  }
  // Same external point/national identifier may exist in both companies. An
  // unscoped service-role lookup deliberately returns B, not an empty mock.
  const company = query.filters.find(([key]) => key === 'company_id')?.[1] ?? B
  if (query.table === 'metering_points') return { data: db.pointFound ? { id: `point-${company}`, site_id: `site-${company}` } : null, error: null }
  if (query.table === 'customer_sites') return { data: { id: `site-${company}`, customer_id: `customer-${company}` }, error: null }
  if (query.table === 'customers') return { data: { id: `customer-${company}` }, error: null }
  throw new Error(`UNEXPECTED_TABLE:${query.table}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.queries = []; db.pointFound = true; db.errorTable = null; db.existing = null
  db.event.mockResolvedValue({})
  db.from.mockImplementation((table: string) => {
    const query: Query = { table, operation: 'select', filters: [] }
    db.queries.push(query)
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain },
      is: (key: string, value: unknown) => { query.filters.push([`is:${key}`, value]); return chain },
      or: (value: string) => { query.filters.push(['or', value]); return chain },
      limit: () => chain,
      insert: (payload: Row) => { query.operation = 'insert'; query.payload = payload; return chain },
      update: (payload: Row) => { query.operation = 'update'; query.payload = payload; return chain },
      maybeSingle: async () => result(query),
      single: async () => result(query),
    }
    return chain
  })
})
const masterQueries = () => db.queries.filter(query => query.table !== 'ediel_inbound_cases')
const writes = () => db.queries.filter(query => query.operation !== 'select')
function row(company: string | null | undefined, payload: string): EdielMessageRow {
  return {
    id: '00000000-0000-4000-8000-000000000001', company_id: company,
    direction: 'inbound', environment: 'test', message_family: 'PRODAT', message_code: 'Z04',
    raw_payload: payload, parsed_payload: { companyId: B, tenant_id: B, meterPointId: 'STALE' },
  } as unknown as EdielMessageRow
}
function body(kind?: 'org' | 'person'): Parts[] {
  const parts = [line('1', 'POINT'), qty('10'), ...common('POINT', 'Synthetic')]
  if (!kind) return parts
  // Lexical synthetic IDs only, not claimed valid national identities.
  return [...parts.filter(part => part[0] !== 'NAD'),
    ['NAD', 'UD', [kind === 'org' ? '0000000000' : '000000000000', kind === 'org' ? 'SE1' : 'SE2', '260'], '', 'Synthetic', 'Street', 'City', '', '12345', 'SE']]
}
async function stage(message: EdielMessageRow) {
  return createOrUpdateInboundProdatCase({ actorUserId: '00000000-0000-4000-8000-000000000002', message })
}
function expectUnbound(saved: Awaited<ReturnType<typeof stage>>) {
  expect(saved).toMatchObject({ company_id: null, status: 'pending_review', customer_id: null, site_id: null, metering_point_id: null, match_confidence: 0 })
  expect(masterQueries()).toEqual([])
  expect(db.link).not.toHaveBeenCalled()
}

for (const alphabet of alphabets) describe(`real PRODAT staging tenant boundary ${alphabet.join('')}`, () => {
  for (const company of [null, undefined, '', '  '] as const) it(`stages unresolved ${JSON.stringify(company)} without any masterdata lookup`, async () => {
    const message = row(company, raw(body(), 'Z04', alphabet))
    const before = JSON.stringify(message)
    const saved = await stage(message)
    expectUnbound(saved)
    expect(writes()).toHaveLength(1)
    expect(db.event).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ match: emptyMatch }) }))
    expect(saved?.parsed_metering_point).toMatchObject({ meterPointId: 'POINT' })
    expect(JSON.stringify(message)).toBe(before)
  })

  it('does not adopt a cached company or matching claim for an unresolved source', async () => {
    const message = row(null, raw(body(), 'Z04', alphabet))
    message.parsed_payload = { ...message.parsed_payload, company_id: A, business_match_status: 'matched', customerId: `customer-${A}` }
    expectUnbound(await stage(message))
  })

  for (const kind of ['org', 'person'] as const) it(`does not search global ${kind} identifiers while unresolved`, async () => {
    db.pointFound = false
    const message = row(null, raw(body(kind), 'Z04', alphabet))
    const parsed = parseInboundProdatBusinessData(message)
    expect(parsed.customer[kind === 'org' ? 'orgNumber' : 'personalNumber']).toBe(kind === 'org' ? '0000000000' : '000000000000')
    expectUnbound(await stage(message))
  })

  for (const company of [A, B]) it(`retains point/site/customer matching within company ${company}`, async () => {
    const saved = await stage(row(company, raw(body(), 'Z04', alphabet)))
    expect(saved).toMatchObject({ company_id: company, customer_id: `customer-${company}`, site_id: `site-${company}`, metering_point_id: `point-${company}`, match_confidence: 95 })
    expect(masterQueries().map(query => query.table)).toEqual(['metering_points', 'customer_sites'])
    for (const query of masterQueries()) expect(query.filters).toContainEqual(['company_id', company])
  })

  for (const kind of ['org', 'person'] as const) it(`retains company-scoped ${kind} fallback after an unmatched point`, async () => {
    db.pointFound = false
    const saved = await stage(row(A, raw(body(kind), 'Z04', alphabet)))
    expect(saved).toMatchObject({ company_id: A, customer_id: `customer-${A}`, site_id: null, metering_point_id: null, match_confidence: 80 })
    expect(masterQueries().map(query => query.table)).toEqual(['metering_points', 'customers'])
    for (const query of masterQueries()) expect(query.filters).toContainEqual(['company_id', A])
    expect(masterQueries()[1].filters).toContainEqual([kind === 'org' ? 'org_number' : 'personal_number', kind === 'org' ? '0000000000' : '000000000000'])
  })

  it('does not hide a real scoped lookup failure as an unresolved successful case', async () => {
    db.errorTable = 'metering_points'
    await expect(stage(row(A, raw(body(), 'Z04', alphabet)))).rejects.toThrow('SYNTHETIC_DATABASE_UNAVAILABLE')
    expect(masterQueries()[0].filters).toContainEqual(['company_id', A])
    expect(writes()).toEqual([]); expect(db.event).not.toHaveBeenCalled()
  })

  it('retains the existing multi-object no-scalar-match rule', async () => {
    const payload = raw([...body(), line('2', 'SECOND'), qty('20'), ...common('SECOND', 'Synthetic Second')], 'Z04', alphabet)
    expectUnbound(await stage(row(null, payload)))
  })

  it('still stops a malformed register chain before any database access', async () => {
    const payload = raw([line('1', 'POINT', '1'), qty('10'), line('2', 'POINT', '1'), qty('20')], 'Z04', alphabet)
    await expect(stage(row(null, payload))).rejects.toThrow('PRODAT_REGISTER_STRUCTURE_INVALID')
    expect(db.from).not.toHaveBeenCalled(); expect(db.event).not.toHaveBeenCalled()
  })

  it('still rejects real malformed wire rather than bypassing parsing for unresolved tenants', async () => {
    await expect(stage(row(null, raw(body(), 'Z04', alphabet) + alphabet[2]))).rejects.toThrow('edifact_dangling_release_character')
    expect(db.from).not.toHaveBeenCalled(); expect(db.event).not.toHaveBeenCalled()
  })

  it('keeps unresolved pending-case updates null-scoped and compare-and-swap guarded', async () => {
    db.existing = { id: 'existing', company_id: null, status: 'pending_review', updated_at: '2026-09-21T00:00:00Z', review_decision: null }
    expectUnbound(await stage(row(null, raw(body(), 'Z04', alphabet))))
    const update = writes()[0]
    expect(update.operation).toBe('update')
    expect(update.filters).toEqual([['id', 'existing'], ['is:company_id', null], ['updated_at', '2026-09-21T00:00:00Z'], ['status', 'pending_review']])
    expect(db.event).not.toHaveBeenCalled()
  })

  it('keeps a foreign existing-case owner mismatch blocking, without global matching first', async () => {
    db.existing = { id: 'foreign', company_id: B, status: 'pending_review' }
    await expect(stage(row(null, raw(body(), 'Z04', alphabet)))).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
    expect(masterQueries()).toEqual([]); expect(writes()).toEqual([]); expect(db.event).not.toHaveBeenCalled()
  })
})
