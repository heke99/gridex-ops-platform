// FINDINGS F40: the go-live route wizard superseded existing production profiles with
// production_mode 'superseded', which ediel_route_profiles_production_mode_check (production too)
// rejects, so "Skapa valda production routes" failed for every tenant that already had a profile.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, redirects: [] as string[], seq: 0 }))
const PRODUCTION_MODES = ['disabled', 'shadow', 'dry_run', 'live', 'active']
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => ({ userId: '00000000-0000-4000-8000-0000000000ad' }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { db.redirects.push(to); throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' }) },
  unstable_rethrow: (error: unknown) => { if ((error as { digest?: string })?.digest === 'NEXT_REDIRECT') throw error },
}))
vi.mock('@/lib/supabase/service', () => {
  // The database enforces ediel_route_profiles_production_mode_check like the real schema.
  const violates = (table: string, row: Row) => table === 'ediel_route_profiles' && 'production_mode' in row && !PRODUCTION_MODES.includes(String(row.production_mode))
  const checkError = { code: '23514', message: 'new row for relation "ediel_route_profiles" violates check constraint "ediel_route_profiles_production_mode_check"' }
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    let write: { kind: 'insert' | 'update'; values: Row } | null = null
    const rows = () => (db.tables[table] ??= [])
    const run = () => {
      if (write?.kind === 'insert') {
        if (violates(table, write.values)) return { data: null, error: checkError }
        const row = { id: `${table}-${++db.seq}`, ...write.values }
        rows().push(row)
        return { data: [row], error: null }
      }
      const matched = rows().filter(row => filters.every(filter => filter(row)))
      if (write?.kind === 'update') {
        if (violates(table, write.values)) return { data: null, error: checkError }
        matched.forEach(row => Object.assign(row, write!.values))
      }
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

import { createProductionRouteFromWizardAction } from '@/app/admin/platform/go-live/[companyId]/route-wizard/actions'

const companyId = '00000000-0000-4000-8000-000000000001'
const form = (...families: string[]) => {
  const data = new FormData()
  data.set('company_id', companyId)
  data.set('receiver_source', 'selected_metering_point_grid_owner')
  for (const family of families) data.append('message_family', family)
  return data
}
const outcome = () => new URL(db.redirects.at(-1)!, 'http://local').searchParams

describe('go-live route wizard over existing production profiles', () => {
  beforeEach(() => {
    db.redirects = []
    db.tables = {
      companies: [{ id: companyId }],
      ediel_actor_settings: [{ id: 'setting-1', company_id: companyId, environment: 'production', is_active: true, ediel_id: '70001', actor_role: 'supplier' }],
      ediel_mailboxes: [{ id: 'mailbox-1', company_id: null, mailbox_name: 'Gridex Ediel', email_address: 'ediel@example.invalid', environment: 'production', is_active: true }],
      // The tenant already has production profiles, as contract publishing requires.
      ediel_route_profiles: [
        { id: 'old-prodat', company_id: companyId, environment: 'production', message_family: 'PRODAT', communication_route_id: 'old-route-prodat', is_enabled: true, production_mode: 'disabled', metadata: {} },
        { id: 'old-utilts', company_id: companyId, environment: 'production', message_family: 'UTILTS', communication_route_id: 'old-route-utilts', is_enabled: true, production_mode: 'disabled', metadata: {} },
      ],
      communication_routes: [{ id: 'old-route-prodat', company_id: companyId, is_active: true }, { id: 'old-route-utilts', company_id: companyId, is_active: true }],
      production_route_wizard_runs: [],
    }
  })

  it('supersedes the existing profiles with an allowed mode and creates the dynamic grid-owner routes', async () => {
    await expect(createProductionRouteFromWizardAction(form('PRODAT', 'UTILTS'))).rejects.toThrow('NEXT_REDIRECT')
    expect(outcome().get('status'), outcome().get('message') ?? '').not.toBe('failed')
    const profiles = db.tables.ediel_route_profiles
    expect(profiles.filter(p => String(p.id).startsWith('old-'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old-prodat', is_enabled: false, production_mode: 'disabled' }),
      expect.objectContaining({ id: 'old-utilts', is_enabled: false, production_mode: 'disabled' }),
    ]))
    const created = profiles.filter(p => !String(p.id).startsWith('old-'))
    expect(created.map(p => [p.message_family, p.receiver_source, p.is_production_route, p.production_mode, p.is_enabled])).toEqual([
      ['PRODAT', 'selected_metering_point_grid_owner', true, 'shadow', true],
      ['UTILTS', 'selected_metering_point_grid_owner', true, 'shadow', true],
    ])
    expect(db.tables.communication_routes.filter(r => String(r.id).startsWith('old-')).every(r => r.is_active === false)).toBe(true)
  })
})
