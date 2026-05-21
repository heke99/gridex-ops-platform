import { redirect } from 'next/navigation'
import { isPlatformAdminContext, type GuardResult } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

export type TenantLiveAccess = {
  companyId: string | null
  companyName: string | null
  canUseLiveEdiel: boolean
  isLiveApproved: boolean
  productionStatus: string | null
  liveApprovedAt: string | null
  liveBlockedReason: string | null
  message: string | null
}

function isLiveCompany(row: {
  live_ediel_enabled?: boolean | null
  production_status?: string | null
  live_approved_at?: string | null
} | null): boolean {
  return Boolean(row?.live_ediel_enabled === true && row?.production_status === 'live' && row?.live_approved_at)
}

export async function getTenantLiveAccessForAdmin(admin: Pick<GuardResult, 'userId' | 'roles' | 'permissions'>): Promise<TenantLiveAccess> {
  if (isPlatformAdminContext(admin)) {
    return {
      companyId: null,
      companyName: 'Gridex Platform',
      canUseLiveEdiel: true,
      isLiveApproved: true,
      productionStatus: 'platform',
      liveApprovedAt: null,
      liveBlockedReason: null,
      message: null,
    }
  }

  const scope = await getOperationalCompanyScope(admin.userId)
  if (!scope.companyId) {
    return {
      companyId: null,
      companyName: null,
      canUseLiveEdiel: false,
      isLiveApproved: false,
      productionStatus: null,
      liveApprovedAt: null,
      liveBlockedReason: null,
      message: scope.message ?? 'Kontot saknar aktiv bolagskoppling.',
    }
  }

  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,live_ediel_enabled,production_status,live_approved_at,live_blocked_reason')
    .eq('id', scope.companyId)
    .maybeSingle()

  if (error) throw error
  const row = data as {
    id: string
    name: string | null
    live_ediel_enabled: boolean | null
    production_status: string | null
    live_approved_at: string | null
    live_blocked_reason: string | null
  } | null

  const isLiveApproved = isLiveCompany(row)

  return {
    companyId: scope.companyId,
    companyName: row?.name ?? scope.companyName,
    canUseLiveEdiel: isLiveApproved,
    isLiveApproved,
    productionStatus: row?.production_status ?? null,
    liveApprovedAt: row?.live_approved_at ?? null,
    liveBlockedReason: row?.live_blocked_reason ?? null,
    message: isLiveApproved
      ? null
      : row?.live_blocked_reason || 'Live Ediel är inte aktiverat för bolaget. Superadmin måste godkänna go-live innan liveflöden visas eller kan skicka meddelanden.',
  }
}

export async function assertTenantCanUseLiveEdiel(admin: Pick<GuardResult, 'userId' | 'roles' | 'permissions'>): Promise<TenantLiveAccess> {
  const access = await getTenantLiveAccessForAdmin(admin)
  if (!access.canUseLiveEdiel) {
    redirect('/admin/company-actor-status?status=blocked&message=' + encodeURIComponent(access.message ?? 'Live Ediel är inte aktiverat.'))
  }
  return access
}

export async function assertCompanyLiveEdielForOutbound(companyId: string): Promise<void> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,live_ediel_enabled,production_status,live_approved_at,live_blocked_reason')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  const row = data as {
    live_ediel_enabled?: boolean | null
    production_status?: string | null
    live_approved_at?: string | null
    live_blocked_reason?: string | null
  } | null

  if (!isLiveCompany(row)) {
    throw new Error(row?.live_blocked_reason || 'Live Ediel är inte aktiverat av superadmin för detta bolag. Skicka inte produktionsmeddelanden innan go-live är godkänd.')
  }
}
