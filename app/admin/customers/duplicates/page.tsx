import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listDuplicateCustomerGroups } from '@/lib/customers/duplicates'

export const dynamic = 'force-dynamic'

function customerName(row: { full_name: string | null; first_name: string | null; last_name: string | null; company_name: string | null; email: string | null }) {
  return row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.company_name || row.email || 'Kund'
}

export default async function CustomerDuplicatesPage() {
  const admin = await requireAdminPageKeyAccess('customers.list')
  const scope = await resolveAdminTenantReadScope(admin)
  const groups = await listDuplicateCustomerGroups(scope.companyId)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Dubblett- och mergekontroll"
        subtitle="Visar möjliga dubbletter från manuell registrering, bulk/PDF och externa intag. Slå inte ihop data automatiskt; granska först och koppla ny anläggning till rätt kund."
        userEmail={admin.email}
        workspaceName={scope.isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
        workspaceMode={scope.isPlatformAdmin ? 'platform' : 'tenant'}
      />
      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Möjliga dubbletter</h2>
              <p className="mt-1 text-sm text-slate-700">Systemet föreslår grupper utifrån e-post, personnummer, organisationsnummer och namn inom rätt tenant.</p>
            </div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">{groups.length} grupper</span>
          </div>
        </section>

        {groups.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">Inga tydliga dubbletter hittades i valt bolag.</section>
        ) : (
          <section className="grid gap-4 xl:grid-cols-2">
            {groups.map((group) => (
              <article key={`${group.reason}-${group.groupKey}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">{group.reason}</h3>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{group.candidates.length} kunder</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">Nyckel: {group.groupKey}</p>
                <div className="mt-4 space-y-3">
                  {group.candidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="font-semibold text-slate-950">{customerName(candidate)}</div>
                      <div className="mt-1 grid gap-1 text-xs text-slate-600">
                        <div>Kundnr: {candidate.customer_number ?? '—'}</div>
                        <div>E-post: {candidate.email ?? '—'}</div>
                        <div>ID/orgnr: {candidate.personal_number ?? candidate.org_number ?? '—'}</div>
                      </div>
                      <Link href={`/admin/customers/${candidate.id}`} className="mt-3 inline-flex rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Öppna kundkort</Link>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  Rekommenderad åtgärd: välj huvudkund, koppla eventuell ny anläggning/mätpunkt till huvudkunden och stäng eller markera den andra som separat. Hård merge ska alltid göras manuellt med audit.
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
