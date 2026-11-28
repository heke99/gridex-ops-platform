import Link from 'next/link'
import { formatAdminDateTime } from '@/lib/ui/format'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { getLatestForecastByBiddingZone, getLatestForecastByGridOwner, listAnalyticsFilterOptions } from '@/lib/analytics/db'
import { formatMwh, monthStart } from '@/lib/analytics/utils'
import { AnalyticsUnavailable, AnalyticsFilters, AnalyticsTabs, ForecastTable, GridOwnerForecastTable, MetricCards } from '../_components'
import type { MetricCard } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{ month?: string; biddingZoneCode?: string; gridOwnerId?: string; customerType?: string; meteringMethod?: string; status?: string }>
}

export default async function AnalyticsForecastPage({ searchParams }: PageProps) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
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
  const loaded = await Promise.all([
    listAnalyticsFilterOptions(companyId),
    getLatestForecastByBiddingZone(companyId, filters),
    getLatestForecastByGridOwner(companyId, filters),
  ]).catch(() => null)
  if (!loaded) return <AnalyticsUnavailable />
  const [filterOptions, rows, gridOwnerRows] = loaded
  const totalValue = rows.reduce((sum, row) => sum + row.forecastKwh, 0)
  const actualValue = rows.reduce((sum, row) => sum + row.actualKwh, 0)
  const total = rows.length && rows.every(row => row.forecastAvailable !== false) ? totalValue : null
  const actual = rows.length && rows.every(row => row.actualAvailable !== false) ? actualValue : null
  const confidence = rows.length && rows.every(row => row.confidenceScore !== null) ? Math.round(rows.reduce((sum, row) => sum + (row.confidenceScore ?? 0), 0) / rows.length) : null
  const missingKnown = rows.length > 0 && rows.every(row => row.missingDataAvailable !== false)
  const missing = rows.reduce((sum, row) => sum + row.missingDataCount, 0)
  const cards: MetricCard[] = [
    { key: 'total', label: 'Total prognos', value: formatMwh(total), hint: 'Vald period', status: 'info' },
    { key: 'actual', label: 'Faktiskt utfall', value: formatMwh(actual), hint: actual === null ? 'Saknas för perioden' : 'Inkomna mätvärden', status: actual === null ? 'warning' : 'ok' },
    ...rows.slice(0, 4).map((row) => ({ key: row.biddingZoneCode, label: row.biddingZoneCode, value: formatMwh(row.forecastAvailable === false ? null : row.forecastKwh), hint: 'Prognos per SE-område', status: 'info' as const })),
    { key: 'confidence', label: 'Säkerhet', value: confidence === null ? '–' : `${confidence} %`, hint: 'Baserat på historik eller årsförbrukning', status: confidence === null ? 'info' : confidence >= 80 ? 'ok' : 'warning' },
    { key: 'missing', label: 'Saknad data', value: missingKnown ? String(missing) : '–', hint: missingKnown ? missing ? 'Påverkar säkerheten' : 'Ingen saknad prognosbas i urvalet' : 'Antal saknade prognosbaser kan inte bedömas', status: !missingKnown ? 'info' : missing ? 'warning' : 'ok' },
  ]

  const exportParams = new URLSearchParams({ report: 'forecast_run_items', month: month.slice(0, 7), expected_company_id: companyId })
  for (const [key, value] of Object.entries(filters)) if (key !== 'month' && value) exportParams.set(key, value)

  return (
    <div className="min-h-screen">
      <AdminHeader title="Prognos" subtitle="Förbruknings- och inköpsprognos per SE-område med synlig säkerhet." userEmail={admin.email} workspaceName={scope.companyName} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <AnalyticsTabs active="forecast" month={month} />
        <AnalyticsFilters
          month={month}
          biddingZones={filterOptions.biddingZones}
          gridOwners={filterOptions.gridOwners}
          meteringMethods={filterOptions.meteringMethods}
          statuses={filterOptions.statuses}
          selected={params}
        />
        <p className="text-sm text-slate-600">Vald månad: {month.slice(0, 7)}. Senaste färdigställda prognos som täcker perioden. Streck betyder att underlag saknas. Exporten avser motsvarande detaljerade prognosunderlag och valda filter; utan sådant underlag blir exporten tom.</p>
        <p className="text-sm text-slate-600">Prognosunderlag skapat: {formatAdminDateTime(rows[0]?.sourceCreatedAt, 'Tidpunkt saknas')}. Detta är källans tidpunkt, ingen automatisk garanti för aktualitet.</p>
        <MetricCards cards={cards} />
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold leading-6 text-emerald-950">
          Prognosen baseras på historisk förbrukning där den finns. Om historik saknas används uppskattad årsförbrukning och säsongsprofil.
        </section>
        <div className="flex justify-end">
          <Link href={`/admin/analytics/export?${exportParams}`} className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
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
