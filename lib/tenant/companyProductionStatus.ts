import { supabaseService } from '@/lib/supabase/service'

export type CompanyProductionStatus = {
  id: string
  name: string
  tenantStatus: string | null
  edielProductionStatus: string | null
  productionApproved: boolean
}

export type CompanyProductionApprovalInput = {
  ediel_production_status?: string | null
  ediel_production_enabled?: boolean | null
  live_ediel_enabled?: boolean | null
  live_approved_at?: string | null
}

export function isCompanyProductionApproved(input: CompanyProductionApprovalInput) {
  return Boolean(
    input.ediel_production_enabled === true
      && input.live_ediel_enabled === true
      && String(input.ediel_production_status ?? '').toLowerCase() === 'live'
      && input.live_approved_at,
  )
}

export async function getCompanyProductionStatus(companyId: string): Promise<CompanyProductionStatus | null> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,status,lifecycle_status,ediel_production_status,ediel_production_enabled,live_ediel_enabled,live_approved_at')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const edielProductionStatus = data.ediel_production_status ?? null

  return {
    id: String(data.id),
    name: String(data.name),
    tenantStatus: data.lifecycle_status ?? data.status ?? null,
    edielProductionStatus,
    productionApproved: isCompanyProductionApproved(data),
  }
}
