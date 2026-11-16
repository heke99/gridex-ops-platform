import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext } from '@/lib/admin/guards'
import { canPresentAdminAction, canPresentAdminLink, canPresentOperationalAction } from '@/lib/admin/actionPresentation'
// app/admin/partner-exports/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listAllBillingUnderlays, listAllPartnerExports } from '@/lib/cis/db'
import { updatePartnerExportStatusAction } from '@/app/admin/cis/actions'
import { formatStatusLabel } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

type PageProps = {
 searchParams: Promise<{
 status?: string
 exportKind?: string
 q?: string
 }>
}

function tone(status: string): string {
 if (['acknowledged'].includes(status)) return 'bg-emerald-100 text-emerald-700'
 if (['failed', 'cancelled'].includes(status)) {
 return 'bg-red-100 text-red-700'
 }
 if (['sent'].includes(status)) return 'bg-emerald-100 text-emerald-700'
 return 'bg-amber-100 text-amber-700'
}

export default async function AdminPartnerExportsPage({
 searchParams,
}: PageProps) {
 const context = await requireAdminPageKeyAccess('partner_exports.workspace')
 const tenantScope = await resolveAdminTenantReadScope(context)
 const companyId = tenantScope.companyId
 const canWrite = await canPresentAdminAction(['partner_exports.write'])

 const params = await searchParams
 const status = (params.status ?? 'all').trim()
 const exportKind = (params.exportKind ?? 'all').trim()
 const query = (params.q ?? '').trim()

 const [exports, underlays] = await Promise.all([
 listAllPartnerExports({
 status,
 exportKind,
 query,
 companyId,
 }),
 listAllBillingUnderlays({
 status: 'all',
 query: '',
 companyId,
 }),
 ])

 const underlayMap = new Map(underlays.map((row) => [row.id, row]))
 const exportCompanies = [...new Set(exports.map(row => row.company_id ?? companyId).filter((id): id is string => Boolean(id)))]
 const writableCompanies = new Map(await Promise.all(canWrite ? exportCompanies.map(async id => [id, await canPresentOperationalAction(['partner_exports.write'], id)] as const) : []))
 const showTechnicalDetails = isPlatformAdminContext(context)
 const canReadCustomers = canPresentAdminLink(context, { anyOf: ['customers.read', 'masterdata.read'] })
 const canReadBilling = canPresentAdminLink(context, { anyOf: ['billing_underlay.read'] })
 const canReadSource = canPresentAdminLink(context, { anyOf: ['metering.read', 'billing_underlay.read', 'communication.read', 'switching.read'] })
 const labelClient = await createSupabaseServerClient()
 const customerIds = [...new Set(exports.map(row => row.customer_id))]
 const siteIds = [...new Set(exports.flatMap(row => row.site_id ? [row.site_id] : []))]
 // The page's export rows already select the company. Names remain subject to
 // customer-read policy and the same explicit company scope.
 const scopedLabels = (table: 'customers' | 'customer_sites', columns: string, ids: string[]) => {
   const read = labelClient.from(table).select(columns).in('id', ids)
   return companyId ? read.eq('company_id', companyId) : read
 }
 const [customerLabels, siteLabels] = canReadCustomers && customerIds.length ? await Promise.all([
   scopedLabels('customers', 'id,full_name,first_name,last_name,company_name,customer_number', customerIds),
   siteIds.length ? scopedLabels('customer_sites', 'id,customer_id,site_name,street,facility_id', siteIds) : Promise.resolve({ data: [], error: null }),
 ]) : [{ data: [], error: null }, { data: [], error: null }]
 if (customerLabels.error) throw customerLabels.error
 if (siteLabels.error) throw siteLabels.error
 const customerById = new Map(((customerLabels.data ?? []) as unknown as Array<Record<string, unknown>>).map(row => [String(row.id), row]))
 const siteById = new Map(((siteLabels.data ?? []) as unknown as Array<Record<string, unknown>>).map(row => [String(row.id), row]))
 const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null
 const exportLabel = (kind: string) => ({ billing_underlay: 'Faktureringsunderlag', meter_values: 'Mätvärden', customer_snapshot: 'Kunduppgifter' })[kind] ?? 'Export till anslutet system'


 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Partnerexporter"
 subtitle="Följ underlag som överförs till faktureringssystem och andra anslutna tjänster."
 userEmail={context.email}
 />

 <div className="min-w-0 space-y-4 p-4 lg:p-6">
 <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
 <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_220px_auto]">
 <input
 name="q"
 defaultValue={query}
 aria-label="Sök exportreferens" placeholder="Sök på referens eller mottagande system"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-emerald-700"
 />
 <select
 name="status" aria-label="Exportstatus"
 defaultValue={status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 >
 <option value="all">Alla statusar</option>
 <option value="queued">Köad</option>
 <option value="sent">Skickad</option>
 <option value="acknowledged">Kvitterad</option>
 <option value="failed">Kräver åtgärd</option>
 <option value="cancelled">Avbruten</option>
 </select>
 <select
 name="exportKind" aria-label="Exporttyp"
 defaultValue={exportKind}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 >
 <option value="all">Alla exporttyper</option>
 <option value="billing_underlay">Faktureringsunderlag</option>
 <option value="meter_values">Mätvärden</option>
 <option value="customer_snapshot">Kundöversikt</option>
 </select>
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
 Filtrera
 </button>
 </form>
 </section>

 <section className="space-y-4">
 {exports.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-700 shadow-sm">
 Inga partnerexporter matchade filtret.
 </div>
 ) : (
 exports.map((exportRow) => {
 const customer = customerById.get(exportRow.customer_id)
 const site = exportRow.site_id ? siteById.get(exportRow.site_id) : null
 const customerLabel = [text(customer?.company_name) ?? text(customer?.full_name) ?? [text(customer?.first_name), text(customer?.last_name)].filter(Boolean).join(' '), text(customer?.customer_number)].filter(Boolean).join(' · ') || (canReadCustomers ? 'Kunduppgifter saknas i denna vy' : 'Kunduppgifter kräver kundläsbehörighet')
 const siteLabel = site?.customer_id === exportRow.customer_id ? [text(site.site_name), text(site.street), text(site.facility_id)].filter(Boolean).join(' · ') || 'Anläggningsuppgifter saknas' : 'Anläggningsuppgifter saknas'
 const relatedUnderlay = exportRow.billing_underlay_id
 ? underlayMap.get(exportRow.billing_underlay_id) ?? null
 : null

 return (
 <article
 key={exportRow.id}
 className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
 >
 <div className="grid min-w-0 items-start gap-3">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(exportRow.status)}`}>
 {formatStatusLabel(exportRow.status)}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
 {exportLabel(exportRow.export_kind)}
 </span>
 </div>

 <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
 <h2 className="text-base font-semibold text-slate-950">
 {customerLabel}
 </h2>

 <div className="flex flex-wrap gap-2">
 {canReadSource && relatedUnderlay?.source_request_id ? (
 <Link
 href={`/admin/operations/grid-owner-requests/${relatedUnderlay.source_request_id}`}
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Öppna källbegäran
 </Link>
 ) : null}

 {canReadBilling ? <Link
 href="/admin/billing"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
 >
 Öppna fakturering
 </Link> : null}
 </div>
 </div>

 <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
 <div>Anläggning: <span className="font-medium break-words">{siteLabel}</span></div>
 <div>Mottagare: <span className="font-medium">{exportRow.target_system === 'billing_partner' ? 'Fakturapartner' : exportRow.target_system === 'nordfin' ? 'Nordfin' : exportRow.target_system === 'capway' ? 'Capway' : 'Anslutet system'}</span></div>
 <div>Extern referens: <span className="font-medium">{exportRow.external_reference ?? '—'}</span></div>
 <div>Köad: <span className="font-medium">{new Date(exportRow.queued_at).toLocaleString('sv-SE')}</span></div>
 <div>Felorsak: <span className="font-medium">{exportRow.status === 'failed' ? 'Överföringen behöver kontrolleras. Kontakta ansvarig för anslutningen.' : 'Ingen felorsak registrerad för aktuell status.'}</span></div>
 </div>
 {showTechnicalDetails ? <details className="mt-3 rounded-xl border border-slate-200 p-3 text-xs"><summary className="cursor-pointer font-semibold">Tekniska uppgifter</summary><p className="mt-2 break-all">Export: {exportRow.id} · Kund: {exportRow.customer_id} · Anläggning: {exportRow.site_id} · Mätpunkt: {exportRow.metering_point_id} · Underlag: {exportRow.billing_underlay_id} · Källbegäran: {relatedUnderlay?.source_request_id} · System: {exportRow.target_system} · Typ: {exportRow.export_kind}</p><p className="mt-2 break-words">{exportRow.failure_reason}</p></details> : null}
 </div>

 {canWrite && writableCompanies.get(exportRow.company_id ?? companyId ?? '') ? <details className="min-w-0 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-semibold text-slate-800">Uppdatera exportstatus</summary><form
 action={updatePartnerExportStatusAction}
 className="rounded-2xl border border-slate-200 p-4"
 >


 <input type="hidden" name="export_id" value={exportRow.id} />
 <input type="hidden" name="customer_id" value={exportRow.customer_id} />

 <div className="mt-4 grid gap-3">
 <select
 name="status" aria-label="Exportstatus"
 defaultValue={exportRow.status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 >
 <option value="queued">Köad</option>
 <option value="sent">Skickad</option>
 <option value="acknowledged">Kvitterad</option>
 <option value="failed">Kräver åtgärd</option>
 <option value="cancelled">Avbruten</option>
 </select>

 <input
 name="external_reference" aria-label="Extern referens"
 defaultValue={exportRow.external_reference ?? ''}
 placeholder="Extern referens"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 <input
 name="response_payload_note" aria-label="Svar eller intern notering"
 placeholder="Svar / intern notering"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
 />

 {showTechnicalDetails ? <textarea
 name="failure_reason" aria-label="Felorsak"
 defaultValue={exportRow.failure_reason ?? ''}
 placeholder="Felorsak"
 rows={4}
 className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
 /> : null}

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
 Spara exportstatus
 </button>
 </div>
 </form></details> : null}
 </div>
 </article>
 )
 })
 )}
 </section>
 </div>
 </div>
 )
}
