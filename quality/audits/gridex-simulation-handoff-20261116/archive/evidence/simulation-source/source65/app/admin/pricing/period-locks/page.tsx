import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

export default async function PeriodLocksPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const rows = await safeListRows('price_period_locks', scope?.companyId ?? null, '*', 80)

  return <div className="min-h-screen bg-slate-50"><AdminHeader title="Prislåsning" subtitle="Endast platform admin får skapa, ändra och publicera pris- och avtalslogik. När en prisperiod är låst får spot, portföljpris eller fakturarader inte ändras tyst. Nya ändringar ska skapa ny version eller omräkning." userEmail={admin.email} workspaceName={scope?.companyName} /><main className="p-8"><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Låsta perioder</h2><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Månad</th><th>Område</th><th>Status</th><th>Låst</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={String(row.id)}><td className="py-3">{fmt(row.billing_month)}</td><td>{fmt(row.lock_scope)}</td><td><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></td><td>{fmt(row.locked_at)}</td></tr>)}</tbody></table></div></section></main></div>
}
