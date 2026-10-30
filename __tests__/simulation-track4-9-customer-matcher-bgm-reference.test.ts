// simulation: track4/9
// Finding 20261029-3f1a8ab1/claude-track4/9: inbound UTILTS files whose BGM
// document number is not a UUID ('6f495e7776054aee9541', 'M2607xx216776')
// reached `customers.id.eq.<ref>` in the automation customer matcher, PostgREST
// answered 22P02 and the backend automation pipeline trace was lost while the
// ediel_processing_runs row stayed 'running'. Fix: finance 36ffc606f (cherry-
// picked). The fake below behaves like PostgREST for the customers table:
// a non-UUID value compared with the uuid column fails the whole query (22P02),
// company_id and the or() conditions filter rows.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type PgError = { code: string; message: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const db = vi.hoisted(() => ({
  customers: [] as Row[],
  runs: [] as Row[],
  customerOrFilters: [] as string[],
  customerEqFilters: [] as Array<[string, unknown]>,
  forcedCustomersError: null as PgError | null,
}))

// Split a PostgREST `or` list on top-level commas and parse `col.eq."value"`.
function parseOr(filter: string): Array<{ column: string; value: string }> {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < filter.length; i++) {
    const ch = filter[i]
    if (ch === '\\' && quoted) { current += filter[++i]; continue }
    if (ch === '"') { quoted = !quoted; current += ch; continue }
    if (ch === ',' && !quoted) { parts.push(current); current = ''; continue }
    current += ch
  }
  parts.push(current)
  return parts.map((part) => {
    const match = /^([a-z_]+)\.eq\.(?:"([^]*)"|([^]*))$/.exec(part)
    if (!match) throw new Error(`unparseable condition ${part}`)
    return { column: match[1], value: match[2] ?? match[3] }
  })
}

vi.mock('@/lib/supabase/service', () => {
  function customersQuery() {
    const eqs: Array<[string, unknown]> = []
    let orConds: Array<{ column: string; value: string }> | null = null
    const chain: Record<string, unknown> = {
      select: () => chain,
      limit: () => chain,
      eq: (column: string, value: unknown) => { eqs.push([column, value]); db.customerEqFilters.push([column, value]); return chain },
      or: (filter: string) => { db.customerOrFilters.push(filter); orConds = parseOr(filter); return chain },
      then: (resolve: (value: unknown) => unknown) => {
        if (db.forcedCustomersError) return resolve({ data: null, error: db.forcedCustomersError })
        const badUuid = (orConds ?? []).find((cond) => cond.column === 'id' && !UUID.test(cond.value))
        if (badUuid) {
          return resolve({ data: null, error: { code: '22P02', message: `invalid input syntax for type uuid: "${badUuid.value}"` } })
        }
        const rows = db.customers.filter((row) =>
          eqs.every(([column, value]) => row[column] === value) &&
          (orConds === null || orConds.some((cond) => String(row[cond.column] ?? '') === cond.value)),
        )
        return resolve({ data: rows, error: null })
      },
    }
    return chain
  }

  function runsTable() {
    return {
      insert: (row: Row) => {
        const stored = { ...row, id: `run-${db.runs.length + 1}` }
        db.runs.push(stored)
        const single = { single: async () => ({ data: { id: stored.id }, error: null }) }
        return { select: () => single }
      },
      update: (patch: Row) => ({
        eq: async (column: string, value: unknown) => {
          for (const row of db.runs) if (row[column] === value) Object.assign(row, patch)
          return { error: null }
        },
      }),
    }
  }

  return {
    supabaseService: {
      from: (table: string) => {
        if (table === 'customers') return customersQuery()
        if (table === 'ediel_processing_runs') return runsTable()
        throw new Error(`unexpected table ${table}`)
      },
    },
  }
})

// Isolate the customer matcher: the other matchers have their own tests.
vi.mock('@/lib/ediel/matching/meteringPointMatcher', () => ({ matchMeteringPointForAutomation: async () => [] }))
vi.mock('@/lib/ediel/matching/permissionMatcher', () => ({ matchPermissionForAutomation: async () => [] }))
vi.mock('@/lib/ediel/matching/processMatcher', () => ({ matchProcessForAutomation: async () => [] }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: vi.fn(async () => null) }))

import { matchCustomerForAutomation } from '@/lib/ediel/matching/customerMatcher'
import { analyzeEdielProcessingPipeline } from '@/lib/ediel/orchestrator/edielProcessingPipeline'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY_A = '11111111-1111-4111-8111-111111111111'
const COMPANY_B = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_A = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_B = '44444444-4444-4444-8444-444444444444'
const BGM_REFS = ['6f495e7776054aee9541', 'M2607xx216776']

function message(overrides: Partial<EdielMessageRow> = {}): EdielMessageRow {
  return {
    id: 'msg-1',
    company_id: COMPANY_A,
    customer_id: null,
    external_reference: null,
    message_family: 'OTHER',
    message_code: null,
    environment: 'test',
    test_flag: 1,
    parsed_payload: {},
    validation_report: {},
    ...overrides,
  } as unknown as EdielMessageRow
}

beforeEach(() => {
  db.customers = []
  db.runs = []
  db.customerOrFilters = []
  db.customerEqFilters = []
  db.forcedCustomersError = null
})

describe('track4/9 customer matcher with a non-UUID BGM reference', () => {
  it.each(BGM_REFS)('(a) %s never reaches id.eq and still matches by the identifier columns', async (ref) => {
    db.customers = [{ id: CUSTOMER_A, company_id: COMPANY_A, customer_number: ref, status: 'active' }]

    const candidates = await matchCustomerForAutomation({ message: message({ external_reference: ref }), companyId: COMPANY_A })

    const conds = parseOr(db.customerOrFilters[0])
    expect(conds.filter((cond) => cond.column === 'id')).toEqual([])
    expect(conds.map((cond) => cond.column).sort()).toEqual(['customer_number', 'email', 'org_number', 'personal_number'])
    expect(candidates.map((candidate) => candidate.entityId)).toEqual([CUSTOMER_A])
  })

  it('(a) a UUID-shaped linked customer id is still compared with customers.id', async () => {
    db.customers = [{ id: CUSTOMER_A, company_id: COMPANY_A, customer_number: 'K-1', status: 'active' }]
    const candidates = await matchCustomerForAutomation({
      message: message({ external_reference: BGM_REFS[0], customer_id: CUSTOMER_A }),
      companyId: COMPANY_A,
    })
    expect(parseOr(db.customerOrFilters[0])).toContainEqual({ column: 'id', value: CUSTOMER_A })
    expect(candidates[0]).toMatchObject({ entityId: CUSTOMER_A, reason: 'customer_id_already_set' })
  })

  it('(b) keeps the company_id filter: an equal reference in another tenant is not matched', async () => {
    const ref = BGM_REFS[1]
    db.customers = [
      { id: CUSTOMER_A, company_id: COMPANY_A, customer_number: ref, status: 'active' },
      { id: CUSTOMER_B, company_id: COMPANY_B, customer_number: ref, status: 'active' },
    ]

    const candidates = await matchCustomerForAutomation({ message: message({ external_reference: ref }), companyId: COMPANY_A })

    expect(db.customerEqFilters).toContainEqual(['company_id', COMPANY_A])
    expect(candidates.map((candidate) => candidate.entityId)).toEqual([CUSTOMER_A])
  })

  it('(b) without a resolved tenant nothing is read', async () => {
    const candidates = await matchCustomerForAutomation({ message: message({ company_id: null, external_reference: BGM_REFS[0] }), companyId: null })
    expect(candidates).toEqual([])
    expect(db.customerOrFilters).toEqual([])
  })

  it('(c) the automation pipeline with a BGM reference completes its processing run (was 22P02 and left running)', async () => {
    const result = await analyzeEdielProcessingPipeline({
      actorUserId: 'actor-1',
      message: message({ external_reference: BGM_REFS[0] }),
      createSlaTimers: false,
      createDecisionTrace: false,
    })

    expect(result.runId).toBe('run-1')
    expect(db.runs).toHaveLength(1)
    expect(db.runs[0].status).not.toBe('running')
    expect(db.runs[0].completed_at).toEqual(expect.any(String))
  })

  // KNOWN SEPARATE DEFECT (not fixed by 36ffc606f, not fixed on the finance
  // branch): analyzeEdielProcessingPipeline has no failure path after
  // createProcessingRun, so any other matcher error (here a statement timeout)
  // propagates, recordBackendAutomationPipelineTrace swallows it into a
  // manual_note event, and the run row keeps status 'running' with no
  // completed_at. `it.fails` documents the desired behaviour and turns red
  // once that defect is fixed, so this marker must then become `it`.
  it.fails('(c) KNOWN DEFECT: a matcher failure for another reason must not leave the run running', async () => {
    db.forcedCustomersError = { code: '57014', message: 'canceling statement due to statement timeout' }

    await analyzeEdielProcessingPipeline({
      actorUserId: 'actor-1',
      message: message({ external_reference: BGM_REFS[0] }),
      createSlaTimers: false,
      createDecisionTrace: false,
    }).catch(() => null)

    expect(db.runs).toHaveLength(1)
    expect(db.runs[0].status).not.toBe('running')
  })

  it('(c) behaviour today: the 57014 matcher error propagates and the run row stays running', async () => {
    db.forcedCustomersError = { code: '57014', message: 'canceling statement due to statement timeout' }

    await expect(analyzeEdielProcessingPipeline({
      actorUserId: 'actor-1',
      message: message({ external_reference: BGM_REFS[0] }),
      createSlaTimers: false,
      createDecisionTrace: false,
    })).rejects.toMatchObject({ code: '57014' })

    expect(db.runs[0]).toMatchObject({ status: 'running' })
    expect(db.runs[0].completed_at).toBeUndefined()
  })
})
