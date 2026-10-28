// reality-defects: F-B1
// F-B1 (reality F6c, batch 13): a deadlock (40P01) between concurrent inbound processings aborted the business
// processing of one E66 after it had already been validated. The stranded resume only selects messages still
// 'received', so the file was never processed again and its metering values were never stored. A transient
// PostgreSQL conflict (deadlock 40P01, serialization failure 40001) is now retried in place, a bounded number of times;
// any other error fails at once as before.
import { describe, expect, it, vi } from 'vitest'
import { runWithTransientRetry } from '@/lib/inbound-mail/strandedInboundEdielResume'

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' })

describe('F-B1 inbound business processing retries a transient database conflict', () => {
  it('a deadlock is retried and the processing completes', async () => {
    const run = vi.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce('done')
    await expect(runWithTransientRetry(run, { delayMs: 0 })).resolves.toBe('done')
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('a PostgREST error object with a serialization failure is retried too', async () => {
    const run = vi.fn().mockRejectedValueOnce({ code: '40001', message: 'could not serialize access' }).mockResolvedValueOnce('done')
    await expect(runWithTransientRetry(run, { delayMs: 0 })).resolves.toBe('done')
  })
  it('the retry is bounded: a deadlock every time still fails after the last attempt', async () => {
    const run = vi.fn().mockRejectedValue(deadlock())
    await expect(runWithTransientRetry(run, { attempts: 3, delayMs: 0 })).rejects.toThrow('deadlock detected')
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('any other error is never retried', async () => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error('utilts_consumption_binding_invalid'), { code: 'P0U01' }))
    await expect(runWithTransientRetry(run, { delayMs: 0 })).rejects.toThrow('utilts_consumption_binding_invalid')
    expect(run).toHaveBeenCalledTimes(1)
  })

  // F-B1c (batch 15): under load five CONTRL/APERAK aborted on a statement timeout (57014) and one E66 on the
  // ledger's client time limit; all were stranded after progressing past 'received'.
  it('a statement timeout and a client timeout are retried too', async () => {
    const timeout = vi.fn().mockRejectedValueOnce({ code: '57014', message: 'canceling statement due to statement timeout' }).mockResolvedValueOnce('done')
    await expect(runWithTransientRetry(timeout, { delayMs: 0 })).resolves.toBe('done')
    const aborted = vi.fn().mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })).mockResolvedValueOnce('done')
    await expect(runWithTransientRetry(aborted, { delayMs: 0 })).resolves.toBe('done')
  })
})

