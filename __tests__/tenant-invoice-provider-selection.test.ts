import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: (...a: unknown[]) => rpc(...a) } }))

import {
  InvoiceProviderConfigError,
  isDispatchImplemented,
  requireTenantInvoiceProvider,
  selectTenantInvoiceProvider,
  setTenantInvoiceDispatchEnabled,
} from '@/lib/billing/providers/registry'

describe('tenant invoice provider selection', () => {
  beforeEach(() => rpc.mockReset())

  it('accepts the selected Capway provider with an explicit environment', () => {
    expect(requireTenantInvoiceProvider({ invoice_export_target_system: 'capway_aptic', billing_provider_environment: 'production' }))
      .toEqual({ provider: 'capway_aptic', environment: 'production' })
  })

  it('never falls back to a default provider or environment', () => {
    expect(() => requireTenantInvoiceProvider({})).toThrow(expect.objectContaining({ code: 'invoice_provider_not_selected' }))
    expect(() => requireTenantInvoiceProvider({ invoice_export_target_system: 'capway_aptic' }))
      .toThrow(expect.objectContaining({ code: 'invoice_provider_environment_missing' }))
  })

  it('refuses a provider without an integration (Fortnox)', () => {
    expect(isDispatchImplemented('fortnox')).toBe(false)
    expect(isDispatchImplemented('nordfin')).toBe(true)
    expect(() => requireTenantInvoiceProvider({ invoice_export_target_system: 'fortnox', billing_provider_environment: 'test' }))
      .toThrow(expect.objectContaining({ code: 'invoice_provider_not_available' }))
  })

  it('does not call the database when an unavailable provider is selected', async () => {
    await expect(selectTenantInvoiceProvider({ companyId: 'c1', provider: 'fortnox', environment: 'test', actorUserId: 'u1' }))
      .rejects.toBeInstanceOf(InvoiceProviderConfigError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('selects through the audited RPC bound to the company and actor', async () => {
    rpc.mockResolvedValue({ data: { provider: 'capway_aptic', environment: 'test', connection_created: true }, error: null })
    await selectTenantInvoiceProvider({ companyId: 'c1', provider: 'capway_aptic', environment: 'test', actorUserId: 'u1' })
    expect(rpc).toHaveBeenCalledWith('gridex_select_invoice_provider_v1', {
      p_company_id: 'c1', p_provider: 'capway_aptic', p_environment: 'test', p_actor_user_id: 'u1',
    })
  })

  it('maps database refusals to readable errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'invoice_provider_connection_not_ready' } })
    await expect(setTenantInvoiceDispatchEnabled({ companyId: 'c1', enabled: true, actorUserId: 'u1' }))
      .rejects.toMatchObject({ code: 'invoice_provider_connection_not_ready' })
    rpc.mockResolvedValue({ data: null, error: { message: 'invoice_provider_switch_blocked_open_exports' } })
    await expect(selectTenantInvoiceProvider({ companyId: 'c1', provider: 'capway_aptic', environment: 'production', actorUserId: 'u1' }))
      .rejects.toMatchObject({ code: 'invoice_provider_switch_blocked_open_exports' })
  })
})
