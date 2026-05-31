'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listAnalyticsCompanyIds } from '@/lib/analytics/cron'
import { buildCompanyMonthlyMetrics } from '@/lib/analytics/monthlyMetricsBuilder'
import { scanCompanyDataQuality } from '@/lib/analytics/dataQuality'
import { runCompanyForecast } from '@/lib/forecasting/forecastRuns'
import { monthStart } from '@/lib/analytics/utils'

export async function rebuildPlatformAnalyticsAction() {
  await requirePlatformAdminAccess()
  const month = monthStart()
  const companyIds = await listAnalyticsCompanyIds()
  for (const companyId of companyIds) {
    await buildCompanyMonthlyMetrics(companyId, month)
    await scanCompanyDataQuality(companyId, month)
  }
  revalidatePath('/admin/platform/analytics')
}

export async function runPlatformForecastAction() {
  const admin = await requirePlatformAdminAccess()
  const month = monthStart()
  const companyIds = await listAnalyticsCompanyIds()
  for (const companyId of companyIds) {
    await runCompanyForecast({ companyId, periodStart: month, createdBy: admin.userId })
  }
  revalidatePath('/admin/platform/analytics')
}

export async function rebuildCompanyAnalyticsAction(formData: FormData) {
  await requirePlatformAdminAccess()
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) throw new Error('Bolag saknas.')
  const month = monthStart()
  await buildCompanyMonthlyMetrics(companyId, month)
  await scanCompanyDataQuality(companyId, month)
  revalidatePath(`/admin/platform/companies/${companyId}/analytics`)
}

export async function runCompanyForecastAction(formData: FormData) {
  const admin = await requirePlatformAdminAccess()
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) throw new Error('Bolag saknas.')
  const month = monthStart()
  await runCompanyForecast({ companyId, periodStart: month, createdBy: admin.userId })
  revalidatePath(`/admin/platform/companies/${companyId}/analytics`)
}
