import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(),
  refresh: vi.fn<(client: unknown, customerId: string) => Promise<void>>(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/customer-operations/automationConfig', () => ({
  resolveAutomationActorId: (actorUserId: string) => actorUserId,
}))
vi.mock('@/lib/operations/db', () => ({ syncCustomerOperationsForCustomer: io.refresh }))

import { processReadySupplierSwitchActivations } from '@/lib/operations/supplierSwitchActivationSweep'

const nativeFailure = {
  requestId: 'switch-C',
  companyId: 'company-C',
  code: 'supplier_switch_activation_blocked',
  message: 'Verifierad marknadsspärr.',
}

function nativeResult(data: Record<string, unknown>) {
  io.rpc.mockResolvedValueOnce({
    data: { marketDate: '2026-11-19', ...data },
    error: null,
  })
}

function sweep() {
  return processReadySupplierSwitchActivations({ actorUserId: 'actor-A', limit: 3 })
}

describe('supplier switch derived customer refresh', () => {
  beforeEach(() => {
    io.rpc.mockReset()
    io.refresh.mockReset().mockResolvedValue(undefined)
  })

  it('loads the native activation result and refreshes each customer once', async () => {
    nativeResult({ scanned: 3, ready: 3, activated: 3, activatedCustomerIds: ['customer-A', 'customer-B', 'customer-A'] })

    await expect(sweep()).resolves.toMatchObject({
      scanned: 3,
      ready: 3,
      activated: 3,
      failed: 0,
      failures: [],
      customerRefresh: { attempted: 2, succeeded: 2, failed: 0, failures: [] },
    })
    expect(io.rpc.mock.calls).toEqual([['gridex_process_ready_supplier_switch_activations', {
      p_actor_user_id: 'actor-A',
      p_limit: 3,
    }]])
    expect(io.rpc.mock.invocationCallOrder[0]).toBeLessThan(io.refresh.mock.invocationCallOrder[0])
    expect(io.refresh.mock.calls.map(([, customerId]) => customerId)).toEqual(['customer-A', 'customer-B'])
  })

  it('continues after customer A fails, and preserves the independent native result', async () => {
    nativeResult({ scanned: 3, activated: 2, blocked: 1, failures: [nativeFailure], activatedCustomerIds: ['customer-A', 'customer-B'] })
    io.refresh.mockRejectedValueOnce(new Error('synthetic internal error details'))

    const result = await sweep()

    expect(io.refresh.mock.calls.map(([, customerId]) => customerId)).toEqual(['customer-A', 'customer-B'])
    expect(result).toMatchObject({
      activated: 2,
      blocked: 1,
      failed: 0,
      failures: [nativeFailure, {
        requestId: 'derived-state-refresh',
        companyId: null,
        code: 'post_activation_customer_sync_failed',
      }],
      customerRefresh: {
        attempted: 2,
        succeeded: 1,
        failed: 1,
        failures: [{ customerId: 'customer-A', code: 'post_activation_customer_sync_failed' }],
      },
    })
    expect(JSON.stringify(result)).not.toContain('synthetic internal error details')
  })

  it('reports no refresh when the native sweep performed no activation', async () => {
    nativeResult({ scanned: 0, activated: 0, activatedCustomerIds: [] })

    await expect(sweep()).resolves.toMatchObject({
      customerRefresh: { attempted: 0, succeeded: 0, failed: 0, failures: [] },
    })
    expect(io.refresh).not.toHaveBeenCalled()
  })

  it('retains native RPC failure and performs no refresh', async () => {
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: 'synthetic native fault' } })

    await expect(sweep()).rejects.toThrow('synthetic native fault')
    expect(io.refresh).not.toHaveBeenCalled()
  })
})
