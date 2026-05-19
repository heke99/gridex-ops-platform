// app/admin/ediel/page.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { getEdielSummary, type EdielSummary } from '@/lib/ediel/summary'
import { getActiveEdielActorSettings } from '@/lib/ediel/config'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAgtSupplierRuntime } from '@/lib/ediel/agtRuntime'
import { EDIEL_AGT_SUPPLIER_2026A_CASES } from '@/lib/ediel/agtRegistry'

export const dynamic = 'force-dynamic'

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

function Metric({
 label,
 value,
 hint,
 tone = 'slate',
}: {
 label: string
 value: string | number
 hint: string
 tone?: 'slate' | 'emerald' | 'amber' | 'red'
}) {
 const classes: Record<typeof tone, string> = {
 slate: 'border-slate-200 bg-white',
 emerald: 'border-emerald-200 bg-emerald-50/90',
 amber: 'border-amber-200 bg-amber-50/95',
 red: 'border-red-200 bg-red-50/95',
 }

 return (
 <div className={`rounded-3xl border p-5 shadow-sm ${classes[tone]}`}>
 <div className="text-sm font-bold text-slate-700">{label}</div>
 <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</div>
 <div className="mt-2 text-xs font-medium leading-5 text-slate-700">{hint}</div>
 </div>
 )
}

function Pill({
 tone,
 children,
}: {
 tone: 'emerald' | 'amber' | 'red' | 'slate'
 children: ReactNode
}) {
 const classes: Record<typeof tone, string> = {
 emerald: 'border-emerald-300 bg-emerald-100 text-emerald-900',
 amber: 'border-amber-300 bg-amber-100 text-amber-950',
 red: 'border-red-300 bg-red-100 text-red-950',
 slate: 'border-slate-300 bg-slate-100 text-slate-900',
 }

 return (
 <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${classes[tone]}`}>
 {children}
 </span>
 )
}

function AreaCard({
 eyebrow,
 title,
 text,
 href,
 cta,
 tone = 'default',
}: {
 eyebrow: string
 title: string
 text: string
 href: string
 cta: string
 tone?: 'default' | 'production' | 'test' | 'settings'
}) {
 const styles: Record<typeof tone, string> = {
 default: 'border-slate-200 bg-white',
 production: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white',
 test: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white',
 settings: 'border-emerald-200 bg-gradient-to-br from-white via-emerald-50/70 to-white',
 }

 const eyebrowStyles: Record<typeof tone, string> = {
 default: 'text-slate-700',
 production: 'text-emerald-900',
 test: 'text-amber-900',
 settings: 'text-emerald-900',
 }

 return (
 <div className={`rounded-3xl border p-6 shadow-sm ${styles[tone]}`}>
 <p className={`text-xs font-black uppercase tracking-[0.18em] ${eyebrowStyles[tone]}`}>{eyebrow}</p>
 <h2 className="mt-3 text-xl font-black tracking-tight text-slate-950">{title}</h2>
 <p className="mt-2 text-sm font-medium leading-6 text-slate-700">{text}</p>
 <Link
 href={href}
 className="mt-5 inline-flex rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800"
 >
 {cta}
 </Link>
 </div>
 )
}

function FlowStep({
 number,
 title,
 text,
}: {
 number: string
 title: string
 text: string
}) {
 return (
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="flex items-start gap-3">
 <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-black text-white">
 {number}
 </span>
 <div>
 <div className="text-sm font-black text-slate-950">{title}</div>
 <p className="mt-1 text-sm font-medium leading-6 text-slate-700">{text}</p>
 </div>
 </div>
 </div>
 )
}

function CaseLine({
 label,
 direction,
}: {
 label: string
 direction: 'actor_to_portal' | 'portal_to_actor'
}) {
 const outbound = direction === 'actor_to_portal'

 return (
 <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
 <span className="text-sm font-bold text-slate-950">{label}</span>
 <Pill tone={outbound ? 'emerald' : 'slate'}>{outbound ? 'Leverantör → Portal' : 'Portal → Leverantör'}</Pill>
 </div>
 )
}

function ProfileField({
 label,
 value,
}: {
 label: string
 value: string | number | null | undefined
}) {
 const display = value === null || value === undefined || String(value).trim().length === 0 ? '—' : String(value)

 return (
 <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
 <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-700">{label}</div>
 <div className="mt-1 break-all text-sm font-black text-slate-950">{display}</div>
 </div>
 )
}

export default async function EdielPage() {
 const context = await requireAnyPermissionServer(['communication.read'])
 const supabase = await createSupabaseServerClient()
 const companyScope = await getOperationalCompanyScope(context.userId)

 const [ediel, agtRuntime, activeProductionActor, activeTestActor] = await Promise.all([
 getEdielSummary(supabase).catch(() => EMPTY_EDIEL_SUMMARY),
 getEdielAgtSupplierRuntime(companyScope.companyId).catch(() => null),
 getActiveEdielActorSettings('production', companyScope.companyId).catch(() => null),
 getActiveEdielActorSettings('test', companyScope.companyId).catch(() => null),
 ])

 const liveActor = activeProductionActor ?? activeTestActor ?? agtRuntime?.actor ?? null
 const liveAttention = ediel.failedMessages + ediel.ackPendingMessages + ediel.ackOverdueMessages
 const agtErrors = agtRuntime?.issues.filter((issue) => issue.severity === 'error').length ?? 0
 const agtWarnings = agtRuntime?.issues.filter((issue) => issue.severity === 'warning').length ?? 0
 const outboundCases = EDIEL_AGT_SUPPLIER_2026A_CASES.filter((item) => item.direction === 'actor_to_portal')
 const inboundCases = EDIEL_AGT_SUPPLIER_2026A_CASES.filter((item) => item.direction === 'portal_to_actor')

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Ediel Live Center"
 subtitle="Produktion för PRODAT, UTILTS, CONTRL och APERAK. Testmiljö och AGT hålls låst och separat från vanliga leverantörsflöden."
 userEmail={context.email}
 />

 <div className="space-y-8 p-8">
 <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-5">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900">Ediel Live</p>
 <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
 Liveflödet först. Testmiljö separat.
 </h1>
 <p className="mt-3 max-w-4xl text-sm font-medium leading-6 text-slate-700">
 GridCore ska fungera som SaaS: varje bolag har egna aktörs-id, route-profiler och kvittensregler.
 Därför visas liveflöde, Ediel Control Tower och adressering tydligt här. AGT är bara en låst testmiljö
 för godkännande.
 </p>
 </div>

 <div className="flex flex-wrap gap-2">
 <Pill tone={liveAttention > 0 ? 'amber' : 'emerald'}>
 {liveAttention > 0 ? `${liveAttention} live-ärenden` : 'Live ok'}
 </Pill>
 <Pill tone={agtRuntime?.isReady ? 'emerald' : agtErrors > 0 ? 'red' : 'amber'}>
 {agtRuntime?.isReady ? 'Testmiljö redo' : agtRuntime ? 'Testmiljö behöver kontroll' : 'Testmiljö ej laddad'}
 </Pill>
 </div>
 </div>
 </section>

 <section className="grid gap-5 xl:grid-cols-3">
 <AreaCard
 eyebrow="Produktion"
 title="Live-meddelanden"
 text="Meddelanden som hör till riktig kunddrift: PRODAT, UTILTS, CONTRL och APERAK. Följ status, fel, kvittenser och koppling till kundflöde."
 href="/admin/ediel/messages"
 cta="Öppna liveflöde"
 tone="production"
 />
 <AreaCard
 eyebrow="Driftkontroll"
 title="Ediel Control Tower"
 text="Övervaka saknad CONTRL/APERAK, negativ kvittens, UTILTS_ERR, dubbletter, route-problem och regelkonflikter."
 href="/admin/ediel/control-tower"
 cta="Öppna Control Tower"
 tone="settings"
 />
 <AreaCard
 eyebrow="Aktörsregister"
 title="Adressering och routes"
 text="Konfigurera Ediel-id, nätägare, leverantörer, BRP, subadresser, mailbox, versioner och ack-policy per bolag."
 href="/admin/ediel/routes"
 cta="Öppna adressering"
 tone="settings"
 />
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-5">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">
 Aktiv tenant och Ediel-profil
 </p>
 <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">
 {companyScope.companyName ?? 'Bolag ej valt'} · {liveActor?.actor_name ?? 'Ediel-profil saknas'}
 </h2>
 <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-700">
 Tenantprofilen är källan för Ediel-id, sender-namn, mailbox, Application Reference och route-profiler.
 När profilen sparas ska den ligga på samma company_id som kunder, routes, outbound, Ediel-meddelanden
 och mätvärden.
 </p>
 </div>

 <div className="flex flex-wrap gap-2">
 <Pill tone={liveActor ? 'emerald' : 'red'}>{liveActor ? 'Tenantprofil hittad' : 'Profil saknas'}</Pill>
 <Pill tone={activeProductionActor ? 'emerald' : activeTestActor ? 'amber' : 'red'}>
 {activeProductionActor ? 'Produktion aktiv' : activeTestActor ? 'Endast testprofil aktiv' : 'Ingen aktiv miljö'}
 </Pill>
 </div>
 </div>

 {companyScope.message ? (
 <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950">
 {companyScope.message}
 </div>
 ) : null}

 <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <ProfileField label="Bolag / tenant" value={companyScope.companyName} />
 <ProfileField label="Company ID" value={companyScope.companyId} />
 <ProfileField label="Miljö som visas" value={activeProductionActor ? 'production' : activeTestActor ? 'test' : liveActor?.environment} />
 <ProfileField label="Aktörsroll" value={liveActor?.actor_role} />
 <ProfileField label="Ediel-id" value={liveActor?.actor_ediel_id} />
 <ProfileField label="Sender-namn" value={liveActor?.sender_name ?? liveActor?.actor_name} />
 <ProfileField label="Sender subaddress" value={liveActor?.sender_sub_address} />
 <ProfileField label="Mailbox" value={liveActor?.mailbox} />
 <ProfileField label="Application Reference" value={liveActor?.default_application_reference} />
 <ProfileField label="SMTP från" value={liveActor?.smtp_from_email} />
 <ProfileField label="Charset" value={liveActor?.default_charset} />
 <ProfileField label="Testmiljö readiness" value={agtRuntime?.isReady ? 'redo' : `${agtErrors} fel / ${agtWarnings} varningar`} />
 </div>

 <div className="mt-5 flex flex-wrap gap-3">
 <Link
 href="/admin/ediel/settings"
 className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800"
 >
 Hantera tenantprofil
 </Link>
 <Link
 href="/admin/ediel/routes"
 className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 transition hover:bg-slate-50"
 >
 Kontrollera routes
 </Link>
 </div>
 </section>

 <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
 <Metric label="Totalt" value={ediel.totalMessages} hint="Live + historik" tone="emerald" />
 <Metric label="Inbound" value={ediel.inboundMessages} hint="Från motpart" />
 <Metric label="Outbound" value={ediel.outboundMessages} hint="Till motpart" />
 <Metric label="Drafts" value={ediel.draftMessages} hint="Granska före skick" tone={ediel.draftMessages > 0 ? 'amber' : 'slate'} />
 <Metric label="Felade" value={ediel.failedMessages} hint="Manuell åtgärd" tone={ediel.failedMessages > 0 ? 'red' : 'emerald'} />
 <Metric label="Kvittenser" value={ediel.ackPendingMessages} hint={`${ediel.ackOverdueMessages} försenade`} tone={ediel.ackPendingMessages > 0 ? 'amber' : 'emerald'} />
 </section>

 <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Rätt arbetssätt</p>
 <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">När något händer i Ediel</h2>
 </div>
 <Link
 href="/admin/ediel/control-tower"
 className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-50"
 >
 Control Tower
 </Link>
 </div>

 <div className="mt-5 grid gap-3">
 <FlowStep
 number="1"
 title="Se om det är live eller testmiljö"
 text="Kunddrift, switchar och mätvärden hanteras i liveflödet. AGT-run och portaltester hanteras i låst testmiljö."
 />
 <FlowStep
 number="2"
 title="Följ meddelandekedjan"
 text="Öppna meddelandet och kontrollera länken mellan PRODAT/UTILTS, CONTRL, APERAK och relevant kund-/switchärende."
 />
 <FlowStep
 number="3"
 title="Skicka bara från rätt kontext"
 text="Outbound draft ska komma från kundflöde eller låst testkörning. Manuella filgeneratorer ska inte vara primär arbetsväg."
 />
 </div>
 </div>

 <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white p-6 shadow-sm">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-900">Testmiljö / AGT-tester</p>
 <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">Låsta godkännandeflöden</h2>
 </div>
 <Pill tone={agtErrors > 0 ? 'red' : agtWarnings > 0 ? 'amber' : 'emerald'}>
 {agtErrors} fel · {agtWarnings} varningar
 </Pill>
 </div>

 <div className="mt-5 grid gap-3">
 {outboundCases.map((testCase) => (
 <CaseLine key={testCase.testCaseCode} label={`${testCase.testCaseCode} · ${testCase.messageCode}`} direction={testCase.direction} />
 ))}
 {inboundCases.map((testCase) => (
 <CaseLine key={testCase.testCaseCode} label={`${testCase.testCaseCode} · ${testCase.messageCode}`} direction={testCase.direction} />
 ))}
 </div>

 <p className="mt-4 text-sm font-medium leading-6 text-slate-700">
 AGT används endast för aktörs- och leverantörsgodkännande. Vanliga SaaS-kunder ska arbeta i
 Live-meddelanden, Control Tower och Routes.
 </p>
 </div>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-700">Separat från liveflödet</p>
 <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">Testverktyg ska inte styra daglig drift</h2>

 <div className="mt-5 grid gap-3 md:grid-cols-3">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-700">
 Filgeneratorer och testverktyg är inte primära flöden. De kan ligga kvar tekniskt men ska inte vara
 huvudväg för operatören.
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-700">
 TGT/AGT och portaldiagnostik hör hemma i låst testmiljö, inte i live Ediel Center.
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-700">
 Alla leverantörer ska kopplas via tenant-konfiguration: aktör, route, profil, mailbox och ack-policy.
 </div>
 </div>
 </section>
 </div>
 </div>
 )
}