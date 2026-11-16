// app/admin/ediel/page.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getEdielSummary, type EdielSummary } from '@/lib/ediel/summary'
import { getActiveEdielActorSettings } from '@/lib/ediel/config'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAgtSupplierRuntime } from '@/lib/ediel/testing/agtRuntime'

export const dynamic = 'force-dynamic'

type Tone = 'emerald' | 'amber' | 'red' | 'slate'

const PILL_TONES: Record<Tone, string> = {
 emerald: 'border-emerald-300 bg-emerald-50 text-emerald-900',
 amber: 'border-amber-300 bg-amber-50 text-amber-950',
 red: 'border-red-300 bg-red-50 text-red-950',
 slate: 'border-slate-300 bg-slate-50 text-slate-900',
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
 return (
 <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${PILL_TONES[tone]}`}>
 {children}
 </span>
 )
}

function Metric({ label, value, hint, tone = 'slate' }: { label: string; value: number | null; hint?: string; tone?: Tone }) {
 const border: Record<Tone, string> = {
 slate: 'border-slate-200',
 emerald: 'border-slate-200',
 amber: 'border-amber-300',
 red: 'border-red-300',
 }
 return (
 <div className={`rounded-2xl border bg-white p-4 shadow-sm ${border[tone]}`}>
 <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">{label}</div>
 <div className="mt-1 text-2xl font-black text-slate-950">{value ?? '—'}</div>
 {hint ? <div className="mt-1 text-xs font-medium text-slate-600">{hint}</div> : null}
 </div>
 )
}

function WorkLink({ href, title, text, badge }: { href: string; title: string; text: string; badge?: ReactNode }) {
 return (
 <Link
 href={href}
 className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-400 hover:shadow"
 >
 <div className="flex items-start justify-between gap-3">
 <span className="text-base font-black text-slate-950 group-hover:text-emerald-800">{title}</span>
 {badge}
 </div>
 <span className="mt-1 text-sm font-medium leading-6 text-slate-600">{text}</span>
 </Link>
 )
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
 const display = value === null || value === undefined || String(value).trim() === '' ? '—' : String(value)
 return (
 <div className="min-w-0">
 <dt className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">{label}</dt>
 <dd className="mt-0.5 break-all text-sm font-bold text-slate-950">{display}</dd>
 </div>
 )
}

const MORE_TOOLS: Array<{ href: string; label: string }> = [
 { href: '/admin/ediel/automation', label: 'Automation och SLA' },
 { href: '/admin/ediel/rule-profiles', label: 'Regelprofiler' },
 { href: '/admin/ediel/masterdata-reconciliation', label: 'Masterdata' },
 { href: '/admin/ediel/certification', label: 'Certifiering' },
 { href: '/admin/ediel/portal-feedback', label: 'Portalfeedback' },
 { href: '/admin/ediel/test-center', label: 'Testcenter' },
 { href: '/admin/ediel/contract-originals', label: 'Signerade avtalsoriginal' },
 { href: '/admin/ediel/signed-brp-declarations', label: 'Signerade BRP-deklarationer' },
 { href: '/admin/ediel/prodat-recovery', label: 'PRODAT-rättelse' },
 { href: '/admin/ediel/supply-rescission-sources', label: 'Återgång (Z08H)' },
]

export default async function EdielPage() {
 // Platform admin only; tenant admins are redirected by the guard.
 const context = await requirePlatformAdminAccess()
 const supabase = await createSupabaseServerClient()
 const companyScope = await getOperationalCompanyScope(context.userId)
 const companyId = companyScope.companyId

 const [ediel, agtRuntime, productionActor, testActor] = await Promise.all([
 getEdielSummary(supabase, companyId).catch((): EdielSummary | null => null),
 getEdielAgtSupplierRuntime(companyId).catch(() => null),
 getActiveEdielActorSettings('production', companyId).catch(() => null),
 getActiveEdielActorSettings('test', companyId).catch(() => null),
 ])

 const actor = productionActor ?? testActor ?? null
 const environment = productionActor ? 'Produktion' : testActor ? 'Test' : null
 const attention = ediel ? ediel.failedMessages + ediel.ackOverdueMessages : null
 const agtErrors = agtRuntime?.issues.filter((issue) => issue.severity === 'error').length ?? 0
 const agtWarnings = agtRuntime?.issues.filter((issue) => issue.severity === 'warning').length ?? 0
 const scopeLabel = companyScope.companyName ?? 'Alla bolag'

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Ediel"
 subtitle="PRODAT, UTILTS, CONTRL och APERAK för valt bolag."
 userEmail={context.email}
 workspaceName={companyScope.companyName}
 workspaceMode={companyId ? 'tenant' : 'platform'}
 />

 <div className="space-y-6 p-6 sm:p-8">
 {companyScope.message ? (
 <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
 {companyScope.message}
 </div>
 ) : null}

 <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">Aktörsprofil</div>
 <h2 className="mt-1 text-xl font-black text-slate-950">
 {scopeLabel} · {actor?.actor_name ?? 'Ingen aktiv profil'}
 </h2>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <Pill tone={productionActor ? 'emerald' : testActor ? 'amber' : 'red'}>{environment ?? 'Ingen aktiv miljö'}</Pill>
 {agtRuntime ? (
 <Pill tone={agtRuntime.isReady ? 'emerald' : agtErrors > 0 ? 'red' : 'amber'}>
 {agtRuntime.isReady ? 'Aktörstest godkänt' : `Aktörstest: ${agtErrors} fel, ${agtWarnings} varningar`}
 </Pill>
 ) : null}
 <Link
 href="/admin/ediel/settings"
 className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-900 transition hover:bg-slate-50"
 >
 Redigera
 </Link>
 </div>
 </div>

 {actor ? (
 <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
 <Field label="Ediel-id" value={actor.actor_ediel_id} />
 <Field label="Roll" value={actor.actor_role} />
 <Field label="Subadress" value={actor.sender_sub_address} />
 <Field label="Application Reference" value={actor.default_application_reference} />
 <Field label="Mailbox" value={actor.mailbox} />
 <Field label="Avsändare (SMTP)" value={actor.smtp_from_email} />
 <Field label="Teckenuppsättning" value={actor.default_charset} />
 </dl>
 ) : (
 <p className="mt-3 text-sm font-medium text-slate-700">
 {companyId
 ? 'Bolaget saknar aktiv Ediel-profil. Lägg upp Ediel-id, subadress och mailbox innan meddelanden kan skickas.'
 : 'Välj ett bolag i sidomenyn för att se dess Ediel-profil.'}
 </p>
 )}
 </section>

 <section>
 <div className="mb-3 flex items-baseline justify-between gap-3">
 <h2 className="text-sm font-black uppercase tracking-[0.12em] text-slate-700">Meddelanden · {scopeLabel}</h2>
 {ediel === null ? <span className="text-xs font-bold text-red-800">Kunde inte läsa statistik</span> : null}
 </div>
 <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
 <Metric label="Totalt" value={ediel?.totalMessages ?? null} />
 <Metric label="Inkommande" value={ediel?.inboundMessages ?? null} />
 <Metric label="Utgående" value={ediel?.outboundMessages ?? null} />
 <Metric label="Utkast" value={ediel?.draftMessages ?? null} tone={ediel && ediel.draftMessages > 0 ? 'amber' : 'slate'} />
 <Metric label="Felade" value={ediel?.failedMessages ?? null} tone={ediel && ediel.failedMessages > 0 ? 'red' : 'slate'} />
 <Metric
 label="Väntar kvittens"
 value={ediel?.ackPendingMessages ?? null}
 hint={ediel ? `${ediel.ackOverdueMessages} försenade` : undefined}
 tone={ediel && ediel.ackOverdueMessages > 0 ? 'red' : ediel && ediel.ackPendingMessages > 0 ? 'amber' : 'slate'}
 />
 </div>
 </section>

 <section>
 <div className="mb-3 flex items-center justify-between gap-3">
 <h2 className="text-sm font-black uppercase tracking-[0.12em] text-slate-700">Arbeta i</h2>
 <details className="relative">
 <summary className="cursor-pointer list-none rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-900 transition hover:bg-slate-50">
 Fler verktyg ▾
 </summary>
 <ul className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
 {MORE_TOOLS.map((tool) => (
 <li key={tool.href}>
 <Link href={tool.href} className="block px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
 {tool.label}
 </Link>
 </li>
 ))}
 </ul>
 </details>
 </div>
 <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <WorkLink
 href="/admin/ediel/messages"
 title="Meddelanden"
 text="Inkommande och utgående meddelanden med kvittenskedja och kundkoppling."
 badge={attention ? <Pill tone="red">{attention} att åtgärda</Pill> : null}
 />
 <WorkLink
 href="/admin/ediel/control-tower"
 title="Kontrollvy"
 text="Saknade eller negativa kvittenser, dubbletter och blockerade meddelanden."
 />
 <WorkLink
 href="/admin/ediel/outbox"
 title="Utkorg"
 text="Köade CONTRL, APERAK och UTILTS_ERR som väntar på att skickas."
 badge={ediel && ediel.queuedMessages > 0 ? <Pill tone="amber">{ediel.queuedMessages} i kö</Pill> : null}
 />
 <WorkLink
 href="/admin/ediel/routes"
 title="Routes"
 text="Motparter, Ediel-id, subadresser och kvittensregler per bolag."
 />
 </div>
 </section>
 </div>
 </div>
 )
}
