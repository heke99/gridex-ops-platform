import { supabaseService } from '@/lib/supabase/service'

export type AdminCustomerPortalAccountRow = {
  id: string
  user_id: string
  user_email: string | null
  customer_id: string
  role: string
  is_active: boolean
  invited_at: string | null
  activated_at: string | null
  verified_at: string | null
  last_seen_at: string | null
  match_method: string | null
  verified_identity_snapshot: Record<string, unknown>
  notes: string | null
  created_at: string
  updated_at: string
}

export type AdminCustomerPortalClaimRow = {
  id: string
  user_id: string
  user_email: string | null
  customer_id: string | null
  status: string
  match_method: string
  personal_number_last4: string | null
  email_matched: boolean
  name_matched: boolean
  personal_number_matched: boolean
  installation_matched: boolean
  matched_site_id: string | null
  matched_metering_point_id: string | null
  failure_reason: string | null
  input_snapshot: Record<string, unknown>
  match_snapshot: Record<string, unknown>
  created_at: string
  updated_at: string
}

export async function listCustomerPortalAccountsByCustomerId(
  customerId: string
): Promise<AdminCustomerPortalAccountRow[]> {
  const { data, error } = await supabaseService
    .from('customer_portal_accounts')
    .select(
      'id,user_id,user_email,customer_id,role,is_active,invited_at,activated_at,verified_at,last_seen_at,match_method,verified_identity_snapshot,notes,created_at,updated_at'
    )
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as AdminCustomerPortalAccountRow[]
}

export async function listCustomerPortalClaimsByCustomerId(
  customerId: string
): Promise<AdminCustomerPortalClaimRow[]> {
  const { data, error } = await supabaseService
    .from('customer_portal_claims')
    .select(
      'id,user_id,user_email,customer_id,status,match_method,personal_number_last4,email_matched,name_matched,personal_number_matched,installation_matched,matched_site_id,matched_metering_point_id,failure_reason,input_snapshot,match_snapshot,created_at,updated_at'
    )
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return (data ?? []) as AdminCustomerPortalClaimRow[]
}

export async function listRecentCustomerPortalClaims(options: {
  limit?: number
  status?: string
} = {}): Promise<AdminCustomerPortalClaimRow[]> {
  let query = supabaseService
    .from('customer_portal_claims')
    .select(
      'id,user_id,user_email,customer_id,status,match_method,personal_number_last4,email_matched,name_matched,personal_number_matched,installation_matched,matched_site_id,matched_metering_point_id,failure_reason,input_snapshot,match_snapshot,created_at,updated_at'
    )
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as AdminCustomerPortalClaimRow[]
}
