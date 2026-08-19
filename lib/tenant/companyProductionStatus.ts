import { supabaseService } from '@/lib/supabase/service'

export type CompanyProductionStatus = {
  id: string
  name: string
  tenantStatus: string | null
  edielProductionStatus: string | null
  productionApproved: boolean
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
  const productionApproved = Boolean(
    data.ediel_production_enabled === true
      && data.live_ediel_enabled === true
      && String(edielProductionStatus ?? '').toLowerCase() === 'live'
      && data.live_approved_at,
  )

  return {
    id: String(data.id),
    name: String(data.name),
    tenantStatus: data.lifecycle_status ?? data.status ?? null,
    edielProductionStatus,
    productionApproved,
  }
}
