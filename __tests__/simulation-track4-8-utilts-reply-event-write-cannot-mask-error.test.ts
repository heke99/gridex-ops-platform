// simulation: finding 20261029-3f1a8ab1/claude-track4/8 (PR #976 clean-migration-replay regression)
// The native suite mocks createEdielMessageEvent as a bare vi.fn() (returns undefined).
// The best-effort error event must never replace the original reply error.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ event: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))

import { createUtiltsRepliesAfterStore, readUtiltsReplyFailedAfterStore } from '@/lib/ediel/utilts/utiltsReplyAfterStore'

const params = { actorUserId: 'actor', sourceMessageId: 'msg', storedMeterValueIds: ['mv-1'], billingUnderlayId: 'bu-1' }
const original = () => new Error('after_real_completion')

beforeEach(() => { io.event.mockReset() })

const arrangements: Record<string, () => void> = {
  'returns undefined (bare mock)': () => { io.event.mockReturnValue(undefined) },
  'throws synchronously': () => { io.event.mockImplementation(() => { throw new Error('event_sync_failure') }) },
  'rejects': () => { io.event.mockImplementation(async () => { throw new Error('event_async_failure') }) },
}

async function runFailingReply(storedMeterValueIds: string[], billingUnderlayId: string | null): Promise<unknown> {
  try {
    await createUtiltsRepliesAfterStore({ ...params, storedMeterValueIds, billingUnderlayId }, async () => { throw original() })
  } catch (error) {
    return error
  }
  throw new Error('expected_reply_failure')
}

for (const [name, arrange] of Object.entries(arrangements)) {
  it(`event writer that ${name} cannot mask the original reply error`, async () => {
    arrange()
    const thrown = await runFailingReply(['mv-1'], 'bu-1')
    expect((thrown as Error).message).toBe('after_real_completion')
    expect(readUtiltsReplyFailedAfterStore(thrown)).toMatchObject({ sourceMessageId: 'msg', storedMeterValueIds: ['mv-1'], billingUnderlayId: 'bu-1' })
    expect(io.event).toHaveBeenCalledTimes(1)
  })
}

it('nothing stored: original error rethrown without an event', async () => {
  const thrown = await runFailingReply([], null)
  expect((thrown as Error).message).toBe('after_real_completion')
  expect(readUtiltsReplyFailedAfterStore(thrown)).toBeNull()
  expect(io.event).not.toHaveBeenCalled()
})
