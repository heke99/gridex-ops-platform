import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/internal/manual-inbound/cron/route'
import type { ManualMailboxPollResult, runManualInboundMailEngine } from '@/lib/inbound-mail/manualMailboxPoller'

const { engine } = vi.hoisted(() => ({ engine: vi.fn<typeof runManualInboundMailEngine>() }))
vi.mock('@/lib/inbound-mail/manualMailboxPoller', () => ({ runManualInboundMailEngine: engine }))

const secret = 'synthetic-cron-secret'
const privateError = 'Synthetic provider diagnostic'
const emptyPoll: ManualMailboxPollResult = {
  mailboxes: 1, polled: 1, fetched: 0, ingested: 0, matched: 0, ambiguous: 0,
  unmatched: 0, ignored: 0, skipped: 0, deadLettered: 0, errors: [],
}

function request(method: 'GET' | 'POST' = 'GET', search = '?environment=test', headers: HeadersInit = { authorization: `Bearer ${secret}` }) {
  return new NextRequest(`https://gridex.test/api/internal/manual-inbound/cron${search}`, { method, headers })
}

beforeEach(() => {
  vi.stubEnv('MANUAL_INBOUND_CRON_SECRET', secret)
  vi.stubEnv('CRON_SECRET', undefined)
  engine.mockReset().mockResolvedValue(emptyPoll)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('manual inbound cron response', () => {
  it('reports a healthy empty poll with an explicit zero error count', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true, source: 'manual_inbound_cron', outcome: 'completed',
      result: { mailboxes: 1, polled: 1, fetched: 0, ingested: 0, matched: 0, skipped: 0, error_count: 0 },
    })
    expect(engine).toHaveBeenCalledOnce()
    expect(engine).toHaveBeenCalledWith({ environment: 'test' })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('reports a failed poll when the worker acquired and fetched but ingested nothing', async () => {
    engine.mockResolvedValueOnce({ ...emptyPoll, fetched: 2, errors: [privateError] })
    const response = await GET(request())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({
      ok: false, source: 'manual_inbound_cron', outcome: 'failed', trace_id: expect.any(String),
      result: { mailboxes: 1, polled: 1, fetched: 2, ingested: 0, matched: 0, skipped: 0, error_count: 1 },
    })
    expect(JSON.stringify(body)).not.toContain(privateError)
    expect(console.error).toHaveBeenCalledWith('[manual-inbound-cron] Poll errors', {
      traceId: body.trace_id, count: 1, errors: [privateError],
    })
  })

  it('reports partial progress and preserves completed work when another operation failed', async () => {
    engine.mockResolvedValueOnce({
      ...emptyPoll, mailboxes: 2, polled: 2, fetched: 2, ingested: 1, matched: 1,
      errors: [privateError, 'Second synthetic diagnostic'],
    })
    const response = await POST(request('POST', '?environment=test', { 'x-manual-inbound-secret': secret }))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: false, source: 'manual_inbound_cron', outcome: 'partial', trace_id: expect.any(String),
      result: { mailboxes: 2, polled: 2, fetched: 2, ingested: 1, matched: 1, skipped: 0, error_count: 2 },
    })
    expect(JSON.stringify(body)).not.toContain('diagnostic')
  })

  it('preserves the existing sanitized 500 and trace when the worker throws', async () => {
    engine.mockRejectedValueOnce(new Error(privateError))
    const response = await GET(request())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, code: 'manual_inbound_processing_failed', trace_id: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain(privateError)
  })

  it('rejects an unconfigured route, invalid credentials and a supplied tenant before polling', async () => {
    vi.stubEnv('MANUAL_INBOUND_CRON_SECRET', undefined)
    expect((await GET(request())).status).toBe(503)
    vi.stubEnv('MANUAL_INBOUND_CRON_SECRET', secret)
    expect((await GET(request('GET', '', {}))).status).toBe(401)
    expect((await GET(request('GET', '?companyId=synthetic-company'))).status).toBe(400)
    expect(engine).not.toHaveBeenCalled()
  })
})
