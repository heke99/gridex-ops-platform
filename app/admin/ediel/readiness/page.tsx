import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listActorTestingSummaries } from '@/lib/ediel/actorTesting'
import { ActorTestingCompanyTable, ActorTestingStats } from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function EdielReadinessPage() {
  const admin = await requirePlatformAdminAccess()
  const summaries = await listActorTestingSummaries({ scope: 'platform' })
  const missingActorProfiles = summaries.filter((summary) => !summary.hasActiveActorProfile).length
  const routeBlockers = summaries.filter((summary) => summary.routeValidationIssues.length > 0 || !summary.hasTestRoute).length
  const productionReady = summaries.filter((summary) => summary.productionReadiness === 'ready' || summary.productionReadiness === 'live').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel readiness"
        subtitle="Superadmin-vy for actor profiles, AGT/TGT-status, route health och production readiness."
        userEmail={admin.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Readiness control</p>
              <h1 className="mt-2 text-2xl font-black text-slate-950">Tenant readiness over test och production</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Samma sammanfattning som aktor- och go-live-modulerna, samlad under Ediel Control Tower for superadmin.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-black">
              <Link href="/admin/ediel/test-center" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">Test Center</Link>
              <Link href="/admin/ediel/go-live" className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-slate-800">Go-live</Link>
            </div>
          </div>
        </section>

        <ActorTestingStats summaries={summaries} />

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
            <p className="text-sm font-semibold">Saknar aktiv actor profile</p>
            <p className="mt-2 text-3xl font-black">{missingActorProfiles}</p>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm">
            <p className="text-sm font-semibold">Route/test blockerare</p>
            <p className="mt-2 text-3xl font-black">{routeBlockers}</p>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 shadow-sm">
            <p className="text-sm font-semibold">Production ready/live</p>
            <p className="mt-2 text-3xl font-black">{productionReady}</p>
          </div>
        </section>

        <ActorTestingCompanyTable summaries={summaries} basePath="/admin/platform/actor-testing" />
      </main>
    </div>
  )
}
