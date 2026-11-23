import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markMailboxPollStarted } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn<typeof globalThis.fetch>() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.invalid', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch },
    }),
  }
})

const mailboxId = '00000000-0000-4000-8000-000000000021'
const now = '2026-11-19T18:00:00.000Z'
const cutoff = '2026-11-19T17:30:00.000Z'
const databaseError = { code: '42501', message: 'permission denied', details: null, hint: null }

function patchReceipt(init?: RequestInit) {
  const { locked_at, locked_by } = JSON.parse(String(init?.body)) as {
    locked_at: string
    locked_by: string
  }
  return { id: mailboxId, locked_at, locked_by }
}

function params(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe('https://synthetic.example.invalid')
  expect(url.pathname).toBe('/rest/v1/ediel_mailboxes')
  return url.searchParams
}

beforeEach(() => {
  fetch.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  vi.stubEnv('EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES', '30')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('conditional mailbox poll claim representation', () => {
  it('reads back the exact receipt after a successful PATCH returns an empty representation', async () => {
    fetch.mockImplementationOnce(async () => Response.json([]))
    fetch.mockImplementationOnce(async () => {
      const persisted = patchReceipt(fetch.mock.calls[0][1])
      return Response.json([{ ...persisted, locked_at: '2026-11-19T18:00:00+00:00' }])
    })

    const receipt = await markMailboxPollStarted(mailboxId, 'scheduled')
    expect(receipt).toMatchObject({
      id: mailboxId,
      locked_by: expect.stringMatching(/^scheduled:[0-9a-f-]{36}$/),
      locked_at: '2026-11-19T18:00:00+00:00',
    })
    expect(fetch).toHaveBeenCalledTimes(2)

    const [[patch, patchInit], [read, readInit]] = fetch.mock.calls
    expect(patchInit?.method).toBe('PATCH')
    expect(new Headers(patchInit?.headers).get('prefer')).toBe('return=representation')
    expect(Object.fromEntries(params(patch))).toEqual({
      id: `eq.${mailboxId}`,
      or: `(locked_at.is.null,locked_at.lt.${cutoff})`,
      select: 'id,locked_by,locked_at',
    })
    expect(JSON.parse(String(patchInit?.body))).toEqual({
      last_polled_at: now,
      locked_at: now,
      locked_by: receipt?.locked_by,
      last_error: null,
      updated_at: now,
    })
    expect(readInit?.method).toBe('GET')
    expect(Object.fromEntries(params(read))).toEqual({
      id: `eq.${mailboxId}`,
      locked_by: `eq.${receipt?.locked_by}`,
      locked_at: `eq.${now}`,
      select: 'id,locked_by,locked_at',
    })
  })

  it('recovers only the winning owner from two concurrent empty responses', async () => {
    let winner: ReturnType<typeof patchReceipt> | undefined
    fetch.mockImplementation(async (input, init) => {
      if (init?.method === 'PATCH') {
        winner ??= patchReceipt(init)
        return Response.json([])
      }
      expect(init?.method).toBe('GET')
      const query = params(input)
      const exact = winner && query.get('id') === `eq.${winner.id}` &&
        query.get('locked_by') === `eq.${winner.locked_by}` && query.get('locked_at') === `eq.${winner.locked_at}`
      return Response.json(exact ? [winner] : [])
    })

    const results = await Promise.all([
      markMailboxPollStarted(mailboxId, 'worker'),
      markMailboxPollStarted(mailboxId, 'worker'),
    ])
    expect(results.filter(Boolean)).toEqual([winner])
    expect(results.filter(result => result === null)).toHaveLength(1)
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['PATCH', 'PATCH', 'GET', 'GET'])
    const [first, second] = fetch.mock.calls
    expect(patchReceipt(first[1]).locked_by).not.toBe(patchReceipt(second[1]).locked_by)
  })

  it('keeps a missing receipt when an existing or replaced lease does not match', async () => {
    fetch.mockImplementation(async () => Response.json([]))
    await expect(markMailboxPollStarted(mailboxId, 'scheduled')).resolves.toBeNull()
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['PATCH', 'GET'])
  })

  it('rejects a nonmatching timestamp from the exact receipt read', async () => {
    fetch.mockImplementationOnce(async () => Response.json([]))
    fetch.mockImplementationOnce(async () => Response.json([{
      ...patchReceipt(fetch.mock.calls[0][1]),
      locked_at: '2026-11-19T18:00:01+00:00',
    }]))
    await expect(markMailboxPollStarted(mailboxId, 'scheduled')).rejects.toThrow('mailbox_poll_claim_invalid')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('uses a returned receipt directly (forced %s)', async force => {
    fetch.mockImplementationOnce(async (input, init) => {
      expect(params(input).has('or')).toBe(!force)
      return Response.json([patchReceipt(init)])
    })
    const receipt = await markMailboxPollStarted(mailboxId, 'worker', force)
    expect(receipt).toEqual(patchReceipt(fetch.mock.calls[0][1]))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not read back a forced attempt with no matching mailbox', async () => {
    fetch.mockImplementationOnce(async () => Response.json([]))
    await expect(markMailboxPollStarted(mailboxId, 'manual', true)).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['PATCH', 'GET'])('preserves database errors from %s', async method => {
    if (method === 'GET') fetch.mockImplementationOnce(async () => Response.json([]))
    fetch.mockImplementationOnce(async () => Response.json(databaseError, { status: 403 }))
    await expect(markMailboxPollStarted(mailboxId, 'scheduled')).rejects.toEqual(databaseError)
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(method === 'PATCH' ? ['PATCH'] : ['PATCH', 'GET'])
  })
})
