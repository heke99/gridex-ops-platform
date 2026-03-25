import { supabaseService } from '@/lib/supabase/service'

export async function getPriceAreas() {
  const { data, error } = await supabaseService
    .from('price_areas')
    .select('id, code, name, sort_order')
    .order('sort_order')

  if (error) throw error
  return data ?? []
}