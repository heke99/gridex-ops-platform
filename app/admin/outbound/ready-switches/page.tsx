import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
 bulkQueueReadySupplierSwitchesAction,
 queueSupplierSwitchOutboundAction,
} from '@/app/admin/cis/actions'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'
import { listOutboundRequests } from '@/lib/cis/db'

export const dynamic = 'force-dynamic'

async function bulkQueueReadySupplierSwitchesFormAction(
 _: FormData
): Promise<void> {
 'use server'
 await bulkQueueReadySupplierSwitchesAction()
}

export default async function ReadySwitchesPage() {
 await requirePermissionServer('switching.read')

 const supabase = await createSupabaseServerClient()
 const {
 data: { user },
 } = await supabase.auth.getUser()

 const [requests, outboundRequests] = await Promise.all([
 listAllSupplierSwitchRequests(supabase, {
 status: 'all',
 requestType: 'all',
 query: '',
 }),
 listOutboundRequests({
 status: 'all',
 requestType: 'supplier_switch',
 channelType: 'all',
 query: '',
 }),
 ])

 const readyRequests = requests.filter((row) =>
 ['queued', 'submitted', 'accepted'].includes(row.status)
 )

 const alreadyQueuedCount = readyRequests.filter((request) =>
 outboundRequests.some(
 (row) =>
 row.source_type === 'supplier_switch_request' &&
 row.source_id === request.id &&
 ['queued', 'prepared', 'sent', 'acknowledged'].includes(row.status)
 )
 ).length

 const missingOutboundCount = readyRequests.filter(
 (request) =>
 !outboundRequests.some(
 (row) =>
 row.source_type === 'supplier_switch_request' &&
 row.source_id === request.id &&
 ['queued', 'prepared', 'sent', 'acknowledged'].includes(row.status)
 )
 ).length

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Bulk: redo för byte"
 subtitle="Köa externa leverantörsbytesrequests i bulk för switchärenden som är klara att skickas vidare. Du kan även köa enskilda ärenden manuellt."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="grid gap-4 md:grid-cols-3">
 <div className="rounded-2xl bg-slate-50 px-4 py-4 ">
 <div className="text-sm text-slate-700 ">
 Aktiva switchärenden
 </div>
 <div className="mt-2 text-2xl font-semibold text-slate-950 ">
 {readyRequests.length}
 </div>
 </div>

 <div className="rounded-2xl bg-emerald-50 px-4 py-4 ">
 <div className="text-sm text-emerald-700 ">
 Redan outbound-köade
 </div>
 <div className="mt-2 text-2xl font-semibold text-emerald-900 ">
 {alreadyQueuedCount}
 </div>
 </div>

 <div className="rounded-2xl bg-amber-50 px-4 py-4 ">
 <div className="text-sm text-amber-700 ">
 Saknar outbound
 </div>
 <div className="mt-2 text-2xl font-semibold text-amber-900 ">
 {missingOutboundCount}
 </div>
 </div>
 </div>

 <form action={bulkQueueReadySupplierSwitchesFormAction} className="mt-6">
 <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white ">
 Köa alla redo-för-byte
 </button>
 </form>
 </section>

 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Förhandsvisning
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Switchärenden som är kandidater för extern dispatch.
 </p>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="border-b border-slate-200 text-left ">
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Status
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Kund
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Site
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Mätpunkt
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Startdatum
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Outbound
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Manuell
 </th>
 </tr>
 </thead>
 <tbody>
 {readyRequests.length === 0 ? (
 <tr>
 <td
 colSpan={7}
 className="px-6 py-10 text-center text-sm text-slate-700 "
 >
 Inga redo-för-byte just nu.
 </td>
 </tr>
 ) : (
 readyRequests.map((request) => {
 const outbound = outboundRequests.find(
 (row) =>
 row.source_type === 'supplier_switch_request' &&
 row.source_id === request.id &&
 ['queued', 'prepared', 'sent', 'acknowledged'].includes(
 row.status
 )
 )

 return (
 <tr
 key={request.id}
 className="border-b border-slate-100 "
 >
 <td className="px-6 py-4 text-slate-700 ">
 {request.status}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {request.customer_id}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {request.site_id}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {request.metering_point_id}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {request.requested_start_date ?? '—'}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {outbound ? outbound.status : 'Saknas'}
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {outbound ? (
 <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ">
 Redan köad
 </span>
 ) : (
 <form action={queueSupplierSwitchOutboundAction}>
 <input type="hidden" name="request_id" value={request.id} />
 <button className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 ">
 Köa manuellt
 </button>
 </form>
 )}
 </td>
 </tr>
 )
 })
 )}
 </tbody>
 </table>
 </div>
 </section>
 </div>
 </div>
 )
}