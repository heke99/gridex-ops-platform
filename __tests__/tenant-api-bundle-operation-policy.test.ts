import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rpcDecision: null as Record<string, unknown> | null,
  rpcError: null as { code?: string; message?: string } | null,
  activeTenantApiClient: true,
  apiClientError: null as { code?: string; message?: string } | null,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: vi.fn(async () => ({ data: state.rpcDecision, error: state.rpcError })),
    from(table: string) {
      if (table !== 'integration_api_clients') throw new Error(`unexpected table ${table}`)
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.limit = chain
      builder.maybeSingle = () => Promise.resolve({
        data: state.activeTenantApiClient ? { id: 'tenant-api-client' } : null,
        error: state.apiClientError,
      })
      return builder
    },
  },
}))

import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'

beforeEach(() => {
  state.rpcDecision = {
    allowed: false,
    reason_code: 'capability_not_ready',
    company_status: 'active',
    capability_status: 'blocked',
    production_status: 'live',
    state_version: 7,
  }
  state.rpcError = null
  state.activeTenantApiClient = true
  state.apiClientError = null
})

describe('tenant API bundle operation policy', () => {
  it.each([
    'api_client.execute',
    'contract_channel.sell',
    'customer_automation.execute',
    'facility_lookup.execute',
    'email.send',
    'webhook.deliver',
  ] as const)('treats active tenant API access as the integration grant for %s', async (operation) => {
    await expect(getTenantOperationDecision('gridex', operation)).resolves.toMatchObject({
      allowed: true,
      reason_code: 'allowed_by_tenant_api_bundle',
      capability_status: 'api_bundle',
      production_status: 'live',
    })
  })

  it('keeps a capability block when no active tenant API client exists', async () => {
    state.activeTenantApiClient = false

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

  it('does not grant market operations such as Ediel production', async () => {
    await expect(
      getTenantOperationDecision('gridex', 'ediel.production.send'),
    ).resolves.toMatchObject({
      allowed: false,
      reason_code: 'capability_not_ready',
    })
  })
})
