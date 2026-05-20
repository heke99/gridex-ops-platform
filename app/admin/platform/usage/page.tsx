import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listTenantUsageStats } from '@/lib/tenant/usageStats'

export const dynamic = 'force-dynamic'

function total(rows: Array<Record<string, unknown>>, key: string): number {
  return rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? row[key] as number : 0), 0)
}

export default async function PlatformUsagePage() {
  const admin = await requirePlatformAdminAccess()
  const rows = await listTenantUsageStats()
  const totals = {
    customers: total(rows, 'customers'),
    meteringValues: total(rows, 'meteringValues'),
    edielMessages: total(rows, 'edielMessages'),
    billingExportRuns: total(rows, 'billingExportRuns'),
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Usage & plattformsfakturering"
        subtitle="Tenant-statistik för framtida SaaS-billing: kunder, mätpunkter, Ediel, mätvärden, export och API-volym."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-700">Kunder</div><div className="mt-2 text-3xl font-semibold text-slate-950">{totals.customers}</div></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-700">Mätvärden</div><div className="mt-2 text-3xl font-semibold text-slate-950">{totals.meteringValues}</div></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-700">Ediel-meddelanden</div><div className="mt-2 text-3xl font-semibold text-slate-950">{totals.edielMessages}</div></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-700">Exportkörningar</div><div className="mt-2 text-3xl font-semibold text-slate-950">{totals.billingExportRuns}</div></div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Usage per tenant</h2>
            <p className="mt-1 text-sm text-slate-700">Används som kontrollunderlag inför kommande plattformsfakturering. Inga rader visas för vanliga tenants.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr>
                  <th className="px-6 py-4">Bolag</th>
                  <th className="px-6 py-4">Kunder</th>
                  <th className="px-6 py-4">Avtal</th>
                  <th className="px-6 py-4">Anläggningar</th>
                  <th className="px-6 py-4">Mätpunkter</th>
                  <th className="px-6 py-4">Fullmakter</th>
                  <th className="px-6 py-4">Mätvärden</th>
                  <th className="px-6 py-4">PRODAT</th>
                  <th className="px-6 py-4">UTILTS</th>
                  <th className="px-6 py-4">Exporter</th>
                  <th className="px-6 py-4">API/partner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.companyId} className="align-top">
                    <td className="px-6 py-4">
                      <Link href={`/admin/companies/${row.companyId}`} className="font-semibold text-emerald-800 hover:underline">{row.companyName}</Link>
                      <div className="mt-1 text-xs text-slate-500">{row.companyStatus ?? 'okänd status'}</div>
                    </td>
                    <td className="px-6 py-4">{row.customers}<div className="text-xs text-slate-500">{row.activeCustomers} aktiva</div></td>
                    <td className="px-6 py-4">{row.contracts}</td>
                    <td className="px-6 py-4">{row.sites}</td>
                    <td className="px-6 py-4">{row.meteringPoints}</td>
                    <td className="px-6 py-4">{row.authorizations}</td>
                    <td className="px-6 py-4">{row.meteringValues}</td>
                    <td className="px-6 py-4">{row.prodat}</td>
                    <td className="px-6 py-4">{row.utilts}</td>
                    <td className="px-6 py-4">{row.billingExportRuns}</td>
                    <td className="px-6 py-4">{row.partnerExports}</td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={11} className="px-6 py-10 text-center text-slate-600">Inga tenants hittades.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
