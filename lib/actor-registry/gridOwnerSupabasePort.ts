import { supabaseService } from '@/lib/supabase/service'
import type { GridOwnerInsert, GridOwnerPatch, GridOwnerPort, GridOwnerRow } from '@/lib/actor-registry/gridOwnerReconciliation'

const COLUMNS = 'id,name,company_id,ediel_id,org_number,communication_email,default_prodat_subaddress,default_utilts_subaddress,is_active,verified_for_customer_flow'
const PAGE = 1000

/** Service-role port for the platform-admin registry import. Every grid_owners
 * row is read (all tenants) so creation can never duplicate an Ediel ID, org
 * number or name; writes are limited to platform rows (company_id IS NULL) and
 * are compare-and-set on the previous values of every changed column. */
export function createSupabaseGridOwnerPort(actorUserId: string): GridOwnerPort {
  return {
    async listGridOwners() {
      const rows: GridOwnerRow[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseService.from('grid_owners').select(COLUMNS).order('id').range(from, from + PAGE - 1)
        if (error) throw error
        rows.push(...((data ?? []) as unknown as GridOwnerRow[]))
        if (!data || data.length < PAGE) return rows
      }
    },
    async updateGridOwner(id: string, expected: GridOwnerPatch, patch: GridOwnerPatch) {
      let query = supabaseService.from('grid_owners')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: actorUserId })
        .eq('id', id).is('company_id', null)
      for (const [column, previous] of Object.entries(expected)) query = previous === null || previous === undefined ? query.is(column, null) : query.eq(column, previous)
      const { data, error } = await query.select('id')
      if (error) throw error
      return (data ?? []).length === 1
    },
    async insertGridOwner(row: GridOwnerInsert) {
      const { data, error } = await supabaseService.from('grid_owners').insert({ ...row, created_by: actorUserId, updated_by: actorUserId }).select('id').single()
      if (error) throw error
      return { id: String(data.id) }
    },
  }
}
