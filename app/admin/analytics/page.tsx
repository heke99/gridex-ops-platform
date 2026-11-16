import AdminHeader from '@/components/admin/AdminHeader'
import { formatAdminDateTime } from '@/lib/ui/format'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { buildLiveMonthlyFallback, getCustomerGrowthSeries, getMonthlyMetric, getOverviewBreakdowns, listAnalyticsFilterOptions } from '@/lib/analytics/db'
import { addMonths, nullableNumber, formatMwh, formatNumber, monthStart, percentChange } from '@/lib/analytics/utils'
import { AnalyticsUnavailable, AnalyticsFilters, AnalyticsTabs, MetricCards, SimpleBars, SimpleChart } from './_components'
import type { MetricCard } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{ month?: string; biddingZoneCode?: string; gridOwnerId?: string; customerType?: string; meteringMethod?: string; status?: string }>
}

export default async function AnalyticsOverviewPage({ searchParams }: PageProps) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const companyId = scope.companyId
  const params = await searchParams
  const month = monthStart(params.month)

  if (!companyId) {
    return <EmptyAnalytics userEmail={admin.email} message="Välj bolag för att se analytics." />
  }

  const loaded = await Promise.all([
    getMonthlyMetric(companyId, month),
    getMonthlyMetric(companyId, addMonths(month, -1)),
    getCustomerGrowthSeries(companyId, month),
    listAnalyticsFilterOptions(companyId),
    getOverviewBreakdowns(companyId, month),
  ]).catch(() => null)
  if (!loaded) return <AnalyticsUnavailable />
  const [currentMetric, previousMetric, growthSeries, filterOptions, breakdowns] = loaded
  const metric = currentMetric ?? await buildLiveMonthlyFallback(companyId, month)
  const previous = previousMetric ?? null
  const cards = buildOverviewCards(metric, previous).map(card => {
    if (!scope.isPlatformAdmin && card.href === '/admin/customers' && !admin.permissions.includes('customers.read')) return { ...card, href: undefined }
    if (!scope.isPlatformAdmin && card.href === '/admin/metering' && !admin.permissions.includes('metering.read')) return { ...card, href: undefined }
    return card
  })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Analys"
        subtitle="En enkel operationsvy för kunder, mätpunkter, mätvärden, prognos och avvikelser."
        userEmail={admin.email}
        workspaceName={scope.companyName}
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <AnalyticsTabs active="overview" />
        <AnalyticsFilters
          monthOnly
          month={month}
          biddingZones={filterOptions.biddingZones}
          gridOwners={filterOptions.gridOwners}
          meteringMethods={filterOptions.meteringMethods}
          statuses={filterOptions.statuses}
          selected={params}
        />
        <p className="text-sm text-slate-600">Vald månad: {month.slice(0, 7)}. Underlag uppdaterat: {formatAdminDateTime(currentMetric?.updated_at, 'Tidpunkt saknas')}. Aktualiteten behöver bedömas utifrån periodens bearbetning.</p>
        {!currentMetric ? <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Månadsunderlag saknas för vald period. Okända värden visas som streck; dagens bestånd används inte som historik.</p> : null}
        <MetricCards cards={cards} />

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Kundtillväxt per månad</h2>
            <div className="mt-5">
              <SimpleBars rows={growthSeries.length ? growthSeries : [metric]} valueKey="total_customers" labelKey="month" />
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Förbrukning/prognos per månad</h2>
            <div className="mt-5">
              <SimpleBars rows={growthSeries.length ? growthSeries : [metric]} valueKey="forecast_kwh" labelKey="month" />
            </div>
          </div>
        </section>
        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Fördelning per SE-område</h2>
            <div className="mt-5">
              <SimpleChart rows={breakdowns.biddingZones} emptyLabel="Inget sparat månadsunderlag per elområde." />
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Nätägare med flest saknade mätvärden (högst 6)</h2>
            <div className="mt-5">
              <SimpleChart rows={breakdowns.missingByGridOwner} emptyLabel="Inget avvikelseunderlag per nätägare att visa för vald period." />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function buildOverviewCards(metric: Record<string, unknown>, previous: Record<string, unknown> | null): MetricCard[] {
  const number = (key: string) => nullableNumber(metric[key])
  const previousNumber = (key: string) => nullableNumber(previous?.[key])
  const missing = number('metering_values_missing')
  const failed = number('failed_metering_requests')
  const deviations = missing === null || failed === null ? null : missing + failed
  return [
    { key: 'customers', label: 'Kunder totalt', value: formatNumber(number('total_customers')), hint: percentChange(number('total_customers'), previousNumber('total_customers')), status: 'info', href: '/admin/customers' },
    { key: 'new_customers', label: 'Nya kunder vald månad', value: formatNumber(number('new_customers')), hint: percentChange(number('new_customers'), previousNumber('new_customers')), status: 'info', href: '/admin/customers' },
    { key: 'sites', label: 'Aktiva anläggningar', value: formatNumber(number('active_sites')), hint: `${formatNumber(number('total_sites'))} anläggningar totalt`, status: 'info' },
    { key: 'metering_points', label: 'Aktiva mätpunkter', value: formatNumber(number('active_metering_points')), hint: `${formatNumber(number('total_metering_points'))} mätpunkter totalt`, status: 'info', href: '/admin/metering' },
    { key: 'received', label: 'Mottagna mätvärden', value: formatNumber(number('metering_values_received')), hint: 'Inkomna värden för vald period', status: 'info', href: '/admin/metering' },
    { key: 'missing', label: 'Saknade mätvärden', value: formatNumber(missing), hint: missing === null ? 'Månadsunderlag saknas' : missing ? 'Kräver uppföljning' : 'Inga saknade mätvärden i månadsunderlaget', status: missing === null ? 'info' : missing ? 'critical' : 'ok', href: '/admin/analytics/deviations' },
    { key: 'forecast_current', label: 'Prognos vald månad', value: formatMwh(number('forecast_kwh')), hint: 'Sparad prognosvolym', status: 'info', href: `/admin/analytics/forecast?month=${String(metric.month).slice(0, 7)}` },
    { key: 'forecast_next', label: 'Prognos nästa månad', value: 'Visa prognos', hint: 'Månaden efter vald period', status: 'info', href: `/admin/analytics/forecast?month=${addMonths(String(metric.month), 1).slice(0, 7)}` },
    { key: 'deviations', label: 'Mätvärdesavvikelser', value: formatNumber(deviations), hint: 'Saknade värden och misslyckade begäranden i månadsunderlaget', status: deviations === null ? 'info' : deviations ? 'warning' : 'ok', href: '/admin/analytics/deviations' },
    { key: 'quality', label: 'Mätvärdestäckning', value: missing === null ? 'Underlag saknas' : missing ? 'Följ upp' : 'Inga saknade mätvärden', hint: 'Avser enbart saknade mätvärden i månadsunderlaget', status: missing === null ? 'info' : missing ? 'warning' : 'ok', href: '/admin/analytics/deviations' },
  ]
}

function EmptyAnalytics({ userEmail, message }: { userEmail: string | null; message: string }) {
  return (
    <div className="min-h-screen">
      <AdminHeader title="Analys" subtitle="Bolag saknas." userEmail={userEmail} />
      <div className="p-8">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 font-bold text-amber-900">{message}</div>
      </div>
    </div>
  )
}
