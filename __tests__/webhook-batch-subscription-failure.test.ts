/* eslint-disable @typescript-eslint/no-explicit-any -- finite stateful delivery database port */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  deliveries: [] as Record<string, unknown>[], subscriptions: [] as Record<string, unknown>[],
  failProjection: true, failCanonicalUpdate: false,
  transport: vi.fn(async (input: { url: string; headers: Headers; body: string; signal: AbortSignal }) => ({ status: 200, ok: true, body: `synthetic accepted ${input.url}` })),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    let patch: Record<string, unknown> | null = null
    const predicates: Array<(row: Record<string, unknown>) => boolean> = []
    let single = false
    const matches = (row: Record<string, unknown>) => predicates.every(p => p(row))
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      update: (value: Record<string, unknown>) => { patch = value; return q },
      eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return q },
      in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return q },
      lt: (key: string, value: string) => { predicates.push(row => row[key] != null && new Date(String(row[key])) < new Date(value)); return q },
      lte: (key: string, value: string) => { predicates.push(row => row[key] != null && new Date(String(row[key])) <= new Date(value)); return q },
      maybeSingle: () => { single = true; return q },
      async then(resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) {
        let result: { data: unknown; error: unknown }
        if (table === 'integration_api_clients') result = { data: [{ id: 'client_synthetic', company_id: 'company_synthetic', status: 'active' }], error: null }
        else {
          const source = table === 'webhook_deliveries' ? m.deliveries : m.subscriptions
          const rows = source.filter(matches)
          if (patch && table === 'webhook_subscriptions' && rows[0]?.id === 'subscription_missing' && m.failProjection) {
            result = { data: null, error: { code: '08006', message: 'synthetic secondary projection failure' } }
          } else if (patch?.status === 'failed' && table === 'webhook_deliveries' && rows[0]?.id === 'delivery_missing' && m.failCanonicalUpdate) {
            result = { data: null, error: { code: '08006', message: 'synthetic canonical ledger failure' } }
          } else {
            if (patch) rows.forEach(row => Object.assign(row, patch))
            result = { data: single ? rows[0] ?? null : rows.map(row => ({ ...row })), error: null }
          }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return q
  },
} }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: vi.fn(async () => ({ allowed: true, company_status: 'active' })) }))
vi.mock('@/lib/integrations/publicWebhookTransport', () => ({ postPublicWebhook: m.transport }))
import { dispatchDueWebhookDeliveries } from '@/lib/integrations/webhooks'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.transport.mockClear(); m.failProjection = true; m.failCanonicalUpdate = false
  delete process.env.WEBHOOK_SIGNING_SECRET_BATCH_MISSING
  process.env.WEBHOOK_SIGNING_SECRET_BATCH_VALID = 'synthetic-test-secret-not-a-live-credential'
  m.subscriptions = ['missing', 'valid'].map(kind => ({
    id: `subscription_${kind}`, company_id: 'company_synthetic', api_client_id: 'client_synthetic',
    status: 'active', endpoint_url: `https://${kind}.example.invalid/receiver`, event_types: ['customer.updated'],
    signing_secret_ref: kind === 'missing' ? 'BATCH_MISSING' : 'BATCH_VALID', timeout_ms: 1000, max_attempts: 3,
    custom_headers: {}, metadata: {}, failure_count: 0,
  }))
  m.deliveries = ['missing', 'valid'].map(kind => ({
    id: `delivery_${kind}`, company_id: 'company_synthetic', webhook_subscription_id: `subscription_${kind}`,
    domain_event_id: `event_${kind}`, event_type: 'customer.updated', status: 'queued', attempts: 0, max_attempts: 3,
    next_attempt_at: '2026-01-01T00:00:00Z', locked_at: null, locked_by: null,
    payload: { event_id: `event_${kind}`, event_type: 'customer.updated', created_at: '2026-01-01T00:00:00Z',
      organization_reference: 'organization_syntheticpublicreference123456', contract_schema_version: 'test',
      aggregate: { type: 'customer', reference: 'customer_syntheticpublicreference123456' }, data: { status: 'active' } },
  }))
})
describe('Webhook missing-secret subscription projection is secondary to delivery state', () => {
  it('keeps the first failed ledger row truthful and still processes an independent second delivery', async () => {
    await expect(dispatchDueWebhookDeliveries()).resolves.toMatchObject({ processed: 2, sent: 1, failed: 1, deliveryUncertain: 0 })
    expect(m.deliveries[0]).toMatchObject({ status: 'failed', attempts: 1, failure_reason: 'webhook_signing_secret_missing', locked_at: null, locked_by: null })
    expect(m.deliveries[1]).toMatchObject({ status: 'sent', attempts: 1, locked_at: null, locked_by: null })
    expect(m.transport).toHaveBeenCalledTimes(1)
    expect(m.transport.mock.calls[0][0]).toMatchObject({ url: 'https://valid.example.invalid/receiver' })
    expect(console.error).toHaveBeenCalled()
  })
  it('does not claim success or continue after a canonical delivery ledger update fails', async () => {
    m.failCanonicalUpdate = true
    await expect(dispatchDueWebhookDeliveries()).rejects.toMatchObject({ message: 'synthetic canonical ledger failure' })
    expect(m.deliveries[0].status).toBe('processing')
    expect(m.transport).not.toHaveBeenCalled()
  })
})
