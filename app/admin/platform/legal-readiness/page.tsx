import AdminHeader from '@/components/admin/AdminHeader'
import Link from 'next/link'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import {
  listFailedWebsiteApplications,
  listTenantLegalReadiness,
} from '@/lib/legal/legalReadinessOverview'

export const dynamic = 'force-dynamic'

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-400'}`}
      aria-label={ok ? 'klar' : 'saknas'}
    />
  )
}

export default async function PlatformLegalReadinessPage() {
  const admin = await requirePlatformAdminAccess()
  const [tenants, failed] = await Promise.all([
    listTenantLegalReadiness(),
    listFailedWebsiteApplications(),
  ])

  const notReady = tenants.filter((tenant) => !tenant.isReady)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Juridisk readiness per bolag"
        subtitle="Superadmin-vy: vilka tenants har komplett juridik och fullmakt, samt misslyckade kundansökningar per felkod och felsteg."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Bolag</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{tenants.length}</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Ej juridiskt redo</p>
            <p className="mt-2 text-3xl font-black text-amber-950">{notReady.length}</p>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Misslyckade ansökningar (senaste)</p>
            <p className="mt-2 text-3xl font-black text-red-950">{failed.total}</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Juridisk status per bolag</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Bolag</th>
                  <th className="px-4 py-3">Villkor</th>
                  <th className="px-4 py-3">Integritet</th>
                  <th className="px-4 py-3">Ångerrätt</th>
                  <th className="px-4 py-3">Pris</th>
                  <th className="px-4 py-3">Fullmakt</th>
                  <th className="px-4 py-3">Varningar</th>
                  <th className="px-4 py-3">Åtgärd</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {tenants.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center font-semibold text-slate-600">Inga bolag hittades.</td></tr>
                ) : null}
                {tenants.map((tenant) => (
                  <tr key={tenant.companyId} className={tenant.isReady ? '' : 'bg-amber-50/40'}>
                    <td className="px-4 py-3 font-bold text-slate-900">{tenant.companyName ?? tenant.companyId}</td>
                    <td className="px-4 py-3"><StatusDot ok={tenant.hasTerms} /></td>
                    <td className="px-4 py-3"><StatusDot ok={tenant.hasPrivacyPolicy} /></td>
                    <td className="px-4 py-3"><StatusDot ok={tenant.hasWithdrawal} /></td>
                    <td className="px-4 py-3"><StatusDot ok={tenant.hasPriceTerms} /></td>
                    <td className="px-4 py-3"><StatusDot ok={tenant.hasPowerOfAttorney} /></td>
                    <td className="px-4 py-3 text-xs font-semibold text-amber-900">
                      {tenant.warnings.length > 0 ? tenant.warnings.join(' · ') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/companies/${tenant.companyId}#legal-master`}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100"
                      >
                        Hantera juridik
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Misslyckade ansökningar per felkod</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {failed.byErrorCode.length === 0 ? (
                <p className="text-sm font-semibold text-slate-600">Inga misslyckade ansökningar i urvalet.</p>
              ) : null}
              {failed.byErrorCode.map((group) => (
                <div key={group.key} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-slate-800">{group.key}</span>
                  <span className="font-black text-slate-950">{group.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Misslyckade ansökningar per felsteg</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {failed.byErrorStage.length === 0 ? (
                <p className="text-sm font-semibold text-slate-600">Inga misslyckade ansökningar i urvalet.</p>
              ) : null}
              {failed.byErrorStage.map((group) => (
                <div key={group.key} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-slate-800">{group.key}</span>
                  <span className="font-black text-slate-950">{group.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
