import { supabaseService } from '@/lib/supabase/service'

export type DashboardAlertInput = {
  companyId: string
  alertType: string
  severity?: 'info' | 'warning' | 'critical'
  title: string
  message?: string
  entityType?: string
  entityId?: string
  source?: string
}

export async function createDashboardAlert(input: DashboardAlertInput): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_upsert_dashboard_alert_v1', {
    p_company: input.companyId,
    p_alert_type: input.alertType,
    p_severity: input.severity ?? 'info',
    p_title: input.title,
    p_message: input.message ?? null,
    p_entity_type: input.entityType ?? null,
    p_entity: input.entityId ?? null,
    p_source: input.source ?? 'manual',
  })
  if (error) throw error
}

export async function refreshDashboardAlerts(companyId: string): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_reconcile_data_quality_v1', {
    p_company: companyId,
  })
  if (error) throw error
}

export async function resolveDashboardAlert(alertId: string, companyId: string): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_resolve_dashboard_alert_v1', {
    p_company: companyId,
    p_alert: alertId,
  })
  if (error) throw error
}
