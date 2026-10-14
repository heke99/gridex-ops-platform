import CustomerName from '@/components/admin/CustomerName'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import {
 bulkFinalizeReadySupplierSwitchesAction,
 finalizeSupplierSwitchExecutionAction,
} from '@/app/admin/operations/actions'
import { listReadySupplierSwitchCandidatePage } from '@/lib/operations/db'
import { supabaseService } from '@/lib/supabase/service'
import type { OutboundRequestRow } from '@/lib/cis/types'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import { formatStatusLabel } from '@/lib/ui/format'
import { InvalidReadModelResponseError, readResult } from '@/lib/read-models/readResult'

export const dynamic = 'force-dynamic'

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'

 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

function badgeTone(status: string): string {
 if (['completed', 'accepted', 'acknowledged', 'ready_to_execute'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 if (['failed', 'rejected', 'cancelled', 'blocked'].includes(status)) {
 return 'bg-red-100 text-red-700 '
 }

 if (['sent', 'submitted'].includes(status)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 return 'bg-amber-100 text-amber-700 '
}

function siteLabel(siteId: string, sites: CustomerSiteRow[]): string {
 return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

export default async function ReadyToExecuteSwitchesPage({ searchParams }: {
 searchParams?: Promise<Record<string, string | string[] | undefined>>
} = {}) {
 const context = await requireAdminPageKeyAccess('operations.ready_to_execute')
 const tenantScope = await resolveAdminTenantReadScope(context)
 const companyId = tenantScope.companyId

 const supabase = await createSupabaseServerClient()
 const params = await searchParams
 const candidates = await readResult(async () => {
 if (Array.isArray(params?.cursor)) throw new InvalidReadModelResponseError()
 return listReadySupplierSwitchCandidatePage(supabase, { companyId, cursor: params?.cursor })
 }, { definitionVersion: 'supplier_switch_ready_page_v1', errorCode: 'READY_QUEUE_UNAVAILABLE' })

 if (candidates.kind === 'unavailable') {
 return <div className="min-h-screen">
 <AdminHeader title="Redo för leveransstart" subtitle="Bekräftade leverantörsbyten som kan aktiveras." userEmail={context.email} />
 <div className="space-y-3 p-8" role="alert">
 <h2 className="text-lg font-semibold">Kön kunde inte läsas</h2>
 <p>Försök igen från första sidan. Inga uppgifter om köns storlek kan visas just nu.</p>
 <p className="text-sm text-slate-600">Referens: {candidates.traceId}</p>
 <Link href="/admin/operations/ready-to-execute" className="inline-block font-semibold underline">Läs kön igen</Link>
 </div>
 </div>
 }

 const { items: requests, page } = candidates.data
 const details = await readResult(async () => {
 if (!requests.length) return { sites: [] as CustomerSiteRow[], outboundRequests: [] as OutboundRequestRow[] }
 const siteIds = [...new Set(requests.map(request => request.site_id))]
 const requestIds = requests.map(request => request.id)
 let sitesQuery = supabase.from('customer_sites').select('*', { count: 'exact' }).in('id', siteIds).limit(siteIds.length)
 let outboundQuery = supabaseService.from('outbound_requests').select('*', { count: 'exact' })
 .eq('request_type', 'supplier_switch').eq('source_type', 'supplier_switch_request').in('source_id', requestIds)
 .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000)
 if (companyId) {
 sitesQuery = sitesQuery.eq('company_id', companyId)
 outboundQuery = outboundQuery.eq('company_id', companyId)
 }
 const [sitesResult, outboundResult] = await Promise.all([sitesQuery, outboundQuery])
 for (const result of [sitesResult, outboundResult]) {
 if (result.error) throw result.error
 if (!Array.isArray(result.data) || result.count !== result.data.length) throw new InvalidReadModelResponseError()
 }
 for (const site of sitesResult.data!) {
 if (!site || typeof site.id !== 'string' || !requests.some(request => request.site_id === site.id && request.company_id === site.company_id)) {
 throw new InvalidReadModelResponseError()
 }
 }
 for (const outbound of outboundResult.data!) {
 if (!outbound || typeof outbound.id !== 'string' || !outbound.id || !requests.some(request => request.id === outbound.source_id && request.company_id === outbound.company_id)
 || typeof outbound.status !== 'string' || !outbound.status
 || outbound.request_type !== 'supplier_switch' || outbound.source_type !== 'supplier_switch_request') {
 throw new InvalidReadModelResponseError()
 }
 }
 return { sites: sitesResult.data as CustomerSiteRow[], outboundRequests: outboundResult.data as OutboundRequestRow[] }
 }, { definitionVersion: 'supplier_switch_ready_details_v1', errorCode: 'READY_QUEUE_DETAILS_UNAVAILABLE' })
 const sites = details.kind === 'unavailable' ? [] : details.data.sites
 const outboundRequests = details.kind === 'unavailable' ? [] : details.data.outboundRequests
 const readyRows = requests.map((request) => {
 const outbound =
 outboundRequests.find(
 (row) =>
 row.request_type === 'supplier_switch' &&
 row.source_type === 'supplier_switch_request' &&
 row.source_id === request.id
 ) ?? null

 const lifecycle = getSwitchLifecycle({
 request,
 readiness: null,
 outboundRequest: outbound,
 })

 return {
 request,
 outbound,
 lifecycle,
 }
 })
 const acknowledgedOutboundCount = details.kind === 'unavailable' ? '—' : readyRows.filter(row => row.outbound?.status === 'acknowledged').length

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Redo för leveransstart"
 subtitle="Kö för nätägarbekräftade leverantörsbyten där bekräftat startdatum har uppnåtts."
 userEmail={context.email}
 />

 <div className="space-y-6 p-8">
 <section className="grid gap-4 xl:grid-cols-4">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Redo på sidan</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {readyRows.length}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Visade byten som kan aktiveras nu.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Kontrollerade bekräftade byten</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {page.scanned}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Kontrollerade i denna sidas urval, inte hela kön.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Inte redo i urvalet</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {page.notReady}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Väntar normalt på bekräftat startdatum eller kräver granskning av Z04-kopplingen.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Kvitterade i visat urval</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {acknowledgedOutboundCount}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Visade byten med kvitterat utgående meddelande.
 </div>
 </div>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-center justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Aktivera klara byten
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Åtgärden hämtar klara byten och kontrollerar villkoren igen inför varje aktivering.
 </p>
 <p className="mt-2 text-sm text-slate-700">
 Bulk-aktivering kräver ett helt verifierat urval på högst 1 000 bekräftade byten. Om urvalet är större eller inte kan läsas avbryts åtgärden innan något byte aktiveras. Använd då individuell aktivering på respektive ärende.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/operations/switches"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 "
 >
 Öppna byteslistan
 </Link>

 <form action={bulkFinalizeReadySupplierSwitchesAction}>
 <button className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
 Starta aktivering
 </button>
 </form>
 </div>
 </div>
 </section>

 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Klara leverantörsbyten
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Endast byten där nätägaren har bekräftat bytet och leveransens startdatum är uppnått. Senast skapade visas först.
 </p>
 </div>

 <div className="space-y-4 p-6">
 {details.kind === 'unavailable' && <div role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm">
 Vissa uppgifter kunde inte läsas. Klara byten visas, men anläggningsnamn och meddelandekvittenser kan saknas. Referens: {details.traceId}
 </div>}
 {page.coverage === 'partial' && <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm">
 Fler bekräftade byten återstår att kontrollera. Fortsätt till nästa sida eller läs om kön från början.
 </p>}
 {readyRows.length === 0 && page.coverage === 'complete' ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-700 ">
 Inga byten är redo för leveransstart{params?.cursor ? ' i återstående urval' : ''}.
 </div>
 ) : (
 readyRows.map(({ request, outbound, lifecycle }) => (
 <article
 key={request.id}
 className="rounded-3xl border border-slate-200 p-5 "
 >
 <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
 <div className="min-w-0">
 <div className="flex flex-wrap items-center gap-2">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
 request.status
 )}`}
 >
 Bekräftat av nätägaren
 </span>
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
 lifecycle.stage
 )}`}
 >
 {lifecycle.label}
 </span>
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
 outbound?.status ?? 'queued'
 )}`}
 >
 Utgående meddelande: {details.kind === 'unavailable' ? 'Uppgift saknas' : formatStatusLabel(outbound?.status, '—', 'Kontroll krävs')}
 </span>
 </div>

 <h3 className="mt-3 text-base font-semibold text-slate-950 ">
 Bytesärende {request.id}
 </h3>

 <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Kund</div>
 <div className="mt-1 font-medium text-slate-900 ">
 <CustomerName id={request.customer_id} />
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Anläggning</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {siteLabel(request.site_id, sites)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Mätpunkt</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.metering_point_id}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Startdatum</div>
 <div className="mt-1 font-medium text-slate-900 ">
 {request.requested_start_date ?? '—'}
 </div>
 </div>
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4 text-sm ">
 <div className="font-semibold text-slate-900 ">
 Aktiveringsvillkor
 </div>
 <div className="mt-2 text-slate-700 ">
 {lifecycle.reason}
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4 text-sm ">
 <div className="font-semibold text-slate-900 ">
 Skickat / kvitterat
 </div>
 <div className="mt-2 space-y-1 text-slate-700 ">
 <div>
 Skickat:{' '}
 <span className="font-medium">
 {formatDateTime(request.submitted_at)}
 </span>
 </div>
 <div>
 Kvitterat:{' '}
 <span className="font-medium">
 {formatDateTime(outbound?.acknowledged_at)}
 </span>
 </div>
 </div>
 </div>
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 p-5 ">
 <h4 className="text-sm font-semibold text-slate-900 ">
 Åtgärder
 </h4>

 <div className="mt-4 space-y-3">
 <form action={finalizeSupplierSwitchExecutionAction}>
 <input type="hidden" name="request_id" value={request.id} />
 <button className="w-full rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
 Aktivera leverans nu
 </button>
 </form>

 <Link
 href={`/admin/operations/switches/${request.id}`}
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Öppna bytesärendet
 </Link>

 <Link
 href={`/admin/customers/${request.customer_id}`}
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Öppna kundkort
 </Link>

 <Link
 href="/admin/outbound"
 className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 "
 >
 Öppna utgående meddelanden
 </Link>
 </div>
 </div>
 </div>
 </article>
 ))
 )}
 <div className="flex flex-wrap gap-4">
 {params?.cursor && <Link href="/admin/operations/ready-to-execute" className="font-semibold underline">Första sidan</Link>}
 {page.hasMore && page.nextCursor && <Link href={`/admin/operations/ready-to-execute?cursor=${encodeURIComponent(page.nextCursor)}`} className="font-semibold underline">Nästa sida</Link>}
 </div>
 </div>
 </section>
 </div>
 </div>
 )
}
