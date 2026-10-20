// FINDINGS F34: /admin/ediel/route-readiness sent every actor ID in one
// in-filter. With the full Ediel registry (434 actors in production) the URL
// passed the gateway's ~8 kB limit, the read failed with 414 and the page crashed.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ readinessRows: [] as Array<Record<string, unknown>>, contactQueries: [] as string[][], failContacts: null as null | { code: string; message: string } }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: async () => ({ userId: 'operator', email: 'operator@example.invalid' }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/app/admin/ediel/route-readiness/actions', () => Object.fromEntries(['bulkRouteReadinessByStatusAction', 'createRouteManualReviewAction', 'importSupplierContactsCsvAction', 'markContactOnlySupplierAction',
  'markRouteNotRelevantAction', 'saveSupplierContactAction', 'verifyActorRouteForManualSendAction', 'materializeCompanyGridOwnerRouteAction', 'approveFirstProductionSendAction',
  'bulkMaterializeOperationalRoutesAction'].map(name => [name, async () => undefined])))
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    let ids: string[] = []
    const chain = {
      select: () => chain, order: () => chain, or: () => chain, eq: () => chain,
      in: (_column: string, values: string[]) => { ids = values; return chain },
      limit: async () => {
        if (table === 'gridex_route_readiness_v') return { data: db.readinessRows, error: null }
        if (table === 'platform_actor_contacts') {
          db.contactQueries.push(ids)
          if (db.failContacts) return { data: null, error: db.failContacts }
          return { data: ids.map(actor_id => ({ actor_id, contact_type: 'operations', email: `contact-${actor_id.slice(0, 8)}@example.invalid`, phone: null, is_verified: true })), error: null }
        }
        return { data: [], error: null }
      },
    }
    return chain
  }
  return { supabaseService: { from } }
})

import EdielRouteReadinessPage from '@/app/admin/ediel/route-readiness/page'

const actorId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const rows = (actors: number) => Array.from({ length: actors }, (_, n) => ({ actor_id: actorId(n), actor_name: `Aktör ${n}`, readiness_status: 'missing_route', message_family: 'PRODAT', environment: 'production' }))

describe('route readiness contacts', () => {
  beforeEach(() => { db.contactQueries = []; db.failContacts = null })

  it('reads the contacts of 434 actors in chunks of at most 100 IDs, covering every actor once', async () => {
    db.readinessRows = [...rows(434), ...rows(66)] // 500 rows, 434 distinct actors as in production
    await EdielRouteReadinessPage({ searchParams: Promise.resolve({}) })
    expect(db.contactQueries.map(ids => ids.length)).toEqual([100, 100, 100, 100, 34])
    expect(db.contactQueries.flat()).toEqual(rows(434).map(row => row.actor_id))
    // Each chunk stays far below the gateway's ~8 kB URL limit.
    for (const ids of db.contactQueries) expect(`actor_id=in.(${ids.map(encodeURIComponent).join('%2C')})`.length).toBeLessThan(5_000)
  })

  it('makes no contact query without rows and keeps the missing-schema fallback', async () => {
    db.readinessRows = []
    await EdielRouteReadinessPage({ searchParams: Promise.resolve({}) })
    expect(db.contactQueries).toEqual([])
    db.readinessRows = rows(3)
    db.failContacts = { code: '42P01', message: 'relation "platform_actor_contacts" does not exist' }
    await expect(EdielRouteReadinessPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
  })

  it('still fails loudly on any other database error', async () => {
    db.readinessRows = rows(3)
    db.failContacts = { code: '57014', message: 'canceling statement due to statement timeout' }
    await expect(EdielRouteReadinessPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ code: '57014' })
  })
})
