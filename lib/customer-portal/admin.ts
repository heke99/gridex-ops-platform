import { supabaseService } from '@/lib/supabase/service'
import { projectAdminPortalAccount, projectAdminPortalClaim } from './adminProjection'

import type { AdminCustomerPortalAccountRow, AdminCustomerPortalClaimRow } from './adminProjection'
export type { AdminCustomerPortalAccountRow, AdminCustomerPortalClaimRow } from './adminProjection'

export async function listCustomerPortalAccountsByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {}
): Promise<AdminCustomerPortalAccountRow[]> {
  let query = supabaseService
    .from('customer_portal_accounts')
    .select(
      'id,user_id,user_email,customer_id,role,is_active,status,invited_at,activated_at,verified_at,last_seen_at,match_method,verified_identity_snapshot,created_at,updated_at'
    )
    .eq('customer_id', customerId)

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (error) throw error
  return (data ?? []).map(projectAdminPortalAccount)
}

export async function listCustomerPortalClaimsByCustomerId(
  customerId: string,
  options: { companyId?: string | null; limit?: number } = {}
): Promise<AdminCustomerPortalClaimRow[]> {
  let query = supabaseService
    .from('customer_portal_claims')
    .select(
      'id,user_id,customer_id,status,metadata,created_at,updated_at'
    )
    .eq('customer_id', customerId)

  if (options.companyId) {
    query = query.eq('company_id', options.companyId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 20)

  if (error) throw error
  return (data ?? []).map(projectAdminPortalClaim)
}

export async function listRecentCustomerPortalClaims(options: {
  limit?: number
  status?: string
} = {}): Promise<AdminCustomerPortalClaimRow[]> {
  let query = supabaseService
    .from('customer_portal_claims')
    .select(
      'id,user_id,customer_id,status,metadata,created_at,updated_at'
    )
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(projectAdminPortalClaim)
}
