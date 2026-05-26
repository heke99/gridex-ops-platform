import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'

export const dynamic = 'force-dynamic'

type WorkQueuePageProps = {
 searchParams: Promise<{
 type?: string
 q?: string
 }>
}

type RawRow = Record<string, unknown>

type WorkItem = {
 id: string
 type: 'fullmakt' | 'uppgiftsbegaran' | 'kundarende' | 'leverantorsbyte' | 'blockerare'
 customerId: string | null
 title: string
 description: string
 status: string
 priority: string
 createdAt: string | null
 href: string
}

type CustomerLabel = {
 id: string
 label: string
}

function stringValue(value: unknown): string {
 return typeof value === 'string' ? value : ''
}

function dateValue(value: unknown): string | null {
 return typeof value === 'string' && value.trim() ? value : null
}

function uiStatus(value: string): string {
 switch (value) {
 case 'open':
 return 'Öppen'
 case 'in_progress':
 return 'Pågår'
 case 'blocked':
 return 'Blockerad'
 case 'draft':
 return 'Utkast'
 case 'ready_to_send':
 return 'Redo att skickas'
 case 'sent':
 return 'Skickad'
 case 'waiting_response':
 return 'Väntar svar'
 case 'partially_received':
 return 'Delvis mottaget'
 case 'received':
 return 'Svar mottaget'
 case 'rejected':
 return 'Nekad'
 case 'failed':
 return 'Fel'
 default:
 return value || 'Okänd'
 }
}

function typeLabel(type: WorkItem['type']): string {
 switch (type) {
 case 'fullmakt':
 return 'Fullmakt'
 case 'uppgiftsbegaran':
 return 'Uppgiftsbegäran'
 case 'kundarende':
 return 'Kundärende'
 case 'leverantorsbyte':
 return 'Leverantörsbyte'
 case 'blockerare':
 return 'Blockerare'
 default:
 return type
 }
}

function priorityTone(priority: string): string {
 if (['critical', 'high', 'kritisk', 'hög'].includes(priority)) {
 return 'border-red-200 bg-red-50 text-red-700'
 }
 if (['normal', 'medium', 'medel'].includes(priority)) {
 return 'border-amber-200 bg-amber-50 text-amber-700'
 }
 return 'border-slate-200 bg-slate-50 text-slate-700'
}

function itemTone(status: string): string {
 if (['blocked', 'failed', 'rejected'].includes(status)) {
 return 'border-red-200 bg-red-50'
 }
 if (['waiting_response', 'sent', 'ready_to_send', 'open', 'in_progress', 'draft'].includes(status)) {
 return 'border-amber-200 bg-amber-50'
 }
 return 'border-slate-200 bg-white'
}

function customerDisplayName(row: RawRow): string {
 const companyName = stringValue(row.company_name).trim()
 if (companyName) return companyName
 const fullName = stringValue(row.full_name).trim()
 if (fullName) return fullName
 const firstName = stringValue(row.first_name).trim()
 const lastName = stringValue(row.last_name).trim()
 const personName = [firstName, lastName].filter(Boolean).join(' ').trim()
 if (personName) return personName
 const number = stringValue(row.customer_number).trim()
 if (number) return number
 return 'Kund utan namn'
}

async function safeSelectRows(
 table: string,
 select: string,
 companyId: string | null,
 statusValues: string[],
 limit = 50
): Promise<RawRow[]> {
 const supabase = await createSupabaseServerClient()
 try {
 let query = supabase.from(table).select(select)
 if (companyId) query = query.eq('company_id', companyId)
 if (statusValues.length > 0) query = query.in('status', statusValues)
 const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
 if (error) return []
 return (data ?? []) as unknown as RawRow[]
 } catch {
 return []
 }
}

async function loadCustomerLabels(companyId: string | null, customerIds: string[]): Promise<Map<string, CustomerLabel>> {
 const uniqueIds = Array.from(new Set(customerIds.filter(Boolean)))
 const labels = new Map<string, CustomerLabel>()
 if (uniqueIds.length === 0) return labels

 const supabase = await createSupabaseServerClient()
 try {
 let query = supabase
 .from('customers')
 .select('id, full_name, first_name, last_name, company_name, customer_number')
 .in('id', uniqueIds)
 if (companyId) query = query.eq('company_id', companyId)
 const { data, error } = await query
 if (error) return labels
 for (const row of (data ?? []) as RawRow[]) {
 const id = stringValue(row.id)
 if (id) labels.set(id, { id, label: customerDisplayName(row) })
 }
 return labels
 } catch {
 return labels
 }
}

function blockerTitle(type: string, fallback: string): string {
 if (fallback) return fallback
 switch (type) {
 case 'missing_power_of_attorney':
 return 'Saknar fullmakt'
 case 'missing_metering_point_id':
 return 'Saknar mätpunkts-ID'
 case 'missing_facility_id':
 return 'Saknar anläggnings-ID'
 case 'possible_duplicate':
 return 'Möjlig dubblett'
 default:
 return 'Kund behöver kompletteras'
 }
}

function buildWorkItems(rows: {
 blockers: RawRow[]
 infoRequests: RawRow[]
 cases: RawRow[]
 switches: RawRow[]
 tasks: RawRow[]
}): WorkItem[] {
 const blockerItems = rows.blockers.map((row) => {
 const customerId = stringValue(row.customer_id) || null
 const blockerType = stringValue(row.blocker_type)
 return {
 id: `blocker-${stringValue(row.id)}`,
 type: blockerType === 'missing_power_of_attorney' ? 'fullmakt' : 'blockerare',
 customerId,
 title: blockerTitle(blockerType, stringValue(row.title)),
 description: stringValue(row.description) || 'Komplettera kunden innan nästa steg kan slutföras.',
 status: stringValue(row.status) || 'open',
 priority: stringValue(row.severity) || 'normal',
 createdAt: dateValue(row.created_at),
 href: customerId ? `/admin/customers/${customerId}` : '/admin/customers',
 } satisfies WorkItem
 })

 const requestItems = rows.infoRequests.map((row) => {
 const customerId = stringValue(row.customer_id) || null
 const targetName = stringValue(row.target_party_name)
 const targetType = stringValue(row.target_party_type)
 return {
 id: `info-${stringValue(row.id)}`,
 type: 'uppgiftsbegaran',
 customerId,
 title: targetName ? `Väntar uppgifter från ${targetName}` : 'Uppgiftsbegäran kräver uppföljning',
 description: targetType ? `Mottagare: ${targetType}` : 'Följ upp begäran och registrera svar när det kommer.',
 status: stringValue(row.status) || 'waiting_response',
 priority: 'normal',
 createdAt: dateValue(row.created_at),
 href: customerId ? `/admin/customers/${customerId}?tab=data-requests` : '/admin/customer-info-requests',
 } satisfies WorkItem
 })

 const caseItems = rows.cases.map((row) => {
 const customerId = stringValue(row.customer_id) || null
 return {
 id: `case-${stringValue(row.id)}`,
 type: 'kundarende',
 customerId,
 title: stringValue(row.title) || 'Kundärende kräver åtgärd',
 description: stringValue(row.next_action) || stringValue(row.description) || 'Öppna ärendet och följ nästa åtgärd.',
 status: stringValue(row.status) || 'open',
 priority: stringValue(row.priority) || 'normal',
 createdAt: dateValue(row.created_at),
 href: customerId ? `/admin/customers/${customerId}?tab=cases` : '/admin/customer-cases',
 } satisfies WorkItem
 })

 const switchItems = rows.switches.map((row) => {
 const customerId = stringValue(row.customer_id) || null
 return {
 id: `switch-${stringValue(row.id)}`,
 type: 'leverantorsbyte',
 customerId,
 title: 'Leverantörsbyte kräver uppföljning',
 description: stringValue(row.status) ? `Status: ${uiStatus(stringValue(row.status))}` : 'Kontrollera status och nästa steg.',
 status: stringValue(row.status) || 'open',
 priority: 'normal',
 createdAt: dateValue(row.created_at),
 href: customerId ? `/admin/customers/${customerId}?tab=switch-operations` : '/admin/operations/switches',
 } satisfies WorkItem
 })

 const taskItems = rows.tasks.map((row) => {
 const customerId = stringValue(row.customer_id) || null
 const taskType = stringValue(row.task_type)
 return {
 id: `task-${stringValue(row.id)}`,
 type: taskType.includes('power') || taskType.includes('fullmakt') ? 'fullmakt' : 'blockerare',
 customerId,
 title: stringValue(row.title) || 'Driftuppgift kräver åtgärd',
 description: stringValue(row.description) || 'Öppna kundkortet och komplettera det som saknas.',
 status: stringValue(row.status) || 'open',
 priority: stringValue(row.priority) || 'normal',
 createdAt: dateValue(row.created_at),
 href: customerId ? `/admin/customers/${customerId}` : '/admin/operations/tasks',
 } satisfies WorkItem
 })

 return [...blockerItems, ...requestItems, ...caseItems, ...switchItems, ...taskItems].sort((a, b) => {
 const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0
 const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0
 return createdB - createdA
 })
}

function formatDate(value: string | null): string {
 if (!value) return '—'
 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

export default async function AdminWorkQueuePage({ searchParams }: WorkQueuePageProps) {
 const context = await requireAdminPageKeyAccess('operations.tasks')
 const tenantScope = await resolveAdminTenantReadScope(context)
 const companyId = tenantScope.companyId
 const resolvedSearchParams = await searchParams
 const selectedType = (resolvedSearchParams.type ?? 'all').trim()
 const query = (resolvedSearchParams.q ?? '').trim().toLowerCase()
 const supabase = await createSupabaseServerClient()
 const {
 data: { user },
 } = await supabase.auth.getUser()

 const [blockers, infoRequests, cases, switches, tasks] = await Promise.all([
 safeSelectRows(
 'customer_blockers',
 'id, customer_id, blocker_type, severity, status, title, description, created_at',
 companyId,
 ['open', 'in_progress', 'blocked', 'pending'],
 80
 ),
 safeSelectRows(
 'customer_info_requests',
 'id, customer_id, request_type, target_party_type, target_party_name, status, blocker_reason, notes, created_at',
 companyId,
 ['draft', 'ready_to_send', 'sent', 'waiting_response', 'partially_received', 'failed', 'rejected'],
 80
 ),
 safeSelectRows(
 'customer_cases',
 'id, customer_id, case_type, priority, status, title, description, next_action, created_at',
 companyId,
 ['open', 'in_progress', 'blocked'],
 80
 ),
 safeSelectRows(
 'supplier_switch_requests',
 'id, customer_id, request_type, status, created_at',
 companyId,
 ['open', 'draft', 'queued', 'sent', 'waiting_response', 'accepted', 'blocked', 'failed', 'rejected'],
 80
 ),
 safeSelectRows(
 'customer_operation_tasks',
 'id, customer_id, task_type, priority, status, title, description, created_at',
 companyId,
 ['open', 'in_progress', 'blocked'],
 80
 ),
 ])

 const allItems = buildWorkItems({ blockers, infoRequests, cases, switches, tasks })
 const labels = await loadCustomerLabels(
 companyId,
 allItems.map((item) => item.customerId).filter((value): value is string => Boolean(value))
 )
 const filteredItems = allItems.filter((item) => {
 const customerName = item.customerId ? labels.get(item.customerId)?.label ?? '' : ''
 const matchesType = selectedType === 'all' || item.type === selectedType
 const haystack = [item.title, item.description, item.status, item.priority, customerName].join(' ').toLowerCase()
 const matchesQuery = !query || haystack.includes(query)
 return matchesType && matchesQuery
 })
 const countsByType = allItems.reduce<Record<string, number>>((acc, item) => {
 acc[item.type] = (acc[item.type] ?? 0) + 1
 return acc
 }, {})

 const filterItems: Array<{ id: string; label: string }> = [
 { id: 'all', label: 'Alla' },
 { id: 'fullmakt', label: 'Saknar fullmakt' },
 { id: 'uppgiftsbegaran', label: 'Uppgiftsbegäran' },
 { id: 'leverantorsbyte', label: 'Leverantörsbyte' },
 { id: 'kundarende', label: 'Kundärenden' },
 { id: 'blockerare', label: 'Blockerare' },
 ]

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Arbetskö"
 subtitle="Samlad lista över kunder, blockerare, fullmakter, uppgiftsbegäran och ärenden som kräver nästa åtgärd."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-5">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-900">Dagens arbete</p>
 <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Vad behöver åtgärdas?</h1>
 <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-slate-700">
 Här samlas uppgifter från kundkort, fullmakter, uppgiftsbegäran, leverantörsbyte och kundärenden. Målet är att handläggaren snabbt ska se nästa praktiska steg.
 </p>
 </div>
 <Link href="/admin/customers/intake" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
 Skapa kund
 </Link>
 </div>
 </section>

 <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
 {filterItems.map((filter) => {
 const count = filter.id === 'all' ? allItems.length : countsByType[filter.id] ?? 0
 const active = selectedType === filter.id
 return (
 <Link
 key={filter.id}
 href={`/admin/work-queue?type=${filter.id}`}
 className={`rounded-2xl border px-4 py-4 text-sm shadow-sm ${
 active ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
 }`}
 >
 <div className="font-black">{filter.label}</div>
 <div className="mt-2 text-2xl font-black">{count}</div>
 </Link>
 )
 })}
 </section>

 <form className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
 <input type="hidden" name="type" value={selectedType} />
 <label className="text-sm font-black text-slate-800" htmlFor="work-queue-search">
 Sök i arbetskön
 </label>
 <div className="mt-2 flex flex-col gap-3 md:flex-row">
 <input
 id="work-queue-search"
 name="q"
 defaultValue={resolvedSearchParams.q ?? ''}
 placeholder="Sök kund, status, ärende eller problem"
 className="min-h-12 flex-1 rounded-2xl border border-slate-300 px-4 text-sm"
 />
 <button className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800">
 Sök
 </button>
 </div>
 </form>

 <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-200 px-6 py-5">
 <h2 className="text-lg font-black text-slate-950">Uppgifter</h2>
 <p className="mt-1 text-sm font-bold text-slate-700">{filteredItems.length} träffar utifrån valt filter.</p>
 </div>
 {filteredItems.length === 0 ? (
 <div className="p-10 text-center text-sm text-slate-700">
 <div className="text-base font-black text-slate-950">Inget kräver åtgärd just nu</div>
 <div className="mx-auto mt-2 max-w-xl">När kunder saknar fullmakt, uppgiftsbegäran väntar på svar eller ärenden skapas visas de här.</div>
 </div>
 ) : (
 <div className="divide-y divide-slate-200">
 {filteredItems.map((item) => {
 const customerLabel = item.customerId ? labels.get(item.customerId)?.label ?? 'Kund' : 'Ingen kund kopplad'
 return (
 <article key={item.id} className="grid gap-4 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_180px_160px_auto] lg:items-center">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full border px-3 py-1 text-xs font-black ${itemTone(item.status)}`}>{typeLabel(item.type)}</span>
 <span className={`rounded-full border px-3 py-1 text-xs font-black ${priorityTone(item.priority)}`}>{item.priority || 'normal'}</span>
 </div>
 <h3 className="mt-3 text-base font-black text-slate-950">{item.title}</h3>
 <p className="mt-1 text-sm font-bold leading-6 text-slate-700">{item.description}</p>
 <div className="mt-2 text-xs font-bold text-slate-600">Kund: {customerLabel}</div>
 </div>
 <div className="text-sm font-bold text-slate-700">
 <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Status</div>
 <div className="mt-1">{uiStatus(item.status)}</div>
 </div>
 <div className="text-sm font-bold text-slate-700">
 <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Skapad</div>
 <div className="mt-1">{formatDate(item.createdAt)}</div>
 </div>
 <Link href={item.href} className="inline-flex justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-900 hover:bg-slate-50">
 Öppna
 </Link>
 </article>
 )
 })}
 </div>
 )}
 </section>
 </div>
 </div>
 )
}
