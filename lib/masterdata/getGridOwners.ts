import { supabaseService } from '@/lib/supabase/service'

export async function getGridOwners() {
  const { data, error } = await supabaseService
    .from('grid_owners')
    .select('id, company_id, name, owner_code, ediel_id, org_number, contact_name, email, phone, address_line_1, address_line_2, postal_code, city, country, notes, is_active, created_at, updated_at, created_by, updated_by')
    .order('name')

  if (error) throw error
  return data ?? []
}