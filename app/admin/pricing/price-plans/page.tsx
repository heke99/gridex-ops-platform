import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

export default async function PricePlansPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const plans = await safeListRows('price_plans', scope?.companyId ?? null, '*', 80)
  const versions = await safeListRows('price_plan_versions', scope?.companyId ?? null, '*', 80)

  return <div className="min-h-screen bg-slate-50"><AdminHeader title="Prisplaner" subtitle="Endast platform admin får skapa, ändra och publicera pris- och avtalslogik. Prisplaner är versionsstyrda så äldre kunder inte påverkas av nya ändringar." userEmail={admin.email} workspaceName={scope?.companyName} /><main className="space-y-6 p-8"><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Prisplaner</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{plans.map((plan) => <article key={String(plan.id)} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{fmt(plan.name)}</h3><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(plan.status)}`}>{fmt(plan.status)}</span></div><p className="mt-2 text-sm text-slate-600">{fmt(plan.pricing_model)}</p></article>)}</div></section><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Versioner</h2><div className="mt-4 text-sm text-slate-700">{versions.length} versioner registrerade.</div></section></main></div>
}
