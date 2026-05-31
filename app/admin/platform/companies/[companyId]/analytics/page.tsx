import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listTenantUsageStats } from '@/lib/tenant/usageStats'
import { getCustomerGrowthSeries, getDeviationRows, getLatestForecastByBiddingZone, getMonthlyMetric } from '@/lib/analytics/db'
import { formatMwh, formatNumber, monthStart } from '@/lib/analytics/utils'
import { DeviationsTable, ForecastTable, SimpleBars } from '../../../../analytics/_components'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ companyId: string }>
}

export default async function PlatformCompanyAnalyticsPage({ params }: PageProps) {
  const admin = await requirePlatformAdminAccess()
  const { companyId } = await params
  const tenants = await listTenantUsageStats()
  const tenant = tenants.find((row) => row.companyId === companyId)
  const month = monthStart()
  const [metric, growth, forecast, deviations] = await Promise.all([
    getMonthlyMetric(companyId, month),
    getCustomerGrowthSeries(companyId, month),
    getLatestForecastByBiddingZone(companyId, { month }),
    getDeviationRows(companyId),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader title={`Analytics: ${tenant?.companyName ?? 'Bolag'}`} subtitle="Superadminvy för valt bolags statistik, prognos och avvikelser." userEmail={admin.email} workspaceMode="platform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <Link href="/admin/platform/analytics" className="inline-flex rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-50">Till platform analytics</Link>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card label="Kunder" value={formatNumber(metric?.total_customers ?? tenant?.customers ?? 0)} hint={`${formatNumber(metric?.active_customers ?? tenant?.activeCustomers ?? 0)} aktiva`} />
          <Card label="Mätpunkter" value={formatNumber(metric?.total_metering_points ?? tenant?.meteringPoints ?? 0)} hint={`${formatNumber(metric?.active_metering_points ?? 0)} aktiva`} />
          <Card label="Prognos" value={formatMwh(metric?.forecast_kwh ?? 0)} hint={`${formatMwh(metric?.actual_kwh ?? 0)} faktiskt`} />
          <Card label="Öppna avvikelser" value={formatNumber(deviations.length)} hint={`${formatNumber(metric?.metering_values_missing ?? 0)} saknade mätvärden`} />
        </section>
        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Kundtillväxt</h2>
            <div className="mt-5"><SimpleBars rows={growth} valueKey="total_customers" labelKey="month" /></div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Prognos per SE-område</h2>
            <div className="mt-5"><ForecastTable rows={forecast} /></div>
          </div>
        </section>
        <DeviationsTable rows={deviations} />
      </div>
    </div>
  )
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-black text-slate-700">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-xs font-bold text-slate-500">{hint}</p>
    </div>
  )
}
