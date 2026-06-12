import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  facilityMissingFieldLabel,
  facilityStatusLabel,
  listFacilityWorkQueue,
  type FacilityWorkQueuePriority,
  type FacilityWorkQueueRow,
  type FacilityWorkQueueStatus,
} from '@/lib/facility/workQueue'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return '—'
  }
}

function priorityTone(priority: FacilityWorkQueuePriority): string {
  if (priority === 'critical') return 'border-red-200 bg-red-50 text-red-800'
  if (priority === 'high') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (priority === 'low') return 'border-slate-200 bg-slate-50 text-slate-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

function statusTone(status: FacilityWorkQueueStatus): string {
  if (status === 'ready_for_switch') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'awaiting_grid_owner') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (status === 'needs_facility_data') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-red-200 bg-red-50 text-red-800'
}

function StatCard({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-bold text-slate-700">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <h3 className="text-lg font-bold text-slate-950">Ingen anläggningskö hittades</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Det betyder att synliga kunder antingen saknar anläggningar helt eller att anläggningsuppgifterna inte har några aktiva blockerare. Skapa kund/anläggning via kundintag eller öppna kundregistret för manuell kontroll.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/admin/customers" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">Öppna kundregister</Link>
        <Link href="/admin/customers/intake" className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">Skapa kund</Link>
      </div>
    </div>
  )
}

function FacilityRow({ item }: { item: FacilityWorkQueueRow }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-6 py-4 align-top">
        <div className="font-bold text-slate-950">{item.customerLabel}</div>
        <div className="mt-1 text-xs text-slate-500">{item.customerNumber ?? 'Utan kundnummer'}</div>
      </td>
      <td className="px-6 py-4 align-top">
        <div className="font-semibold text-slate-950">{item.siteLabel}</div>
        <div className="mt-1 text-xs leading-5 text-slate-600">
          Anläggnings-ID: {item.facilityId ?? 'saknas'} · Mätpunkt: {item.meteringPointLabel ?? 'saknas'}
        </div>
        <div className="mt-1 text-xs leading-5 text-slate-600">
          Nätägare: {item.gridOwnerName ?? 'saknas'} · Elområde: {item.priceAreaCode ?? 'saknas'}
        </div>
      </td>
      <td className="px-6 py-4 align-top">
        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${statusTone(item.status)}`}>
          {facilityStatusLabel(item.status)}
        </span>
        <p className="mt-2 max-w-xl text-xs leading-5 text-slate-600">{item.description}</p>
      </td>
      <td className="px-6 py-4 align-top">
        {item.missingFields.length > 0 ? (
          <div className="flex max-w-sm flex-wrap gap-2">
            {item.missingFields.map((field) => (
              <span key={field} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">
                {facilityMissingFieldLabel(field)}
              </span>
            ))}
          </div>
        ) : (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Komplett</span>
        )}
      </td>
      <td className="px-6 py-4 align-top">
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${priorityTone(item.priority)}`}>{item.priority}</span>
        <div className="mt-2 text-xs text-slate-500">Uppdaterad {formatDate(item.updatedAt ?? item.createdAt)}</div>
      </td>
      <td className="px-6 py-4 align-top">
        <Link href={item.href} className="inline-flex rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
          {item.nextAction}
        </Link>
      </td>
    </tr>
  )
}

export default async function FacilityRequestsPage() {
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const companyScope = await getOperationalCompanyScope(context.userId)
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyId = isPlatformAdmin ? null : companyScope.companyId
  const supabase = await createSupabaseServerClient()
  const queue = await listFacilityWorkQueue(supabase, companyId, { limit: 250 })

  const missingAuthorization = queue.filter((item) => item.status === 'missing_authorization').length
  const needsFacilityData = queue.filter((item) => item.status === 'needs_facility_data').length
  const needsGridOwnerReview = queue.filter((item) => item.status === 'needs_grid_owner_review').length
  const awaitingGridOwner = queue.filter((item) => item.status === 'awaiting_grid_owner').length
  const readyForSwitch = queue.filter((item) => item.status === 'ready_for_switch').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Anläggningsuppgifter"
        subtitle="Kö för kunder där anläggnings-ID, mätpunkt, nätägare, elområde eller fullmakt behöver kompletteras innan leverantörsbyte."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-6 p-6 lg:p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950 shadow-sm">
          <div className="font-bold">Affärsregel</div>
          <p className="mt-1 leading-6">
            Adress och postnummer får användas som förslag. Verifierad sanning är nätområdeskod, anläggnings-ID, mätpunkt eller bekräftelse från nätägare. Systemet får inte starta leverantörsbyte när kritiska anläggningsuppgifter saknas.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Saknar fullmakt" value={missingAuthorization} description="Utskick stoppas tills signerad fullmakt finns." />
          <StatCard label="Saknar uppgifter" value={needsFacilityData} description="Anläggnings-ID, mätpunkt eller elområde saknas." />
          <StatCard label="Nätägare behöver verifieras" value={needsGridOwnerReview} description="Resolver-förslag räcker inte för switch." />
          <StatCard label="Väntar nätägare" value={awaitingGridOwner} description="Begäran är skickad eller köad." />
          <StatCard label="Redo" value={readyForSwitch} description="Kan fortsätta mot leverantörsbyte." />
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Facility-arbetskö</h2>
                <p className="mt-1 text-sm text-slate-600">Visar bara kundkopplade anläggningar med aktiv brist, väntande nätägarsvar eller nästa åtgärd.</p>
              </div>
              <Link href="/admin/work-queue" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
                Öppna hela arbetskön
              </Link>
            </div>
          </div>

          {queue.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-6 py-4">Kund</th>
                    <th className="px-6 py-4">Anläggning</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Saknas</th>
                    <th className="px-6 py-4">Prioritet</th>
                    <th className="px-6 py-4">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {queue.map((item) => (
                    <FacilityRow key={`${item.id}-${item.status}`} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
