import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listActorTestingSummaries } from '@/lib/ediel/actorTesting'
import { ActorTestingCompanyTable, ActorTestingStats } from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function PlatformActorTestingPage() {
  const admin = await requirePlatformAdminAccess()
  const summaries = await listActorTestingSummaries({ scope: 'platform' })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Aktörstester"
        subtitle="Superadmin-vy för alla bolag. Varje tenant har egen aktörsprofil, egen teststatus, egna bevis och egen go-live spärr."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <ActorTestingStats summaries={summaries} />
        <ActorTestingCompanyTable summaries={summaries} basePath="/admin/platform/actor-testing" />
      </div>
    </div>
  )
}
