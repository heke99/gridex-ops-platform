import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import {
  getCompanyById,
  getCompanyGovernanceSummary,
  getCompanyStatusCopy,
  normalizeCompanyStatus,
  type GovernanceCompany,
} from '@/lib/tenant/governance'
import { getActorTestingSummary, getActorTestingStatusLabel, getProductionReadinessLabel } from '@/lib/ediel/actorTesting'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="truncate text-sm font-semibold text-slate-600">{label}</p>
      <p className="mt-2 break-words text-3xl font-black text-slate-950">{value}</p>
      {hint ? <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{hint}</p> : null}
    </div>
  )
}

function statusBadge(company: GovernanceCompany) {
  const copy = getCompanyStatusCopy(company.status)
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>{copy.label}</span>
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdminAccess()
  const { id } = await params
  const row = await getCompanyById(id)

  if (!row) {
    return (
      <div className="space-y-6 p-8">
        <Link href="/admin/companies" className="text-sm font-semibold text-emerald-800 hover:text-emerald-900">Tillbaka till bolag</Link>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">Bolaget hittades inte.</div>
      </div>
    )
  }

  const company = await getCompanyGovernanceSummary(row)
  const actorSummary = await getActorTestingSummary(row.id)
  const status = normalizeCompanyStatus(company.status)
  const copy = getCompanyStatusCopy(status)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Bolagsöversikt · ${company.name}`}
        subtitle="Platform-only statistik för drift, volymer och framtida faktureringsunderlag."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/companies" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Tillbaka till bolag
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(company)}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{company.org_number ?? 'Orgnummer saknas'}</span>
          </div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <h2 className="break-words text-2xl font-black text-slate-950">{company.name}</h2>
              <p className="mt-2 break-all text-sm text-slate-600">Tenant ID: {company.id}</p>
              <p className="mt-4 max-w-4xl text-sm font-semibold leading-6 text-slate-700">{copy.description}</p>
              {company.status_reason ? <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Senaste anledning: {company.status_reason}</p> : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <p><strong>Kontakt:</strong> {company.primary_contact_name ?? '–'}</p>
              <p><strong>E-post:</strong> {company.primary_contact_email ?? '–'}</p>
              <p><strong>Telefon:</strong> {company.phone ?? '–'}</p>
              <p><strong>Webb:</strong> {company.website ?? '–'}</p>
              <p><strong>Skapad:</strong> {formatDate(company.created_at)}</p>
            </div>
          </div>
        </section>

        {actorSummary ? (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Aktörstester</div>
              <h2 className="mt-2 text-xl font-black text-emerald-950">{getActorTestingStatusLabel(actorSummary.actorTestStatus)}</h2>
              <p className="mt-2 text-sm leading-6 text-emerald-800">PRODAT: {actorSummary.prodatPassed}/{actorSummary.prodatTotal} godkända · UTILTS: {actorSummary.utiltsPassed}/{actorSummary.utiltsTotal} godkända.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/admin/platform/actor-testing/${company.id}`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Öppna tester</Link>
                <Link href={`/admin/platform/actor-testing/${company.id}/evidence`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Bevispaket</Link>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Produktionssättning</div>
              <h2 className="mt-2 text-xl font-black text-slate-950">{getProductionReadinessLabel(actorSummary.productionReadiness)}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-700">BRP: {actorSummary.company.brp_status ?? '–'} · Routes: {actorSummary.hasProductionRoute ? 'Klara' : 'Saknas'} · Mailbox: {actorSummary.hasVerifiedMailbox ? 'Verifierad' : 'Saknas'}.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/admin/platform/go-live/${company.id}`} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Öppna go-live checklista</Link>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Aktiva användare" value={company.activeUsers} />
          <StatCard label="Väntande invites" value={company.pendingInvites} />
          <StatCard label="Kunder" value={company.customers} />
          <StatCard label="Avtal" value={company.contracts} />
          <StatCard label="Ediel-meddelanden" value={company.edielMessages} />
          <StatCard label="Mätvärden" value={company.meteringValues} />
          <StatCard label="Faktureringsunderlag" value={company.billingUnderlays} />
          <StatCard label="Partnerexporter" value={company.partnerExports} />
          <StatCard label="Outbound requests" value={company.outboundRequests} />
          <StatCard label="Blockerade underlag" value={company.blockedBillingUnderlays} />
          <StatCard label="Senaste audit" value={formatDate(company.latestAuditAt)} />
          <StatCard label="Senaste Ediel" value={formatDate(company.latestEdielAt)} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-orange-200 bg-orange-50 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-orange-950">Blockerare</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-orange-800">
              {company.missingEdielProfile ? <li>Saknar aktiv Ediel-aktörsprofil.</li> : null}
              {company.blockedBillingUnderlays > 0 ? <li>{company.blockedBillingUnderlays} faktureringsunderlag är inte exportklara.</li> : null}
              {company.deleteBlockers.length > 0 ? <li>Hård radering blockeras av historik.</li> : null}
              {!company.missingEdielProfile && company.blockedBillingUnderlays === 0 && company.deleteBlockers.length === 0 ? <li>Inga kritiska blockerare.</li> : null}
            </ul>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Raderingskontroll</h2>
            {company.canHardDelete ? (
              <p className="mt-3 text-sm leading-6 text-slate-700">Bolaget saknar historiska kopplingar och kan raderas som test-/felregistrering.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                {company.deleteBlockers.map((blocker) => (
                  <li key={blocker.table}>{blocker.label}: <strong>{blocker.count}</strong></li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
