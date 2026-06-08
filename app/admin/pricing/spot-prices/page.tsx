import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

export default async function SpotPricesPage() {
  const admin = await requireAdminPageKeyAccess('pricing.engine')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const rows = await safeListRows('spot_price_monthly_summaries', null, '*', 80)
  const runs = await safeListRows('spot_price_import_runs', null, '*', 20)

  return <div className="min-h-screen bg-slate-50"><AdminHeader title="Spotpriser" subtitle="Import från Elpriset just nu lagras exklusive moms och används som baspris när bolagets avtal baseras på spot." userEmail={admin.email} workspaceName={scope?.companyName} /><main className="space-y-6 p-8"><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Månadsspot per elområde</h2><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Månad</th><th>Elområde</th><th>Snitt kr/kWh</th><th>Intervall</th><th>Status</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={`${row.source}-${row.price_area}-${row.billing_month}`}><td className="py-3">{fmt(row.billing_month)}</td><td>{fmt(row.price_area)}</td><td>{fmt(row.average_sek_per_kwh)}</td><td>{fmt(row.interval_count)} / {fmt(row.expected_interval_count)}</td><td><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></td></tr>)}</tbody></table></div></section><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Senaste importer</h2><div className="mt-4 grid gap-3">{runs.map((run) => <div key={String(run.id)} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><span>{fmt(run.billing_month)}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(run.status)}`}>{fmt(run.status)}</span></div></div>)}</div></section></main></div>
}
