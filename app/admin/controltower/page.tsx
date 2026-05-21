/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope, isMissingRelationError } from '@/lib/tenant/scope'
import { listPlatformControlTowerAlerts } from '@/lib/tenant/controlTower'
import { listBatch2BControlTower } from '@/lib/operations/batch2bAutomation'

export const dynamic = 'force-dynamic'

type CountFilter = {
 column: string
 op?: 'eq' | 'in' | 'is'
 value: string | string[] | boolean | null
}

type QueueRow = {
 id: string
 title: string
 description: string
 href: string
 status: string
 tone: 'success' | 'warning' | 'danger' | 'neutral'
 meta?: string
}

function toneClass(tone: 'success' | 'warning' | 'danger' | 'neutral'): string {
 if (tone === 'success') return 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
 if (tone === 'warning') return 'border-amber-200 bg-amber-50/80 text-amber-900'
 if (tone === 'danger') return 'border-red-200 bg-red-50/80 text-red-900'
 return 'border-slate-200 bg-white text-slate-900'
}

function badgeClass(tone: 'success' | 'warning' | 'danger' | 'neutral'): string {
 if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
 if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
 if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-700'
 return 'border-slate-200 bg-slate-50 text-slate-700'
}

function formatDate(value: string | null | undefined): string {
 if (!value) return '—'
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return value
 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(date)
}

function applyFilter(query: any, filter: CountFilter): any {
 if (filter.op === 'in') return query.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
 if (filter.op === 'is') return query.is(filter.column, filter.value)
 return query.eq(filter.column, filter.value)
}

async function safeCount(
 supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
 table: string,
 filters: CountFilter[] = []
): Promise<number> {
 try {
 let query: any = supabase.from(table).select('*', { count: 'exact', head: true })
 for (const filter of filters) query = applyFilter(query, filter)
 const { count, error } = await query
 if (error) throw error
 return count ?? 0
 } catch (error) {
 if (isMissingRelationError(error)) return 0
 throw error
 }
}

async function safeRows<T>(
 supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
 table: string,
 select: string,
 filters: CountFilter[] = [],
 limit = 8
): Promise<T[]> {
 try {
 let query: any = supabase.from(table).select(select).order('created_at', { ascending: false }).limit(limit)
 for (const filter of filters) query = applyFilter(query, filter)
 const { data, error } = await query
 if (error) throw error
 return (data ?? []) as T[]
 } catch (error) {
 if (isMissingRelationError(error)) return []
 throw error
 }
}

function companyFilter(companyId: string | null): CountFilter[] {
 return companyId ? [{ column: 'company_id', value: companyId }] : []
}

function KpiCard({
 label,
 value,
 description,
 href,
 tone = 'neutral',
}: {
 label: string
 value: number
 description: string
 href: string
 tone?: 'success' | 'warning' | 'danger' | 'neutral'
}) {
 return (
 <Link href={href} className={`block rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass(tone)}`}>
 <div className="flex items-start justify-between gap-3">
 <p className="text-sm font-semibold text-slate-700">{label}</p>
 <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(tone)}`}>
 Öppna
 </span>
 </div>
 <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
 <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
 </Link>
 )
}

function QueueList({ title, rows }: { title: string; rows: QueueRow[] }) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-100 px-5 py-4">
 <h2 className="text-base font-semibold text-slate-950">{title}</h2>
 <p className="mt-1 text-sm text-slate-700">Praktiska blockerare som operations ska kunna agera på utan att leta i flera menyer.</p>
 </div>
 {rows.length === 0 ? (
 <div className="px-5 py-8 text-sm text-slate-700">Inga tydliga blockerare i den här kön just nu.</div>
 ) : (
 <div className="divide-y divide-slate-100">
 {rows.map((row) => (
 <Link key={`${row.href}-${row.id}`} href={row.href} className="block px-5 py-4 transition hover:bg-emerald-50/50">
 <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <h3 className="font-semibold text-slate-950">{row.title}</h3>
 <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(row.tone)}`}>{row.status}</span>
 </div>
 <p className="mt-1 text-sm leading-6 text-slate-700">{row.description}</p>
 {row.meta ? <p className="mt-1 text-xs text-slate-700">{row.meta}</p> : null}
 </div>
 <span className="text-sm font-semibold text-emerald-700">Öppna →</span>
 </div>
 </Link>
 ))}
 </div>
 )}
 </section>
 )
}

export default async function AdminControlTowerPage() {
 const admin = await requireAdminPageKeyAccess('operations.control_tower')
 const supabase = await createSupabaseServerClient()
 const isPlatformAdmin = isPlatformAdminContext(admin)
 const scope = await getOperationalCompanyScope(admin.userId)
 const scopeFilters = companyFilter(isPlatformAdmin ? null : scope.companyId)

 const [batch2BRows, platformAlerts, [
 openTasks,
 blockedTasks,
 uploadedPoaDocs,
 signedPowersOfAttorney,
 pendingGridOwnerRequests,
 waitingSwitches,
 failedSwitches,
 failedOutbound,
 failedEdielMessages,
 openCustomerCases,
 billingBlockedCases,
 cancellationCustomerCases,
 movedCustomers,
 ]] = await Promise.all([
 listBatch2BControlTower(isPlatformAdmin ? null : scope.companyId),
 isPlatformAdmin ? listPlatformControlTowerAlerts() : Promise.resolve([]),
 Promise.all([
 safeCount(supabase, 'customer_operation_tasks', [...scopeFilters, { column: 'status', op: 'in', value: ['open', 'in_progress'] }]),
 safeCount(supabase, 'customer_operation_tasks', [...scopeFilters, { column: 'status', value: 'blocked' }]),
 safeCount(supabase, 'customer_authorization_documents', [...scopeFilters, { column: 'document_type', value: 'power_of_attorney' }, { column: 'status', value: 'uploaded' }]),
 safeCount(supabase, 'powers_of_attorney', [...scopeFilters, { column: 'status', value: 'signed' }]),
 safeCount(supabase, 'grid_owner_data_requests', [...scopeFilters, { column: 'status', op: 'in', value: ['pending', 'sent'] }]),
 safeCount(supabase, 'supplier_switch_requests', [...scopeFilters, { column: 'status', op: 'in', value: ['queued', 'submitted', 'accepted'] }]),
 safeCount(supabase, 'supplier_switch_requests', [...scopeFilters, { column: 'status', op: 'in', value: ['failed', 'rejected'] }]),
 safeCount(supabase, 'outbound_requests', [...scopeFilters, { column: 'status', value: 'failed' }]),
 safeCount(supabase, 'ediel_messages', [...scopeFilters, { column: 'status', value: 'failed' }]),
 safeCount(supabase, 'customer_cases', [...scopeFilters, { column: 'status', op: 'in', value: ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up'] }]),
 safeCount(supabase, 'customer_cases', [...scopeFilters, { column: 'billing_blocked', value: true }]),
 safeCount(supabase, 'customer_cases', [...scopeFilters, { column: 'cancellation_status', op: 'in', value: ['draft_required', 'draft_created', 'sent', 'rejected', 'manual_review'] }]),
 safeCount(supabase, 'customers', [...scopeFilters, { column: 'status', op: 'in', value: ['moved', 'terminated'] }]),
 ]),
 ])

 const [taskRows, gridOwnerRows, switchRows, customerCaseRows, movedRows] = await Promise.all([
 safeRows<{
 id: string
 customer_id: string | null
 title: string | null
 description: string | null
 status: string | null
 priority: string | null
 created_at: string | null
 }>(supabase, 'customer_operation_tasks', 'id, customer_id, title, description, status, priority, created_at', [...scopeFilters, { column: 'status', op: 'in', value: ['open', 'in_progress', 'blocked'] }], 8),
 safeRows<{
 id: string
 customer_id: string | null
 request_scope: string | null
 status: string | null
 created_at: string | null
 }>(supabase, 'grid_owner_data_requests', 'id, customer_id, request_scope, status, created_at', [...scopeFilters, { column: 'status', op: 'in', value: ['pending', 'sent'] }], 6),
 safeRows<{
 id: string
 customer_id: string | null
 request_type: string | null
 status: string | null
 failure_reason: string | null
 created_at: string | null
 }>(supabase, 'supplier_switch_requests', 'id, customer_id, request_type, status, failure_reason, created_at', [...scopeFilters, { column: 'status', op: 'in', value: ['queued', 'submitted', 'accepted', 'failed', 'rejected'] }], 8),
 safeRows<{
 id: string
 customer_id: string | null
 case_type: string | null
 status: string | null
 title: string | null
 next_action: string | null
 cancellation_status: string | null
 billing_blocked: boolean | null
 delivery_start_at: string | null
 created_at: string | null
 }>(supabase, 'customer_cases', 'id, customer_id, case_type, status, title, next_action, cancellation_status, billing_blocked, delivery_start_at, created_at', [...scopeFilters, { column: 'status', op: 'in', value: ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up'] }], 8),
 safeRows<{
 id: string
 full_name: string | null
 company_name: string | null
 customer_number: string | null
 status: string | null
 moved_out_at: string | null
 lifecycle_closed_at: string | null
 lifecycle_status_reason: string | null
 created_at: string | null
 }>(supabase, 'customers', 'id, full_name, company_name, customer_number, status, moved_out_at, lifecycle_closed_at, lifecycle_status_reason, created_at', [...scopeFilters, { column: 'status', op: 'in', value: ['moved', 'terminated'] }], 6),
 ])

 const batch2B = batch2BRows[0] ?? null
 const batch2BBlockedRows = Number(batch2B?.blocked_export_rows ?? 0)
 const batch2BOpenOutbound = Number(batch2B?.open_outbound_count ?? 0)
 const batch2BFailedImports = Number(batch2B?.failed_import_rows ?? 0)

 const queueRows: QueueRow[] = [
 ...taskRows.map((task) => ({
 id: task.id,
 title: task.title ?? 'Operationsuppgift',
 description: task.description ?? 'Öppen operationsuppgift som påverkar kundflödet.',
 href: task.customer_id ? `/admin/customers/${task.customer_id}` : '/admin/operations/tasks',
 status: task.status ?? 'open',
 tone: task.status === 'blocked' || task.priority === 'critical' ? 'danger' as const : 'warning' as const,
 meta: `Skapad ${formatDate(task.created_at)}`,
 })),
 ...gridOwnerRows.map((request) => ({
 id: request.id,
 title: 'Begäran till nätägare väntar',
 description: `Scope: ${request.request_scope ?? 'uppgifter'}. Kontrollera att fullmakt, mottagare och route profile är korrekt.`,
 href: request.customer_id ? `/admin/customers/${request.customer_id}` : `/admin/operations/grid-owner-requests/${request.id}`,
 status: request.status ?? 'pending',
 tone: 'warning' as const,
 meta: `Skapad ${formatDate(request.created_at)}`,
 })),
 ...switchRows.map((request) => ({
 id: request.id,
 title: `Switchflöde ${request.request_type ?? ''}`.trim(),
 description: request.failure_reason ?? 'Switchärende väntar på nästa steg i operationskedjan.',
 href: request.customer_id ? `/admin/customers/${request.customer_id}` : '/admin/operations/switches',
 status: request.status ?? 'queued',
 tone: ['failed', 'rejected'].includes(request.status ?? '') ? 'danger' as const : 'warning' as const,
 meta: `Skapad ${formatDate(request.created_at)}`,
 })),
 ...customerCaseRows.map((item) => ({
 id: item.id,
 title: item.title ?? (item.case_type === 'withdrawal' ? 'Ångerärende' : 'Kundärende'),
 description: item.next_action ?? 'Kundärende behöver uppföljning innan flödet fortsätter.',
 href: item.customer_id ? `/admin/customers/${item.customer_id}` : '/admin/customer-cases',
 status: item.billing_blocked ? 'Fakturering blockerad' : item.status ?? 'open',
 tone: item.billing_blocked || item.cancellation_status === 'rejected' ? 'danger' as const : 'warning' as const,
 meta: item.delivery_start_at ? `Leveransstart ${formatDate(item.delivery_start_at)}` : `Skapad ${formatDate(item.created_at)}`,
 })),
 ].slice(0, 14)

 const lifecycleRows: QueueRow[] = movedRows.map((customer) => ({
 id: customer.id,
 title: customer.full_name ?? customer.company_name ?? customer.customer_number ?? 'Avslutad kund',
 description: customer.lifecycle_status_reason ?? 'Kunden har mjukt avslutats. Följ upp slutmätvärden och faktureringsunderlag.',
 href: `/admin/customers/${customer.id}`,
 status: customer.status ?? 'moved',
 tone: 'neutral',
 meta: `Utflytts-/avslutsdatum ${customer.moved_out_at ?? customer.lifecycle_closed_at?.slice(0, 10) ?? '—'}`,
 }))

 const activeIssues =
 openTasks +
 blockedTasks +
 uploadedPoaDocs +
 pendingGridOwnerRequests +
 waitingSwitches +
 failedSwitches +
 failedOutbound +
 failedEdielMessages +
 openCustomerCases +
 billingBlockedCases +
 cancellationCustomerCases

 return (
 <div className="space-y-6 p-6 xl:p-8">
 <AdminHeader
 title="Control Tower"
 subtitle={isPlatformAdmin ? 'Global SaaS-drift för tenants, Ediel, routes och blockerade flöden.' : `Driftläge för ${scope.companyName ?? 'ditt bolag'}: fullmakter, kundflöden, Ediel och nätägarbegäran.`}
 userEmail={admin.email}
 workspaceName={isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 {scope.message ? (
 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-sm">
 {scope.message}
 </section>
 ) : null}

 {platformAlerts.length > 0 ? (
 <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-100 px-5 py-4">
 <h2 className="text-base font-semibold text-slate-950">Superadmin-larm</h2>
 <p className="mt-1 text-sm text-slate-700">Tenant-, Ediel-, route-, export- och behörighetslarm som påverkar SaaS-driften.</p>
 </div>
 <div className="grid gap-4 p-5 xl:grid-cols-3">
 {platformAlerts.map((alert) => (
 <Link key={alert.id} href={alert.href} className={`rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass(alert.severity === 'danger' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'neutral')}`}>
 <div className="flex items-start justify-between gap-3">
 <h3 className="text-sm font-semibold text-slate-950">{alert.title}</h3>
 <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(alert.severity === 'danger' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'neutral')}`}>{alert.count}</span>
 </div>
 <p className="mt-3 text-sm leading-6 text-slate-700">{alert.description}</p>
 {alert.meta ? <p className="mt-2 text-xs text-slate-600">{alert.meta}</p> : null}
 </Link>
 ))}
 </div>
 </section>
 ) : (
 <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 shadow-sm">
 Inga plattformsövergripande larm för pausade bolag, saknad Ediel-profil, routeproblem, försenade kvittenser eller blockerade exporter.
 </section>
 )}

 <section className="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5 text-sm leading-6 text-emerald-950 shadow-sm">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <h2 className="text-base font-semibold">Operationsprincip</h2>
 <p className="mt-2 max-w-5xl">
 Control Tower ska visa vad som stoppar flödet. Verkliga kunder ska inte raderas när de flyttar; de ska mjukt avslutas så att Ediel-historik, fullmakter, mätvärden, avtal och slutdebitering kan följas upp. Batch 2B lägger även live-drift, importfel och exportradsblockerare i samma vy.
 </p>
 </div>
 <Link href="/admin/operations/automation" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Öppna automationsmotor</Link>
 </div>
 </section>

 <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
 <KpiCard label="Aktiva blockerare" value={activeIssues} description="Total kö som kräver manuell eller automatisk åtgärd." href="/admin/operations" tone={activeIssues > 0 ? 'warning' : 'success'} />
 <KpiCard label="Blockerade uppgifter" value={blockedTasks} description="Kundflöden som inte ska skickas vidare innan datan är rättad." href="/admin/operations/tasks?status=blocked" tone={blockedTasks > 0 ? 'danger' : 'success'} />
 <KpiCard label="Uppladdade fullmakter" value={uploadedPoaDocs} description="Fullmakter som behöver verifieras innan uppgifter begärs." href="/admin/operations/tasks" tone={uploadedPoaDocs > 0 ? 'warning' : 'success'} />
 <KpiCard label="Signerade fullmakter" value={signedPowersOfAttorney} description="Signerade fullmakter som kan ligga till grund för automation." href="/admin/customers" tone="neutral" />
 <KpiCard label="Väntar på nätägare" value={pendingGridOwnerRequests} description="Begäran om kund-/anläggningsdata, mätvärden eller underlag." href="/admin/outbound/unresolved" tone={pendingGridOwnerRequests > 0 ? 'warning' : 'success'} />
 <KpiCard label="Switchar i flöde" value={waitingSwitches} description="Köade, skickade eller accepterade leverantörsbyten." href="/admin/operations/switches" tone="neutral" />
 <KpiCard label="Switchfel" value={failedSwitches} description="Switchar som behöver rättas eller stängas manuellt." href="/admin/operations/switches?stage=failed" tone={failedSwitches > 0 ? 'danger' : 'success'} />
 <KpiCard label="Outboundfel" value={failedOutbound} description="Utskick som inte gick igenom och måste felsökas." href="/admin/outbound" tone={failedOutbound > 0 ? 'danger' : 'success'} />
 <KpiCard label="Ediel-fel" value={failedEdielMessages} description="Meddelanden med felstatus i Ediel-kedjan." href="/admin/ediel/control-tower" tone={failedEdielMessages > 0 ? 'danger' : 'success'} />
 <KpiCard label="Kundärenden" value={openCustomerCases} description="Ånger, nekade kunder och ärenden som stoppar kundflödet." href="/admin/customer-cases" tone={openCustomerCases > 0 ? 'warning' : 'success'} />
 <KpiCard label="Ånger/annullering" value={cancellationCustomerCases} description="Ärenden där annullering eller kvittenskedja måste följas upp." href="/admin/customer-cases?type=withdrawal" tone={cancellationCustomerCases > 0 ? 'danger' : 'success'} />
 <KpiCard label="Faktureringsstopp" value={billingBlockedCases} description="Kunder där fakturering ska hållas blockerad tills ärendet är hanterat." href="/admin/customer-cases?status=billing_blocked" tone={billingBlockedCases > 0 ? 'danger' : 'success'} />
 <KpiCard label="Blockerade exportrader" value={batch2BBlockedRows} description="Enskilda export-/underlagsrader som blockeras utan att stoppa hela perioden." href="/admin/billing/export-center" tone={batch2BBlockedRows > 0 ? 'danger' : 'success'} />
 <KpiCard label="Live outbound" value={batch2BOpenOutbound} description="Köade, förberedda eller felande utskick i live-drift." href="/admin/outbound" tone={batch2BOpenOutbound > 0 ? 'warning' : 'success'} />
 <KpiCard label="Importfel" value={batch2BFailedImports} description="Rader från billing/import som behöver rättas innan export." href="/admin/billing/import" tone={batch2BFailedImports > 0 ? 'danger' : 'success'} />
 <KpiCard label="Flyttade/avslutade" value={movedCustomers} description="Kunder som är mjukt stängda och ska slutuppföljas." href="/admin/customers?status=moved" tone="neutral" />
 </section>

 <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
 <QueueList title="Prioriterad operationskö" rows={queueRows} />
 <QueueList title="Flytt / avslut att följa upp" rows={lifecycleRows} />
 </div>
 </div>
 )
}
