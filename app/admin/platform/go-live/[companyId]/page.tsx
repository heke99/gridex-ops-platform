import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getActorTestingSummary } from '@/lib/ediel/actorTesting'
import { ActorCompanyIdentityCard, EvidencePackage, GoLiveChecklist } from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function PlatformGoLiveCompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const admin = await requirePlatformAdminAccess()
  const { companyId } = await params
  const summary = await getActorTestingSummary(companyId)

  if (!summary) {
    return <div className="p-8">Bolaget hittades inte.</div>
  }

  return (
    <div className="min-h-screen">
      <AdminHeader title={`Produktionssättning · ${summary.company.name}`} subtitle="Kontrollerad växling från testläge till live Ediel. Systemet blockerar live om route, BRP, eSett, mailbox eller tester saknas." userEmail={admin.email} workspaceMode="platform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/platform/go-live" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Alla go-live</Link>
          <Link href={`/admin/platform/actor-testing/${summary.company.id}`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Aktörstester</Link>
        </div>
        <ActorCompanyIdentityCard summary={summary} />
        <GoLiveChecklist summary={summary} canActivateLive />
        <EvidencePackage summary={summary} />
      </div>
    </div>
  )
}
