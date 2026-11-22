import { createClient } from '@supabase/supabase-js'
import { afterEach, expect, it, vi } from 'vitest'
import { requestMissingFacilityInformation } from '@/lib/customer-operations/requestMissingFacilityInformation'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

const port = vi.hoisted(() => ({ db: null as unknown as FakeDb, outbound: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return port.db.client } }))
vi.mock('@/lib/platform/outboundFreeze', () => ({ assertOutboundAllowed: port.outbound }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: vi.fn() }))

const id = (n: number) => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const companyId = id(1)
const customerId = id(2)
const siteId = id(3)
const otherSiteId = id(6)
const gridOwnerId = id(4)
const olderTime = '2026-09-01T10:00:00.123455+00:00'
const newerTime = '2026-09-01T10:00:00.123456+00:00'
const select = () => requestMissingFacilityInformation({ companyId, customerId, siteId, actorUserId: null })

function poa(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: id(n), company_id: companyId, customer_id: customerId, site_id: siteId, customer_site_id: siteId,
    status: 'signed', scope: 'facility_information_lookup', scope_summary: {},
    valid_from: '2020-01-01', valid_to: '2099-01-01', accepted_at: '2020-01-01T10:00:00Z',
    signer_name: 'Synthetic customer', method: 'bankid',
    fullmakt_snapshot: { legal_text: { title: 'Fullmakt', body: 'Synthetic accepted permit' } },
    created_at: olderTime, ...overrides,
  }
}

type Poa = ReturnType<typeof poa>
type FixtureOptions = {
  cap?: number
  repeat?: boolean
  nextError?: { code: string; message: string }
  advanceClock?: () => void
}

function fixture(rows: Poa[], options: FixtureOptions = {}) {
  const cursors: URLSearchParams[] = []
  const poaClient = createClient('https://poa-probe.example.invalid', 'synthetic-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input) => {
        const filters = new URL(input instanceof Request ? input.url : String(input)).searchParams
        cursors.push(filters)
        if (cursors.length === 2) options.advanceClock?.()
        if (cursors.length === 2 && options.nextError) return Response.json(options.nextError, { status: 409 })

        expect(filters.get('company_id')).toBe(`eq.${companyId}`)
        expect(filters.get('customer_id')).toBe(`eq.${customerId}`)
        expect(filters.get('status')).toBe('in.(signed,active,accepted)')
        expect(filters.get('limit')).toBe('25')
        const groups = filters.getAll('or')
        const scoped = groups.length > 0
        const after = filters.get('created_at')?.slice(4)
        let lastId: string | undefined
        if (scoped) {
          expect(groups[0]).toBe(`(site_id.eq."${siteId}",customer_site_id.eq."${siteId}")`)
          expect(groups[1]).toBe(`(site_id.eq."${siteId}",site_id.is.null)`)
          expect(filters.get('order')).toBe('created_at.desc,id.desc')
          expect(filters.get('select')?.split(',')).toContain('created_at')
          if (after) {
            const filter = /^\(created_at\.lt\."([^"]+)",id\.lt\."([^"]+)"\)$/.exec(groups[2] ?? '')
            expect(filter?.[1]).toBe(after)
            lastId = filter?.[2]
            expect(lastId).toBeTruthy()
          }
        }
        const result = rows
          .filter((row) => row.company_id === companyId && row.customer_id === customerId && ['signed', 'active', 'accepted'].includes(row.status))
          .filter((row) => !scoped || (row.site_id ?? row.customer_site_id) === siteId)
          .filter((row) => !after || options.repeat || row.created_at < after || (row.created_at === after && lastId !== undefined && row.id < lastId))
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
          .slice(0, options.cap ?? 25)
        return Response.json(result)
      },
    },
  })
  const db = createFakeDb({
    customer_sites: [{ id: siteId, company_id: companyId, customer_id: customerId, grid_owner_id: gridOwnerId,
      grid_area_code: 'ABC', resolution_status: 'grid_area_master_validated', address_hash: 'synthetic-address-hash' }],
    customers: [{ id: customerId, company_id: companyId, full_name: 'Synthetic customer' }],
    grid_owner_information_requests: [], grid_owner_contact_channels: [], manual_email_outbox: [],
  })
  const from = db.client.from
  db.client.from = (table) => table === 'powers_of_attorney' ? poaClient.from(table) : from(table)
  port.db = db
  return { db, cursors }
}

async function expectSelected(poaId: string, db: FakeDb) {
  await expect(select()).resolves.toMatchObject({ status: 'blocked_missing_grid_owner_contact', poaId,
    nextAction: { code: 'grid_owner_contact_required' } })
  expect(db.tables.grid_owner_information_requests).toEqual([expect.objectContaining({
    company_id: companyId, customer_id: customerId, customer_site_id: siteId, poa_id: poaId,
  })])
  expect(db.tables.manual_email_outbox).toHaveLength(0)
  expect(port.outbound).not.toHaveBeenCalled()
}

afterEach(() => vi.useRealTimers())

it('finds the older authorization for the chosen site before limiting candidates', async () => {
  const { db, cursors } = fixture([
    poa(5),
    ...Array.from({ length: 25 }, (_, i) => poa(100 + i, { site_id: otherSiteId, customer_site_id: otherSiteId, created_at: newerTime })),
  ])
  await expectSelected(id(5), db)
  expect(cursors).toHaveLength(1)
})

it('falls back to the legacy site only when the primary site is null and keeps company/customer scope', async () => {
  const { db } = fixture([
    poa(10, { site_id: null, customer_site_id: siteId }),
    poa(11, { site_id: otherSiteId, customer_site_id: siteId, created_at: newerTime }),
    poa(12, { company_id: id(18), created_at: newerTime }),
    poa(13, { customer_id: id(19), created_at: newerTime }),
  ])
  await expectSelected(id(10), db)
  const primary = fixture([poa(14, { site_id: siteId, customer_site_id: otherSiteId })])
  await expectSelected(id(14), primary.db)
})

it('uses an exact microsecond tuple and UUID tie-break across incomplete same-site pages', async () => {
  const { db, cursors } = fixture([
    poa(10),
    poa(30, { scope: 'billing_handoff', created_at: newerTime }),
    poa(29, { expires_at: '2021-01-01T00:00:00Z', created_at: newerTime }),
    poa(28, { scope: 'portal', scope_summary: { facility_information_lookup: false }, created_at: newerTime }),
    poa(27, { revoked_at: '2021-01-01T00:00:00Z', created_at: newerTime }),
  ], { cap: 2 })

  await expectSelected(id(10), db)
  expect(cursors.map((page) => page.get('created_at'))).toEqual([null, `lte.${newerTime}`, `lte.${newerTime}`])
  expect(cursors[1].getAll('or')[2]).toContain(`id.lt."${id(29)}"`)
  expect(cursors[2].getAll('or')[2]).toContain(`id.lt."${id(27)}"`)
})

it('takes one lifecycle evaluation time for every page', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z'))
  const { db } = fixture([
    poa(10, { expires_at: '2026-11-19T10:00:01Z' }),
    poa(29, { scope: 'billing_handoff', created_at: newerTime }),
  ], { cap: 1, advanceClock: () => vi.setSystemTime(new Date('2026-11-19T10:00:02Z')) })
  await expectSelected(id(10), db)
})

it('only records missing authority after exhausting matching candidates', async () => {
  const { db, cursors } = fixture([poa(12, { scope: 'billing_handoff', created_at: newerTime })])
  await expect(select()).resolves.toMatchObject({ status: 'blocked_missing_poa', poaId: null })
  expect(cursors).toHaveLength(2)
  expect(db.tables.manual_email_outbox).toHaveLength(0)
})

it.each([{ id: 'malformed' }, { created_at: 'invalid' }])('rejects malformed continuation identity %o', async (fields) => {
  const { db, cursors } = fixture([poa(12, { scope: 'billing_handoff', ...fields })])
  await expect(select()).rejects.toThrow('manual_facility_poa_page_invalid')
  expect(cursors).toHaveLength(1)
  expect(db.tables.grid_owner_information_requests).toHaveLength(0)
})

it('rejects a nonadvancing cursor and keeps an incomplete read out of persisted blockers', async () => {
  const { db, cursors } = fixture([poa(12, { scope: 'billing_handoff', created_at: newerTime })], { repeat: true })
  await expect(select()).rejects.toThrow('manual_facility_poa_page_invalid')
  expect(cursors).toHaveLength(2)
  expect(db.tables.grid_owner_information_requests).toHaveLength(0)
})

it('propagates a continuation failure even when the database reports a missing schema', async () => {
  const { db } = fixture([poa(12, { scope: 'billing_handoff', created_at: newerTime })], {
    nextError: { code: 'PGRST205', message: 'fixture schema temporarily unavailable' },
  })
  await expect(select()).rejects.toMatchObject({ code: 'PGRST205' })
  expect(db.tables.grid_owner_information_requests).toHaveLength(0)
})
