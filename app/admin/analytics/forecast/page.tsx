import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getLatestForecastByBiddingZone, getLatestForecastByGridOwner, listAnalyticsFilterOptions } from '@/lib/analytics/db'
import { formatMwh, monthStart } from '@/lib/analytics/utils'
import { AnalyticsFilters, AnalyticsTabs, ForecastTable, GridOwnerForecastTable, MetricCards } from '../_components'
import type { MetricCard } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{ month?: string; biddingZoneCode?: string; gridOwnerId?: string; customerType?: string; meteringMethod?: string; status?: string }>
}

export default async function AnalyticsForecastPage({ searchParams }: PageProps) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyId = scope.companyId
  const params = await searchParams
  const month = monthStart(params.month)

  if (!companyId) {
    return <div className="p-8">Bolag saknas.</div>
  }

  const filters = {
    month,
    biddingZoneCode: params.biddingZoneCode || null,
    gridOwnerId: params.gridOwnerId || null,
    customerType: params.customerType || null,
    meteringMethod: params.meteringMethod || null,
    status: params.status || null,
  }
  const [filterOptions, rows, gridOwnerRows] = await Promise.all([
    listAnalyticsFilterOptions(companyId),
    getLatestForecastByBiddingZone(companyId, filters),
    getLatestForecastByGridOwner(companyId, filters),
  ])
  const total = rows.reduce((sum, row) => sum + row.forecastKwh, 0)
  const actual = rows.reduce((sum, row) => sum + row.actualKwh, 0)
  const confidence = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.confidenceScore, 0) / rows.length) : 0
  const missing = rows.reduce((sum, row) => sum + row.missingDataCount, 0)
  const cards: MetricCard[] = [
    { key: 'total', label: 'Total prognos', value: formatMwh(total), hint: 'Vald period', status: 'info' },
    { key: 'actual', label: 'Faktiskt utfall', value: formatMwh(actual), hint: actual ? 'Inkomna mätvärden' : 'Saknas för perioden', status: actual ? 'ok' : 'warning' },
    ...rows.slice(0, 4).map((row) => ({ key: row.biddingZoneCode, label: row.biddingZoneCode, value: formatMwh(row.forecastKwh), hint: 'Prognos per SE-område', status: 'info' as const })),
    { key: 'confidence', label: 'Säkerhet', value: confidence ? `${confidence} %` : '–', hint: 'Baserat på historik eller årsförbrukning', status: confidence >= 80 ? 'ok' : 'warning' },
    { key: 'missing', label: 'Saknad data', value: String(missing), hint: missing ? 'Påverkar säkerheten' : 'Ingen saknad prognosbas', status: missing ? 'warning' : 'ok' },
  ]

  return (
    <div className="min-h-screen">
      <AdminHeader title="Prognos" subtitle="Förbruknings- och inköpsprognos per SE-område med synlig säkerhet." userEmail={admin.email} workspaceName={scope.companyName} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <AnalyticsTabs active="forecast" />
        <AnalyticsFilters
          month={month}
          biddingZones={filterOptions.biddingZones}
          gridOwners={filterOptions.gridOwners}
          meteringMethods={filterOptions.meteringMethods}
          statuses={filterOptions.statuses}
          selected={params}
        />
        <MetricCards cards={cards} />
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold leading-6 text-emerald-950">
          Prognosen baseras på historisk förbrukning där den finns. Om historik saknas används uppskattad årsförbrukning och säsongsprofil.
        </section>
        <div className="flex justify-end">
          <Link href={`/admin/analytics/export?report=forecast_run_items&month=${month.slice(0, 7)}`} className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
            Exportera CSV
          </Link>
        </div>
        <section className="space-y-3">
          <h2 className="text-lg font-black text-slate-950">Prognos per SE-område</h2>
          <ForecastTable rows={rows} />
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-black text-slate-950">Prognos per nätägare</h2>
          <GridOwnerForecastTable rows={gridOwnerRows} />
        </section>
      </div>
    </div>
  )
}
