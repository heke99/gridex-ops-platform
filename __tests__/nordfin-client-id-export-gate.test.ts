import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const port = vi.hoisted(() => ({
  db: null as SupabaseClient | null,
  archive: vi.fn(),
  loadItem: vi.fn(),
  legacyProjection: vi.fn(),
  sentEvent: vi.fn(),
  monthLock: vi.fn(),
  companyGate: vi.fn(),
  outboundGate: vi.fn(),
  readConnection: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return port.db } }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: port.companyGate }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: port.outboundGate }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: port.sentEvent }))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({
  approval: (metadata: { approval: { status: string } }) => metadata.approval,
  assertItemStillReady: vi.fn(),
  loadItemContext: port.loadItem,
  updateLegacyProjection: port.legacyProjection,
  maybeLockCompleteMonth: port.monthLock,
}))

import { createInvoiceFile } from '@/lib/billing/invoiceFileExport'

const companyId = '00000000-0000-4000-8000-000000000001'
const actorUserId = '00000000-0000-4000-8000-000000000002'
const itemId = '00000000-0000-4000-8000-000000000003'
const runId = '00000000-0000-4000-8000-000000000004'
const fileId = '00000000-0000-4000-8000-000000000005'
const targetCompanyId = '00000000-0000-4000-8000-000000000006'
const approved = { id: itemId, metadata: { approval: { status: 'approved' } } }
type Environment = 'test' | 'production'

function mockInvoiceDatabase(input: {
  provider?: 'nordfin' | 'file_export'
  environment?: Environment
  settings?: Array<{ companyId: string; environment: Environment; clientId: unknown }>
} = {}) {
  const provider = input.provider ?? 'nordfin'
  const environment = input.environment ?? 'test'
  port.db = createClient('https://invoice-archive-synthetic.example.invalid', 'synthetic', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const { pathname, searchParams } = new URL(String(request))
      if (pathname === '/rest/v1/rpc/gridex_create_invoice_export_file_v1') {
        expect(init?.method).toBe('POST')
        port.archive(JSON.parse(String(init?.body)))
        return Response.json(fileId)
      }
      expect(init?.method).toBe('GET')
      if (pathname === '/rest/v1/companies') {
        expect(searchParams.get('id')).toBe(`eq.${companyId}`)
        return Response.json([{ invoice_export_target_system: provider, billing_provider_environment: environment, invoice_export_enabled: true }])
      }
      expect(searchParams.get('company_id')).toBe(`eq.${companyId}`)
      if (pathname === '/rest/v1/invoice_export_runs') {
        expect(searchParams.get('provider')).toBe(`eq.${provider}`)
        expect(searchParams.get('environment')).toBe(`eq.${environment}`)
        expect(searchParams.get('billing_month')).toBe('eq.2026-11')
        return Response.json([{ id: runId }])
      }
      if (pathname === '/rest/v1/invoice_export_items') {
        expect(searchParams.get('status')).toBe('eq.pending')
        expect(searchParams.get('export_file_id')).toBe('is.null')
        return Response.json([approved])
      }
      if (pathname === '/rest/v1/billing_provider_connections') {
        expect(searchParams.get('provider')).toBe('eq.nordfin')
        expect(searchParams.get('environment')).toBe(`eq.${environment}`)
        expect(searchParams.get('select')).toBe('settings')
        port.readConnection(environment)
        const rows = (input.settings ?? []).filter(row => row.companyId === companyId && row.environment === environment)
        return Response.json(rows.map(row => ({ settings: { client_id: row.clientId } })))
      }
      expect(pathname).toBe('/rest/v1/billing_export_run_items')
      expect(searchParams.get('id')).toBe(`eq.${itemId}`)
      return Response.json([{ invoice_address_snapshot: { email: 'approved@example.invalid' } }])
    } },
  })
}

const beginFileExport = () => createInvoiceFile({ companyId, actorUserId, billingMonth: '2026-11', now: new Date('2026-11-12T12:00:00Z') })

beforeEach(() => {
  vi.resetAllMocks()
  port.sentEvent.mockResolvedValue(null)
  port.loadItem.mockResolvedValue({
    item: { ...approved, total_kwh: 10, amount_ex_vat: 100, vat_amount: 25, amount_inc_vat: 125 },
    run: { id: runId }, invoice: {}, customer: { full_name: 'Synthetic invoice recipient' }, underlay: {}, lines: [],
  })
})

describe('Nordfin configuration on the existing invoice-file producer', () => {
  it.each(['Historic id with spaces', 'A'.repeat(41)])('rejects malformed saved ClientId before archive and sent status (%s)', async clientId => {
    mockInvoiceDatabase({ settings: [{ companyId, environment: 'test', clientId }] })

    await expect(beginFileExport()).rejects.toMatchObject({ code: 'nordfin_client_id_invalid' })

    expect(port.companyGate).toHaveBeenCalledWith(companyId)
    expect(port.outboundGate).toHaveBeenCalledWith({ companyId, channel: 'invoice_export' })
    expect(port.readConnection).toHaveBeenCalledExactlyOnceWith('test')
    expect(port.loadItem).not.toHaveBeenCalled()
    expect(port.archive).not.toHaveBeenCalled()
    expect(port.legacyProjection).not.toHaveBeenCalled()
    expect(port.sentEvent).not.toHaveBeenCalled()
    expect(port.monthLock).not.toHaveBeenCalled()
  })

  it.each([undefined, null, 123, '', '  '])('retains the missing configuration guard for %s', async clientId => {
    mockInvoiceDatabase({ settings: clientId === undefined ? [] : [{ companyId, environment: 'test', clientId }] })

    await expect(beginFileExport()).rejects.toMatchObject({ code: 'nordfin_client_id_missing' })
    expect(port.archive).not.toHaveBeenCalled()
    expect(port.legacyProjection).not.toHaveBeenCalled()
  })

  it.each(['test', 'production'] as const)('freezes the validated ClientId for its own company and %s environment', async environment => {
    const clientId = `LoCal_${'A'.repeat(31)}-Id`
    mockInvoiceDatabase({ environment, settings: [
      { companyId: targetCompanyId, environment, clientId: 'other-company' },
      { companyId, environment: environment === 'test' ? 'production' : 'test', clientId: 'other-environment' },
      { companyId, environment, clientId: `  ${clientId}  ` },
    ] })

    await expect(beginFileExport()).resolves.toMatchObject({ fileId, rowCount: 1 })
    expect(port.readConnection).toHaveBeenCalledExactlyOnceWith(environment)
    expect(port.archive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ p_company_id: companyId, p_environment: environment,
      p_rows: [expect.objectContaining({ invoice_export_item_id: itemId, nordfin_client_id: clientId })] }))
    expect(port.legacyProjection).toHaveBeenCalledExactlyOnceWith({ companyId, runId, itemId, status: 'sent' })
    expect(port.archive.mock.invocationCallOrder[0]).toBeLessThan(port.legacyProjection.mock.invocationCallOrder[0])
  })

  it('creates a neutral file without reading Nordfin configuration', async () => {
    mockInvoiceDatabase({ provider: 'file_export', settings: [{ companyId, environment: 'test', clientId: 'invalid legacy key' }] })

    await expect(beginFileExport()).resolves.toMatchObject({ fileId, rowCount: 1 })
    expect(port.readConnection).not.toHaveBeenCalled()
    expect(port.archive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ p_rows: [expect.objectContaining({ nordfin_client_id: null })] }))
  })
})
