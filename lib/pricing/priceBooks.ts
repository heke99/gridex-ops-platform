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
 * intentionally permissive: if no table exists or there are no rows the
 * function returns null. Additional filtering (e.g. by product) can be
 * implemented at call sites.
 */
export async function getActivePriceBook(companyId: string): Promise<PriceBook | null> {
  try {
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
  } catch (err) {
    // On schema mismatch or missing table simply return null to allow the
    // application to continue. The readiness checks will surface issues.
    return null
  }
}

/**
 * Retrieve price lines for a given price book. Price lines include
 * individual components such as spot markup, fixed fees and taxes. This
 * function returns an empty array if the table is missing or no lines
 * exist. Consumers should not rely on the ordering of lines.
 */
export async function listPriceBookLines(priceBookId: string): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabaseService
      .from('price_book_lines')
      .select('*')
      .eq('price_book_id', priceBookId)
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []) as Record<string, unknown>[]
  } catch (err) {
    return []
  }
}