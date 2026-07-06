'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { listAnalyticsCompanyIds } from '@/lib/analytics/cron'
import { buildCompanyMonthlyMetrics } from '@/lib/analytics/monthlyMetricsBuilder'
import { scanCompanyDataQuality } from '@/lib/analytics/dataQuality'
import { runCompanyForecast } from '@/lib/forecasting/forecastRuns'
import { monthStart } from '@/lib/analytics/utils'

async function auditPlatformAnalyticsAction(input: {
  actorUserId: string
  action: string
  label: string
  companyId?: string | null
  metadata?: Record<string, unknown>
}) {
  await logAdminActionAndUsage({
    companyId: input.companyId ?? null,
    actorUserId: input.actorUserId,
    entityType: 'platform_analytics',
    entityId: input.companyId ?? 'platform',
    action: input.action,
    label: input.label,
    metadata: input.metadata ?? {},
    source: 'platform_analytics',
  }).catch(() => undefined)
}

export async function rebuildPlatformAnalyticsAction() {
  const admin = await requirePlatformAdminAccess()
  const month = monthStart()
  const companyIds = await listAnalyticsCompanyIds()
  for (const companyId of companyIds) {
    await buildCompanyMonthlyMetrics(companyId, month)
    await scanCompanyDataQuality(companyId, month)
  }
  await auditPlatformAnalyticsAction({
    actorUserId: admin.userId,
    action: 'platform_analytics_rebuilt',
    label: 'Plattformsanalys ombyggd',
    metadata: { month, companyCount: companyIds.length },
  })
  revalidatePath('/admin/platform/analytics')
}

export async function runPlatformForecastAction() {
  const admin = await requirePlatformAdminAccess()
  const month = monthStart()
  const companyIds = await listAnalyticsCompanyIds()
  for (const companyId of companyIds) {
    await runCompanyForecast({ companyId, periodStart: month, createdBy: admin.userId })
  }
  await auditPlatformAnalyticsAction({
    actorUserId: admin.userId,
    action: 'platform_forecast_run',
    label: 'Plattformsprognos körd',
    metadata: { month, companyCount: companyIds.length },
  })
  revalidatePath('/admin/platform/analytics')
}

export async function rebuildCompanyAnalyticsAction(formData: FormData) {
  const admin = await requirePlatformAdminAccess()
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) throw new Error('Bolag saknas.')
  const month = monthStart()
  await buildCompanyMonthlyMetrics(companyId, month)
  await scanCompanyDataQuality(companyId, month)
  await auditPlatformAnalyticsAction({
    actorUserId: admin.userId,
    action: 'company_analytics_rebuilt',
    label: 'Bolagsanalys ombyggd',
    companyId,
    metadata: { month },
  })
  revalidatePath(`/admin/platform/companies/${companyId}/analytics`)
}

export async function runCompanyForecastAction(formData: FormData) {
  const admin = await requirePlatformAdminAccess()
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) throw new Error('Bolag saknas.')
  const month = monthStart()
  await runCompanyForecast({ companyId, periodStart: month, createdBy: admin.userId })
  await auditPlatformAnalyticsAction({
    actorUserId: admin.userId,
    action: 'company_forecast_run',
    label: 'Bolagsprognos körd',
    companyId,
    metadata: { month },
  })
  revalidatePath(`/admin/platform/companies/${companyId}/analytics`)
}
