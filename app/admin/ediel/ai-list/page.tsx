// app/admin/ediel/ai-list/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import {
 prepareAiListAction,
 sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { isUuid } from '@/lib/validation/uuid'

export const dynamic = 'force-dynamic'

type CustomerRow = {
 id: string
 full_name: string | null
 company_name: string | null
 customer_number: string | null
}

type SiteRow = { id: string; site_name: string | null }
type MeteringPointRow = { id: string; meter_point_id: string | null }

type SearchParams = Record<string, string | string[] | undefined>
type CursorField = 'customerAfter' | 'siteAfter' | 'pointAfter'
type PageLink = { next?: string; reset?: string }

const pickerSize = 25
const pickerRoute = '/admin/ediel/ai-list'
const pickerInput = 'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900'

function queryText(value: string | string[] | undefined): string | undefined {
 return typeof value === 'string' ? value.trim() || undefined : undefined
}

function queryId(value: string | string[] | undefined): string | undefined {
 const id = queryText(value)
 return id && isUuid(id) ? id.toLowerCase() : undefined
}

function readData<T>({data, error}: {data: T; error: unknown}): T {
 if (error) throw error
 return data
}

function visibleOptions<T extends {id: string}>(rows: T[], selected: T | null): T[] {
 const visible = rows.slice(0, pickerSize)
 if (selected && !visible.some((row) => row.id === selected.id)) visible.unshift(selected)
 return visible
}

function pickerParameters(filters: Record<string, string | undefined>) {
 const parameters = new URLSearchParams()
 for (const [key, value] of Object.entries(filters)) {
   if (value) parameters.set(key, value)
 }
 return parameters
}

function pickerHref(parameters: URLSearchParams): string {
 return pickerRoute + (parameters.size ? '?' + parameters : '')
}

function pickerLinks(
 filters: Record<string, string | undefined>,
 cursor: CursorField,
 rows: {id: string}[],
): PageLink {
 const parameters = pickerParameters(filters)
 parameters.delete(cursor)
 if (cursor === 'customerAfter') parameters.delete('siteAfter')
 if (cursor !== 'pointAfter') parameters.delete('pointAfter')
 const reset = filters[cursor] ? pickerHref(parameters) : undefined
 if (rows.length <= pickerSize) return {reset}
 parameters.set(cursor, rows[pickerSize - 1].id)
 return {reset, next: pickerHref(parameters)}
}

async function readSelection(
 supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
 companyId: string,
 params: SearchParams,
) {
 const q = queryText(params.q)?.slice(0, 120)
 const customerId = queryId(params.customerId)
 const siteId = queryId(params.siteId)
 const requestedPoint = queryId(params.meteringPointId)
 const customerAfter = queryId(params.customerAfter)
 const siteAfter = queryId(params.siteAfter)
 const pointAfter = queryId(params.pointAfter)
 const customerQuery = () => supabase.from('customers')
   .select('id,full_name,company_name,customer_number').eq('company_id', companyId)

 let customerList = customerQuery()
 if (q) {
   const pattern = JSON.stringify('%' + q.replace(/[\\%_]/g, character => '\\' + character) + '%')
   customerList = customerList.or(['full_name', 'company_name', 'customer_number'].map(field => field + '.ilike.' + pattern).join(','))
 }
 if (customerAfter) customerList = customerList.gt('id', customerAfter)
 const customers = (readData(await customerList.order('id').limit(pickerSize + 1)) ?? []) as CustomerRow[]
 const customer = customers.find(row => row.id === customerId)
   ?? (customerId ? readData(await customerQuery().eq('id', customerId).maybeSingle()) as CustomerRow | null : null)

 let sites: SiteRow[] = []
 let site: SiteRow | null = null
 if (customer) {
   const siteQuery = () => supabase.from('customer_sites')
     .select('id,site_name').eq('company_id', companyId).eq('customer_id', customer.id)
   const siteList = siteAfter ? siteQuery().gt('id', siteAfter) : siteQuery()
   sites = (readData(await siteList.order('id').limit(pickerSize + 1)) ?? []) as SiteRow[]
   site = sites.find(row => row.id === siteId)
     ?? (siteId ? readData(await siteQuery().eq('id', siteId).maybeSingle()) as SiteRow | null : null)
 }

 let points: MeteringPointRow[] = []
 let point: MeteringPointRow | null = null
 if (customer && site) {
   const scopedSiteId = site.id
   const pointQuery = () => supabase.from('metering_points').select('id,meter_point_id')
     .eq('company_id', companyId).eq('customer_id', customer.id)
     .or('customer_site_id.eq.' + scopedSiteId + ',and(customer_site_id.is.null,site_id.eq.' + scopedSiteId + ')')
   const pointList = pointAfter ? pointQuery().gt('id', pointAfter) : pointQuery()
   points = (readData(await pointList.order('id').limit(pickerSize + 1)) ?? []) as MeteringPointRow[]
   point = points.find(row => row.id === requestedPoint)
     ?? (requestedPoint ? readData(await pointQuery().eq('id', requestedPoint).maybeSingle()) as MeteringPointRow | null : null)
 }

 // Keep a requested point through paging until the operator explicitly resets the selection.
 const pointReference = requestedPoint ?? (params.meteringPointId !== undefined ? 'invalid' : undefined)
 const filters = {q, customerAfter, siteAfter, pointAfter, customerId: customer?.id, siteId: site?.id, meteringPointId: pointReference}
 const pendingPoint = point ? undefined : pointReference
 const pointResetHref = site && pendingPoint
   ? pickerHref(pickerParameters({...filters, pointAfter: undefined, meteringPointId: undefined}))
   : undefined
 return {
   customer, site, point, q, customerAfter, siteAfter, pendingPoint, pointResetHref,
   customerUnavailable: Boolean(customerId && !customer),
   siteUnavailable: Boolean(siteId && !!customer && !site),
   customers: visibleOptions(customers, customer),
   sites: visibleOptions(sites, site),
   points: visibleOptions(points, point),
   customerLinks: pickerLinks(filters, 'customerAfter', customers),
   siteLinks: pickerLinks(filters, 'siteAfter', sites),
   pointLinks: pickerLinks(filters, 'pointAfter', points),
 }
}

function PickerNavigation({ links, label }: {links: PageLink; label: string}) {
 if (!links.reset && !links.next) return null
 return <nav aria-label={label} className="flex gap-4 text-sm">
   {links.reset ? <Link href={links.reset} prefetch={false} className="underline">Första sidan</Link> : null}
   {links.next ? <Link href={links.next} prefetch={false} className="underline">Visa fler</Link> : null}
 </nav>
}

function SelectionControls({selection}: {selection: Awaited<ReturnType<typeof readSelection>>}) {
 return (
   <div className="mb-6 grid gap-5">
     <form method="get" action={pickerRoute} className="flex flex-wrap items-end gap-2">
       <label className="grid gap-1 text-sm font-medium">Sök kundnamn eller kundnummer
         <input name="q" defaultValue={selection.q} maxLength={120} className={pickerInput} />
       </label>
       <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Sök kunder</button>
     </form>
     <form method="get" action={pickerRoute} className="flex flex-wrap items-end gap-2">
       {selection.q ? <input type="hidden" name="q" value={selection.q} /> : null}
       {selection.pendingPoint ? <input type="hidden" name="meteringPointId" value={selection.pendingPoint} /> : null}
       {selection.customerAfter ? <input type="hidden" name="customerAfter" value={selection.customerAfter} /> : null}
       <label className="grid gap-1 text-sm font-medium">Kund
         <select name="customerId" className={pickerInput} defaultValue={selection.customer?.id ?? ''} required>
           <option value="">Välj kund</option>
           {selection.customers.map(row => <option key={row.id} value={row.id}>{customerLabel(row)}</option>)}
         </select>
       </label>
       <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Visa anläggningar</button>
     </form>
     <PickerNavigation links={selection.customerLinks} label="Kundsidor" />
     {!selection.customers.length ? <p role="status">Inga kunder att visa på denna sida.</p> : null}
     {selection.customerUnavailable ? <p role="status">Kunden kunde inte väljas i det aktuella bolaget.</p> : null}
     {selection.customer ? (
       <form method="get" action={pickerRoute} className="flex flex-wrap items-end gap-2">
         <input type="hidden" name="customerId" value={selection.customer.id} />
         {selection.q ? <input type="hidden" name="q" value={selection.q} /> : null}
         {selection.pendingPoint ? <input type="hidden" name="meteringPointId" value={selection.pendingPoint} /> : null}
         {selection.customerAfter ? <input type="hidden" name="customerAfter" value={selection.customerAfter} /> : null}
         {selection.siteAfter ? <input type="hidden" name="siteAfter" value={selection.siteAfter} /> : null}
         <label className="grid gap-1 text-sm font-medium">Anläggning
           <select name="siteId" className={pickerInput} defaultValue={selection.site?.id ?? ''} required>
             <option value="">Välj anläggning</option>
             {selection.sites.map(row => <option key={row.id} value={row.id}>{row.site_name || row.id}</option>)}
           </select>
         </label>
         <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Visa mätpunkter</button>
       </form>
     ) : null}
     {selection.customer ? <PickerNavigation links={selection.siteLinks} label="Anläggningssidor" /> : null}
     {selection.siteUnavailable ? <p role="status">Anläggningen kunde inte väljas för den aktuella kunden.</p> : null}
     {selection.customer && !selection.siteUnavailable && !selection.sites.length ? <p role="status">Inga anläggningar att visa för kunden på denna sida.</p> : null}
     {selection.pointResetHref ? (
       <div role="status" className="space-y-1 text-sm">
         <p>Mätpunkten kunde inte väljas för den aktuella anläggningen.</p>
         <Link href={selection.pointResetHref} prefetch={false} className="underline">Återgå till vald anläggning</Link>
       </div>
     ) : null}
   </div>
 )
}

function formatDate(value: string | null | undefined) {
 if (!value) return '—'
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return value
 return date.toLocaleString('sv-SE')
}

function Pill({
 text,
 tone,
}: {
 text: string
 tone: 'emerald' | 'amber' | 'red' | 'slate'
}) {
 const toneClass =
 tone === 'emerald'
 ? 'bg-emerald-100 text-emerald-700'
 : tone === 'amber'
 ? 'bg-amber-100 text-amber-700'
 : tone === 'red'
 ? 'bg-red-100 text-red-700'
 : 'bg-slate-100 text-slate-700'

 return <span className={`rounded-full px-2 py-1 text-xs font-medium ${toneClass}`}>{text}</span>
}

function statusTone(status: string): 'emerald' | 'amber' | 'red' | 'slate' {
 if (status === 'acknowledged' || status === 'received') return 'emerald'
 if (status === 'queued' || status === 'prepared' || status === 'draft') return 'amber'
 if (status === 'failed' || status === 'cancelled') return 'red'
 if (status === 'sent') return 'emerald'
 return 'slate'
}

function customerLabel(row: CustomerRow) {
 return row.company_name || row.full_name || row.customer_number || row.id
}

export default async function AdminEdielAiListPage({searchParams}: {searchParams?: Promise<SearchParams>} = {}) {
 const context = await requireAdminPageAccess({allOf:['communication.read','customers.read']})
 if(!context.companyId||!['communication.read','customers.read'].every(p=>context.permissions.includes(p)))return <main className="p-6"><h1 className="text-xl font-semibold">AI-/BI-listor</h1><p>Välj ett bolag där du får läsa kommunikation och kunder.</p></main>
 const companyId=context.companyId
 const canPrepare=context.permissions.includes('communication.write')
 const canSend=['ediel.send','communication.send'].some(p=>context.permissions.includes(p))

 const supabase = await createSupabaseServerClient()
 const [messagesResult, selection] = await Promise.all([
   supabase.from('ediel_messages').select('*').eq('company_id', companyId).eq('message_family', 'AI_LIST')
     .order('created_at', {ascending: false}).limit(100),
   canPrepare ? readSelection(supabase, companyId, await searchParams ?? {}) : null,
 ])
 const aiMessages = ((readData(messagesResult) ?? []) as EdielMessageRow[]).filter(row => row.message_family === 'AI_LIST')

 return (
 <div className="min-h-screen bg-slate-50">
 <AdminHeader
 title="AI-/BI-listor"
 subtitle="Export av AI-listor och historik för listmeddelanden. BI används endast för mottagen avstämning."
 userEmail={context.email}
 workspaceMode="tenant"
 />

 <div className="space-y-8 p-8">
 <section className="rounded-3xl border border-slate-200 bg-white p-6">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900">Skapa ny AI-lista</h2>
 <p className="mt-1 text-sm text-slate-700">
 AI-listan ska användas för kontroll och avvikelsehantering, inte för
 automatisk databassynk.
 </p>
 </div>

 {selection ? <SelectionControls selection={selection} /> : <p role="status">Din aktuella behörighet medger läsning. Export kräver egen skrivbehörighet och ett granskat ändamålsunderlag.</p>}
 {selection?.customer && selection.site && !selection.pointResetHref ? <form action={prepareAiListAction} className="grid gap-4 md:grid-cols-3">
 <input type="hidden" name="customerId" value={selection.customer.id} />
 <input type="hidden" name="siteId" value={selection.site.id} />
 <p className="text-sm text-slate-700 md:col-span-3">
 AI-listan gäller <strong>{customerLabel(selection.customer)}</strong>
 {' · '}<strong>{selection.site.site_name || selection.site.id}</strong>.
 </p>
 <div>
 <label htmlFor="ai-listType" className="mb-2 block text-sm font-medium text-slate-700">Listtyp</label>
 <select id="ai-listType" name="listType"
 defaultValue="AI"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 >
 <option value="AI">AI</option>
 </select>
 </div>

 <div>
 <label htmlFor="ai-meteringPointId" className="mb-2 block text-sm font-medium text-slate-700">Mätpunkt</label>
 <select id="ai-meteringPointId" name="meteringPointId" className={pickerInput} defaultValue={selection.point?.id ?? ''}>
 <option value="">Hela anläggningen</option>
 {selection.points.map((row) => (
 <option key={row.id} value={row.id}>{row.meter_point_id || row.id}</option>
 ))}
 </select>
 <PickerNavigation links={selection.pointLinks} label="Mätpunktssidor" />
 </div>

 <div>
 <label htmlFor="ai-receiverEdielId" className="mb-2 block text-sm font-medium text-slate-700">Receiver Ediel ID</label>
 <input id="ai-receiverEdielId" name="receiverEdielId"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 placeholder="Mottagande Ediel-ID"
 required
 />
 </div>

 <div>
 <label htmlFor="ai-receiverEmail" className="mb-2 block text-sm font-medium text-slate-700">Receiver email</label>
 <input id="ai-receiverEmail" name="receiverEmail"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 placeholder="Mottagande e-post"
 />
 </div>

 <div>
 <label htmlFor="ai-supplierEdielId" className="mb-2 block text-sm font-medium text-slate-700">Supplier Ediel ID</label>
 <input id="ai-supplierEdielId" name="supplierEdielId"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 placeholder="Valfri override"
 />
 </div>

 <div>
 <label htmlFor="ai-balanceResponsibleEdielId" className="mb-2 block text-sm font-medium text-slate-700">BRP Ediel ID</label>
 <input id="ai-balanceResponsibleEdielId" name="balanceResponsibleEdielId"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 placeholder="Valfri override"
 />
 </div>

 <div>
 <label htmlFor="ai-communicationRouteId" className="mb-2 block text-sm font-medium text-slate-700">Communication route ID</label>
 <input id="ai-communicationRouteId" name="communicationRouteId"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 placeholder="Valfri route override"
 />
 </div>

 <div>
 <label htmlFor="ai-fromDate" className="mb-2 block text-sm font-medium text-slate-700">From date</label>
 <input id="ai-fromDate" name="fromDate"
 type="date"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 required
 />
 </div>

 <div>
 <label htmlFor="ai-toDate" className="mb-2 block text-sm font-medium text-slate-700">To date</label>
 <input id="ai-toDate" name="toDate"
 type="date"
 className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
 required
 />
 </div>

 <div className="flex items-end">
 <button
 type="submit"
 className="w-full rounded-xl bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900"
 >
 Generera och köa AI-lista
 </button>
 </div>
 </form> : null}
 <p className="mt-4"><Link href="/admin/ediel/ai-purpose-sources" className="underline">Ändamålsunderlag för AI-/BI-listor</Link></p>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900">Historik</h2>
 <p className="mt-1 text-sm text-slate-700">
 AI-/BI-listor som redan genererats i EDIEL-lagret.
 </p>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="text-left text-slate-700">
 <tr className="border-b border-slate-200">
 <th className="px-3 py-3">Tid</th>
 <th className="px-3 py-3">Lista</th>
 <th className="px-3 py-3">Status</th>
 <th className="px-3 py-3">Period</th>
 <th className="px-3 py-3">Åtgärd</th>
 </tr>
 </thead>
 <tbody>
 {aiMessages.length === 0 ? (
 <tr>
 <td colSpan={5} className="px-3 py-6 text-slate-700">
 Inga AI-/BI-listor ännu.
 </td>
 </tr>
 ) : (
 aiMessages.map((row) => (
 <tr key={row.id} className="border-b border-slate-100 align-top">
 <td className="px-3 py-3 whitespace-nowrap text-slate-700">
 {formatDate(row.created_at)}
 </td>
 <td className="px-3 py-3">
 <Link
 href={`/admin/ediel/messages/${row.id}`}
 className="font-medium text-emerald-700 underline-offset-2 hover:underline"
 >
 {row.message_code}
 </Link>
 <div className="mt-1 text-xs text-slate-700">
 {row.subject ?? row.file_name ?? 'AI-/BI-lista'}
 </div>
 <div className="mt-1 text-xs text-slate-700 break-all">
 {row.external_reference ?? row.transaction_reference ?? row.id}
 </div>
 </td>
 <td className="px-3 py-3">
 <Pill text={row.status} tone={statusTone(row.status)} />
 </td>
 <td className="px-3 py-3 text-xs text-slate-700">
 <div>Version: {row.message_version ?? '—'}</div>
 <div>Environment: {row.environment}</div>
 </td>
 <td className="px-3 py-3">
 <div className="flex flex-wrap gap-2">
 <Link
 href={`/admin/ediel/messages/${row.id}`}
 className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
 >
 Öppna
 </Link>

 {canSend && (row.status === 'queued' || row.status === 'prepared') ? (
 <form action={sendEdielMessageAction}>
 <input type="hidden" name="edielMessageId" value={row.id} />
 <button
 type="submit"
 className="rounded-xl bg-white border border-slate-300 px-3 py-2 text-xs font-medium text-slate-900"
 >
 Skicka nu
 </button>
 </form>
 ) : null}
 </div>
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
