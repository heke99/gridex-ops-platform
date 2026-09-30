import { beforeEach, expect, it, vi } from 'vitest'
type Row = Record<string, unknown>
const f = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, selected: {} as Record<string, Row[]>,
  governance: [] as string[], rpcs: [] as Array<{ name: string; args: Row }>, transport: 0,
  receipts: [] as Row[], rpcError: null as unknown, completionFailure: null as 'response' | 'promise' | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const filters: Array<(row: Row) => boolean> = [], sorts: Array<{ key: string; direction: number }> = []
    let limit = Infinity, patch: Row | null = null
    const result = () => {
      const rows = [...(f.tables[table] ?? [])].filter(row => filters.every(test => test(row)))
        .sort((a,b) => { for (const sort of sorts) { const order = String(a[sort.key]).localeCompare(String(b[sort.key])) * sort.direction; if (order) return order } return 0 })
        .slice(0,limit)
      if (patch) rows.forEach(row => Object.assign(row, patch))
      else f.selected[table] = rows
      return { data: structuredClone(rows), error: null }
    }
    const query = {
      select: () => query, update: (value: Row) => { patch = value; return query },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query },
      lt: (key: string, value: string) => { filters.push(row => typeof row[key] === 'string' && String(row[key]) < value); return query },
      lte: (key: string, value: string) => { filters.push(row => typeof row[key] === 'string' && String(row[key]) <= value); return query },
      or: () => query, order: (key: string, options: { ascending?: boolean } = {}) => { sorts.push({ key,direction: options.ascending === false ? -1 : 1 }); return query },
      limit: (value: number) => { limit = value; return query },
      maybeSingle: async () => { const rows = result(); return { data: rows.data[0] ?? null, error: null } },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve,reject),
    }
    return query
  },
  rpc: async (name: string, args: Row) => {
    f.rpcs.push({ name,args })
    if (f.rpcError) return { data: null,error: f.rpcError }
    if (name === 'gridex_release_approved_invoice_retry_v1') {
      if (f.completionFailure === 'promise') throw new Error('synthetic lease completion promise rejection')
      return { data: f.completionFailure ? null : true,error: f.completionFailure ? { code: 'P0001' } : null }
    }
    const rows = f.receipts.map(row => {
      if (name === 'gridex_claim_tenant_email_outbox_fair_v1') Object.assign(row,{ status: 'processing',lock_token: args.p_claim_token })
      else Object.assign(row,{ claim_token: args.p_claim_token })
      return row
    })
    f.selected[name === 'gridex_claim_tenant_email_outbox_fair_v1' ? 'tenant_email_outbox' : 'invoice_export_items'] = rows
    return { data: structuredClone(rows),error: null }
  },
} }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({ allowed: false, reason_code: 'synthetic_tenant_paused', company_status: 'paused' }) }))
vi.mock('@/lib/email/providers', () => ({ getEmailProvider: () => ({ sendEmail: async () => { f.transport++; throw new Error('external_email_transport_forbidden') } }) }))
vi.mock('@/lib/email/communicationLogs', () => ({ markCommunicationFailed: async () => undefined, markCommunicationSent: async () => undefined }))
vi.mock('@/lib/email/emailDomainEvents', () => ({ emitCommunicationSentDomainEvents: async () => undefined }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async (company: string) => {
  f.governance.push(company); throw new Error('synthetic_company_preflight_denied')
} }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: async () => { throw new Error('external_invoice_transport_forbidden') } }))
vi.mock('@/lib/automation/locks', () => ({ withAutomationLock: async () => { throw new Error('external_invoice_lock_forbidden') } }))
import { processTenantEmailOutbox } from '@/lib/email/emailOutbox'
import { processDueApprovedInvoiceRetries } from '@/lib/billing/invoiceApprovedDispatch'

const noisy = 'synthetic-noisy', quiet = 'synthetic-quiet'
beforeEach(() => { f.tables = {}; f.selected = {}; f.governance = []; f.rpcs = []; f.transport = 0; f.receipts = []; f.rpcError = null; f.completionFailure = null })
function emails(count: number) {
  f.tables.tenant_email_outbox = Array.from({ length: count },(_,index) => ({ id: 'email-noisy-' + index, company_id: noisy,
    status: 'queued', created_at: '2026-09-01T00:00:00Z', dead_letter_at: null, next_attempt_at: null }))
  f.tables.tenant_email_outbox.push({ id: 'email-quiet', company_id: quiet, status: 'queued', created_at: '2026-09-02T00:00:00Z', dead_letter_at: null, next_attempt_at: null })
}
function invoices(count: number) {
  f.tables.invoice_export_items = Array.from({ length: count },(_,index) => ({ id: 'invoice-noisy-' + index, company_id: noisy,
    status: 'failed_retryable', next_retry_at: '2026-09-01T00:00:00Z', metadata: { approval: { status: 'approved', approved_by: 'synthetic-operator' } } }))
  f.tables.invoice_export_items.push({ id: 'invoice-quiet', company_id: quiet, status: 'failed_retryable', next_retry_at: '2026-09-02T00:00:00Z',
    metadata: { approval: { status: 'approved', approved_by: 'synthetic-operator' } } })
}
it('actual email worker reaches a later quiet tenant despite an older noisy backlog without external transport', async () => {
  emails(250)
  // Fixed command-boundary receipt; real fairness is proven separately by
  // executing the complete production SQL, not by a fake scheduler here.
  f.receipts = [f.tables.tenant_email_outbox[0],f.tables.tenant_email_outbox.at(-1)!]
  await processTenantEmailOutbox({ limit: 20 })
  expect(f.tables.tenant_email_outbox.find(row => row.company_id === quiet)?.status).toBe('blocked_tenant_state')
  expect(f.transport).toBe(0)
})
it('actual approved retry inventory includes a later quiet tenant despite an older noisy backlog', async () => {
  invoices(250)
  f.receipts = [f.tables.invoice_export_items[0],f.tables.invoice_export_items.at(-1)!]
  await processDueApprovedInvoiceRetries({ limit: 20 }).catch(() => undefined)
  expect(f.selected.invoice_export_items.some(row => row.company_id === quiet)).toBe(true)
  expect(f.transport).toBe(0)
})
it('actual approved retry worker continues another tenant after a first-tenant preflight denial', async () => {
  invoices(1)
  f.receipts = f.tables.invoice_export_items
  await processDueApprovedInvoiceRetries({ limit: 2 }).catch(() => undefined)
  expect(f.governance).toContain(quiet)
  expect(f.transport).toBe(0)
})
it('both workers fail closed when the fair claim schema is absent without legacy queue fallback or transport', async () => {
  emails(1); invoices(1); f.rpcError = { code: 'PGRST202',message: 'synthetic missing fair command' }
  await expect(processTenantEmailOutbox({ limit: 2 })).rejects.toEqual(f.rpcError)
  await expect(processDueApprovedInvoiceRetries({ limit: 2 })).rejects.toEqual(f.rpcError)
  expect(f.selected).toEqual({}); expect(f.governance).toEqual([]); expect(f.transport).toBe(0)
})
it.each(['response','promise'] as const)('approved retry continues the quiet tenant after a %s failure to complete the first lease', async failure => {
  invoices(1); f.receipts = f.tables.invoice_export_items; f.completionFailure = failure
  const result = await processDueApprovedInvoiceRetries({ limit: 2 })
  expect(f.governance).toEqual([noisy,quiet])
  expect(result).toMatchObject({ processed: 2,sent: 0,failed: 2 })
  expect(result.errors.filter(row => row.reason === 'approved_invoice_retry_completion_unavailable')).toHaveLength(2)
  expect(f.rpcs.filter(row => row.name === 'gridex_release_approved_invoice_retry_v1')).toHaveLength(2)
  expect(f.transport).toBe(0)
})
it('an unapproved claim receipt is rejected before an executor or lease completion is attempted', async () => {
  invoices(1); f.tables.invoice_export_items[0].metadata = { approval: { status: 'pending' } }
  f.receipts = f.tables.invoice_export_items
  await expect(processDueApprovedInvoiceRetries({ limit: 2 })).rejects.toThrow('approved_invoice_retry_claim_invalid')
  expect(f.governance).toEqual([])
  expect(f.rpcs.map(row => row.name)).toEqual(['gridex_claim_approved_invoice_retries_fair_v1'])
  expect(f.transport).toBe(0)
})
