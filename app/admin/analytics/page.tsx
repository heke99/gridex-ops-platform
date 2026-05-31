import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { buildLiveMonthlyFallback, getCustomerGrowthSeries, getMonthlyMetric, getOverviewBreakdowns, listAnalyticsFilterOptions } from '@/lib/analytics/db'
import { asNumber, formatMwh, formatNumber, monthStart, percentChange } from '@/lib/analytics/utils'
import { AnalyticsFilters, AnalyticsTabs, MetricCards, SimpleBars, SimpleChart } from './_components'
import type { MetricCard } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{ month?: string; biddingZoneCode?: string; gridOwnerId?: string; customerType?: string; meteringMethod?: string; status?: string }>
}

export default async function AnalyticsOverviewPage({ searchParams }: PageProps) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyId = scope.companyId
  const params = await searchParams
  const month = monthStart(params.month)

  if (!companyId) {
    return <EmptyAnalytics userEmail={admin.email} message={scope.message ?? 'Välj bolag för att se analytics.'} />
  }

  const [currentMetric, previousMetric, growthSeries, filterOptions, breakdowns] = await Promise.all([
    getMonthlyMetric(companyId, month),
    getMonthlyMetric(companyId, new Date(new Date(`${month}T00:00:00.000Z`).setUTCMonth(new Date(`${month}T00:00:00.000Z`).getUTCMonth() - 1)).toISOString().slice(0, 10)),
    getCustomerGrowthSeries(companyId, month),
    listAnalyticsFilterOptions(companyId),
    getOverviewBreakdowns(companyId, month),
  ])
  const metric = currentMetric ?? await buildLiveMonthlyFallback(companyId, month)
  const previous = previousMetric ?? null
  const cards = buildOverviewCards(metric, previous)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Analytics"
        subtitle="En enkel operationsvy för kunder, mätpunkter, mätvärden, prognos och avvikelser."
        userEmail={admin.email}
        workspaceName={scope.companyName}
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <AnalyticsTabs active="overview" />
        <AnalyticsFilters
          month={month}
          biddingZones={filterOptions.biddingZones}
          gridOwners={filterOptions.gridOwners}
          meteringMethods={filterOptions.meteringMethods}
          statuses={filterOptions.statuses}
          selected={params}
        />
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
              <SimpleChart rows={breakdowns.biddingZones} emptyLabel="Inga SE-områden finns för vald period." />
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Saknade mätvärden per nätägare</h2>
            <div className="mt-5">
              <SimpleChart rows={breakdowns.missingByGridOwner} emptyLabel="Inga saknade mätvärden per nätägare." />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function buildOverviewCards(metric: Record<string, unknown>, previous: Record<string, unknown> | null): MetricCard[] {
  const missing = asNumber(metric.metering_values_missing)
  const deviations = missing + asNumber(metric.failed_metering_requests)
  return [
    { key: 'customers', label: 'Kunder totalt', value: formatNumber(asNumber(metric.total_customers)), hint: percentChange(asNumber(metric.total_customers), asNumber(previous?.total_customers)), status: 'info', href: '/admin/customers' },
    { key: 'new_customers', label: 'Nya kunder denna månad', value: formatNumber(asNumber(metric.new_customers)), hint: percentChange(asNumber(metric.new_customers), asNumber(previous?.new_customers)), status: 'ok', href: '/admin/customers' },
    { key: 'sites', label: 'Aktiva anläggningar', value: formatNumber(asNumber(metric.active_sites)), hint: `${formatNumber(asNumber(metric.total_sites))} anläggningar totalt`, status: 'info' },
    { key: 'metering_points', label: 'Aktiva mätpunkter', value: formatNumber(asNumber(metric.active_metering_points)), hint: `${formatNumber(asNumber(metric.total_metering_points))} mätpunkter totalt`, status: 'info', href: '/admin/metering' },
    { key: 'received', label: 'Mottagna mätvärden', value: formatNumber(asNumber(metric.metering_values_received)), hint: 'Inkomna värden för vald period', status: 'ok', href: '/admin/metering' },
    { key: 'missing', label: 'Saknade mätvärden', value: formatNumber(missing), hint: missing ? 'Kräver uppföljning' : 'Ingen öppen brist', status: missing ? 'critical' : 'ok', href: '/admin/analytics/deviations' },
    { key: 'forecast_current', label: 'Prognos denna månad', value: formatMwh(asNumber(metric.forecast_kwh)), hint: 'Summerad prognosvolym', status: 'info', href: '/admin/analytics/forecast' },
    { key: 'forecast_next', label: 'Prognos nästa månad', value: 'Visa prognos', hint: 'Öppna prognosvyn för kommande period', status: 'info', href: '/admin/analytics/forecast' },
    { key: 'deviations', label: 'Avvikelser', value: formatNumber(deviations), hint: deviations ? 'Öppna avvikelser finns' : 'Inga kritiska avvikelser', status: deviations ? 'warning' : 'ok', href: '/admin/analytics/deviations' },
    { key: 'quality', label: 'Datakvalitet', value: missing ? 'Följ upp' : 'Stabil', hint: 'Baserat på öppna datakvalitetsärenden', status: missing ? 'warning' : 'ok', href: '/admin/analytics/deviations' },
  ]
}

function EmptyAnalytics({ userEmail, message }: { userEmail: string | null; message: string }) {
  return (
    <div className="min-h-screen">
      <AdminHeader title="Analytics" subtitle="Bolag saknas." userEmail={userEmail} />
      <div className="p-8">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 font-bold text-amber-900">{message}</div>
      </div>
    </div>
  )
}
