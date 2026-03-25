import { supabaseService } from '@/lib/supabase/service'

export async function getAllRoles() {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id, key, name')
    .order('name')

  if (error) throw error
  return data ?? []
}