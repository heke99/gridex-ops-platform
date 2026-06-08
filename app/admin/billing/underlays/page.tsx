import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

export default async function BillingUnderlaysPage() {
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  const underlays = await safeListRows('billing_underlays', companyId, 'id,customer_id,metering_point_id,underlay_year,underlay_month,status,total_kwh,calculated_total_sek_ex_vat,calculated_total_sek_inc_vat,price_area,readiness_status,updated_at', 80)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Faktureringsunderlag" subtitle="Kontrollera inkomna mätvärden, underlag, prisstatus och vilka rader som är redo för prispreview." userEmail={admin.email} workspaceName={scope?.companyName} />
      <main className="space-y-6 p-8">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Underlag</div><div className="mt-2 text-3xl font-semibold">{underlays.length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Redo för pris</div><div className="mt-2 text-3xl font-semibold">{underlays.filter((row) => row.status === 'validated' && row.readiness_status === 'ready').length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Prispreview</div><div className="mt-2 text-3xl font-semibold">{underlays.filter((row) => row.calculated_total_sek_inc_vat !== null && row.calculated_total_sek_inc_vat !== undefined).length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Behöver kontroll</div><div className="mt-2 text-3xl font-semibold">{underlays.filter((row) => row.readiness_status === 'blocked' || row.status === 'failed').length}</div></div>
        </section>

        <section className="rounded-3xl border bg-white shadow-sm">
          <div className="border-b px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Senaste underlag</h2>
            <p className="mt-1 text-sm text-slate-700">Prismotorn får bara räkna vidare när kund, mätpunkt, period, elområde och avtal är säkra.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-6 py-3">Period</th><th className="px-6 py-3">Mätpunkt</th><th className="px-6 py-3">Elområde</th><th className="px-6 py-3">kWh</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Total inkl. moms</th><th className="px-6 py-3"></th></tr>
              </thead>
              <tbody className="divide-y">
                {underlays.length === 0 ? <tr><td className="px-6 py-8 text-center text-slate-500" colSpan={7}>Inga faktureringsunderlag finns ännu.</td></tr> : null}
                {underlays.map((row) => (
                  <tr key={String(row.id)}>
                    <td className="px-6 py-4">{fmt(row.underlay_year)}-{String(row.underlay_month ?? '').padStart(2, '0')}</td>
                    <td className="px-6 py-4 font-mono text-xs">{fmt(row.metering_point_id)}</td>
                    <td className="px-6 py-4">{fmt(row.price_area)}</td>
                    <td className="px-6 py-4">{fmt(row.total_kwh)}</td>
                    <td className="px-6 py-4"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)} / {fmt(row.readiness_status)}</span></td>
                    <td className="px-6 py-4">{fmt(row.calculated_total_sek_inc_vat)}</td>
                    <td className="px-6 py-4 text-right"><Link className="font-semibold text-emerald-700" href={`/admin/billing/underlays/${row.id}`}>Öppna</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
