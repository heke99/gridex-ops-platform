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

  return <div className="min-h-screen bg-slate-50"><AdminHeader title="Kampanjer" subtitle="Endast platform admin får skapa, ändra och publicera pris- och avtalslogik. Kampanjer är versionsstyrda och sparas i kundens avtalssnapshot när kunden tecknar." userEmail={admin.email} workspaceName={scope?.companyName} /><main className="space-y-4 p-4 lg:p-6"><section className="rounded-2xl border bg-white p-4"><h2 className="text-lg font-semibold">Kampanjer</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{campaigns.map((campaign) => <article key={String(campaign.id)} className="min-w-0 break-words rounded-2xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{fmt(campaign.name)}</h3><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(campaign.status)}`}>{fmt(campaign.status)}</span></div><details className="mt-2 text-sm text-slate-600"><summary className="cursor-pointer font-medium">Beskrivning</summary><p className="mt-2 whitespace-pre-wrap">{fmt(campaign.description)}</p></details></article>)}</div></section><p className="rounded-2xl border bg-white p-4 text-sm text-slate-700">Kampanjversioner: <strong className="text-slate-950">{versions.length}</strong></p></main></div>
}
