import { supabaseService } from '@/lib/supabase/service'

export async function getGridOwners() {
  const { data, error } = await supabaseService
    .from('grid_owners')
    .select('id, name, code, ediel_id, is_active')
    .order('name')

  if (error) throw error
  return data ?? []
}