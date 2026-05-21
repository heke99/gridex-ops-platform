import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { listActorTestingSummaries, listWhiteLabelPlatformIdsForUser } from '@/lib/ediel/actorTesting'
import { ActorTestingCompanyTable, ActorTestingStats } from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function WhiteLabelGoLivePage() {
  const admin = await requireAdminPageAccess({ anyOf: ['whitelabel.read'] })
  const platformIds = await listWhiteLabelPlatformIdsForUser(admin.userId)
  const summaries = platformIds.length === 0
    ? []
    : (await Promise.all(platformIds.map((whiteLabelPlatformId) => listActorTestingSummaries({ scope: 'whitelabel', whiteLabelPlatformId })))).flat()

  return (
    <div className="min-h-screen">
      <AdminHeader title="Produktionsstatus" subtitle="White-label-vy för go-live-status. Slutlig live-aktivering görs av superadmin." userEmail={admin.email} workspaceName="Min plattform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <ActorTestingStats summaries={summaries} />
        <ActorTestingCompanyTable summaries={summaries} basePath="/admin/whitelabel/actor-testing" />
      </div>
    </div>
  )
}
