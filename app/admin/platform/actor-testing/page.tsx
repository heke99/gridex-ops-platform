import Link from 'next/link'
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
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/platform/work-queue" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Plattformsarbetskö</Link>
          <Link href="/admin/platform/usage" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Usage-statistik</Link>
          <Link href="/admin/platform/go-live" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Produktionssättning</Link>
        </div>
        <ActorTestingStats summaries={summaries} />
        <ActorTestingCompanyTable summaries={summaries} basePath="/admin/platform/actor-testing" />
      </div>
    </div>
  )
}
