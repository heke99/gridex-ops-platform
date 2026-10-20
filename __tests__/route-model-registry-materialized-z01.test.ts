// FINDINGS F41: a new tenant could never send Z01. Registry routes declare no application
// reference, so materialization adopted the sender setting's tenant label 'PRODAT' and failed the
// 23-DDQ-PRODAT policy; the customer-info environment resolver ignored registry-materialized
// grid-owner profiles; and the go-live wizard deactivated them while hard-coding 'PRODAT'.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, redirects: [] as string[], seq: 0 }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => ({ userId: '00000000-0000-4000-8000-0000000000ad' }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { db.redirects.push(to); throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' }) },
  unstable_rethrow: (error: unknown) => { if ((error as { digest?: string })?.digest === 'NEXT_REDIRECT') throw error },
}))
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    let write: { kind: 'insert' | 'update'; values: Row } | null = null
    const rows = () => (db.tables[table] ??= [])
    const run = () => {
      if (write?.kind === 'insert') {
        const row = { id: `${table}-${++db.seq}`, ...write.values }
        rows().push(row)
        return { data: [row], error: null }
      }
      const matched = rows().filter(row => filters.every(filter => filter(row)))
      if (write?.kind === 'update') matched.forEach(row => Object.assign(row, write!.values))
      return { data: matched, error: null }
    }
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return chain },
      insert: (values: Row) => { write = { kind: 'insert', values }; return chain },
      update: (values: Row) => { write = { kind: 'update', values }; return chain },
      single: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error } },
      maybeSingle: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error } },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }
  return { supabaseService: { from, rpc: async () => ({ data: null, error: null }) } }
})

import { upsertRouteProfile } from '@/lib/ediel/routeMaterializer'
import { resolveCustomerInfoOperationEnvironment } from '@/lib/ediel/customerInfoEnvironmentResolver'
import { createProductionRouteFromWizardAction } from '@/app/admin/platform/go-live/[companyId]/route-wizard/actions'

const companyId = '00000000-0000-4000-8000-000000000001'
// The tenant setting carries the family label that the wizard and the company card write.
const sender = { id: 'setting-1', company_id: companyId, environment: 'production', is_active: true, ediel_id: '70001', actor_role: 'supplier',
  application_reference: 'PRODAT', default_application_reference: 'PRODAT' }
const registryRoute = { id: 'platform-route-1', actor_id: 'actor-16700', message_family: 'PRODAT', application_reference: null, environment: 'production' as const,
  subaddress: null, communication_type: 'SMTP', communication_address: 'ediel-16700@example.invalid', party_id: '16700', interchange_party_id: '16700',
  is_verified: true, status: 'active', metadata: {} }
const materialized = { id: 'registry-prodat', company_id: companyId, environment: 'production', message_family: 'PRODAT', message_code: 'Z01',
  communication_route_id: 'registry-route', is_enabled: true, is_active: true, receiver_ediel_id: '16700', production_mode: 'disabled',
  metadata: { platform_actor_route_id: 'platform-route-1' } }

beforeEach(() => {
  db.redirects = []
  db.seq = 0
  db.tables = {
    companies: [{ id: companyId }],
    ediel_actor_settings: [{ ...sender }],
    ediel_mailboxes: [{ id: 'mailbox-1', company_id: null, mailbox_name: 'Gridex Ediel', email_address: 'ediel@example.invalid', environment: 'production', is_active: true }],
    ediel_route_profiles: [],
    communication_routes: [],
    production_route_wizard_runs: [],
  }
})

describe('registry materialization', () => {
  it('a registry route without a declared reference takes the policy reference, not the tenant label', async () => {
    const id = await upsertRouteProfile({ actorUserId: null, route: registryRoute, communicationRouteId: 'registry-route',
      gridOwner: { id: 'go-1', company_id: null, name: 'Alingsås Energi Elnät AB', ediel_id: '16700', platform_market_actor_id: 'actor-16700' },
      senderSettings: sender as never, messageFamily: 'PRODAT', messageCode: 'Z01' })
    const profile = db.tables.ediel_route_profiles.find(row => row.id === id)
    expect(profile).toMatchObject({ application_reference: '23-DDQ-PRODAT', receiver_ediel_id: '16700', metadata: expect.objectContaining({ platform_actor_route_id: 'platform-route-1' }) })
  })

  it('a route that declares a conflicting reference is still refused', async () => {
    await expect(upsertRouteProfile({ actorUserId: null, route: { ...registryRoute, application_reference: 'PRODAT' }, communicationRouteId: 'registry-route',
      gridOwner: { id: 'go-1', company_id: null, name: 'Alingsås', ediel_id: '16700', platform_market_actor_id: 'actor-16700' },
      senderSettings: sender as never, messageFamily: 'PRODAT', messageCode: 'Z01' })).rejects.toThrow('ediel_application_reference_route_mismatch:PRODAT:23-DDQ-PRODAT')
  })
})

describe('customer-info environment', () => {
  it('a registry-materialized grid-owner profile resolves production', async () => {
    db.tables.ediel_route_profiles = [{ ...materialized }]
    const result = await resolveCustomerInfoOperationEnvironment({ companyId, messageFamily: 'PRODAT', messageCode: 'Z01' })
    expect(result).toMatchObject({ status: 'resolved', environment: 'production', actorSettingId: 'setting-1' })
  })

  it('a plain manual profile without grid-owner resolution still does not count', async () => {
    db.tables.ediel_route_profiles = [{ ...materialized, metadata: {} }]
    const result = await resolveCustomerInfoOperationEnvironment({ companyId, messageFamily: 'PRODAT', messageCode: 'Z01' })
    expect(result.status).toBe('blocked')
  })
})

describe('go-live route wizard', () => {
  const form = () => {
    const data = new FormData()
    data.set('company_id', companyId)
    data.append('message_family', 'PRODAT')
    data.append('message_family', 'UTILTS')
    return data
  }

  it('keeps registry-materialized routes and declares only the policy reference', async () => {
    db.tables.ediel_route_profiles = [{ ...materialized }]
    db.tables.communication_routes = [{ id: 'registry-route', company_id: companyId, is_active: true }]
    await expect(createProductionRouteFromWizardAction(form())).rejects.toThrow('NEXT_REDIRECT')
    const outcome = new URL(db.redirects.at(-1)!, 'http://local').searchParams
    expect(outcome.get('status'), outcome.get('message') ?? '').toBe('created')
    expect(db.tables.ediel_route_profiles.find(row => row.id === 'registry-prodat')).toMatchObject({ is_enabled: true })
    expect(db.tables.communication_routes.find(row => row.id === 'registry-route')).toMatchObject({ is_active: true })
    const created = db.tables.ediel_route_profiles.filter(row => row.id !== 'registry-prodat')
    expect(created.map(row => [row.message_family, row.application_reference])).toEqual([['PRODAT', '23-DDQ-PRODAT'], ['UTILTS', null]])
  })
})
