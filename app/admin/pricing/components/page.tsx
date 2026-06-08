import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

export default async function ComponentsPage() {
  const admin = await requireAdminPageKeyAccess('pricing.engine')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const components = await safeListRows('price_components', scope?.companyId ?? null, '*', 120)
  const base = await safeListRows('base_price_components', scope?.companyId ?? null, '*', 120)

  return <div className="min-h-screen bg-slate-50"><AdminHeader title="Priskomponenter" subtitle="Här visas baspriskällor och bolagets egna fakturarader: påslag, fakturaavgift, grön el, elcertifikat och rabatter." userEmail={admin.email} workspaceName={scope?.companyName} /><main className="grid gap-6 p-8 xl:grid-cols-2"><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Baspriskällor</h2><div className="mt-4 grid gap-3">{base.map((row) => <div key={String(row.id)} className="rounded-2xl border p-4"><div className="font-semibold">{fmt(row.source_type)} · {fmt(row.weight_percent)} %</div><div className="mt-1 text-sm text-slate-600">Fastpris {fmt(row.fixed_price_sek_per_kwh)} kr/kWh</div></div>)}</div></section><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Fakturarader</h2><div className="mt-4 grid gap-3">{components.map((row) => <div key={String(row.id)} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><div className="font-semibold">{fmt(row.name)}</div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></div><div className="mt-1 text-sm text-slate-600">{fmt(row.component_type)} · {fmt(row.amount)} {fmt(row.unit)}</div></div>)}</div></section></main></div>
}
