import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

export default async function CampaignsPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const campaigns = await safeListRows('campaigns', scope?.companyId ?? null, '*', 80)
  const versions = await safeListRows('campaign_versions', scope?.companyId ?? null, '*', 80)

  return <div className="min-h-screen bg-slate-50"><AdminHeader title="Kampanjer" subtitle="Endast platform admin får skapa, ändra och publicera pris- och avtalslogik. Kampanjer är versionsstyrda och sparas i kundens avtalssnapshot när kunden tecknar." userEmail={admin.email} workspaceName={scope?.companyName} /><main className="space-y-6 p-8"><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Kampanjer</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{campaigns.map((campaign) => <article key={String(campaign.id)} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{fmt(campaign.name)}</h3><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(campaign.status)}`}>{fmt(campaign.status)}</span></div><p className="mt-2 text-sm text-slate-600">{fmt(campaign.description)}</p></article>)}</div></section><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Kampanjversioner</h2><div className="mt-4 text-sm text-slate-700">{versions.length} versioner registrerade.</div></section></main></div>
}
