import { supabaseService } from '@/lib/supabase/service'

export type DashboardAlertInput = {
  companyId: string
  alertType: string
  severity?: 'info' | 'warning' | 'critical'
  title: string
  message?: string
  entityType?: string
  entityId?: string
}

export async function createDashboardAlert(input: DashboardAlertInput): Promise<void> {
  const { error } = await supabaseService
    .from('dashboard_alerts')
    .upsert({
      company_id: input.companyId,
      alert_type: input.alertType,
      severity: input.severity ?? 'info',
      title: input.title,
      message: input.message ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      status: 'open',
      resolved_at: null,
    }, { onConflict: 'company_id,alert_type,entity_type,entity_id,status' })

  if (error && !/does not exist|schema cache|Could not find/i.test(error.message)) throw error
}

export async function refreshDashboardAlerts(companyId: string): Promise<void> {
  const { data: issues, error } = await supabaseService
    .from('data_quality_issues')
    .select('issue_type, severity, status')
    .eq('company_id', companyId)
    .eq('status', 'open')

  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return
    throw error
  }

  const counts = new Map<string, { count: number; severity: 'info' | 'warning' | 'critical' }>()
  for (const issue of issues ?? []) {
    const key = issue.issue_type ?? 'data_quality'
    const previous = counts.get(key) ?? { count: 0, severity: 'info' as const }
    counts.set(key, {
      count: previous.count + 1,
      severity: issue.severity === 'critical' || previous.severity === 'critical' ? 'critical' : 'warning',
    })
  }

  for (const [type, summary] of counts) {
    if (type === 'missing_metering_values') {
      await createDashboardAlert({
        companyId,
        alertType: type,
        severity: summary.severity,
        title: `${summary.count} mätpunkter saknar mätvärden`,
        message: 'Följ upp saknade mätvärden för vald period.',
      })
    } else if (type === 'missing_bidding_zone') {
      await createDashboardAlert({
        companyId,
        alertType: type,
        severity: summary.severity,
        title: `${summary.count} mätpunkter saknar SE-område`,
        message: 'Komplettera SE-område eller lägg till en säker nätområdesmappning.',
      })
    } else if (type === 'missing_grid_owner') {
      await createDashboardAlert({
        companyId,
        alertType: type,
        severity: summary.severity,
        title: `${summary.count} mätpunkter saknar nätägare`,
        message: 'Komplettera nätägare innan prognos och mätvärdesuppföljning används.',
      })
    }
  }
}

export async function resolveDashboardAlert(alertId: string, companyId: string): Promise<void> {
  const { error } = await supabaseService
    .from('dashboard_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('company_id', companyId)

  if (error) throw error
}
