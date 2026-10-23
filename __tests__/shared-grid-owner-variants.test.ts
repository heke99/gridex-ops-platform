// reality-defects: F101
// FINDINGS F101 variants: three TypeScript grid owner lookups filtered grid_owners on company_id = tenant only, so
// they found nothing for a platform-shared registry grid owner (company_id null) - the ACK reply route of
// routeRegistry, the requested-change receiver of prodatRequestedChange and the inbound case grid area lookup.
// They now take the tenant's own row first, else a shared row; never another tenant's row, and never guess.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  gridOwners: [] as Row[],
  queries: [] as Array<Array<[string, string, unknown]>>,
  route: vi.fn(),
  actor: vi.fn(),
  outbound: vi.fn(),
  read: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      if (table !== 'grid_owners') throw Error(`UNEXPECTED_TABLE:${table}`)
      const filters: Array<[string, string, unknown]> = []
      io.queries.push(filters)
      const rows = () => io.gridOwners.filter(row => filters.every(([op, column, value]) => op === 'is' ? row[column] === value : value !== null && row[column] === value))
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return query },
        is: (column: string, value: unknown) => { filters.push(['is', column, value]); return query },
        limit: async (count: number) => ({ data: rows().slice(0, count), error: null }),
      }
      return query
    },
  },
}))
vi.mock('@/lib/cis/db-routes', () => ({ findBestCommunicationRoute: io.route }))
vi.mock('@/lib/ediel/core/actorRegistry', () => ({ resolveCanonicalActorContext: io.actor }))
vi.mock('@/lib/ediel/core/kernel', async original => ({ ...await original<Record<string, unknown>>(), resolveCanonicalOutboundContext: io.outbound }))
vi.mock('@/lib/ediel/production/requestedChangeSource', () => ({ readRequestedChangeSource: io.read, originateRequestedChange: vi.fn() }))
vi.mock('@/lib/ediel/intent/lifeEventGateway', () => ({ renderAndQueueRequestedChange: vi.fn() }))

import { selectTenantUsableGridOwners } from '@/lib/grid-owners/platformGridOwnerResolver'
import { resolveCanonicalRouteContext } from '@/lib/ediel/core/routeRegistry'
import { prepareAndQueueProdatRequestedChange } from '@/lib/ediel/flows/prodatRequestedChange'
import { getGridOwnerIdByGridArea } from '@/lib/ediel/inboundCases'

const tenantA = '00000000-0000-4000-8000-00000000000a', tenantB = '00000000-0000-4000-8000-00000000000b'
const RECEIVER = '7300000000002', AREA = 'SYN'
const owner = (id: string, companyId: string | null, extra: Row = {}): Row =>
  ({ id, company_id: companyId, name: `Synthetic ${id}`, ediel_id: RECEIVER, owner_code: AREA, is_active: true, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  io.queries = []
  io.gridOwners = []
  io.route.mockResolvedValue(null)
  io.actor.mockResolvedValue({ senderEdielId: '7300000000001', senderName: 'Synthetic', mailbox: 'synthetic@example.invalid' })
  io.outbound.mockRejectedValue(new Error('stop after route selection'))
  io.read.mockResolvedValue({ status: 'ready', companyId: tenantA, environment: 'test', legalReceiverId: RECEIVER, legalActorId: 'a', legalSenderId: '7300000000001' })
})

/** The three product lookups, each reduced to the grid owner id it selects for tenant A. */
const lookups: Record<string, () => Promise<string | null>> = {
  'routeRegistry ACK reply grid owner': async () => {
    await expect(resolveCanonicalRouteContext({ requestType: 'ediel_ack', companyId: tenantA, environment: 'test', receiverEdielId: RECEIVER }))
      .rejects.toThrow(/Ingen aktiv communication_route/)
    return (io.route.mock.calls[0][0] as { gridOwnerId: string | null }).gridOwnerId
  },
  'prodatRequestedChange receiver grid owner': async () => {
    await expect(prepareAndQueueProdatRequestedChange({ companyId: tenantA, eventId: 'e', actorUserId: 'u' })).rejects.toThrow('stop after route selection')
    return ((io.outbound.mock.calls[0][0] as { gridOwner: { id: string } | null }).gridOwner)?.id ?? null
  },
  'inboundCases grid area grid owner': () => getGridOwnerIdByGridArea(tenantA, AREA),
}

describe.each(Object.entries(lookups))('%s', (_name, select) => {
  it('selects the shared registry grid owner when the tenant has no own row', async () => {
    io.gridOwners = [owner('shared', null)]
    expect(await select()).toBe('shared')
  })

  it("prefers the tenant's own row over a shared row", async () => {
    io.gridOwners = [owner('shared', null), owner('own-a', tenantA)]
    expect(await select()).toBe('own-a')
  })

  it("never selects another tenant's row", async () => {
    io.gridOwners = [owner('own-b', tenantB)]
    expect(await select()).toBeNull()
    io.gridOwners = [owner('own-b', tenantB), owner('shared', null)]
    io.queries = []; vi.clearAllMocks(); io.route.mockResolvedValue(null); io.outbound.mockRejectedValue(new Error('stop after route selection'))
    expect(await select()).toBe('shared')
  })

  it('never guesses: an ambiguous tier selects none and an ambiguous own tier does not fall through to shared', async () => {
    io.gridOwners = [owner('shared-1', null), owner('shared-2', null)]
    expect(await select()).toBeNull()
    io.gridOwners = [owner('own-a-1', tenantA), owner('own-a-2', tenantA), owner('shared', null)]
    io.queries = []; vi.clearAllMocks(); io.route.mockResolvedValue(null); io.outbound.mockRejectedValue(new Error('stop after route selection'))
    expect(await select()).toBeNull()
    expect(io.queries).toHaveLength(1) // the shared tier is not even read
  })
})

describe('selectTenantUsableGridOwners', () => {
  it('reads the tenant tier with company_id = tenant and the shared tier with company_id is null, never unscoped', async () => {
    io.gridOwners = [owner('own-b', tenantB, { is_active: true }), owner('inactive-shared', null, { is_active: false }), owner('shared', null)]
    const rows = await selectTenantUsableGridOwners<{ id: string }>({ companyId: tenantA, select: 'id', match: { ediel_id: RECEIVER, is_active: true } })
    expect(rows.map(row => row.id)).toEqual(['shared'])
    expect(io.queries).toEqual([
      [['eq', 'company_id', tenantA], ['eq', 'ediel_id', RECEIVER], ['eq', 'is_active', true]],
      [['is', 'company_id', null], ['eq', 'ediel_id', RECEIVER], ['eq', 'is_active', true]],
    ])
  })
})
