import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const fixture = vi.hoisted(() => ({
  ledger: null as Row | null,
  sqlReplay: false,
  commands: [] as Row[],
  log: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  currentIntegrationApiResponseContext: () => null,
  logIntegrationApiRequest: fixture.log,
}))
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({
    ok: true, client: { id: 'client', company_id: 'company' }, identity: { customer_id: 'customer' }, startedAt: Date.now(),
  }),
}))

const completion = {
  completion_reference: 'moveout_010101010101010101010101',
  customer_reference: 'customer_010101010101010101010101',
  facility_reference: 'facility_010101010101010101010101',
  contract_reference: null,
  requested_move_out_date: '2027-01-31',
  submitted_at: '2026-11-19T09:00:00.000Z',
  status: 'submitted',
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: createClient('https://database.synthetic.example', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        expect(url.origin).toBe('https://database.synthetic.example')
        const method = init?.method ?? 'GET'
        const requestBody = init?.body ? JSON.parse(String(init.body)) as Row : null
        if (url.pathname === '/rest/v1/rpc/gridex_submit_customer_move_out_v1' && method === 'POST') {
          fixture.commands.push(requestBody?.p_command as Row)
          return Response.json({ ...completion, replayed: fixture.sqlReplay })
        }
        expect(url.pathname).toBe('/rest/v1/customer_portal_write_idempotency')
        if (method === 'POST') {
          if (fixture.ledger) return Response.json({ code: '23505', message: 'Synthetic existing claim' }, { status: 409 })
          fixture.ledger = { ...requestBody, id: 'synthetic-ledger' }
          return Response.json(fixture.ledger, { status: 201 })
        }
        if (method === 'PATCH') {
          expect(fixture.ledger?.status).toBe('processing')
          fixture.ledger = { ...fixture.ledger, ...requestBody }
          return Response.json({ id: fixture.ledger.id })
        }
        expect(method).toBe('GET')
        return Response.json(fixture.ledger ? [fixture.ledger] : [])
      },
    },
  }),
}))

import { POST } from '@/app/api/v1/customer/move-out/route'

const submit = (extra: Row = {}) => POST(new NextRequest('https://app.synthetic.example/api/v1/customer/move-out', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-move-out-order' },
  body: JSON.stringify({ facility_reference: completion.facility_reference, requested_move_out_date: completion.requested_move_out_date, ...extra }),
}))

beforeEach(() => {
  fixture.ledger = null
  fixture.sqlReplay = false
  fixture.commands = []
  fixture.log.mockClear()
})

describe('Customer move-out creation and durable replay', () => {
  it('uses an existing API completion without rerunning the command, and identifies the replay', async () => {
    const created = await submit()
    expect(created.status).toBe(201)
    expect((await created.json()).data).toEqual({ ...completion, replayed: false })
    expect(fixture.ledger).toMatchObject({ status: 'completed', response_status: 201, response_body: { data: { ...completion, replayed: false } } })

    const replay = await submit()
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual({ ...completion, replayed: true })
    expect(fixture.commands).toHaveLength(1)
    expect(fixture.ledger?.response_status).toBe(201)
    expect(fixture.log).toHaveBeenNthCalledWith(1, expect.objectContaining({ statusCode: 201, metadata: { result_count: 1, idempotency_replay: false } }))
    expect(fixture.log).toHaveBeenNthCalledWith(2, expect.objectContaining({ statusCode: 200, metadata: { result_count: 1, idempotency_replay: true } }))
  })

  it('identifies a replay found by the database even when the API completion was previously missing', async () => {
    fixture.sqlReplay = true
    const replay = await submit()
    expect(replay.status).toBe(200)
    expect((await replay.json()).data).toEqual({ ...completion, replayed: true })
    expect(fixture.commands).toHaveLength(1)
    expect(fixture.ledger).toMatchObject({ response_status: 200 })
    expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200, metadata: { result_count: 1, idempotency_replay: true } }))
  })

  it('keeps a different request under the same key as a conflict', async () => {
    const created = await submit()
    expect(created.status).toBe(201)
    const conflict = await submit({ reason: 'Synthetic changed details' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'idempotency_conflict' } })
    expect(fixture.commands).toHaveLength(1)
  })
})
