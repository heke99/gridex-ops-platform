import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const ORDER_KEYS = ['confirmed_start_date', 'requested_start_date', 'created_at', 'id'] as const
type OrderKey = typeof ORDER_KEYS[number]
type Tuple = Record<Exclude<OrderKey, 'id'>, string | null> & { id: string }

export class BulkReadySelectionError extends Error {
  readonly code = 'BULK_READY_SELECTION_UNAVAILABLE'
  constructor(cause?: unknown) {
    super('Hela urvalet kunde inte bekräftas inom gränsen för bulk-aktivering. Använd individuell aktivering på respektive ärende.', { cause })
    this.name = 'BulkReadySelectionError'
  }
}

function tuple(row: SupplierSwitchRequestRow): Tuple {
  if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new BulkReadySelectionError()
  const result: Tuple = { confirmed_start_date: null, requested_start_date: null, created_at: null, id: row.id.toLowerCase() }
  for (const field of ['confirmed_start_date', 'requested_start_date'] as const) {
    const value = row[field]
    if (value === null) continue
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new BulkReadySelectionError()
    result[field] = value
  }
  if (row.created_at !== null) {
    const value = row.created_at
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new BulkReadySelectionError()
    const fraction = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
    if (!fraction) throw new BulkReadySelectionError()
    // Preserve PostgreSQL microsecond ordering, not Date's millisecond truncation.
    result.created_at = `${new Date(value).toISOString().slice(0, 19)}.${(fraction[1] ?? '').padEnd(6, '0')}Z`
  }
  return result
}

function follows(next: Tuple, previous: Tuple): boolean {
  for (const key of ORDER_KEYS) {
    if (next[key] === previous[key]) continue
    if (next[key] === null) return true
    if (previous[key] === null) return false
    return next[key]! > previous[key]!
  }
  return false
}

function afterFilter(after: Tuple): string {
  const prefix: string[] = []
  const alternatives: string[] = []
  for (const key of ORDER_KEYS) {
    const value = after[key]
    if (value !== null) {
      for (const condition of [key + '.gt.' + value, ...(key === 'id' ? [] : [key + '.is.null'])]) {
        alternatives.push(prefix.length ? `and(${[...prefix, condition].join(',')})` : condition)
      }
    }
    prefix.push(value === null ? key + '.is.null' : key + '.eq.' + value)
  }
  return alternatives.join(',')
}

/** Authenticated read-only discovery. Caller must qualify tenant/global scope.
 * Finish the bounded traversal before any effect. This is live keyset traversal,
 * not a native transaction snapshot; the authoritative finalizer rechecks each row. */
export async function readCompleteBulkReadySelection(
  supabase: SupabaseClient,
  companyId: string | null,
): Promise<{ accepted: SupplierSwitchRequestRow[]; ready: SupplierSwitchRequestRow[] }> {
  if (companyId !== null && !UUID.test(companyId)) throw new BulkReadySelectionError()
  const now = new Date()
  const accepted: SupplierSwitchRequestRow[] = []
  const seenRequestOwners = new Map<string, string>()
  let after: Tuple | null = null
  try {
    for (let batch = 0; batch < 10 && accepted.length < 1000; batch++) {
      const limit = Math.min(100, 1000 - accepted.length)
      let query = supabase.from('supplier_switch_requests').select('*', { count: 'exact' })
        .eq('status', 'accepted')
        .order('confirmed_start_date', { ascending: true, nullsFirst: false })
        .order('requested_start_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .limit(limit)
      if (companyId !== null) query = query.eq('company_id', companyId)
      if (after) query = query.or(afterFilter(after))
      const { data, error, count } = await query
      if (error) throw error
      if (!Array.isArray(data) || typeof count !== 'number' || !Number.isSafeInteger(count)
        || count < data.length || data.length > limit || (data.length === 0 && count !== 0)) throw new BulkReadySelectionError()
      for (const row of data as SupplierSwitchRequestRow[]) {
        if (!row || row.status !== 'accepted' || typeof row.company_id !== 'string' || !UUID.test(row.company_id)
          || (companyId !== null && row.company_id !== companyId)) throw new BulkReadySelectionError()
        const next = tuple(row)
        // A concurrent date edit can move an already-read UUID to a later
        // tuple. Ordering/counts alone do not prove unique request identity.
        if (seenRequestOwners.get(next.id) !== undefined) throw new BulkReadySelectionError()
        seenRequestOwners.set(next.id, row.company_id.toLowerCase())
        if (after && !follows(next, after)) throw new BulkReadySelectionError()
        accepted.push(row)
        after = next
      }
      if (count === data.length) {
        const ready = accepted.filter(row => getSupplierSwitchActivationReadiness(row, now).ready)
        // Validate all effect targets before beginning any finalization. A null
        // meter remains supported by the unchanged authoritative finalizer.
        for (const row of ready) {
          if (typeof row.customer_id !== 'string' || !UUID.test(row.customer_id)
            || typeof row.site_id !== 'string' || !UUID.test(row.site_id)
            || (row.metering_point_id !== null && (typeof row.metering_point_id !== 'string' || !UUID.test(row.metering_point_id)))) {
            throw new BulkReadySelectionError()
          }
        }
        return { accepted, ready }
      }
    }
  } catch (error) {
    if (error instanceof BulkReadySelectionError) throw error
    throw new BulkReadySelectionError(error)
  }
  throw new BulkReadySelectionError()
}
