import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { findActiveSwitchLifecycleBlock } from '@/lib/operations/switchLifecycleBlocks'

const companyId = '20000000-0000-4000-8000-000000000001'
const customerId = '20000000-0000-4000-8000-000000000002'
const siteId = '20000000-0000-4000-8000-000000000003'
const otherSiteId = '20000000-0000-4000-8000-000000000004'
const meteringPointId = '20000000-0000-4000-8000-0000000000a5'
const otherMeteringPointId = '20000000-0000-4000-8000-000000000006'
const otherCompanyId = '20000000-0000-4000-8000-000000000007'
const otherCustomerId = '20000000-0000-4000-8000-000000000008'

const decisionsTable = 'customer_lifecycle_decisions'
const tasksTable = 'customer_operation_tasks'
type SourceTable = typeof decisionsTable | typeof tasksTable
type Scope = Parameters<typeof findActiveSwitchLifecycleBlock>[1]

type SourceRow = {
  id: string
  company_id: string
  customer_id: string
  created_at: string
  decision_type?: string
  scope_type?: string
  scope_id?: string | null
  site_id?: string | null
  metering_point_id?: string | null
  task_type?: string
  status?: string
}

function decision(id: string, day: number, fields: Partial<SourceRow> = {}): SourceRow {
  return {
    id, company_id: companyId, customer_id: customerId,
    created_at: new Date(Date.UTC(2026, 10, day)).toISOString(),
    scope_type: 'site', scope_id: siteId, decision_type: 'withdrawal', ...fields,
  }
}

function task(id: string, day: number, fields: Partial<SourceRow> = {}): SourceRow {
  return {
    id, company_id: companyId, customer_id: customerId,
    created_at: new Date(Date.UTC(2026, 10, day)).toISOString(),
    task_type: 'customer_withdrawal_followup', status: 'blocked', site_id: siteId, metering_point_id: null,
    ...fields,
  }
}

function reader(rows: Record<SourceTable, SourceRow[]>, scope: Scope, decisionError?: { code: string; message: string }) {
  const reads: SourceTable[] = []
  const client = createClient('https://lifecycle-probe.example.invalid', 'synthetic-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        const table = url.pathname.split('/').at(-1) as SourceTable
        expect([decisionsTable, tasksTable]).toContain(table)
        reads.push(table)
        expect(url.searchParams.get('company_id')).toBe(`eq.${companyId}`)
        expect(url.searchParams.get('customer_id')).toBe(`eq.${customerId}`)
        if (table === decisionsTable && decisionError) {
          return Response.json(decisionError, { status: 400 })
        }

        const filters = url.searchParams
        const site = scope.siteId?.toLowerCase()
        const meter = scope.meteringPointId?.toLowerCase()
        const scopeFilter = filters.get('or')
        if (scopeFilter) {
          const expectedTerms = table === decisionsTable
            ? [
              'scope_type.in.(customer,contract)', 'scope_id.is.null',
              ...(site ? [`and(scope_type.eq.site,scope_id.eq."${site}")`] : []),
              ...(meter ? [`and(scope_type.eq.metering_point,scope_id.eq."${meter}")`] : []),
            ]
            : [
              'and(metering_point_id.is.null,site_id.is.null)',
              ...(site ? [`and(metering_point_id.is.null,site_id.eq."${site}")`] : []),
              ...(meter ? [`metering_point_id.eq."${meter}"`] : []),
            ]
          expect(scopeFilter).toBe(`(${expectedTerms.join(',')})`)
          expect(filters.get('limit')).toBe('1')
        }

        const result = rows[table].filter((row) => {
          if (`eq.${row.company_id}` !== filters.get('company_id') || `eq.${row.customer_id}` !== filters.get('customer_id')) return false
          if (table === decisionsTable) {
            const types = filters.get('decision_type')?.slice(4, -1).split(',') ?? []
            return types.includes(row.decision_type ?? '') && (!scopeFilter || !row.scope_id ||
              (row.scope_type === 'site' ? row.scope_id === site : row.scope_type === 'metering_point' ? row.scope_id === meter : true))
          }
          const statuses = filters.get('status')?.slice(4, -1).split(',') ?? []
          const types = filters.get('task_type')?.slice(4, -1).split(',') ?? []
          const applicable = row.metering_point_id ? row.metering_point_id === meter : !row.site_id || row.site_id === site
          return statuses.includes(row.status ?? '') && types.includes(row.task_type ?? '') && (!scopeFilter || applicable)
        })
        const order = filters.get('order')
        expect(order).toMatch(/^created_at\.desc(,id\.desc)?$/)
        result.sort((a, b) => b.created_at.localeCompare(a.created_at) || (order?.endsWith('id.desc') ? b.id.localeCompare(a.id) : 0))
        return Response.json(result.slice(0, Number(filters.get('limit'))))
      },
    },
  })
  return { client, reads }
}

describe('OPS-1711-42 switch lifecycle holds', () => {
  it.each([decisionsTable, tasksTable] as const)('finds an older eligible hold when %s has twenty newer wrong-site records', async (table) => {
    const makeRow = table === decisionsTable ? decision : task
    const older = makeRow('older-match', 1)
    const wrongSite = table === decisionsTable ? { scope_id: otherSiteId } : { site_id: otherSiteId }
    const rows: Record<SourceTable, SourceRow[]> = { [decisionsTable]: [], [tasksTable]: [] }
    rows[table] = [older, ...Array.from({ length: 20 }, (_, i) => makeRow(`unrelated-${i}`, 2 + i, wrongSite))]
    const scope = { companyId, customerId, siteId }
    const { client, reads } = reader(rows, scope)

    await expect(findActiveSwitchLifecycleBlock(client, scope)).resolves.toMatchObject({ id: older.id, siteId })
    expect(reads).toEqual(table === decisionsTable ? [decisionsTable] : [decisionsTable, tasksTable])
  })

  it('preserves decision priority and chooses the newest applicable hold with a stable tie break', async () => {
    const scope = { companyId, customerId, siteId, meteringPointId: meteringPointId.toUpperCase() }
    const rows = {
      [decisionsTable]: [
        decision('foreign-tenant', 26, { company_id: otherCompanyId }),
        decision('other-customer', 25, { customer_id: otherCustomerId }),
        decision('wrong-meter', 24, { scope_type: 'metering_point', scope_id: otherMeteringPointId }),
        decision('non-blocking', 23, { decision_type: 'accepted' }),
        decision('global', 21, { scope_type: 'customer', scope_id: customerId }),
        decision('a-site', 22),
        decision('z-meter', 22, { scope_type: 'metering_point', scope_id: meteringPointId }),
      ],
      [tasksTable]: [task('newer-task', 28)],
    }
    const { client, reads } = reader(rows, scope)

    await expect(findActiveSwitchLifecycleBlock(client, scope)).resolves.toMatchObject({ id: 'z-meter', meteringPointId })
    expect(reads).toEqual([decisionsTable])
  })

  it('uses metering scope before site and excludes final, unrelated or foreign tasks', async () => {
    const scope = { companyId, customerId, siteId, meteringPointId }
    const rows = {
      [decisionsTable]: [],
      [tasksTable]: [
        task('wrong-meter-on-right-site', 29, { metering_point_id: otherMeteringPointId }),
        task('resolved', 28, { status: 'resolved' }),
        task('other-tenant', 27, { company_id: otherCompanyId }),
        task('other-customer', 26, { customer_id: otherCustomerId }),
        task('unrelated-type', 25, { task_type: 'send_notification' }),
        task('applicable-meter', 24, { site_id: otherSiteId, metering_point_id: meteringPointId }),
        task('global-task', 23, { site_id: null }),
      ],
    }
    const { client } = reader(rows, scope)

    await expect(findActiveSwitchLifecycleBlock(client, scope)).resolves.toMatchObject({ id: 'applicable-meter', meteringPointId })
  })

  it('retains unscoped decisions and tasks when no site or metering point is selected', async () => {
    const scope = { companyId, customerId }
    const rows = {
      [decisionsTable]: [decision('unrelated-site', 23), decision('legacy-null-scope', 22, { scope_id: null })],
      [tasksTable]: [task('site-task', 21), task('unscoped-task', 20, { site_id: null })],
    }
    const { client } = reader(rows, scope)

    await expect(findActiveSwitchLifecycleBlock(client, scope)).resolves.toMatchObject({ id: 'legacy-null-scope' })
    const withoutDecisions = reader({ ...rows, [decisionsTable]: [] }, scope)
    await expect(findActiveSwitchLifecycleBlock(withoutDecisions.client, scope)).resolves.toMatchObject({ id: 'unscoped-task' })
  })

  it('only falls back to tasks on a recognized missing decision source', async () => {
    const scope = { companyId, customerId, siteId }
    const rows = { [decisionsTable]: [], [tasksTable]: [task('fallback-task', 1)] }
    const missing = reader(rows, scope, { code: '42P01', message: 'decision relation does not exist' })
    await expect(findActiveSwitchLifecycleBlock(missing.client, scope)).resolves.toMatchObject({ id: 'fallback-task' })

    const unavailable = reader(rows, scope, { code: '08006', message: 'temporary read failure' })
    await expect(findActiveSwitchLifecycleBlock(unavailable.client, scope)).rejects.toMatchObject({ code: '08006' })
    expect(unavailable.reads).toEqual([decisionsTable])
  })
})
