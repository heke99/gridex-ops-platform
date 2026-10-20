// FINDINGS F53/F54: manual intake listed no grid owner for a tenant user (shared registry grid owners were
// hidden behind the lifecycle guard and platform-only certificate reads), and the intake action accepted any
// grid owner UUID, including another tenant's own row.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ view: [] as Row[], gridOwners: [] as Row[], filters: [] as string[] }))
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const conditions: Array<(row: Row) => boolean> = []
    const chain = {
      select: () => chain, order: () => chain,
      eq: (column: string, value: unknown) => { conditions.push(row => row[column] === value); return chain },
      or: (expression: string) => {
        db.filters.push(expression)
        const allowed = expression.split(',').map(part => part.split('.'))
        conditions.push(row => allowed.some(([column, op, ...value]) => op === 'is' ? row[column] === null : row[column] === value.join('.')))
        return chain
      },
      maybeSingle: async () => ({ data: (table === 'grid_owners' ? db.gridOwners : db.view).filter(row => conditions.every(c => c(row)))[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'gridex_verified_grid_owners_v' ? db.view : db.gridOwners, error: null }).then(resolve),
    }
    return chain
  }
  return { supabaseService: { from } }
})

import { listCustomerFlowGridOwnersForCompany } from '@/lib/masterdata/db'
import { resolveOrCreateGridOwnerForIntake } from '@/app/admin/customers/actions.part-1'

const tenantA = '00000000-0000-4000-8000-00000000000a', tenantB = '00000000-0000-4000-8000-00000000000b'
const ready = { is_active: true, lifecycle_status: 'active', excluded_from_electricity_scope: false, is_electricity_grid_owner_scope: true, can_start_supplier_switch: true }
const verified = { is_active: true, lifecycle_status: 'active', verified_for_customer_flow: true, actor_registry_status: 'verified' }

beforeEach(() => {
  db.filters = []
  db.view = [
    { grid_owner_id: 'shared-alingsas', name: 'Alingsås Energi Nät AB', ediel_id: '16700', company_id: null, ...ready },
    { grid_owner_id: 'own-a', name: 'Bolag A nätägare', ediel_id: '80001', company_id: tenantA, ...ready },
    { grid_owner_id: 'own-b', name: 'Bolag B nätägare', ediel_id: '80002', company_id: tenantB, ...ready },
  ]
  db.gridOwners = [
    { id: 'shared-alingsas', name: 'Alingsås Energi Nät AB', ediel_id: '16700', company_id: null, ...verified },
    { id: 'own-b', name: 'Bolag B nätägare', ediel_id: '80002', company_id: tenantB, ...verified },
  ]
})

describe('manual intake grid owners', () => {
  it('lists shared registry grid owners and the tenant\'s own, never another tenant\'s', async () => {
    const rows = await listCustomerFlowGridOwnersForCompany(tenantA)
    expect(rows.map(row => row.id).sort()).toEqual(['own-a', 'shared-alingsas'])
  })

  const form = () => new FormData()
  it('accepts a shared registry grid owner', async () => {
    const result = await resolveOrCreateGridOwnerForIntake({ formData: form(), companyId: tenantA, actorUserId: 'actor', selectedGridOwnerId: 'shared-alingsas' })
    expect(result.gridOwnerId).toBe('shared-alingsas')
  })

  it('refuses another tenant\'s grid owner even when it is verified', async () => {
    const result = await resolveOrCreateGridOwnerForIntake({ formData: form(), companyId: tenantA, actorUserId: 'actor', selectedGridOwnerId: 'own-b' })
    expect(result.gridOwnerId).toBeNull()
    expect(db.filters).toEqual([`company_id.is.null,company_id.eq.${tenantA}`])
  })
})
