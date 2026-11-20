import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const fixture = vi.hoisted(() => ({
  ledger: null as Row | null,
  ledgerCalls: [] as { method: string; filters: URLSearchParams }[],
  ledgerReadError: false,
  sqlReplay: false,
  commands: [] as Row[],
  log: vi.fn(),
}))

const ledgerScope = ['company_id', 'api_client_id', 'customer_id', 'route', 'idempotency_key']

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
        fixture.ledgerCalls.push({ method, filters: url.searchParams })
        if (method === 'POST') {
          if (fixture.ledger && ledgerScope.every((column) => fixture.ledger?.[column] === requestBody?.[column])) {
            return Response.json({ code: '23505', message: 'Synthetic existing claim' }, { status: 409 })
          }
          fixture.ledger = { ...requestBody, id: 'synthetic-ledger' }
          return Response.json(fixture.ledger, { status: 201 })
        }
        if (method === 'PATCH') {
          expect(url.searchParams.get('status')).toBe(`eq.${fixture.ledger?.status}`)
          fixture.ledger = { ...fixture.ledger, ...requestBody }
          return Response.json({ id: fixture.ledger.id })
        }
        expect(method).toBe('GET')
        if (fixture.ledgerReadError) {
          return Response.json({ code: 'PGRST000', message: 'Synthetic ledger unavailable' }, {
            status: 503, headers: { 'retry-after': '0' },
          })
        }
        const row = fixture.ledger
        const matchesScope = row && ledgerScope
          .every((column) => url.searchParams.get(column) === `eq.${row[column]}`)
        return Response.json(matchesScope ? [row] : [])
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
  fixture.ledgerCalls = []
  fixture.ledgerReadError = false
  fixture.sqlReplay = false
  fixture.commands = []
  fixture.log.mockClear()
})

const oldInvalidAddress = { new_address: 'street' }

function historicalAddressClaim(overrides: Row = {}): Row {
  return {
    id: 'historical-ledger', company_id: 'company', api_client_id: 'client', customer_id: 'customer',
    route: '/api/v1/customer/move-out', idempotency_key: 'synthetic-move-out-order',
    // Captured from the previous handler after submitting the same raw synthetic JSON.
    request_hash: '3970f7f8ad9ff0973737f067e5da77da779b36d087651ff924b36d7e537b7546',
    status: 'completed', response_status: 201, response_body: { data: { ...completion, replayed: false } },
    ...overrides,
  }
}

describe('Customer move-out optional JSON objects', () => {
  it.each([
    { field: 'new_address', value: 'Synthetic address' },
    { field: 'contact_details', value: ['Synthetic contact'] },
    { field: 'metadata', value: false },
    { field: 'metadata', value: null },
  ])('rejects malformed $field without claiming the key and accepts a correction', async ({ field, value }) => {
    const response = await submit({ [field]: value })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_json_object', field } })
    expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, metadata: { field } }))
    expect(fixture.ledgerCalls.map(({ method }) => method)).toEqual(['GET'])
    expect(fixture.ledger).toBeNull()
    expect(fixture.commands).toHaveLength(0)

    const objects = {
      new_address: { street: 'Synthetic address', tags: ['postal'] },
      contact_details: { email: 'synthetic@example.test' },
      metadata: { workflow: { resolved: false } },
    }
    expect((await submit(objects)).status).toBe(201)
    expect(fixture.commands).toHaveLength(1)
    expect(fixture.commands[0]).toMatchObject(objects)
    expect(fixture.ledgerCalls.map(({ method }) => method)).toEqual(['GET', 'POST', 'PATCH'])
  })

  it('replays the exact historical receipt using only a fully scoped read', async () => {
    const original = historicalAddressClaim()
    fixture.ledger = original

    const response = await submit(oldInvalidAddress)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ ...completion, replayed: true })
    expect(fixture.ledgerCalls.map(({ method }) => method)).toEqual(['GET'])
    expect(Object.fromEntries(fixture.ledgerCalls[0].filters)).toMatchObject({
      company_id: 'eq.company', api_client_id: 'eq.client', customer_id: 'eq.customer',
      route: 'eq./api/v1/customer/move-out', idempotency_key: 'eq.synthetic-move-out-order',
    })
    expect(fixture.ledger).toEqual(original)
    expect(fixture.commands).toHaveLength(0)
  })

  it('keeps conflicting raw payloads and existing processing claims as conflicts', async () => {
    fixture.ledger = historicalAddressClaim()
    const conflict = await submit({ ...oldInvalidAddress, metadata: true })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'idempotency_conflict' } })

    fixture.ledger = historicalAddressClaim({ status: 'processing', started_at: new Date().toISOString() })
    const processing = await submit(oldInvalidAddress)
    expect(processing.status).toBe(409)
    expect(await processing.json()).toMatchObject({ error: { code: 'idempotency_in_progress' } })
    expect(fixture.ledgerCalls.map(({ method }) => method)).toEqual(['GET', 'GET'])
    expect(fixture.commands).toHaveLength(0)
  })

  it('rejects a failed matching claim without reopening it', async () => {
    const original = historicalAddressClaim({ status: 'failed', response_status: null, response_body: null })
    fixture.ledger = original

    const response = await submit(oldInvalidAddress)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_json_object', field: 'new_address' } })
    expect(fixture.ledgerCalls.map(({ method }) => method)).toEqual(['GET'])
    expect(fixture.ledger).toEqual(original)
    expect(fixture.commands).toHaveLength(0)
  })

  it('does not use a matching historical receipt belonging to a different customer', async () => {
    fixture.ledger = historicalAddressClaim({ customer_id: 'other-customer' })
    const response = await submit(oldInvalidAddress)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_json_object', field: 'new_address' } })
    expect(fixture.ledgerCalls.map(({ method }) => method)).toEqual(['GET'])
    expect(fixture.commands).toHaveLength(0)
  })

  it('preserves an unavailable receipt lookup as a server error without reserving the key', async () => {
    fixture.ledgerReadError = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const response = await submit(oldInvalidAddress)
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ error: { code: 'customer_portal_internal_error' } })
      expect([...new Set(fixture.ledgerCalls.map(({ method }) => method))]).toEqual(['GET'])
      expect(fixture.ledger).toBeNull()
      expect(fixture.commands).toHaveLength(0)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('preserves required-field checks before any receipt or business operation', async () => {
    const response = await submit({ ...oldInvalidAddress, facility_reference: '' })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'facility_reference_required' } })
    expect(fixture.ledgerCalls).toHaveLength(0)
    expect(fixture.commands).toHaveLength(0)
  })
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
