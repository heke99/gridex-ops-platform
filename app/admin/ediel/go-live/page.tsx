import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listActorTestingSummaries } from '@/lib/ediel/actorTesting'
import { ActorTestingCompanyTable, ActorTestingStats } from '@/components/admin/ediel/ActorTestingViews'

export const dynamic = 'force-dynamic'

export default async function EdielGoLivePage() {
  const admin = await requirePlatformAdminAccess()
  const summaries = await listActorTestingSummaries({ scope: 'platform' })
  const live = summaries.filter((summary) => summary.productionReadiness === 'live')
  const ready = summaries.filter((summary) => summary.productionReadiness === 'ready')
  const blocked = summaries.filter((summary) => summary.goLiveBlockers.length > 0 || summary.productionReadiness === 'blocked')

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel go-live"
        subtitle="Production readiness, first-live-send approval och live-blockerare per tenant."
        userEmail={admin.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Production control</p>
              <h1 className="mt-2 text-2xl font-black text-slate-950">Go-live styrning for Ediel</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Live-send aktiveras via befintlig production readiness-panel per bolag. Den har fortsatt dry-run som standard och kraver explicit superadmin-bekraftelse for production.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-black">
              <Link href="/admin/platform/go-live" className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-slate-800">Platform go-live</Link>
              <Link href="/admin/ediel/readiness" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">Readiness</Link>
            </div>
          </div>
        </section>

        <ActorTestingStats summaries={summaries} />

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 shadow-sm">
            <p className="text-sm font-semibold">Live i production</p>
            <p className="mt-2 text-3xl font-black">{live.length}</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
            <p className="text-sm font-semibold">Redo for aktivering</p>
            <p className="mt-2 text-3xl font-black">{ready.length}</p>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm">
            <p className="text-sm font-semibold">Blockerade</p>
            <p className="mt-2 text-3xl font-black">{blocked.length}</p>
          </div>
        </section>

        <ActorTestingCompanyTable summaries={summaries} basePath="/admin/platform/go-live" />
      </main>
    </div>
  )
}
