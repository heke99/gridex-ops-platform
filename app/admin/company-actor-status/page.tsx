import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getActorTestingSummary } from '@/lib/ediel/actorTesting'
import { ActorCompanyIdentityCard, ActorTestPackageCards, GoLiveChecklist } from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function CompanyActorStatusPage() {
  const admin = await requireAdminPageAccess({ anyOf: ['communication.read', 'users.read'] })
  const scope = await getOperationalCompanyScope(admin.userId)
  const summary = scope.companyId ? await getActorTestingSummary(scope.companyId) : null

  return (
    <div className="min-h-screen">
      <AdminHeader title="Aktörsstatus" subtitle="Bolagets egen översikt över aktörstest och produktionsstatus. Tekniska AGT-verktyg visas inte här." userEmail={admin.email} workspaceName={scope.companyName} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        {!summary ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">Kontot saknar aktiv bolagskoppling eller aktörsprofilen är inte skapad ännu.</div>
        ) : (
          <>
            <ActorCompanyIdentityCard summary={summary} />
            <ActorTestPackageCards summary={summary} readonly />
            <GoLiveChecklist summary={summary} canActivateLive={false} returnPath="/admin/company-actor-status" />
          </>
        )}
      </div>
    </div>
  )
}
