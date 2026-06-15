import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getGridOwnerById, listGridOwners } from '@/lib/masterdata/db'
import GridOwnerForm from '@/components/admin/masterdata/GridOwnerForm'
import GridOwnersTable from '@/components/admin/masterdata/GridOwnersTable'
import ActorRegistryImportPanel, { type ImportRunRow } from '@/components/admin/masterdata/ActorRegistryImportPanel'
import {
  backfillGridOwnerVerificationAction,
  completeGridOwnerReadinessAction,
  refreshGridOwnerCertificatesAction,
  searchGridOwnerCertificateNowAction,
} from './actions'

export const dynamic = 'force-dynamic'

type NetworkOwnersPageProps = {
 searchParams?: Promise<{
 edit?: string
 }>
}


function labelOrDash(value?: string | null) {
  return value && value.trim().length > 0 ? value : '—'
}

function DetailReadinessPill({ ready, label }: { ready?: boolean | null; label: string }) {
  return (
    <span className={[
      'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
      ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700',
    ].join(' ')}>
      {label}: {ready ? 'Klar' : 'Inte klar'}
    </span>
  )
}

function GridOwnerTechnicalActionPanel({ owner }: { owner: Awaited<ReturnType<typeof listGridOwners>>[number] }) {
  return (
    <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 text-sm shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Teknisk verifiering</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">Vald nätägare</h2>
        <p className="mt-2 text-slate-700">
          Kör certifikatsökning för just den här nätägaren. Det här är rätt flöde när en enskild nätägare saknar PRODAT-certifikat.
        </p>
      </div>

      <dl className="mt-4 grid gap-2 text-xs text-slate-700">
        <div className="flex justify-between gap-3"><dt>Namn</dt><dd className="text-right font-medium text-slate-950">{owner.name}</dd></div>
        <div className="flex justify-between gap-3"><dt>EDIEL-id</dt><dd className="text-right font-medium text-slate-950">{labelOrDash(owner.ediel_id)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Platform actor</dt><dd className="max-w-[180px] truncate text-right font-medium text-slate-950">{labelOrDash(owner.platform_market_actor_id)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Certifikat</dt><dd className="text-right font-medium text-slate-950">{labelOrDash(owner.certificate_status)}</dd></div>
        <div className="flex justify-between gap-3"><dt>PRODAT-route</dt><dd className="text-right font-medium text-slate-950">{owner.prodat_route_count ?? 0}</dd></div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <DetailReadinessPill ready={owner.can_use_for_prodat} label="PRODAT" />
        <DetailReadinessPill ready={owner.can_use_for_utilts} label="UTILTS" />
        <DetailReadinessPill ready={owner.can_start_supplier_switch} label="Leverantörsbyte" />
      </div>

      <form action={searchGridOwnerCertificateNowAction} className="mt-5">
        <input type="hidden" name="grid_owner_id" value={owner.id} />
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center rounded-2xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-800"
        >
          Sök certifikat nu för vald nätägare
        </button>
      </form>

      <p className="mt-3 text-xs leading-5 text-indigo-900">
        Sökningen markerar inte nätägaren som klar om certifikat saknas, är utgånget, har fel miljö eller inte matchar aktören. Då ska felet ligga kvar som åtgärd/review.
      </p>
    </section>
  )
}

export default async function NetworkOwnersPage({
 searchParams,
}: NetworkOwnersPageProps) {
 await requirePlatformAdminAccess()

 const supabase = await createSupabaseServerClient()
 const params = await searchParams
 const editId = params?.edit

 const [gridOwners, editingGridOwner, importRunsResult] = await Promise.all([
 listGridOwners(supabase),
 editId ? getGridOwnerById(supabase, editId) : Promise.resolve(null),
 supabase
   .from('actor_registry_import_runs')
   .select('id,source_filename,status,total_records,created_count,updated_count,unchanged_count,conflict_count,error_count,started_at,finished_at')
   .order('started_at', { ascending: false })
   .limit(5),
 ])

 const importRuns = importRunsResult.error ? [] : ((importRunsResult.data ?? []) as ImportRunRow[])

 const activeCount = gridOwners.filter((owner) => owner.is_active).length
 const verifiedCount = gridOwners.filter((owner) => owner.verification_status === 'verified' || owner.verified_for_customer_flow === true).length
 const needsReviewCount = gridOwners.filter((owner) => owner.verification_status && owner.verification_status !== 'verified').length

 return (
 <div className="space-y-6">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
 <div>
 <p className="text-sm font-medium text-slate-700 ">
 Masterdata
 </p>
 <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 ">
 Nätägare
 </h1>
 <p className="mt-2 max-w-3xl text-sm text-slate-700 ">
 Hantera register över nätägare med kod, EDIEL-id, org.nr och kontaktuppgifter.
 Dessa används av kundkort, anläggningar, mätpunkter och leverantörsbyte.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/network-owners"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Ny nätägare
 </Link>
 <form action={backfillGridOwnerVerificationAction}>
 <button
 type="submit"
 className="inline-flex items-center rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
 >
 Kontrollera nätägare
 </button>
 </form>
 <form action={completeGridOwnerReadinessAction}>
 <button
 type="submit"
 className="inline-flex items-center rounded-2xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-800 hover:bg-sky-100"
 >
 Komplettera readiness
 </button>
 </form>
 <form action={refreshGridOwnerCertificatesAction}>
 <button
 type="submit"
 className="inline-flex items-center rounded-2xl border border-indigo-300 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
 >
 Hämta certifikat
 </button>
 </form>
 <Link
 href="/admin/customers"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Till kunder
 </Link>
 </div>
 </div>

 <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Antal nätägare</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {gridOwners.length}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Aktiva</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {activeCount}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Verifierade</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {verifiedCount}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Behöver åtgärd</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {needsReviewCount}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Redigeringsläge</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {editingGridOwner ? editingGridOwner.name : 'Nej'}
 </div>
 </div>
 </div>
 </section>

 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950 shadow-sm">
 <h2 className="text-lg font-semibold text-slate-950">Endast platform/teknisk admin ändrar nätägare</h2>
 <p className="mt-2">Tenant-admins ska välja verifierade aktörer i kundflöden. Tekniska fält som Ediel-id, subadress, certifikat, transportkanal och produktions-/testmiljö ska hanteras centralt så att ett elbolag inte råkar skapa felaktig route eller osäker mottagare.</p>
 <p className="mt-2">Batch O2 fyller bara subadress automatiskt när exakt en säker subadress finns i aktörsregistret. Saknas subadress eller certifikat visas det som åtgärd, inte som gissning.</p>
 </section>

 <ActorRegistryImportPanel importRuns={importRuns} />

 <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
 <div className="space-y-6">
 <GridOwnerForm gridOwner={editingGridOwner} />
 {editingGridOwner ? (
 <GridOwnerTechnicalActionPanel owner={gridOwners.find((owner) => owner.id === editingGridOwner.id) ?? editingGridOwner} />
 ) : null}
 </div>
 <GridOwnersTable gridOwners={gridOwners} />
 </div>
 </div>
 )
}