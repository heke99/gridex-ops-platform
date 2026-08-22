import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rpcDecision: null as Record<string, unknown> | null,
  rpcError: null as { code?: string; message?: string } | null,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: vi.fn(async () => ({ data: state.rpcDecision, error: state.rpcError })),
  },
}))

import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'

beforeEach(() => {
  state.rpcDecision = {
    allowed: true,
    reason_code: 'allowed_by_tenant_api_bundle',
    company_status: 'active',
    capability_status: 'api_bundle',
    production_status: 'live',
    state_version: 7,
  }
  state.rpcError = null
})

describe('tenant operation policy', () => {
  it.each([
    'api_client.execute',
    'contract_channel.sell',
    'customer_automation.execute',
    'facility_lookup.execute',
    'email.send',
    'webhook.deliver',
  ] as const)('returns the canonical database API-bundle decision for %s', async (operation) => {
    await expect(getTenantOperationDecision('gridex', operation)).resolves.toMatchObject({
      allowed: true,
      reason_code: 'allowed_by_tenant_api_bundle',
      capability_status: 'api_bundle',
      production_status: 'live',
    })
  })

  it('keeps a canonical capability block fail-closed', async () => {
    state.rpcDecision = {
      allowed: false,
      reason_code: 'capability_not_ready',
      company_status: 'active',
      capability_status: 'blocked',
      production_status: 'live',
      state_version: 7,
    }

    await expect(
      getTenantOperationDecision('gridex', 'customer_automation.execute'),
    ).resolves.toMatchObject({
      allowed: false,
      reason_code: 'capability_not_ready',
    })
  })

  it('does not bypass lifecycle or production gates', async () => {
    state.rpcDecision = {
      allowed: false,
      reason_code: 'tenant_production_not_live_for_sales',
      company_status: 'active',
      capability_status: 'ready',
      production_status: 'prepared',
      state_version: 8,
    }

    await expect(
      getTenantOperationDecision('gridex', 'contract_channel.sell'),
    ).resolves.toMatchObject({
      allowed: false,
      reason_code: 'tenant_production_not_live_for_sales',
      production_status: 'prepared',
    })
  })

  it('preserves canonical Ediel decisions without API-layer override', async () => {
    state.rpcDecision = {
      allowed: false,
      reason_code: 'capability_not_ready',
      company_status: 'active',
      capability_status: 'blocked',
      production_status: 'live',
      state_version: 7,
    }

    await expect(
      getTenantOperationDecision('gridex', 'ediel.production.send'),
    ).resolves.toMatchObject({
      allowed: false,
      reason_code: 'capability_not_ready',
    })
  })

  it('propagates canonical RPC errors instead of inventing a fallback entitlement', async () => {
    state.rpcError = { code: 'XX000', message: 'database operation policy unavailable' }

    await expect(
      getTenantOperationDecision('gridex', 'webhook.deliver'),
    ).rejects.toMatchObject({ code: 'XX000' })
  })
})
