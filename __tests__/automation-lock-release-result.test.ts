import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationAlreadyRunningError, releaseAutomationLock, withAutomationLock } from '@/lib/automation/locks'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc } }))

const companyId = '00000000-0000-4000-8000-000000000001'
const lockKey = `billing-monthly-prepare:${companyId}:2026-09`
const metadata = { domain: 'monthly_billing_prepare', private: 'synthetic-private-metadata' }
const scope = { lockKey, companyId, ttlSeconds: 21_600, metadata }
const cleanupError = { code: 'XX000', message: 'synthetic-private-storage-error' }

function expectFencedCleanup() {
  expect(rpc).toHaveBeenCalledTimes(2)
  const token = rpc.mock.calls[0][1].p_lock_token
  expect(token).toEqual(expect.any(String))
  expect(rpc).toHaveBeenNthCalledWith(1, 'gridex_acquire_automation_lock', {
    p_lock_key: lockKey, p_lock_token: token, p_company_id: companyId, p_ttl_seconds: 21_600, p_metadata: metadata,
  })
  expect(rpc).toHaveBeenNthCalledWith(2, 'gridex_release_automation_lock', {
    p_lock_key: lockKey, p_lock_token: token,
  })
  expect(console.error).toHaveBeenCalledExactlyOnceWith('[automation-lock] release_failed', { lockKey, companyId })
}

beforeEach(() => {
  rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('automation lock release cleanup', () => {
  it('returns the exact completed billing result when the cleanup RPC returns an error', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: cleanupError })
    const result = { status: 'completed', automationRunId: 'monthly-run', prepared: 5 }
    const run = vi.fn().mockResolvedValue(result)

    await expect(withAutomationLock({ ...scope, run })).resolves.toBe(result)
    expect(run).toHaveBeenCalledExactlyOnceWith({ lockKey, lockToken: rpc.mock.calls[0][1].p_lock_token })
    expectFencedCleanup()
  })

  it.each([new Error('original business failure'), new DOMException('cancelled', 'AbortError')])(
    'preserves the original $name when lock release also rejects', async original => {
      rpc.mockResolvedValueOnce({ data: true, error: null }).mockRejectedValueOnce(cleanupError)
      const run = vi.fn().mockRejectedValue(original)

      await expect(withAutomationLock({ ...scope, run })).rejects.toBe(original)
      expect(run).toHaveBeenCalledTimes(1)
      expectFencedCleanup()
    },
  )

  it('does not run or attempt a release after an acquisition conflict', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null })
    const run = vi.fn()
    await expect(withAutomationLock({ ...scope, run })).rejects.toBeInstanceOf(AutomationAlreadyRunningError)
    expect(run).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('keeps the direct release RPC return and error contract', async () => {
    const lock = { lockKey, lockToken: '00000000-0000-4000-8000-000000000002' }
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: cleanupError })
    await expect(releaseAutomationLock(lock)).resolves.toBeUndefined()
    await expect(releaseAutomationLock(lock)).rejects.toBe(cleanupError)
    expect(rpc.mock.calls).toEqual(Array.from({ length: 2 }, () => [
      'gridex_release_automation_lock', { p_lock_key: lockKey, p_lock_token: lock.lockToken },
    ]))
    expect(console.error).not.toHaveBeenCalled()
  })
})
