import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { bulkQueueMissingMeterValuesAction } from '@/app/admin/cis/actions'
import { canQueueMissingMetering, loadBulkMeteringCoverage } from '@/lib/cis/bulkMeteringCoverage'
import { parseBillingMonth, previousStockholmBillingMonth } from '@/lib/time/stockholm'

export const dynamic = 'force-dynamic'

type PageProps = {
 searchParams: Promise<{
 period?: string
 ediel_environment?: string
 }>
}

function normalizePeriod(value: string | undefined): string {
 if (!value) return previousStockholmBillingMonth()
 try {
  return parseBillingMonth(value).value
 } catch {
  return previousStockholmBillingMonth()
 }
}

async function queueMissingMeterValuesFormAction(
 formData: FormData
): Promise<void> {
 'use server'
 await bulkQueueMissingMeterValuesAction(formData)
}

export default async function MissingMeterValuesPage({
 searchParams,
}: PageProps) {
 const context = await requireAdminPageKeyAccess('outbound.missing_meter_values')
 const tenantScope = await resolveAdminSelectedCompanyReadScope(context)
 const companyId = tenantScope.companyId

 const params = await searchParams
 const selectedPeriod = normalizePeriod(params.period)
 const selectedEnvironment = params.ediel_environment === 'production' ? 'production' : 'test'
 const explicitEnvironment = params.ediel_environment === 'production' || params.ediel_environment === 'test'
 const supabase = await createSupabaseServerClient()
 const { meteringPoints, coverage } = await loadBulkMeteringCoverage(supabase, companyId, selectedPeriod, selectedEnvironment)
 const eligible = meteringPoints.filter(point => canQueueMissingMetering(coverage.get(point.id)))
 const completeCount = meteringPoints.filter(point => coverage.get(point.id)?.status === 'complete').length

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Bulk: saknade mätvärden"
 subtitle="Köa periodspecifika mätvärdesförfrågningar utan att skapa dubbletter för samma månad."
 userEmail={context.email}
 />

 <div className="space-y-6 p-8">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <form className="grid gap-4 xl:grid-cols-[260px_210px_auto]">
 <input
 type="month"
 name="period"
 defaultValue={selectedPeriod}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 />
 <label>
 Ediel-miljö
 <select name="ediel_environment" defaultValue={selectedEnvironment}>
 <option value="test">Test</option>
 <option value="production">Produktion</option>
 </select>
 </label>
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white ">
 Visa period
 </button>
 </form>

 <div className="mt-6 grid gap-4 md:grid-cols-3">
 <div className="rounded-2xl bg-slate-50 px-4 py-4 ">
 <div className="text-sm text-slate-700 ">
 Totala mätpunkter
 </div>
 <div className="mt-2 text-2xl font-semibold text-slate-950 ">
 {meteringPoints.length}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-4 ">
 <div className="text-sm text-slate-700 ">
 Komplett period
 </div>
 <div className="mt-2 text-2xl font-semibold text-slate-950 ">
 {completeCount}
 </div>
 </div>

 <div className="rounded-2xl bg-amber-50 px-4 py-4 ">
 <div className="text-sm text-amber-700 ">
 Kan köas i vald miljö
 </div>
 <div className="mt-2 text-2xl font-semibold text-amber-900 ">
 {eligible.length}
 </div>
 </div>
 </div>

 <form action={queueMissingMeterValuesFormAction} className="mt-6">
 <input type="hidden" name="period_month" value={selectedPeriod} />
 <label>
 Ediel-miljö för köläggning
 <select name="ediel_environment" required defaultValue={explicitEnvironment ? selectedEnvironment : ''}>
 <option value="" disabled>Välj miljö</option>
 <option value="test">Test</option>
 <option value="production">Produktion</option>
 </select>
 </label>
 <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white ">
 Köa saknade mätvärden för {selectedPeriod}
 </button>
 </form>
 </section>

 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Förhandsvisning
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Aktuell mättäckning och befintliga begäranden för vald månad och miljö.
 </p>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="border-b border-slate-200 text-left ">
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Mätpunkt
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Site
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Nätägare
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Status
 </th>
 </tr>
 </thead>
 <tbody>
 {meteringPoints.length === 0 ? (
 <tr>
 <td
 colSpan={4}
 className="px-6 py-10 text-center text-sm text-slate-700 "
 >
 Det finns inga mätpunkter i urvalet.
 </td>
 </tr>
 ) : (
 meteringPoints.map((point) => (
 <tr
 key={point.id}
 className="border-b border-slate-100 "
 >
 <td className="px-6 py-4 text-slate-700 ">
 {point.meter_point_id}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {point.site_id}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {point.grid_owner_id ?? '—'}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {coverage.get(point.id)?.status === 'complete' ? 'Komplett'
  : coverage.get(point.id)?.request === 'existing' ? 'Redan köad'
  : !canQueueMissingMetering(coverage.get(point.id)) ? 'Kontrollera mätunderlag eller tidigare begäran'
  : coverage.get(point.id)?.status === 'partial' ? 'Delvis täckt' : 'Saknar värden'}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </section>
 </div>
 </div>
 )
}