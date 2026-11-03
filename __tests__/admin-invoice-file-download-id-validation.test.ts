// simulation: MAIN05.06, finding 20261029-3f1a8ab1/claude-track4/1
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ loadInvoiceFile: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ permissions: ['billing_underlay.export'], isPlatformAdmin: false, companyId: 'co-A' }),
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'co-A' }),
}))
vi.mock('@/lib/billing/invoiceFileExport', () => ({
  loadInvoiceFile: io.loadInvoiceFile,
  parseInvoiceFileFormat: () => 'csv',
  renderInvoiceFile: () => ({ body: 'a;b', contentType: 'text/csv', fileName: 'f.csv' }),
}))

const get = async (id: string) => {
  const { GET } = await import('@/app/admin/billing/invoice-files/[id]/route')
  return GET(new NextRequest('http://localhost/download?format=csv'), { params: Promise.resolve({ id }) })
}
beforeEach(() => { io.loadInvoiceFile.mockReset(); io.loadInvoiceFile.mockResolvedValue({ provider: 'x' }) })

it.each([
  ['36 dashes', '-'.repeat(36)],
  ['36 hex chars without UUID structure', 'a'.repeat(36)],
  ['not-a-uuid', 'not-a-uuid'],
])('malformed id (%s) gives 404 without a database call', async (_name, id) => {
  const response = await get(id)
  expect(response.status).toBe(404)
  expect(io.loadInvoiceFile).not.toHaveBeenCalled()
})

it.each([
  ['v4', '00000000-0000-4000-8000-000000000001'],
  ['v7 upper case', '0192F0C1-7A2B-7C3D-8E4F-0123456789AB'],
  ['nil', '00000000-0000-0000-0000-000000000000'],
])('valid UUID (%s) reaches loadInvoiceFile', async (_name, id) => {
  const response = await get(id)
  expect(io.loadInvoiceFile).toHaveBeenCalledWith('co-A', id)
  expect(response.status).toBe(200)
})
