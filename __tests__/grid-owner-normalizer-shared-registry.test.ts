// FINDINGS F58 (variant of F54): normalizing a submitted grid owner to the OPS namespace looked up only the
// tenant's own rows, so a shared registry grid owner (company_id null) was dropped and the site was saved
// without a grid owner.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ gridOwners: [] as Row[], platform: [] as Row[] }))
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const conditions: Array<(row: Row) => boolean> = []
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => { conditions.push(row => row[column] === value); return chain },
      or: (expression: string) => {
        const allowed = expression.split(',').map(part => part.split('.'))
        conditions.push(row => allowed.some(([column, op, ...value]) => op === 'is' ? row[column] === null : row[column] === value.join('.')))
        return chain
      },
      maybeSingle: async () => ({ data: (table === 'grid_owners' ? db.gridOwners : db.platform).filter(row => conditions.every(c => c(row)))[0] ?? null, error: null }),
    }
    return chain
  }
  return { supabaseService: { from } }
})

import { normalizeGridOwnerIdToOps } from '@/lib/grid-owners/platformGridOwnerResolver'

const tenantA = '00000000-0000-4000-8000-00000000000a', tenantB = '00000000-0000-4000-8000-00000000000b'

beforeEach(() => {
  db.gridOwners = [
    { id: 'shared-alingsas', company_id: null },
    { id: 'own-a', company_id: tenantA },
    { id: 'own-b', company_id: tenantB },
  ]
  db.platform = []
})

describe('normalizeGridOwnerIdToOps tenant scope', () => {
  it('keeps a shared registry grid owner for any tenant', async () => {
    expect(await normalizeGridOwnerIdToOps({ gridOwnerId: 'shared-alingsas', companyId: tenantA })).toEqual({ opsGridOwnerId: 'shared-alingsas', source: 'ops', warnings: [] })
  })

  it('keeps the tenant\'s own grid owner', async () => {
    expect((await normalizeGridOwnerIdToOps({ gridOwnerId: 'own-a', companyId: tenantA })).opsGridOwnerId).toBe('own-a')
  })

  it('never resolves another tenant\'s own grid owner', async () => {
    expect(await normalizeGridOwnerIdToOps({ gridOwnerId: 'own-b', companyId: tenantA })).toEqual({ opsGridOwnerId: null, source: 'unknown', warnings: ['explicit_grid_owner_id_not_in_ops_masterdata'] })
  })
})
