// simulation: MAIN05.06, finding 20261029-3f1a8ab1/claude-track4/1
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  loadInvoiceFile: vi.fn(),
  readArtifact: vi.fn(),
  renderInvoiceFile: vi.fn(),
  normalizeClientId: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.readArtifact } }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ permissions: ['billing_underlay.export'], isPlatformAdmin: false, companyId: 'co-A' }),
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'co-A' }),
}))
vi.mock('@/lib/billing/providers/registry', async (original) => {
  const actual = await original<typeof import('@/lib/billing/providers/registry')>()
  return { ...actual, normalizeNordfinClientId: io.normalizeClientId }
})
vi.mock('@/lib/billing/invoiceFileExport', () => ({
  loadInvoiceFile: io.loadInvoiceFile,
  parseInvoiceFileFormat: (format: string | null) => format ?? 'csv',
  renderInvoiceFile: io.renderInvoiceFile,
}))

const get = async (id: string, format = 'csv') => {
  const { GET } = await import('@/app/admin/billing/invoice-files/[id]/route')
  return GET(new NextRequest(`http://localhost/download?format=${format}`), { params: Promise.resolve({ id }) })
}
beforeEach(() => {
  io.loadInvoiceFile.mockReset().mockImplementation(async (_companyId, id: string) => ({ provider: 'file_export', id, billing_month: '2026-11' }))
  io.readArtifact.mockReset().mockResolvedValue({ data: { kind: 'legacy' }, error: null })
  io.renderInvoiceFile.mockReset().mockReturnValue({ body: 'a;b', contentType: 'text/csv', fileName: 'f.csv' })
  io.normalizeClientId.mockReset().mockImplementation((value: unknown) => typeof value === 'string' ? value : null)
})

it.each([
  ['36 dashes', '-'.repeat(36)],
  ['36 hex chars without UUID structure', 'a'.repeat(36)],
  ['not-a-uuid', 'not-a-uuid'],
])('malformed id (%s) gives 404 without a database call', async (_name, id) => {
  const response = await get(id)
  expect(response.status).toBe(404)
  expect(io.loadInvoiceFile).not.toHaveBeenCalled()
  expect(io.readArtifact).not.toHaveBeenCalled()
})

it.each([
  ['v4', '00000000-0000-4000-8000-000000000001'],
  ['v7 upper case', '0192F0C1-7A2B-7C3D-8E4F-0123456789AB'],
  ['nil', '00000000-0000-0000-0000-000000000000'],
])('valid UUID (%s) reaches loadInvoiceFile', async (_name, id) => {
  const response = await get(id)
  expect(io.loadInvoiceFile).toHaveBeenCalledWith('co-A', id)
  expect(io.readArtifact).toHaveBeenCalledExactlyOnceWith('gridex_read_invoice_file_artifact_v2', { p_company_id: 'co-A', p_file_id: id, p_format: 'csv' })
  expect(response.status).toBe(200)
})


const archiveId = 'b5502000-0000-4000-8000-000000000013'
const archiveMonth = '2026-11'
const archivedXml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Invoices/>', 'utf8')

function loadOlderNordfinRows() {
  io.loadInvoiceFile.mockResolvedValue({
    id: archiveId, provider: 'nordfin', billing_month: archiveMonth, rows: [{ nordfin_client_id: '48' }],
  })
  // Make the successor renderer's ClientId policy stricter while keeping
  // the same published archive and its own valid byte hash.
  io.normalizeClientId.mockReturnValue(null)
}

it('serves the original frozen XML even after the current ClientId policy changes', async () => {
  loadOlderNordfinRows()
  io.readArtifact.mockResolvedValue({
    error: null,
    data: {
      format: 'nordfin_xml',
      fileName: 'nordfin-fakturor-2026-11-b5502000.xml',
      contentType: 'application/xml; charset=utf-8',
      rendererVersion: 'gridex_invoice_file_bytes_v1',
      sha256: createHash('sha256').update(archivedXml).digest('hex'),
      byteLength: archivedXml.length,
      bodyBase64: archivedXml.toString('base64'),
    },
  })

  const response = await get(archiveId, 'nordfin_xml')
  expect(response.status).toBe(200)
  expect(Buffer.from(await response.arrayBuffer())).toEqual(archivedXml)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(io.readArtifact).toHaveBeenCalledExactlyOnceWith('gridex_read_invoice_file_artifact_v2', {
    p_company_id: 'co-A', p_file_id: archiveId, p_format: 'nordfin_xml',
  })
  expect(io.normalizeClientId).not.toHaveBeenCalled()
  expect(io.renderInvoiceFile).not.toHaveBeenCalled()
})

it('still checks the current ClientId policy for an affirmatively classified legacy XML file', async () => {
  loadOlderNordfinRows()

  const response = await get(archiveId, 'nordfin_xml')
  expect(response.status).toBe(409)
  expect(io.readArtifact).toHaveBeenCalledExactlyOnceWith('gridex_read_invoice_file_artifact_v2', {
    p_company_id: 'co-A', p_file_id: archiveId, p_format: 'nordfin_xml',
  })
  expect(io.normalizeClientId).toHaveBeenCalledExactlyOnceWith('48')
  expect(io.renderInvoiceFile).not.toHaveBeenCalled()
})
