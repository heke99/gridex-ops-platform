import { redirect } from 'next/navigation'
import { isPlatformAdminContext, type GuardResult } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { isCompanyProductionApproved } from '@/lib/tenant/companyProductionStatus'
import { getOperationalCompanyScope, isMissingRelationError } from '@/lib/tenant/scope'

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

type CanonicalLiveCompanyRow = {
  id?: string | null
  name?: string | null
  ediel_production_status?: string | null
  ediel_production_enabled?: boolean | null
  live_ediel_enabled?: boolean | null
  live_approved_at?: string | null
  live_blocked_reason?: string | null
}

function isLiveCompany(row: CanonicalLiveCompanyRow | null): boolean {
  return isCompanyProductionApproved(row ?? {})
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
    .select('id,name,ediel_production_status,ediel_production_enabled,live_ediel_enabled,live_approved_at,live_blocked_reason')
    .eq('id', scope.companyId)
    .maybeSingle()

  if (error) {
    if (isMissingRelationError(error)) {
      return {
        companyId: scope.companyId,
        companyName: scope.companyName,
        canUseLiveEdiel: false,
        isLiveApproved: false,
        productionStatus: null,
        liveApprovedAt: null,
        liveBlockedReason: null,
        message:
          'Live Ediel-status kunde inte läsas från bolagstabellen. Kör senaste Supabase-migrationerna eller låt superadmin kontrollera bolagsprofilen.',
      }
    }

    throw error
  }
  const row = data as CanonicalLiveCompanyRow | null
  const isLiveApproved = isLiveCompany(row)

  return {
    companyId: scope.companyId,
    companyName: row?.name ?? scope.companyName,
    canUseLiveEdiel: isLiveApproved,
    isLiveApproved,
    productionStatus: row?.ediel_production_status ?? null,
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
    redirect('/admin?status=blocked&message=' + encodeURIComponent(access.message ?? 'Live Ediel är inte aktiverat.'))
  }
  return access
}

export async function assertCompanyLiveEdielForOutbound(companyId: string): Promise<void> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,ediel_production_status,ediel_production_enabled,live_ediel_enabled,live_approved_at,live_blocked_reason')
    .eq('id', companyId)
    .maybeSingle()

  if (error) throw error
  const row = data as CanonicalLiveCompanyRow | null

  if (!isLiveCompany(row)) {
    throw new Error(row?.live_blocked_reason || 'Live Ediel är inte aktiverat av superadmin för detta bolag. Skicka inte produktionsmeddelanden innan go-live är godkänd.')
  }
}
