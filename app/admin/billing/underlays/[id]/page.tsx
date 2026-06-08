import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

type Props = { params: Promise<{ id: string }> }
export const dynamic = 'force-dynamic'

export default async function BillingUnderlayDetailPage({ params }: Props) {
  const { id } = await params
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  const underlays = (await safeListRows('billing_underlays', companyId, '*', 500)).filter((row) => row.id === id)
  const underlay = underlays[0] ?? null
  const [items, pricingRuns] = await Promise.all([
    safeListRows('billing_underlay_items', companyId, '*', 200).then((rows) => rows.filter((row) => row.billing_underlay_id === id)),
    safeListRows('pricing_runs', companyId, '*', 20).then((rows) => rows.filter((row) => row.billing_underlay_id === id)),
  ])

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Faktureringsunderlag" subtitle="Detaljvy för mätdata, prispreview och varningar innan export." userEmail={admin.email} workspaceName={scope?.companyName} />
      <main className="space-y-6 p-8">
        {!underlay ? <div className="rounded-3xl border bg-white p-8 text-slate-700">Underlaget hittades inte inom valt bolag.</div> : (
          <>
            <section className="grid gap-4 lg:grid-cols-4">
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Status</div><span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusBadge(underlay.status)}`}>{fmt(underlay.status)}</span></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Förbrukning</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.total_kwh)} kWh</div></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Elområde</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.price_area)}</div></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Total inkl. moms</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.calculated_total_sek_inc_vat)} kr</div></div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Underlagsrader</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Period</th><th>Mätpunkt</th><th>kWh</th><th>Status</th></tr></thead><tbody className="divide-y">
                  {items.map((row) => <tr key={String(row.id)}><td className="py-3">{fmt(row.period_start)} → {fmt(row.period_end)}</td><td className="font-mono text-xs">{fmt(row.metering_point_id)}</td><td>{fmt(row.quantity_kwh)}</td><td><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></td></tr>)}
                </tbody></table>
              </div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Prisberäkningar</h2>
              <div className="mt-4 grid gap-3">
                {pricingRuns.length === 0 ? <p className="text-sm text-slate-600">Ingen prispreview har skapats ännu.</p> : null}
                {pricingRuns.map((row) => <div key={String(row.id)} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span><span className="font-semibold">{fmt(row.total_inc_vat)} kr inkl. moms</span></div><div className="mt-2 text-xs text-slate-500">Ex moms {fmt(row.total_ex_vat)} · Moms {fmt(row.vat_amount)}</div></div>)}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
