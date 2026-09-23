import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ operations: [] as string[], rows: [] as Record<string, unknown>[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({
  select: () => {
    const query = {
      eq: (column: string, value: unknown) => { io.operations.push(`eq:${column}:${value}`); return query },
      in: (column: string, values: unknown[]) => { io.operations.push(`in:${column}:${values.join(',')}`); return query },
      order: (column: string) => { io.operations.push(`order:${column}`); return query },
      limit: () => { io.operations.push('limit'); return query },
      range: (start: number, end: number) => { io.operations.push(`range:${start}:${end}`); return query },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: io.rows, error: null })),
    }
    return query
  },
}) } }))

beforeEach(() => { io.operations = []; io.rows = [] })

it('filters the Ediel source in the DB before the 200-row window, keeping default support query unchanged', async () => {
  const { listCustomerCases } = await import('@/lib/customer-cases/db')
  await listCustomerCases({ companyId: 'company-a', source: 'ediel_inbound_state_machine', limit: 200 })
  expect(io.operations).toContain('eq:source:ediel_inbound_state_machine')
  expect(io.operations).toContain('eq:company_id:company-a')
  io.operations = []
  await listCustomerCases({ companyId: 'company-a', limit: 200 })
  expect(io.operations.some((entry) => entry.startsWith('eq:source:'))).toBe(false)
})

it('filters the open exception cohort in the DB before its list limit', async () => {
  const { listCustomerCases } = await import('@/lib/customer-cases/db')
  await listCustomerCases({ companyId: 'company-a', source: 'ediel_inbound_state_machine', statuses: ['open', 'action_required'], limit: 200 })
  expect(io.operations).toContain('in:status:open,action_required')
  expect(io.operations).toContain('eq:source:ediel_inbound_state_machine')
})

it('ranges a later open-cohort page with deterministic ordering after source/status predicates', async () => {
  const { listCustomerCases } = await import('@/lib/customer-cases/db')
  await listCustomerCases({ companyId: 'company-a', source: 'ediel_inbound_state_machine', statuses: ['open'], offset: 200, limit: 201 })
  expect(io.operations).toContain('eq:source:ediel_inbound_state_machine')
  expect(io.operations).toContain('in:status:open')
  expect(io.operations).toContain('order:id')
  expect(io.operations).toContain('range:200:400')
})
