import { supabaseService } from '@/lib/supabase/service'
import { isMissingRelationError } from '@/lib/tenant/scope'

export async function safeListRows(table: string, companyId: string | null, select = '*', limit = 50): Promise<Record<string, unknown>[]> {
  try {
    let query = supabaseService.from(table).select(select).limit(limit)
    if (companyId) query = query.eq('company_id', companyId)
    const { data, error } = await query
    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }
    return (data ?? []) as unknown as Record<string, unknown>[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 4 }).format(value)
  return String(value)
}

export function statusBadge(status: unknown): string {
  const text = typeof status === 'string' ? status : 'okänd'
  if (['price_preview_ready', 'ready_for_pricing', 'ready', 'complete', 'confirmed', 'locked', 'success'].includes(text)) return 'bg-emerald-100 text-emerald-800'
  if (['needs_review', 'incomplete', 'draft', 'reprice_required'].includes(text)) return 'bg-amber-100 text-amber-900'
  if (['pricing_failed', 'failed', 'blocked'].includes(text)) return 'bg-red-100 text-red-800'
  return 'bg-slate-100 text-slate-700'
}
