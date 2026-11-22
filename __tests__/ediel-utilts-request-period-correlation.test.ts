import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  requests: [] as Row[],
  requestReads: [] as Array<Array<[string, unknown]>>,
  requestError: null as { code: string } | null,
  link: vi.fn(),
}))

vi.mock('@/lib/ediel/db', () => ({ linkEdielMessage: io.link }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      let rows: Row[] = []
      const reads: Array<[string, unknown]> = []
      if (table === 'metering_points') {
        rows = [{ id: 'point', company_id: 'tenant', site_id: null }]
      } else if (table === 'grid_owner_data_requests') {
        rows = [...io.requests]
        io.requestReads.push(reads)
      } else {
        throw new Error('Unexpected read: ' + table)
      }
      const error = table === 'grid_owner_data_requests' ? io.requestError : null
      const query = {
        select: () => query,
        eq(key: string, value: unknown) {
          reads.push([key, value])
          rows = rows.filter(row => row[key] === value)
          return query
        },
        in(key: string, values: unknown[]) {
          reads.push([key, values])
          rows = rows.filter(row => values.includes(row[key]))
          return query
        },
        order(key: string) {
          rows.sort((a, b) => String(b[key]).localeCompare(String(a[key])))
          return query
        },
        limit(n: number) { return Promise.resolve({ data: rows.slice(0, n), error }) },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error }) },
      }
      return query
    },
  },
}))

import { linkInboundUtiltsMessageCanonically } from '@/lib/ediel/flows/utiltsDataRequest.part-1'

function message(overrides: Partial<EdielMessageRow> = {}): EdielMessageRow {
  return {
    id: 'message', company_id: 'tenant', direction: 'inbound', environment: 'test',
    message_family: 'UTILTS', message_code: 'E66', metering_point_id: 'point', message_received_at: '2026-07-05T09:00:00Z',
    parsed_payload: {
      normalizedMeteringPayload: { periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z' },
    },
    ...overrides,
  } as EdielMessageRow
}

beforeEach(() => {
  io.link.mockClear()
  io.requestReads = []
  io.requestError = null
  io.requests = [
    {
      id: 'august', company_id: 'tenant', metering_point_id: 'point', external_reference: 'AUGUST-REFERENCE',
      status: 'sent', request_scope: 'meter_values', sent_at: '2026-07-03T10:30:00Z',
      requested_period_start: '2026-08-01', requested_period_end: '2026-09-01', created_at: '2026-07-03T10:00:00Z',
    },
    {
      id: 'july', company_id: 'tenant', metering_point_id: 'point', external_reference: 'JULY-REFERENCE',
      status: 'sent', request_scope: 'meter_values', sent_at: '2026-07-02T10:30:00Z',
      requested_period_start: '2026-07-01', requested_period_end: '2026-08-01', created_at: '2026-07-02T10:00:00Z',
    },
  ]
})

async function correlate(overrides: Partial<EdielMessageRow>, expected: string | null) {
  const result = await linkInboundUtiltsMessageCanonically({ actorUserId: 'actor', message: message(overrides) })
  expect(result.matchedDataRequest?.id ?? null).toBe(expected)
  expect(io.link).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    gridOwnerDataRequestId: expected, meteringPointId: 'point',
  }))
}

it.each([
  { incoming: 'production', prior: 'test' },
  { incoming: 'test', prior: 'production' },
] as const)('holds unreferenced E66 in $incoming without assuming the latest $prior request', async ({ incoming, prior }) => {
  // Legacy requests have no environment column. This metadata is illustrative
  // only. The meter and newest row cannot prove an E73 original in either environment.
  io.requests[0].request_payload = { environment: prior }

  await correlate({ environment: incoming }, null)
  expect(io.requestReads).toEqual([])
})

it('keeps an unambiguous explicit E66 reference in the current company at the same meter', async () => {
  await correlate({ external_reference: 'JULY-REFERENCE' }, 'july')
  expect(io.requestReads).toEqual([[['company_id', 'tenant'], ['external_reference', ['JULY-REFERENCE']]]])
})

it('does not replace two competing E66 references with the latest request', async () => {
  await correlate({ external_reference: 'JULY-REFERENCE', transaction_reference: 'AUGUST-REFERENCE' }, null)
  expect(io.requestReads).toHaveLength(1)
})

it('does not replace an E66 reference belonging to another company with an unrelated tenant request', async () => {
  io.requests[1].company_id = 'foreign-tenant'

  await correlate({ external_reference: 'JULY-REFERENCE' }, null)
  expect(io.requestReads).toHaveLength(1)
})

it('does not replace an E66 reference for another meter with a guessed request', async () => {
  io.requests[1].metering_point_id = 'other-point'

  await correlate({ external_reference: 'JULY-REFERENCE' }, null)
  expect(io.requestReads).toHaveLength(1)
})

it('preserves a stored E66 request identity in the same company', async () => {
  await correlate({ grid_owner_data_request_id: 'july' }, 'july')
  expect(io.requestReads).toEqual([[['id', 'july'], ['company_id', 'tenant']]])
})

it.each(['E30', 'E61'])('preserves the existing meter fallback for %s in the same link resolver', async message_code => {
  await correlate({ message_code }, 'august')
  expect(io.requestReads).toEqual([[['company_id', 'tenant'], ['metering_point_id', 'point']]])
})

it('propagates a failed explicit reference lookup before linking', async () => {
  io.requestError = { code: '08006' }
  await expect(linkInboundUtiltsMessageCanonically({
    actorUserId: 'actor', message: message({ external_reference: 'JULY-REFERENCE' }),
  })).rejects.toBe(io.requestError)
  expect(io.link).not.toHaveBeenCalled()
})
