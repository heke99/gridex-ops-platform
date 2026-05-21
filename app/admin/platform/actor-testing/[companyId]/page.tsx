import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getActorTestingSummary } from '@/lib/ediel/actorTesting'
import {
  ActorCompanyIdentityCard,
  ActorTestPackageCards,
  EvidencePackage,
  GoLiveChecklist,
} from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function PlatformActorTestingCompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const admin = await requirePlatformAdminAccess()
  const { companyId } = await params
  const summary = await getActorTestingSummary(companyId)

  if (!summary) {
    return (
      <div className="p-8">
        <Link href="/admin/platform/actor-testing" className="text-sm font-semibold text-emerald-800 hover:underline">Till aktörstester</Link>
        <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">Bolaget hittades inte.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Aktörstester · ${summary.company.name}`}
        subtitle="Bolagskort, testpaket, bevispaket och produktionsspärrar för ett specifikt elhandelsbolag."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/platform/actor-testing" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Alla aktörstester</Link>
          <Link href={`/admin/platform/go-live/${summary.company.id}`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Produktionssättning</Link>
          <Link href={`/admin/companies/${summary.company.id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Bolagsöversikt</Link>
        </div>
        <ActorCompanyIdentityCard summary={summary} />
        <ActorTestPackageCards summary={summary} />
        <EvidencePackage summary={summary} />
        <GoLiveChecklist summary={summary} canActivateLive />
      </div>
    </div>
  )
}
