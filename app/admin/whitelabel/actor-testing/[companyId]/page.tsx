import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { getActorTestingSummary, userCanManageActorTestingForCompany } from '@/lib/ediel/actorTesting'
import { ActorCompanyIdentityCard,
  ActorProfileGuide, ActorTestPackageCards, EvidencePackage, GoLiveChecklist } from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function WhiteLabelActorTestingCompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const admin = await requireAdminPageAccess({ anyOf: ['whitelabel.read'] })
  const { companyId } = await params
  const allowed = await userCanManageActorTestingForCompany(admin.userId, companyId, false)
  const summary = allowed ? await getActorTestingSummary(companyId) : null

  if (!summary) return <div className="p-8">Bolaget hittades inte eller ligger utanför din white-label-plattform.</div>

  return (
    <div className="min-h-screen">
      <AdminHeader title={`Aktörstester · ${summary.company.name}`} subtitle="White-label admin kan hantera tester för egna bolag, men slutlig live-aktivering kräver superadmin." userEmail={admin.email} workspaceName="Min plattform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <Link href="/admin/whitelabel/actor-testing" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Tillbaka</Link>
        <ActorCompanyIdentityCard summary={summary} />
        <ActorProfileGuide summary={summary} />
        <ActorTestPackageCards summary={summary} />
        <EvidencePackage summary={summary} basePath="/admin/whitelabel/actor-testing" />
        <GoLiveChecklist summary={summary} canActivateLive={false} returnPath={`/admin/whitelabel/actor-testing/${summary.company.id}`} />
      </div>
    </div>
  )
}
