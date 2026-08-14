import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: mocks.rpc,
  },
}))

import { withDependencyCircuit } from '@/lib/runtime/dependencyCircuit'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('withDependencyCircuit', () => {
  it('returns the successful dependency result even when success telemetry throws', async () => {
    // Gate opens, operation succeeds, then circuit success recording fails.
    // The caller must still receive the successful result; telemetry must not
    // fail-closed over a completed dependency call (e.g. SVK fetch).
    mocks.rpc
      .mockResolvedValueOnce({
        data: { allowed: true, circuit_state: 'closed' },
        error: null,
      })
      .mockRejectedValueOnce(new Error('circuit telemetry unavailable'))

    await expect(
      withDependencyCircuit('svk.arcgis', async () => ({ features: 3 })),
    ).resolves.toEqual({ features: 3 })

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls[1]?.[0]).toBe('gridex_dependency_circuit_record_v1')
    expect(mocks.rpc.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ p_outcome: 'success' }),
    )
  })

  it('still records failure telemetry without replacing the original error', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { allowed: true, circuit_state: 'closed' },
        error: null,
      })
      .mockRejectedValueOnce(new Error('circuit telemetry unavailable'))

    await expect(
      withDependencyCircuit('svk.arcgis', async () => {
        throw Object.assign(new Error('fetch failed'), { code: 'ETIMEDOUT' })
      }),
    ).rejects.toMatchObject({ code: 'dependency_timeout' })
  })
})
