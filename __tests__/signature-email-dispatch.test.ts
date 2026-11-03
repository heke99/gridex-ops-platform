import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, sent: [] as Row[], mail: [] as Row[], markedSent: [] as Row[], failTable: '', providerError: false, tenantAllowed: true }))

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | null = null
  let one = false
  const q = {
    select: () => q,
    update: (value: Row) => { patch = value; return q },
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return q },
    lt: (key: string, value: string) => { filters.push(row => typeof row[key] === 'string' && String(row[key]) < value); return q },
    gt: (key: string, value: string) => { filters.push(row => typeof row[key] === 'string' && String(row[key]) > value); return q },
    in: (key: string, value: unknown[]) => { filters.push(row => value.includes(row[key])); return q },
    or: () => q, order: () => q, limit: () => q,
    maybeSingle: () => { one = true; return q },
    single: () => { one = true; return q },
    then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
      if (table === io.failTable) return Promise.resolve({ data: null, error: new Error('database unavailable') }).then(resolve, reject)
      const rows = (io.tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
      if (patch) rows.forEach(row => Object.assign(row, patch))
      return Promise.resolve({ data: one ? (rows[0] ? { ...rows[0] } : null) : rows.map(row => ({ ...row })), error: null }).then(resolve, reject)
    },
  }
  return q
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => query(table), rpc: async (name: string, args: Row) => {
  if (name === 'gridex_mark_customer_contract_signature_request_sent_v1') {
    io.markedSent.push(args); return { data: null, error: null }
  }
  if (name !== 'gridex_prepare_customer_contract_signature_request_v1') throw new Error('unexpected RPC')
  return { data: { ok: true, request_id: 'request-a', company_id: 'company-a', customer_id: 'customer-a', contract_id: 'contract-a',
    contract_number: 'C1', contract_name: 'Agreement', status: 'pending_signature', recipient_email: 'signer@example.invalid', expires_at: '2035-01-01T00:00:00Z',
    channel: 'internal', offer_reference: 'offer-a', contract_publication_version_id: 'publication-a', price_plan_version_id: 'price-a', legal_bundle_version_id: 'legal-a', contract_price_snapshot_id: 'snapshot-a' }, error: null }
} } }))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requireContractRecordsAvailable: async () => undefined }))
vi.mock('@/lib/website/customerApplicationCommunication', () => ({ companyEmailContext: async () => ({ name: 'Supplier', supportEmail: 'support@example.invalid' }) }))
// The generic, separately owned queue helper remains unchanged. Keep the
// actual signature orchestrator and durable dispatcher under this fixture.
vi.mock('@/lib/email/sendCompanyEmail', () => ({ sendCompanyEmail: async (input: Row) => {
  io.mail.push(input); return { ok: true, log: { id: 'log-a' } }
} }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({ allowed: io.tenantAllowed, reason_code:'tenant_suspended',company_status:'suspended' }) }))
vi.mock('@/lib/email/communicationLogs', () => ({ markCommunicationFailed: async () => null, markCommunicationSent: async () => null }))
vi.mock('@/lib/email/emailDomainEvents', () => ({ emitCommunicationSentDomainEvents: async () => undefined }))
vi.mock('@/lib/email/providers', () => ({ getEmailProvider: () => ({ sendEmail: async (input: Row) => {
  io.sent.push(input)
  if (io.providerError) throw new Error('connection lost after request')
  return { providerMessageId: 'provider-receipt', status: 'sent' }
} }) }))

import { processTenantEmailOutbox, sendContractSignatureEmailNow } from '@/lib/email/emailOutbox'
import { sendOnlineContractSignatureRequest } from '@/lib/customer-contracts/onlineSigning'

const scope = { companyId: 'company-a', customerId: 'customer-a', contractId: 'contract-a', signatureRequestId: 'request-a', communicationLogId: 'log-a' }
const row = () => io.tables.tenant_email_outbox[0]

beforeEach(() => {
  io.sent = []; io.mail = []; io.markedSent = []; io.failTable = ''; io.providerError = false;io.tenantAllowed=true
  io.tables = {
    tenant_email_outbox: [{ id: 'outbox-a', company_id: 'company-a', customer_id: 'customer-a', communication_log_id: 'log-a', email_type: 'contract.signature_requested',
      to_email: 'signer@example.invalid', from_email: 'supplier@example.invalid', subject: 'Agreement', html_body: '<p>Private signing link</p>', text_body: null,
      status: 'queued', attempts: 0, max_attempts: 5, next_attempt_at: null, provider_message_id: null,
      provider_idempotency_key: 'tenant-email:company-a:outbox-a', locked_at: null, lock_token: null }],
    communication_logs: [{ id: 'log-a', company_id: 'company-a', customer_id: 'customer-a', contract_id: 'contract-a', event_key: 'contract.signature_requested', status: 'queued',
      metadata: { signature_request_id: 'request-a', contract_id: 'contract-a' } }],
    customer_contract_signature_requests: [{ id: 'request-a', company_id: 'company-a', customer_id: 'customer-a', customer_contract_id: 'contract-a',
      recipient_email: 'signer@example.invalid', revoked_at: null, used_at: null, expires_at: '2035-01-01T00:00:00.000Z' }],
    customer_contracts: [{ id: 'contract-a', company_id: 'company-a', customer_id: 'customer-a', status: 'pending_signature', signed_at: null }],
    customers: [{ id: 'customer-a', company_id: 'company-a', full_name: 'Synthetic signer', customer_number: 'S1' }],
    company_email_templates: [{ id: 'template-a', company_id: 'company-a', template_key: 'contract.signature_requested', language: 'sv' }],
  }
})
afterEach(() => { vi.unstubAllEnvs() })

describe('current signature-link delivery through the real durable outbox', () => {
  it('connects the real signing request and its queue acknowledgement to immediate delivery', async () => {
    const result = await sendOnlineContractSignatureRequest({ companyId: 'company-a', customerId: 'customer-a', contractId: 'contract-a', recipientEmail: 'signer@example.invalid', actorUserId: 'staff-a' })
    expect(result.deliveryStatus).toBe('sent')
    expect(io.sent).toHaveLength(1)
    expect(row().status).toBe('sent')
    expect(io.markedSent).toEqual([{ p_request_id: 'request-a', p_company_id: 'company-a' }])
  })

  it('does not report provider success when the queued request has an uncertain delivery', async () => {
    io.providerError = true
    const result = await sendOnlineContractSignatureRequest({ companyId: 'company-a', customerId: 'customer-a', contractId: 'contract-a', recipientEmail: 'signer@example.invalid', actorUserId: 'staff-a' })
    expect(result.deliveryStatus).toBe('delivery_uncertain')
    expect(io.markedSent).toHaveLength(1) // Existing request acknowledgement is not a provider receipt.
    expect(row().status).toBe('delivery_uncertain')
  })

  it('puts the neutral signing origin into the actual outgoing signing template', async () => {
    vi.stubEnv('PUBLIC_SIGNING_BASE_URL', 'https://agreements.example.invalid')
    await sendOnlineContractSignatureRequest({ companyId: 'company-a', customerId: 'customer-a', contractId: 'contract-a', recipientEmail: 'signer@example.invalid', actorUserId: 'staff-a' })
    const link = new URL(String((io.mail[0].variables as Row).portal_url))
    expect(link.origin).toBe('https://agreements.example.invalid')
    expect(link.pathname).toMatch(/^\/sign\/contract\/[0-9a-f]{64}$/)
  })

  it('reports the actual tenant block without transport or a false processing status',async()=>{
    io.tenantAllowed=false
    const result=await sendContractSignatureEmailNow(scope)
    expect(result.status).toBe('blocked_tenant_state')
    expect(io.sent).toHaveLength(0)
    expect(row().status).toBe('blocked_tenant_state')
  })

  it('dispatches the exact newly queued signature now, before any cron tick', async () => {
    const result = await sendContractSignatureEmailNow(scope)
    expect(result.status).toBe('sent')
    expect(row().status).toBe('sent')
    expect(row().provider_message_id).toBe('provider-receipt')
    expect(io.sent.map(mail => [mail.to, mail.idempotencyKey])).toEqual([['signer@example.invalid', 'tenant-email:company-a:outbox-a']])
  })

  it('keeps one provider attempt when the immediate dispatch and cron race', async () => {
    await Promise.all([sendContractSignatureEmailNow(scope), processTenantEmailOutbox()])
    expect(io.sent).toHaveLength(1)
    expect(row().status).toBe('sent')
  })

  it.each([
    ['revoked', { revoked_at: '2026-10-28T00:00:00Z' }],
    ['used', { used_at: '2026-10-28T00:00:00Z' }],
    ['expired', { expires_at: '2000-01-01T00:00:00Z' }],
    ['other tenant', { company_id: 'company-b' }],
    ['other customer', { customer_id: 'customer-b' }],
    ['other contract', { customer_contract_id: 'contract-b' }],
    ['other recipient', { recipient_email: 'other@example.invalid' }],
  ])('does not send a %s request when the cron reaches the already queued mail', async (_label, changes) => {
    Object.assign(io.tables.customer_contract_signature_requests[0], changes)
    const result = await processTenantEmailOutbox()
    expect(io.sent).toHaveLength(0)
    expect(row().status).toBe('cancelled')
    expect(io.tables.communication_logs[0].status).toBe('cancelled')
    expect(result.skipped).toBe(1)
    expect(result.retried).toBe(0)
  })

  it('does not dispatch an otherwise valid row for a different caller tenant', async () => {
    await sendContractSignatureEmailNow({ ...scope, companyId: 'company-b' })
    expect(io.sent).toHaveLength(0)
    expect(row().status).toBe('queued')
  })

  it('does not send a contract that has become signed since its link was queued', async () => {
    io.tables.customer_contracts[0].status = 'signed'
    await sendContractSignatureEmailNow(scope)
    expect(io.sent).toHaveLength(0)
    expect(row().status).toBe('cancelled')
  })

  it('fails closed on request lookup failure without calling the provider', async () => {
    io.failTable = 'customer_contract_signature_requests'
    await processTenantEmailOutbox()
    expect(io.sent).toHaveLength(0)
    expect(row().status).toBe('queued')
  })

  it('retains an uncertain provider attempt and never automatically sends it again', async () => {
    io.providerError = true
    const result = await sendContractSignatureEmailNow(scope)
    expect(result.status).toBe('delivery_uncertain')
    expect(row().status).toBe('delivery_uncertain')
    await sendContractSignatureEmailNow(scope)
    await processTenantEmailOutbox()
    expect(io.sent).toHaveLength(1)
    expect(row().provider_idempotency_key).toBe('tenant-email:company-a:outbox-a')
  })

  it('also retains uncertain signature sends started by the cron', async () => {
    io.providerError = true
    await processTenantEmailOutbox()
    expect(row().status).toBe('delivery_uncertain')
    await processTenantEmailOutbox()
    expect(io.sent).toHaveLength(1)
  })
})
