import { supabaseService } from '@/lib/supabase/service'

export async function getAllPermissions() {
  const { data, error } = await supabaseService
    .from('permissions')
    .select('id, key, name')
    .order('name')

  if (error) throw error
  return data ?? []
}