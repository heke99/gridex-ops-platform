import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({
  context: vi.fn(),
  read: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/app/admin/customers/actions', () => ({
  createCustomerFromImportRowAction: vi.fn(),
  linkCustomerImportRowToExistingCustomerAction: vi.fn(),
  rejectCustomerImportRowAction: vi.fn(),
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: ports.context,
  isPlatformAdminContext: (access: { isPlatformAdmin: boolean }) => access.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/scope', () => ({
  TenantCompanyRequiredError: Error,
  getOperationalCompanyScope: vi.fn(),
}))
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: ports.audit }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (key: string, companyId: string) => {
          expect(key).toBe('company_id')
          const predicates = { companyId, batchIds: [] as string[] }
          const query = {
            in: (column: string, batchIds: string[]) => {
              expect(column).toBe('import_batch_id')
              predicates.batchIds = batchIds
              return query
            },
            order: () => query,
            limit: (limit: number) => ports.read(table, columns, predicates, limit),
          }
          return query
        },
      }),
    }),
  }),
}))

import CustomerImportQueuePage from '@/app/admin/customers/imports/page'

const createdAt = '2026-11-22T13:30:00.000Z'
const batch = { id: 'batch-a', company_id: 'company-a', created_at: createdAt, file_name: 'Syntetisk import' }
const legacyRow = {
  id: 'row-a', import_batch_id: batch.id, row_number: 7, status: 'requires_review',
  customer_id: null, created_at: createdAt,
}

function setupRows(rows: object[]) {
  ports.read.mockImplementation(async (table) => {
    if (table === 'customer_import_batches') return { data: [batch], error: null }
    if (table === 'customer_import_rows') return { data: rows, error: null }
    throw new Error('Unexpected read: ' + table)
  })
}

async function renderPage() {
  return renderToStaticMarkup(await CustomerImportQueuePage())
}

beforeEach(() => {
  vi.resetAllMocks()
  ports.context.mockResolvedValue({
    companyId: 'company-a', isPlatformAdmin: false, roles: [], permissions: ['customers.read'],
  })
})

it('retains a historic import row with a SQL NULL row number', async () => {
  setupRows([{ ...legacyRow, row_number: null }])
  const content = await renderPage()
  expect(content).toContain('Rad —')
  expect(content).toContain('Kräver granskning')
  expect(ports.audit).not.toHaveBeenCalled()
})

it('renders known issue strings without calling .join on malformed history', async () => {
  setupRows([{
    ...legacyRow,
    issues: {
      missingFields: 'unexpected legacy shape',
      uncertainFields: [null, {}, 'Anläggnings-ID'],
      duplicateWarnings: { length: 1 },
    },
    warnings: [{ toString: 'not callable' }, 'Historisk varning'],
  }])
  const content = await renderPage()
  expect(content).toContain('Osäkert: Anläggnings-ID')
  expect(content).toContain('Historisk varning')
  expect(content).not.toContain('unexpected legacy shape')
})

it('uses the older projection when optional row details are unavailable', async () => {
  ports.read.mockImplementation(async (table, columns) => {
    if (table === 'customer_import_batches') return { data: [batch], error: null }
    if (columns.includes('issues')) return {
      data: null,
      error: { code: '42703', message: 'column customer_import_rows.issues does not exist' },
    }
    return { data: [legacyRow], error: null }
  })
  expect(await renderPage()).toContain('Rad 7')
  const calls = ports.read.mock.calls.filter(([table]) => table === 'customer_import_rows')
  expect(calls).toHaveLength(2)
  expect(calls[1][1]).not.toMatch(/issues|parser_confidence|normalized_payload/)
  for (const [, , scope] of calls) {
    expect(scope).toEqual({ companyId: 'company-a', batchIds: ['batch-a'] })
  }
})

it('propagates a missing required column with no additional reads', async () => {
  const error = { code: '42703', message: 'column customer_import_rows.customer_id does not exist' }
  ports.read.mockImplementation(async (table) => table === 'customer_import_batches'
    ? { data: [batch], error: null }
    : { data: null, error })
  await expect(renderPage()).rejects.toEqual(error)
  expect(ports.read).toHaveBeenCalledTimes(2)
  expect(ports.audit).not.toHaveBeenCalled()
})

it('shows company selection to a tenant reader with no active selection', async () => {
  ports.context.mockResolvedValue({
    companyId: null, isPlatformAdmin: false, roles: [], permissions: ['customers.read'],
  })
  expect(await renderPage()).toContain('Välj bolag för att visa importgranskning')
  expect(ports.read).not.toHaveBeenCalled()
  expect(ports.audit).not.toHaveBeenCalled()
})
