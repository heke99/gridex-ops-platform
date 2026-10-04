import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, queries: [] as Array<{ table: string; filters: string[] }> }))
type Row = Record<string, unknown>
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  const order: Array<{ field: string; ascending: boolean }> = []
  const evidence = { table, filters: [] as string[] }
  state.queries.push(evidence)
  let limit = Infinity
  const result = () => {
    const rows = (state.tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
    rows.sort((a, b) => {
      for (const key of order) { const difference = String(a[key.field]).localeCompare(String(b[key.field])) * (key.ascending ? 1 : -1); if (difference) return difference }
      return 0
    })
    return { data: rows.slice(0, limit), error: null }
  }
  const api = {
    select: () => api,
    eq: (field: string, value: unknown) => { evidence.filters.push(`${field}=${value}`); filters.push(row => row[field] === value); return api },
    in: (field: string, values: unknown[]) => { filters.push(row => values.includes(row[field])); return api },
    order: (field: string, options: { ascending: boolean }) => { order.push({ field, ascending: options.ascending }); return api },
    limit: (value: number) => { limit = value; return api },
    or: (expression: string) => {
      const match = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/.exec(expression)
      if (!match) throw new Error('Unknown keyset predicate')
      filters.push(row => String(row.created_at) < match[1] || (row.created_at === match[2] && String(row.id) < match[3]))
      return api
    },
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => resolve(result()),
  }
  return api
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => query(table) } }))
vi.mock('@/lib/customer-cases/support', () => ({ createTenantSupportCase: vi.fn() }))
import { listStaffCaseEvents } from '@/lib/staff-api/cases'
import { listSupportAttachmentsPage } from '@/lib/customer-service/supportAttachments'
import { createCustomerCase } from '@/lib/customer-cases/db'
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const customer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const caseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const actor = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const scope = { companyId: company, customerId: customer, caseId, audience: 'staff' as const }
beforeEach(() => { state.tables = {}; state.queries = [] })

describe('addressable staff case history', () => {
  it('walks all 501 events with stable timestamp ties and displays newest entries first', async () => {
    state.tables.customer_case_events = Array.from({ length: 501 }, (_, index) => ({
      id: id(index + 1), company_id: company, customer_id: customer, customer_case_id: caseId,
      event_type: 'support_internal_note', message: `entry-${index + 1}`, payload: { visibility: 'internal' },
      created_by: actor, created_at: '2026-10-04T08:00:00.000Z',
    }))
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await listStaffCaseEvents(company, customer, caseId, { limit: 100, cursor })
      expect(page.page.returned).toBeLessThanOrEqual(100)
      seen.push(...page.items.map(row => row.message))
      cursor = page.page.next_cursor
      if (page.page.has_more) expect(cursor).toBeTypeOf('string')
    } while (cursor)
    expect(seen).toHaveLength(501)
    expect(new Set(seen).size).toBe(501)
    expect(seen[0]).toBe('entry-501')
    expect(seen.at(-1)).toBe('entry-1')
    expect(state.queries.every(query => query.filters.includes(`company_id=${company}`) && query.filters.includes(`customer_id=${customer}`) && query.filters.includes(`customer_case_id=${caseId}`))).toBe(true)
  })
  it('rejects event cursors for another case, customer, company or attachment resource', async () => {
    state.tables.customer_case_events = Array.from({ length: 2 }, (_, index) => ({ id: id(index + 1), company_id: company, customer_id: customer, customer_case_id: caseId, event_type: 'support_internal_note', message: 'note', payload: {}, created_by: actor, created_at: '2026-10-04T08:00:00.000Z' }))
    const page = await listStaffCaseEvents(company, customer, caseId, { limit: 1 })
    const cursor = page.page.next_cursor
    for (const [c, u, s] of [[actor, customer, caseId], [company, actor, caseId], [company, customer, actor]]) {
      await expect(listStaffCaseEvents(c, u, s, { cursor })).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 })
    }
    await expect(listSupportAttachmentsPage(scope, { cursor })).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 })
  })
  it('walks all 101 attachments without hiding the latest attachment or internal files', async () => {
    state.tables.customer_case_attachments = Array.from({ length: 101 }, (_, index) => ({
      id: id(index + 1), company_id: company, customer_id: customer, customer_case_id: caseId,
      public_reference: `support_attachment_${index + 1}`, visibility: 'internal', scan_status: 'released',
      created_at: '2026-10-04T08:00:00.000Z',
    }))
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await listSupportAttachmentsPage(scope, { limit: 50, cursor })
      seen.push(...page.items.map(row => row.public_reference))
      cursor = page.page.next_cursor
    } while (cursor)
    expect(seen).toHaveLength(101)
    expect(new Set(seen).size).toBe(101)
    expect(seen[0]).toBe('support_attachment_101')
    expect(seen.at(-1)).toBe('support_attachment_1')
  })
  it('fails closed before a staff support caller can enter the non-atomic generic creation path', async () => {
    await expect(createCustomerCase({ companyId: company, customerId: customer, caseType: 'other', title: 'Staff support', actorUserId: actor, metadata: { support_channel: 'staff_api' } })).rejects.toThrow('staff_support_atomic_command_required')
    expect(state.queries).toHaveLength(0)
  })
})
