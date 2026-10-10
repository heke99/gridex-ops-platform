// ops-api-review: F45
// Owner-approved webhook lifecycle on credential revocation. Real dispatcher
// (dispatchDueWebhookDeliveries) and real policy helpers against a synthetic
// DB port; transport is mocked and never leaves the process.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const COMPANY = 'company-a'
const CLIENT = 'client-a'

const m = vi.hoisted(() => ({
  subscription: {} as Record<string, unknown>,
  delivery: {} as Record<string, unknown>,
  client: null as Record<string, unknown> | null,
  tenantAllowed: true,
  subscriptionUpdates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>,
  transport: vi.fn(async () => ({ ok: true, status: 200, body: 'ok' })),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      let patch: Record<string, unknown> | null = null
      const filters: Record<string, unknown> = {}
      const run = async () => {
        if (table === 'webhook_subscriptions') {
          if (patch) {
            m.subscriptionUpdates.push({ patch, filters: { ...filters } })
            return { data: null, error: null }
          }
          const s = m.subscription
          const matches = (!filters.status || s.status === filters.status)
            && (!filters.company_id || s.company_id === filters.company_id)
            && (!('api_client_id' in filters) || s.api_client_id === filters.api_client_id)
          return { data: matches ? [{ ...s }] : [], error: null }
        }
        if (table === 'webhook_deliveries') {
          if (patch?.status === 'processing') { Object.assign(m.delivery, patch); return { data: [{ ...m.delivery }], error: null } }
          if (patch) { Object.assign(m.delivery, patch); return { data: { id: m.delivery.id }, error: null } }
          return { data: [{ id: m.delivery.id }], error: null }
        }
        if (table === 'integration_api_clients') return { data: m.client ? [{ ...m.client }] : [], error: null }
        throw new Error(`unexpected table ${table}`)
      }
      const q: Record<string, unknown> = {
        then: (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => run().then(a, b),
        update: (p: Record<string, unknown>) => { patch = p; return q },
        eq: (k: string, v: unknown) => { filters[k] = v; return q },
      }
      for (const name of ['select', 'in', 'lt', 'lte', 'order', 'limit', 'maybeSingle']) q[name] = () => q
      return q
    },
  },
}))
vi.mock('@/lib/tenant/operationPolicy', () => ({
  getTenantOperationDecision: async () => m.tenantAllowed
    ? { allowed: true, company_status: 'active' }
    : { allowed: false, company_status: 'closed', reason_code: 'tenant_closed' },
}))
vi.mock('@/lib/integrations/tenantContext', () => ({
  loadExternalTenantReference: async () => 'organization_syntheticpublicreference123456',
}))
vi.mock('@/lib/integrations/publicWebhookTransport', () => ({ postPublicWebhook: m.transport }))

import { buildPublicWebhookPayload, dispatchDueWebhookDeliveries } from '@/lib/integrations/webhooks'
import {
  formatRevokeReason,
  parseRevokeKind,
  stopCredentialLinkedWebhooks,
  webhookCredentialDecision,
} from '@/lib/integrations/webhookCredentialPolicy'

function revokedClient(reason: string | null, metadata: Record<string, unknown> = {}) {
  return { id: CLIENT, company_id: COMPANY, status: 'revoked', revoke_reason: reason, metadata }
}

beforeEach(() => {
  process.env.WEBHOOK_SIGNING_SECRET_SYNTHETIC = 'synthetic-proof-secret'
  m.transport.mockClear()
  m.tenantAllowed = true
  m.subscriptionUpdates = []
  m.client = { id: CLIENT, company_id: COMPANY, status: 'active', revoke_reason: null, metadata: {} }
  m.subscription = {
    id: 'subscription', company_id: COMPANY, api_client_id: CLIENT, status: 'active',
    endpoint_url: 'https://receiver.example.invalid', timeout_ms: 1000, max_attempts: 3,
    signing_secret_ref: 'SYNTHETIC', event_types: ['customer.updated'], custom_headers: {}, metadata: {},
  }
  // A delivery queued before any revocation.
  m.delivery = {
    id: 'delivery', company_id: COMPANY, webhook_subscription_id: 'subscription', domain_event_id: 'event',
    event_type: 'customer.updated', status: 'queued', attempts: 0, max_attempts: 3,
    next_attempt_at: '2026-01-01T00:00:00Z',
    payload: buildPublicWebhookPayload({
      id: 'event', company_id: COMPANY, event_type: 'customer.updated', aggregate_type: 'customer',
      aggregate_id: 'customer', occurred_at: '2026-10-07T00:00:00Z', payload: { status: 'active' },
    } as never, 'organization_syntheticpublicreference123456'),
  }
})

describe('F45: credential revocation versus queued webhook delivery', () => {
  it('security revocation stops an already-queued delivery before transport', async () => {
    m.client = revokedClient(formatRevokeReason('security_revocation', 'leaked key'))
    const result = await dispatchDueWebhookDeliveries()
    expect(result.sent).toBe(0)
    expect(m.transport).not.toHaveBeenCalled()
    expect(m.delivery.status).toBe('skipped')
    expect(m.delivery.failure_reason).toBe('webhook_credential_security_revoked')
  })

  it('normal key rotation keeps the approved webhook delivering', async () => {
    m.client = revokedClient(formatRevokeReason('key_rotation', 'scheduled rotation'))
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(1)
    expect(m.transport).toHaveBeenCalledTimes(1)
  })

  it('revocation recorded before this policy (no kind) keeps the previous behaviour', async () => {
    m.client = revokedClient('Återkallad från superadmin UI')
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(1)
  })

  it('credential expiry or pause stops inbound calls only, not the webhook', async () => {
    m.client = { id: CLIENT, company_id: COMPANY, status: 'expired', revoke_reason: null, metadata: {} }
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(1)
    m.delivery.status = 'queued'
    m.client = { id: CLIENT, company_id: COMPANY, status: 'paused', revoke_reason: null, metadata: {} }
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(1)
    expect(m.transport).toHaveBeenCalledTimes(2)
  })

  it('paused subscription is skipped regardless of credential state', async () => {
    m.subscription.status = 'paused'
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(0)
    expect(m.delivery.status).toBe('skipped')
    expect(m.transport).not.toHaveBeenCalled()
  })

  it('tenant lifecycle block still applies before any credential decision', async () => {
    m.tenantAllowed = false
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(0)
    expect(m.delivery.status).toBe('blocked_tenant_state')
    expect(m.transport).not.toHaveBeenCalled()
  })

  it('tenant closure (canonical lifecycle revoke) stops credential-linked webhooks', async () => {
    m.client = revokedClient('Bolaget avslutat', { lifecycle_status: 'closed' })
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(0)
    expect(m.delivery.failure_reason).toBe('webhook_credential_tenant_offboarded')
  })

  it('null-client and manually approved subscriptions keep explicit ownership', async () => {
    m.client = revokedClient(formatRevokeReason('security_revocation', null))
    m.subscription.api_client_id = null
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(1)
    m.delivery.status = 'queued'
    m.subscription.api_client_id = CLIENT
    m.subscription.metadata = { credential_independent_approval: true }
    expect((await dispatchDueWebhookDeliveries()).sent).toBe(1)
  })

  it('a linked credential of another tenant or a missing credential fails closed', () => {
    const subscription = { api_client_id: CLIENT, company_id: COMPANY, metadata: {} }
    expect(webhookCredentialDecision(subscription, null)).toEqual({ allowed: false, reason: 'webhook_credential_missing' })
    expect(webhookCredentialDecision(subscription, { id: CLIENT, company_id: 'company-b', status: 'active' }))
      .toEqual({ allowed: false, reason: 'webhook_credential_missing' })
  })
})

describe('F45: revoke reason separation and kill action', () => {
  it('records and parses the revoke kind', () => {
    expect(formatRevokeReason('key_rotation', 'x')).toBe('[revoke_kind:key_rotation] x')
    expect(parseRevokeKind(formatRevokeReason('security_revocation', '[revoke_kind:key_rotation] y'))).toBe('security_revocation')
    expect(parseRevokeKind('free text')).toBeNull()
    expect(parseRevokeKind('[revoke_kind:unknown] z')).toBeNull()
  })

  it('security revocation disables linked active subscriptions of the same tenant', async () => {
    const stopped = await stopCredentialLinkedWebhooks({ companyId: COMPANY, clientId: CLIENT, kind: 'security_revocation', actorUserId: 'admin' })
    expect(stopped).toBe(1)
    expect(m.subscriptionUpdates).toHaveLength(1)
    expect(m.subscriptionUpdates[0].patch).toMatchObject({ status: 'disabled', status_reason: 'credential_security_revoked' })
    expect(m.subscriptionUpdates[0].filters).toMatchObject({ company_id: COMPANY, api_client_id: CLIENT })
  })

  it('key rotation and manually approved subscriptions are not disabled', async () => {
    expect(await stopCredentialLinkedWebhooks({ companyId: COMPANY, clientId: CLIENT, kind: 'key_rotation', actorUserId: 'admin' })).toBe(0)
    m.subscription.metadata = { credential_independent_approval: true }
    expect(await stopCredentialLinkedWebhooks({ companyId: COMPANY, clientId: CLIENT, kind: 'tenant_offboarding', actorUserId: 'admin' })).toBe(0)
    expect(m.subscriptionUpdates).toHaveLength(0)
  })
})
