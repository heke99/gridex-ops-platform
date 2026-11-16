import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listActorTestingSummaries } from '@/lib/ediel/actorTesting'
import { ActorTestingCompanyTable, ActorTestingStats } from '@/components/admin/ediel/ActorTestingViews'
import { listPlatformGoLiveSetupSummaries } from '@/lib/ediel/platformGoLive'
import { GoLiveSetupOverview } from '@/components/admin/ediel/GoLiveSetupViews'

export const dynamic = 'force-dynamic'

export default async function PlatformGoLivePage() {
  const admin = await requirePlatformAdminAccess()
  const [summaries, goLiveSummaries] = await Promise.all([
    listActorTestingSummaries({ scope: 'platform' }),
    listPlatformGoLiveSetupSummaries(),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Produktionssättning"
        subtitle="Superadmin-vy för go-live. Här ska test och produktion hållas separerade, live-spärrar visas tydligt och slutlig aktivering kräver bekräftelse."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <GoLiveSetupOverview summaries={goLiveSummaries} />
        <ActorTestingStats summaries={summaries} />
        <ActorTestingCompanyTable summaries={summaries} basePath="/admin/platform/go-live" />
      </div>
    </div>
  )
}
