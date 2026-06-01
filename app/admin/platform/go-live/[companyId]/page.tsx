import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getActorTestingSummary } from '@/lib/ediel/actorTesting'
import { ActorCompanyIdentityCard,
  ActorProfileGuide, EvidencePackage } from '@/components/admin/ediel/ActorTestingViews'
import { getCompanyProductionReadiness } from '@/lib/ediel/productionReadiness'
import { ProductionReadinessPanel } from '@/components/admin/ediel/ProductionReadinessViews'

export const dynamic = 'force-dynamic'

export default async function PlatformGoLiveCompanyPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams?: Promise<{ status?: string; message?: string }> }) {
  const admin = await requirePlatformAdminAccess()
  const { companyId } = await params
  const notice = searchParams ? await searchParams : {}
  const [summary, readiness] = await Promise.all([
    getActorTestingSummary(companyId),
    getCompanyProductionReadiness(companyId),
  ])

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
          <Link href={`/admin/platform/go-live/${summary.company.id}/route-wizard`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Production route-wizard</Link>
        </div>
        {notice?.message ? (
          <div className={`rounded-3xl border p-5 text-sm font-semibold ${notice.status === 'live' || notice.status === 'prepared' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : notice.status === 'blocked' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            {notice.message}
          </div>
        ) : null}
        <ActorCompanyIdentityCard summary={summary} />
        <ProductionReadinessPanel readiness={readiness} returnPath={`/admin/platform/go-live/${summary.company.id}`} canManageProduction />
        <ActorProfileGuide summary={summary} />
        <EvidencePackage summary={summary} />
      </div>
    </div>
  )
}
