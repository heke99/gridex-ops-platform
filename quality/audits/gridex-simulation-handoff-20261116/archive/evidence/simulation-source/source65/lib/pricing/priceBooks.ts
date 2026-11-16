import { supabaseService } from '@/lib/supabase/service'

/**
 * Price books represent an immutable set of price lines that describe the
 * canonical pricing for an offer at a point in time. They replace the
 * previous loosely defined snapshot logic. A price book should be
 * published before being attached to a public offer and must not be
 * modified once it is in use.
 */

export type PriceBook = {
  id: string
  company_id: string
  status: string | null
  valid_from: string | null
  valid_to: string | null
  name: string | null
}

/**
 * Retrieve the most recent active price book for a company. This helper is
 * It returns null only when no active row exists. Database and schema failures
 * are propagated so callers cannot mistake a broken query for an empty state.
 */
export async function getActivePriceBook(companyId: string): Promise<PriceBook | null> {
  const { data, error } = await supabaseService
    .from('price_books')
    .select('*')
    .eq('company_id', companyId)
    .in('status', ['active', 'published'])
    .order('valid_from', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as PriceBook) ?? null
}

/**
 * Retrieve price lines for a given price book. Price lines include
 * individual components such as spot markup, fixed fees and taxes. This
 * function returns an empty array only when no lines exist. Database failures
 * are propagated. Consumers should not rely on the ordering of lines.
 */
export async function listPriceBookLines(priceBookId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseService
    .from('price_book_lines')
    .select('*')
    .eq('price_book_id', priceBookId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as Record<string, unknown>[]
}
