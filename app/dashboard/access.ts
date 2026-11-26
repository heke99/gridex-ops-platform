import { cache } from 'react'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'
import { isCompanyVisibleInTenantWorkspace } from '@/lib/tenant/lifecycle'

type DashboardAccess =
  | { status: 'allowed'; isPlatformAdmin: boolean; companyName: string | null }
  | { status: 'denied' }
  | { status: 'unavailable' }

export const getDashboardAccess = cache(async (userId: string): Promise<DashboardAccess> => {
  try {
    const { guard, response } = await requireAdminApiAccess()
    if (!guard) return { status: response.status === 403 ? 'denied' : 'unavailable' }
    if (guard.userId !== userId) return { status: 'unavailable' }

    if (guard.isPlatformAdmin) return { status: 'allowed', isPlatformAdmin: true, companyName: null }
    if (!guard.companyId) return { status: 'denied' }

    const { data, error } = await supabaseService
      .from('companies')
      .select('id,name,status')
      .eq('id', guard.companyId)
      .maybeSingle()

    if (error || !data || data.id !== guard.companyId) {
      console.warn('[dashboard] Authorized workspace company could not be verified')
      return { status: 'unavailable' }
    }
    if (!isCompanyVisibleInTenantWorkspace(data.status)) return { status: 'denied' }

    return { status: 'allowed', isPlatformAdmin: false, companyName: data.name }
  } catch {
    console.warn('[dashboard] Staff workspace access could not be verified')
    return { status: 'unavailable' }
  }
})
