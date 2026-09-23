import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ operations: [] as string[], rows: [] as Record<string, unknown>[], updated: false }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({
  select: () => {
    const query = {
      eq: (column: string, value: unknown) => { io.operations.push(`eq:${column}:${value}`); return query },
      order: () => { io.operations.push('order'); return query },
      limit: () => { io.operations.push('limit'); return query },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: io.rows, error: null })),
    }
    return query
  },
  update: () => {
    const query = {
      eq: (column: string, value: unknown) => { io.operations.push(`eq:${column}:${value}`); return query },
      select: () => query,
      single: async () => {
        io.updated = io.operations.includes('eq:source:ediel_inbound_state_machine')
        return io.updated ? { data: { id: 'case-a', company_id: 'company-a', customer_id: 'customer-a' }, error: null } : { data: null, error: { message: 'expected source missing' } }
      },
    }
    return query
  },
  insert: async () => ({ error: null }),
}) } }))

beforeEach(() => { io.operations = []; io.rows = []; io.updated = false })

it('filters the Ediel source in the DB before the 200-row window, keeping default support query unchanged', async () => {
  const { listCustomerCases } = await import('@/lib/customer-cases/db')
  await listCustomerCases({ companyId: 'company-a', source: 'ediel_inbound_state_machine', limit: 200 })
  expect(io.operations).toContain('eq:source:ediel_inbound_state_machine')
  expect(io.operations).toContain('eq:company_id:company-a')
  io.operations = []
  await listCustomerCases({ companyId: 'company-a', limit: 200 })
  expect(io.operations.some((entry) => entry.startsWith('eq:source:'))).toBe(false)
})

it('makes the source predicate part of the atomic status UPDATE before recording its effects', async () => {
  const { updateCustomerCaseStatus } = await import('@/lib/customer-cases/db')
  await updateCustomerCaseStatus({ caseId: 'case-a', companyId: 'company-a', status: 'resolved', expectedSource: 'ediel_inbound_state_machine', actorUserId: 'actor' })
  expect(io.updated).toBe(true)
  expect(io.operations).toContain('eq:company_id:company-a')
})
