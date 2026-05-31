import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listTenantUsageStats } from '@/lib/tenant/usageStats'
import { getMonthlyMetric } from '@/lib/analytics/db'
import { formatMwh, formatNumber, monthStart } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

export default async function PlatformAnalyticsPage() {
  const admin = await requirePlatformAdminAccess()
  const rows = await listTenantUsageStats()
  const month = monthStart()
  const metrics = await Promise.all(rows.map(async (row) => ({ row, metric: await getMonthlyMetric(row.companyId, month) })))
  const totalForecast = metrics.reduce((sum, item) => sum + Number(item.metric?.forecast_kwh ?? 0), 0)
  const totalActual = metrics.reduce((sum, item) => sum + Number(item.metric?.actual_kwh ?? 0), 0)
  const missingValues = metrics.reduce((sum, item) => sum + Number(item.metric?.metering_values_missing ?? 0), 0)
  const openIssues = missingValues + rows.reduce((sum, row) => sum + row.customerBlockers, 0)

  return (
    <div className="min-h-screen">
      <AdminHeader title="Platform analytics" subtitle="Plattformsöversikt per company_id för volym, prognos och datakvalitet." userEmail={admin.email} workspaceMode="platform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card label="Aktiva elbolag" value={formatNumber(rows.filter((row) => String(row.companyStatus).toLowerCase() === 'active').length)} hint={`${formatNumber(rows.length)} bolag totalt`} />
          <Card label="Kunder totalt" value={formatNumber(rows.reduce((sum, row) => sum + row.customers, 0))} hint="Alla tenants" />
          <Card label="Prognosvolym" value={formatMwh(totalForecast)} hint={`${formatMwh(totalActual)} faktiskt utfall`} />
          <Card label="Öppna avvikelser" value={formatNumber(openIssues)} hint={`${formatNumber(missingValues)} saknade mätvärden`} />
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-black text-slate-950">Bolag</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">Klicka in på ett bolag för tenant-scopad analytics.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr>
                  <th className="px-5 py-4">Bolag</th>
                  <th className="px-5 py-4">Kunder</th>
                  <th className="px-5 py-4">Mätpunkter</th>
                  <th className="px-5 py-4">Prognos</th>
                  <th className="px-5 py-4">Saknade mätvärden</th>
                  <th className="px-5 py-4">Avvikelser</th>
                  <th className="px-5 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.map(({ row, metric }) => (
                  <tr key={row.companyId}>
                    <td className="px-5 py-4"><Link href={`/admin/platform/companies/${row.companyId}/analytics`} className="font-black text-emerald-800 hover:underline">{row.companyName}</Link></td>
                    <td className="px-5 py-4">{formatNumber(row.customers)}</td>
                    <td className="px-5 py-4">{formatNumber(row.meteringPoints)}</td>
                    <td className="px-5 py-4">{formatMwh(Number(metric?.forecast_kwh ?? 0))}</td>
                    <td className="px-5 py-4">{formatNumber(Number(metric?.metering_values_missing ?? 0))}</td>
                    <td className="px-5 py-4">{formatNumber(row.customerBlockers + Number(metric?.failed_metering_requests ?? 0))}</td>
                    <td className="px-5 py-4">{row.companyStatus ?? 'okänd'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
