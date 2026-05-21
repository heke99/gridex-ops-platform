import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listBatch2CRlsPolicyReport } from '@/lib/operations/batch2cAutomation'

export const dynamic = 'force-dynamic'

function statusTone(status: string) {
  if (status === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'missing_table') return 'border-slate-200 bg-slate-50 text-slate-700'
  return 'border-red-200 bg-red-50 text-red-800'
}

function label(status: string) {
  if (status === 'ok') return 'OK'
  if (status === 'missing_table') return 'Tabell saknas'
  if (status === 'rls_disabled') return 'RLS avstängd'
  if (status === 'missing_policy') return 'Policy saknas'
  if (status === 'missing_company_scope') return 'Company scope saknas'
  return status
}

export default async function PlatformSecurityPage() {
  const admin = await requirePlatformAdminAccess()
  const report = await listBatch2CRlsPolicyReport()
  const failed = report.filter((row) => row.verification_status !== 'ok' && row.verification_status !== 'missing_table')
  const ok = report.filter((row) => row.verification_status === 'ok')

  return (
    <div className="min-h-screen">
      <AdminHeader title="Säkerhetskontroll" subtitle="Faktisk RLS-policyrapport för risk-tabeller, tenant-scope och service-role-kontroller." userEmail={admin.email} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-700">Tabeller kontrollerade</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{report.length}</div>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-emerald-800">Godkända</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{ok.length}</div>
          </div>
          <div className={`rounded-3xl border p-5 shadow-sm ${failed.length > 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className={`text-sm font-medium ${failed.length > 0 ? 'text-red-800' : 'text-emerald-800'}`}>Åtgärd krävs</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{failed.length}</div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">RLS-policyrapport</h2>
            <p className="mt-1 text-sm text-slate-700">Rapporten läser faktisk databaskatalog via vyn <code>gridex_batch_2c_rls_policy_report_v</code>.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-6 py-3">Tabell</th>
                  <th className="px-6 py-3">Scope</th>
                  <th className="px-6 py-3">RLS</th>
                  <th className="px-6 py-3">Policies</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.map((row) => (
                  <tr key={row.table_name}>
                    <td className="px-6 py-4 font-semibold text-slate-950">{row.table_name}</td>
                    <td className="px-6 py-4 text-slate-700">{row.expected_scope}</td>
                    <td className="px-6 py-4 text-slate-700">{row.rls_enabled ? 'På' : 'Av'}</td>
                    <td className="px-6 py-4 text-slate-700">{row.policy_count ?? 0}</td>
                    <td className="px-6 py-4"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(row.verification_status)}`}>{label(row.verification_status)}</span></td>
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
