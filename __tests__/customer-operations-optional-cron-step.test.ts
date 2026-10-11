import { describe, expect, it, vi } from 'vitest'
import { isUndeployedSchemaError, runOptionalStep } from '@/lib/customer-operations/optionalCronStep'

describe('customer-operations cron optional steps', () => {
  it('skips a step whose database function is not deployed and keeps running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await runOptionalStep('permissionMarketDeadlines', async () => {
      throw { code: 'PGRST202', message: 'Could not find the function public.ediel_advance_permission_deadlines_v1' }
    }, { updated: 0 })
    expect(result).toEqual({ updated: 0, skippedReason: 'schema_not_deployed' })
    warn.mockRestore()
  })

  it('rethrows real failures', async () => {
    await expect(runOptionalStep('x', async () => { throw { code: '23514', message: 'check violation' } }, { updated: 0 }))
      .rejects.toMatchObject({ code: '23514' })
    expect(isUndeployedSchemaError(new Error('boom'))).toBe(false)
  })

  it('returns the step result unchanged on success', async () => {
    await expect(runOptionalStep('x', async () => ({ updated: 3 }), { updated: 0 })).resolves.toEqual({ updated: 3 })
  })
})
