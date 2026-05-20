// app/admin/page.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielSummary, type EdielSummary } from '@/lib/ediel/summary'
import { getActiveEdielActorSettings } from '@/lib/ediel/config'

export const dynamic = 'force-dynamic'

type CountFilter = {
 column: string
 value: string | number | boolean | null
}

const DASHBOARD_PERMISSIONS = [
 'customers.read',
 'switching.read',
 'metering.read',
 'billing_underlay.read',
 'partner_exports.read',
 'communication.read',
 'pricing.read',
 'audit.read',
 'users.read',
]

const EMPTY_EDIEL_SUMMARY: EdielSummary = {
 totalMessages: 0,
 inboundMessages: 0,
 outboundMessages: 0,
 draftMessages: 0,
 failedMessages: 0,
 queuedMessages: 0,
 preparedMessages: 0,
 sentMessages: 0,
 ackPendingMessages: 0,
 ackOverdueMessages: 0,
 activeRoutes: 0,
 configuredProfiles: 0,
 activeTestRuns: 0,
 runningTests: 0,
}

async function safeCount(
 supabase: SupabaseClient,
 table: string,
 companyId?: string | null,
 filters: CountFilter[] = []
) {
 try {
 let query = supabase.from(table).select('id', { count: 'exact', head: true }) as any

 if (companyId) {
 query = query.eq('company_id', companyId)
 }

 for (const filter of filters) {
 query = filter.value === null
 ? query.is(filter.column, null)
 : query.eq(filter.column, filter.value)
 }

 const { count, error } = await query
 if (error) return 0
 return count ?? 0
 } catch {
 return 0
 }
}

function Pill({ tone, children }: { tone: 'emerald' | 'amber' | 'red' | 'slate'; children: ReactNode }) {
 const classes: Record<typeof tone, string> = {
 emerald: 'border-emerald-300 bg-emerald-100 text-emerald-900',
 amber: 'border-amber-300 bg-amber-100 text-amber-950',
 red: 'border-red-300 bg-red-100 text-red-950',
 slate: 'border-slate-300 bg-slate-100 text-slate-900',
 }

 return (
 <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black ${classes[tone]}`}>
 {children}
 </span>
 )
}

function MetricCard({
 label,
 value,
 hint,
 href,
 tone = 'slate',
}: {
 label: string
 value: string | number
 hint: string
 href?: string
 tone?: 'slate' | 'emerald' | 'amber' | 'red'
}) {
 const styles: Record<typeof tone, string> = {
 slate: 'border-slate-200 bg-white',
 emerald: 'border-emerald-200 bg-emerald-50/90',
 amber: 'border-amber-200 bg-amber-50/95',
 red: 'border-red-200 bg-red-50/95',
 }

 const content = (
 <div className={`h-full rounded-3xl border p-5 shadow-sm ${styles[tone]}`}>
 <div className="text-sm font-black text-slate-700">{label}</div>
 <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
 <div className="mt-2 text-xs font-bold leading-5 text-slate-700">{hint}</div>
 </div>
 )

 return href ? <Link href={href}>{content}</Link> : content
}

function WorkAreaCard({
 eyebrow,
 title,
 text,
 href,
 cta,
 children,
}: {
 eyebrow: string
 title: string
 text: string
 href: string
 cta: string
 children?: ReactNode
}) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">{eyebrow}</p>
 <h2 className="mt-3 text-xl font-black tracking-tight text-slate-950">{title}</h2>
 <p className="mt-2 text-sm font-bold leading-6 text-slate-700">{text}</p>
 {children ? <div className="mt-5 grid gap-2">{children}</div> : null}
 <Link
 href={href}
 className="mt-5 inline-flex rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800"
 >
 {cta}
 </Link>
 </section>
 )
}

function ActionLine({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'emerald' | 'amber' | 'red' }) {
 return (
 <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
 <span className="text-sm font-bold text-slate-800">{label}</span>
 <Pill tone={tone}>{value}</Pill>
 </div>
 )
}

export default async function AdminDashboardPage() {
 const context = await requireAdminPageKeyAccess('dashboard')
 const isPlatformAdmin = isPlatformAdminContext(context)
 const supabase = await createSupabaseServerClient()
 const companyScope = await getOperationalCompanyScope(context.userId)
 const companyId = companyScope.companyId

 const [
 ediel,
 productionActor,
 testActor,
 customers,
 contracts,
 sites,
 meteringPoints,
 pendingTasks,
 openGridOwnerRequests,
 openSwitches,
 outboundQueue,
 meteringValues,
 billingUnderlays,
 companies,
 networkOwners,
 suppliers,
 ] = await Promise.all([
 getEdielSummary(supabase, isPlatformAdmin ? null : companyId).catch(() => EMPTY_EDIEL_SUMMARY),
 getActiveEdielActorSettings('production', companyId).catch(() => null),
 getActiveEdielActorSettings('test', companyId).catch(() => null),
 safeCount(supabase, 'customers', companyId),
 safeCount(supabase, 'customer_contracts', companyId),
 safeCount(supabase, 'customer_sites', companyId),
 safeCount(supabase, 'metering_points', companyId),
 safeCount(supabase, 'customer_operation_tasks', companyId, [{ column: 'status', value: 'open' }]),
 safeCount(supabase, 'grid_owner_data_requests', companyId, [{ column: 'status', value: 'sent' }]),
 safeCount(supabase, 'supplier_switch_requests', companyId, [{ column: 'status', value: 'open' }]),
 safeCount(supabase, 'outbound_requests', companyId),
 safeCount(supabase, 'metering_values', companyId),
 safeCount(supabase, 'billing_underlays', companyId),
 isPlatformAdmin ? safeCount(supabase, 'companies') : Promise.resolve(0),
 isPlatformAdmin ? safeCount(supabase, 'grid_owners') : Promise.resolve(0),
 isPlatformAdmin ? safeCount(supabase, 'electricity_suppliers') : Promise.resolve(0),
 ])

 const actor = productionActor ?? testActor
 const liveWarnings = ediel.failedMessages + ediel.ackPendingMessages + ediel.ackOverdueMessages + pendingTasks + openGridOwnerRequests
 const tenantReady = Boolean(companyId && actor?.actor_ediel_id)

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Driftöversikt"
 subtitle="Samlad översikt för Ediel, kunder, fullmakter, operations, mätvärden, faktureringsunderlag och tenant-säkerhet."
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 <div className="space-y-8 p-8">
 <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-6">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-900">Gridex Operations</p>
 <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
{isPlatformAdmin ? 'Plattformsöversikt' : `Dagens driftläge för ${companyScope.companyName ?? 'ditt bolag'}`}
 </h1>
 <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-slate-700">
 Den här sidan är systemets startsida. Ediel Live Center, kundflöden, onboarding, operations,
 mätvärden och faktureringsunderlag visas i samma arbetsyta så att inga kritiska blockeringar göms.
 </p>
 {companyScope.message ? (
 <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-black text-amber-950">
 {companyScope.message}
 </div>
 ) : null}
 </div>

 <div className="flex flex-wrap gap-2">
 {isPlatformAdmin ? (
 <Pill tone="emerald">Platform admin</Pill>
 ) : (
 <Pill tone={tenantReady ? 'emerald' : 'red'}>{tenantReady ? 'Tenantprofil aktiv' : 'Tenantprofil behöver åtgärd'}</Pill>
 )}
 <Pill tone={liveWarnings > 0 ? 'amber' : 'emerald'}>{liveWarnings > 0 ? `${liveWarnings} driftärenden` : 'Inga akuta blockeringar'}</Pill>
 </div>
 </div>
 </section>

 <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
 <MetricCard label="Kunder" value={customers} hint="Aktuellt kundregister" href="/admin/customers" tone="emerald" />
 <MetricCard label="Avtal" value={contracts} hint="Aktiva och historiska avtal" href="/admin/contracts" />
 <MetricCard label="Anläggningar" value={sites} hint="Kopplade uttagspunkter" href="/admin/customers" />
 <MetricCard label="Mätpunkter" value={meteringPoints} hint="Fakturagrundande mätpunkter" href="/admin/metering" />
 <MetricCard label="Edielärenden" value={ediel.ackPendingMessages} hint={`${ediel.ackOverdueMessages} försenade kvittenser`} href="/admin/ediel/control-tower" tone={ediel.ackPendingMessages > 0 ? 'amber' : 'emerald'} />
 <MetricCard label="Uppgifter" value={pendingTasks} hint="Öppna operationsuppgifter" href="/admin/operations/tasks" tone={pendingTasks > 0 ? 'amber' : 'emerald'} />
 </section>

 <section className="grid gap-5 xl:grid-cols-3">
 <WorkAreaCard
 eyebrow="Ediel Center"
 title="Liveflöde, kvittenser och route-hälsa"
 text="Följ PRODAT, UTILTS, CONTRL och APERAK. Ediel är högst prioriterat eftersom leverantörsbyten och mätvärden bygger på korrekt adressering."
 href="/admin/ediel"
 cta="Öppna Ediel Live Center"
 >
 <ActionLine label="Meddelanden totalt" value={ediel.totalMessages} tone="emerald" />
 <ActionLine label="Felade meddelanden" value={ediel.failedMessages} tone={ediel.failedMessages > 0 ? 'red' : 'emerald'} />
 <ActionLine label="Aktiva Ediel-routes" value={ediel.activeRoutes} tone={ediel.activeRoutes > 0 ? 'emerald' : 'amber'} />
 </WorkAreaCard>

 <WorkAreaCard
 eyebrow="Kunder & avtal"
 title="Kunddata som går att lita på"
 text="Kund, avtal, anläggning, mätpunkt och fullmakt ska hänga ihop innan systemet startar operations- eller Ediel-flöden."
 href="/admin/customers"
 cta="Öppna kundregister"
 >
 <ActionLine label="Kunder" value={customers} tone="emerald" />
 <ActionLine label="Avtal" value={contracts} tone={contracts > 0 ? 'emerald' : 'amber'} />
 <ActionLine label="Mätpunkter" value={meteringPoints} tone={meteringPoints > 0 ? 'emerald' : 'amber'} />
 </WorkAreaCard>

 <WorkAreaCard
 eyebrow="Fullmakter & onboarding"
 title="Från signerad fullmakt till begärda uppgifter"
 text="Signerad eller verifierad fullmakt ska trigga rätt begäran till nätägare, och blockeringar ska synas tydligt."
 href="/admin/operations/tasks"
 cta="Öppna onboarding"
 >
 <ActionLine label="Öppna uppgifter" value={pendingTasks} tone={pendingTasks > 0 ? 'amber' : 'emerald'} />
 <ActionLine label="Begäran hos nätägare" value={openGridOwnerRequests} tone={openGridOwnerRequests > 0 ? 'amber' : 'emerald'} />
 <ActionLine label="Aktiva switchar" value={openSwitches} tone={openSwitches > 0 ? 'amber' : 'emerald'} />
 </WorkAreaCard>
 </section>

 <section className="grid gap-5 xl:grid-cols-3">
 <WorkAreaCard
 eyebrow="Operations"
 title="Switchar, utskick och åtgärder"
 text="Här följer du leverantörsbyten, outboundköer, ej matchade meddelanden och ärenden som är redo att köras."
 href="/admin/operations"
 cta="Öppna operations"
 >
 <ActionLine label="Aktiva switchar" value={openSwitches} tone={openSwitches > 0 ? 'amber' : 'emerald'} />
 <ActionLine label="Outboundkö" value={outboundQueue} tone={outboundQueue > 0 ? 'amber' : 'emerald'} />
 </WorkAreaCard>

 <WorkAreaCard
 eyebrow="Mätvärden & fakturaunderlag"
 title="Underlag som kan exporteras säkert"
 text="Mätvärden, saknade perioder och faktureringsberedskap ska kontrolleras innan partnerhandoff eller export."
 href="/admin/billing"
 cta="Öppna faktureringsunderlag"
 >
 <ActionLine label="Mätvärden" value={meteringValues} tone={meteringValues > 0 ? 'emerald' : 'amber'} />
 <ActionLine label="Billingunderlag" value={billingUnderlays} tone={billingUnderlays > 0 ? 'emerald' : 'slate'} />
 </WorkAreaCard>

 {isPlatformAdmin ? (
 <WorkAreaCard
 eyebrow="Plattform"
 title="Bolag, globala användare och styrning"
 text="Detta är en superadmin-yta. Här hanteras tenants, globala användare, roller och plattformsregler. Vanliga elbolag ser inte den här vägen."
 href="/admin/companies"
 cta="Öppna plattformens bolag"
 >
 <ActionLine label="Bolag" value={companies} tone={companies > 0 ? 'emerald' : 'amber'} />
 <ActionLine label="Nätägare" value={networkOwners} tone={networkOwners > 0 ? 'emerald' : 'amber'} />
 <ActionLine label="Elleverantörer" value={suppliers} tone={suppliers > 0 ? 'emerald' : 'amber'} />
 </WorkAreaCard>
 ) : (
 <WorkAreaCard
 eyebrow="Bolagsinställningar"
 title="Ditt elbolags profil och team"
 text="Här hanterar du bara ditt eget bolags kontaktuppgifter, Ediel-profil och användare. Du kan inte skapa eller se andra elbolag."
 href="/admin/company-settings"
 cta="Öppna bolagsinställningar"
 >
 <ActionLine label="Bolagskoppling" value={companyScope.companyName ?? 'Saknas'} tone={companyId ? 'emerald' : 'red'} />
 <ActionLine label="Ediel-id" value={actor?.actor_ediel_id ?? 'Saknas'} tone={actor?.actor_ediel_id ? 'emerald' : 'red'} />
 </WorkAreaCard>
 )}
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Tenantprofil</p>
 <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">
 {companyScope.companyName ?? 'Bolagskoppling saknas'} · {actor?.actor_name ?? 'Ediel-profil saknas'}
 </h2>
 <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-slate-700">
 När tenantprofilen sparas ska samma company_id följa kunder, fullmakter, routes, outbound, Ediel-meddelanden,
 mätvärden och faktureringsunderlag. Om profilen saknas ska liveflöden inte skickas.
 </p>
 </div>

 <div className="flex flex-wrap gap-2">
 <Pill tone={companyId ? 'emerald' : 'red'}>{companyId ? 'Company ID finns' : 'Company ID saknas'}</Pill>
 <Pill tone={actor?.actor_ediel_id ? 'emerald' : 'red'}>{actor?.actor_ediel_id ? 'Ediel-id finns' : 'Ediel-id saknas'}</Pill>
 <Pill tone={productionActor ? 'emerald' : testActor ? 'amber' : 'red'}>
 {productionActor ? 'Produktion aktiv' : testActor ? 'Endast testprofil' : 'Ingen aktörsprofil'}
 </Pill>
 </div>
 </div>

 <div className="mt-5 flex flex-wrap gap-3">
 <Link href="/admin/ediel/settings" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800">
 Hantera tenantprofil
 </Link>
 <Link href="/admin/ediel/routes" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-900 transition hover:bg-slate-50">
 Kontrollera routes
 </Link>
 <Link href="/admin/controltower" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-900 transition hover:bg-slate-50">
 Öppna Control Tower
 </Link>
 </div>
 </section>
 </div>
 </div>
 )
}
