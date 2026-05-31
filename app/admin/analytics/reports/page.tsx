import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { ANALYTICS_REPORTS, listAnalyticsFilterOptions } from '@/lib/analytics/db'
import { monthStart } from '@/lib/analytics/utils'
import { AnalyticsFilters, AnalyticsTabs, ReportsList } from '../_components'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{ month?: string }>
}

export default async function AnalyticsReportsPage({ searchParams }: PageProps) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyId = scope.companyId
  const params = await searchParams
  const month = monthStart(params.month)
  if (!companyId) return <div className="p-8">Bolag saknas.</div>

  const filterOptions = await listAnalyticsFilterOptions(companyId)

  return (
    <div className="min-h-screen">
      <AdminHeader title="Rapporter" subtitle="Enkla CSV-exporter för statistik, prognos, saknade mätvärden och datakvalitet." userEmail={admin.email} workspaceName={scope.companyName} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <AnalyticsTabs active="reports" />
        <AnalyticsFilters month={month} biddingZones={filterOptions.biddingZones} gridOwners={filterOptions.gridOwners} />
        <ReportsList reports={ANALYTICS_REPORTS} month={month} />
      </div>
    </div>
  )
}
