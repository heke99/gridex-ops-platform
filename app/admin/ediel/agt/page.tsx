import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { listEdielTestRuns } from '@/lib/ediel/db'
import { getEdielAgtSupplierRuntime } from '@/lib/ediel/agtRuntime'
import {
 EDIEL_AGT_PORTAL_EDIEL_ID,
 EDIEL_AGT_PORTAL_SMTP,
 EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS,
 EDIEL_AGT_SUPPLIER_2026A_CASES,
} from '@/lib/ediel/agtRegistry'
import {
 createAgtSupplierTestRunAction,
 createAgtSupplierOutboundCommandAction,
 saveAgtSupplierRuntimeAction,
} from '@/app/admin/ediel/agt/actions'

export const dynamic = 'force-dynamic'

function inputClassName() {
 return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500'
}

function Field({
 label,
 value,
}: {
 label: string
 value: string | number | boolean | null | undefined
}) {
 const display = value === null || value === undefined || String(value).trim() === '' ? '—' : String(value)

 return (
 <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
 <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">{label}</div>
 <div className="mt-1 break-all text-sm text-slate-950">{display}</div>
 </div>
 )
}

function Badge({
 tone,
 children,
}: {
 tone: 'emerald' | 'amber' | 'red' | 'slate'
 children: ReactNode
}) {
 const className =
 tone === 'emerald'
 ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
 : tone === 'amber'
 ? 'border-amber-200 bg-amber-50 text-amber-700'
 : tone === 'red'
 ? 'border-red-200 bg-red-50 text-red-700'
 : 'border-slate-200 bg-slate-50 text-slate-700'

 return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>
}

function issueTone(severity: 'error' | 'warning' | 'info') {
 if (severity === 'error') return 'red' as const
 if (severity === 'warning') return 'amber' as const
 return 'emerald' as const
}

function RouteCard({
 title,
 family,
 route,
 profile,
}: {
 title: string
 family: 'PRODAT' | 'UTILTS'
 route: Awaited<ReturnType<typeof getEdielAgtSupplierRuntime>>['prodat']['route']
 profile: Awaited<ReturnType<typeof getEdielAgtSupplierRuntime>>['prodat']['profile']
}) {
 return (
 <div className="rounded-2xl border border-slate-200 bg-white p-5">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="text-lg font-semibold text-slate-950">{title}</div>
 <div className="mt-1 text-sm text-slate-700">Runtime route + Ediel profile som AGT använder.</div>
 </div>
 <div className="flex flex-wrap gap-2">
 <Badge tone={route?.is_active ? 'emerald' : 'red'}>{route?.is_active ? 'route aktiv' : 'route saknas/inaktiv'}</Badge>
 <Badge tone={profile?.is_enabled ? 'emerald' : 'red'}>{profile?.is_enabled ? 'profil aktiv' : 'profil saknas/inaktiv'}</Badge>
 </div>
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-2">
 <Field label="Route name" value={route?.route_name} />
 <Field label="Target email" value={route?.target_email} />
 <Field label="Sender Ediel-id" value={profile?.sender_ediel_id} />
 <Field label="Receiver Ediel-id" value={profile?.receiver_ediel_id} />
 <Field label="Sender subaddress" value={profile?.sender_sub_address} />
 <Field label="Receiver subaddress" value={profile?.receiver_sub_address} />
 <Field label="Ack mode" value={profile?.ack_mode} />
 <Field label="Encryption" value={profile?.encryption_mode} />
 </div>

 <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
 {family === 'PRODAT'
 ? `PRODAT AGT ska gå mot ${EDIEL_AGT_PORTAL_EDIEL_ID}. Sender-subadress ska följa tenantens Edielregisteruppgift; receiver-subadress är ${EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS}.`
 : `UTILTS AGT ska gå mot ${EDIEL_AGT_PORTAL_EDIEL_ID} utan subadress.`}
 </div>
 </div>
 )
}

function caseTone(hasRun: boolean) {
 return hasRun ? 'emerald' : 'slate'
}


function directionLabel(direction: 'actor_to_portal' | 'portal_to_actor') {
 return direction === 'actor_to_portal' ? 'Leverantör → Edielportalen' : 'Edielportalen → Leverantör'
}

function notesText(notes: string | string[]) {
 return Array.isArray(notes) ? notes.join(' ') : notes
}

function parseAgtActorNotes(notes?: string | null): { balanceResponsibleEdielId: string | null } {
 if (!notes) return { balanceResponsibleEdielId: null }
 try {
 const parsed = JSON.parse(notes) as { balanceResponsibleEdielId?: unknown }
 return {
 balanceResponsibleEdielId: typeof parsed.balanceResponsibleEdielId === 'string' && parsed.balanceResponsibleEdielId.trim()
 ? parsed.balanceResponsibleEdielId.trim()
 : null,
 }
 } catch {
 return { balanceResponsibleEdielId: null }
 }
}

export default async function EdielAgtPage() {
 const context = await requireAdminPageKeyAccess('ediel.workspace')
 const isPlatformAdmin = isPlatformAdminContext(context)
 const companyScope = await getOperationalCompanyScope(context.userId)
 const companyId = isPlatformAdmin ? null : companyScope.companyId
 const [runtime, testRuns] = await Promise.all([
 getEdielAgtSupplierRuntime(companyId),
 listEdielTestRuns(),
 ])

 const supplierAgtRuns = testRuns.filter(
 (run) =>
 run.role_code === 'supplier' &&
 run.approval_version === '2026A' &&
 EDIEL_AGT_SUPPLIER_2026A_CASES.some(
 (testCase) => testCase.suite === run.test_suite && testCase.testCaseCode === run.test_case_code
 )
 )

 const errorCount = runtime.issues.filter((issue) => issue.severity === 'error').length
 const warningCount = runtime.issues.filter((issue) => issue.severity === 'warning').length
 const agtActorNotes = parseAgtActorNotes(runtime.actor?.notes)

 return (
 <div className="space-y-6">
 <AdminHeader
 title="Testmiljö / AGT-tester"
 subtitle="Låst godkännandeyta för Edielportalen. Vanliga leverantörer ska arbeta i Ediel Live Center; detta läge används bara vid aktörs- och leverantörsgodkännande."
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Platform Control' : companyScope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 p-5">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Låst testmiljö</div>
 <h1 className="mt-1 text-2xl font-semibold text-slate-950">Först ska testmiljön vara redo</h1>
 <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
 Värdena i formuläret sparas i aktörskort, communication_routes och ediel_route_profiles. Nuvarande värden är bara förifyllda defaultvärden i formuläret. Runtime ska läsa från databasen så att samma SaaS-flöde fungerar för varje leverantör/tenant senare.
 </p>
 </div>
 <div className="flex flex-wrap gap-2">
 <Badge tone={runtime.isReady ? 'emerald' : 'red'}>{runtime.isReady ? 'testmiljö redo' : 'testmiljö blockerad'}</Badge>
 <Badge tone={errorCount > 0 ? 'red' : 'emerald'}>fel {errorCount}</Badge>
 <Badge tone={warningCount > 0 ? 'amber' : 'emerald'}>varningar {warningCount}</Badge>
 <Link href="/admin/ediel" className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
 Till Ediel
 </Link>
 </div>
 </div>
 </section>

 <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
 <Field label="Aktiv aktör" value={runtime.actor?.actor_name} />
 <Field label="Aktörens Ediel-id" value={runtime.actor?.actor_ediel_id} />
 <Field label="Aktörsroll" value={runtime.actor?.actor_role} />
 <Field label="Miljö" value={runtime.actor?.environment} />
 <Field label="Portal Ediel-id" value={EDIEL_AGT_PORTAL_EDIEL_ID} />
 <Field label="Portal SMTP" value={EDIEL_AGT_PORTAL_SMTP} />
 </section>

 {runtime.issues.length > 0 ? (
 <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
 <h2 className="text-lg font-semibold text-slate-950">Readiness issues</h2>
 <div className="mt-4 space-y-3">
 {runtime.issues.map((issue) => (
 <div key={issue.code} className="rounded-xl border border-white/70 bg-white p-4">
 <div className="flex flex-wrap items-center gap-2">
 <Badge tone={issueTone(issue.severity)}>{issue.severity}</Badge>
 <div className="text-sm font-semibold text-slate-950">{issue.title}</div>
 </div>
 <div className="mt-1 text-sm text-slate-700">{issue.description}</div>
 </div>
 ))}
 </div>
 </section>
 ) : (
 <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
 Readiness är grön. Du kan starta ett AGT-test i Edielportalen och skapa motsvarande run här som bevislogg.
 </section>
 )}

 <section className="rounded-2xl border border-slate-200 bg-white p-6">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-950">Leverantörens AGT-info</h2>
 <p className="mt-1 text-sm text-slate-700">
 Det är här du lägger in aktiv leverantör/tenant. För framtida SaaS-kunder ändras samma fält till kundens bolagsnamn, Ediel-id och e-post/routing.
 </p>
 </div>

 <form action={saveAgtSupplierRuntimeAction} className="grid gap-5 xl:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 p-4">
 <div className="mb-3 text-sm font-semibold text-slate-900">Aktörskort</div>
 <div className="grid gap-3 md:grid-cols-2">
 <label className="text-sm text-slate-700">
 Bolagsnamn
 <input name="actor_name" defaultValue={runtime.actor?.actor_name ?? ''} className={inputClassName()} />
 </label>
 <label className="text-sm text-slate-700">
 Leverantörens Ediel-id
 <input name="actor_ediel_id" defaultValue={runtime.actor?.actor_ediel_id ?? ''} className={inputClassName()} />
 </label>
 <label className="text-sm text-slate-700">
 Balansansvarig Ediel-id
 <input name="balance_responsible_ediel_id" defaultValue={agtActorNotes.balanceResponsibleEdielId ?? ''} className={inputClassName()} placeholder="BRP-id krävs för L1/L7 Z03/Z09" />
 </label>
 <label className="text-sm text-slate-700">
 PRODAT sender subaddress
 <input name="prodat_sender_sub_address" defaultValue={runtime.prodat.profile?.sender_sub_address ?? runtime.actor?.sender_sub_address ?? ''} className={inputClassName()} placeholder="Lämna tom om Edielregistret saknar subadress" />
 </label>
 <label className="text-sm text-slate-700">
 Sender name
 <input name="sender_name" defaultValue={runtime.actor?.sender_name ?? runtime.actor?.actor_name ?? ''} className={inputClassName()} />
 </label>
 <label className="text-sm text-slate-700">
 Mailbox
 <input name="mailbox" defaultValue={runtime.actor?.mailbox ?? 'INBOX'} className={inputClassName()} />
 </label>
 <label className="text-sm text-slate-700">
 SMTP from email
 <input name="smtp_from_email" defaultValue={runtime.actor?.smtp_from_email ?? ''} className={inputClassName()} placeholder="din avsändaradress" />
 </label>
 <label className="text-sm text-slate-700">
 Reply-to
 <input name="smtp_reply_to_email" defaultValue={runtime.actor?.smtp_reply_to_email ?? ''} className={inputClassName()} placeholder="valfritt" />
 </label>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 p-4">
 <div className="mb-3 text-sm font-semibold text-slate-900">Edielportalen / AGT-routes</div>
 <div className="grid gap-3 md:grid-cols-2">
 <label className="text-sm text-slate-700">
 Mottagare
 <input name="receiver_name" defaultValue="Edielportalen" className={inputClassName()} />
 </label>
 <label className="text-sm text-slate-700">
 SMTP till portalen
 <input name="target_email" defaultValue={EDIEL_AGT_PORTAL_SMTP} className={inputClassName()} />
 </label>
 <label className="text-sm text-slate-700">
 PRODAT application reference
 <input name="prodat_application_reference" defaultValue={runtime.prodat.profile?.application_reference ?? '23-DDQ-PRODAT'} className={inputClassName()} />
 </label>
 <label className="text-sm text-slate-700">
 PRODAT default version
 <input name="prodat_default_message_version" defaultValue={runtime.prodat.profile?.default_message_version ?? ''} className={inputClassName()} placeholder="valfritt" />
 </label>
 <label className="text-sm text-slate-700">
 UTILTS default version
 <input name="utilts_default_message_version" defaultValue={runtime.utilts.profile?.default_message_version ?? ''} className={inputClassName()} placeholder="valfritt" />
 </label>
 </div>

 <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
 Knappen skapar/uppdaterar ett aktivt test-aktörskort, en PRODAT-route och en UTILTS-route. PRODAT AGT sparas med tenantens registrerade sender-subadress om sådan finns, receiver-subadress PRODAT och okrypterad SMTP. Balansansvarig Ediel-id sparas i aktörens AGT-notes och används som NAD+Z02 i L1/L7.
 </div>
 </div>

 <div className="xl:col-span-2">
 <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
 Spara AGT-runtime
 </button>
 </div>
 </form>
 </section>

 <section className="grid gap-4 xl:grid-cols-2">
 <RouteCard title="PRODAT AGT route" family="PRODAT" route={runtime.prodat.route} profile={runtime.prodat.profile} />
 <RouteCard title="UTILTS AGT route" family="UTILTS" route={runtime.utilts.route} profile={runtime.utilts.profile} />
 </section>

 <section className="rounded-2xl border border-slate-200 bg-white p-6">
 <div className="mb-5">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Testfall 2026A</h2>
 <p className="mt-1 text-sm text-slate-700">
 Kör ett test åt gången. L1/L7 skickas som outbound-kommandon direkt till portalen. L2–L5 ska vänta på inbound från Edielportalen.
 </p>
 </div>
 <Badge tone="emerald">testläge separat från produktion</Badge>
 </div>
 <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
 Den här sidan ska bara användas för AGT. Verkliga kundflöden skapas från kundkort, operations och live Ediel-meddelanden.
 </div>
 </div>

 <div className="grid gap-3 lg:grid-cols-2">
 {EDIEL_AGT_SUPPLIER_2026A_CASES.map((testCase) => {
 const activeRun = supplierAgtRuns.find(
 (run) => run.test_suite === testCase.suite && run.test_case_code === testCase.testCaseCode
 )
 const hasRun = Boolean(activeRun)
 const actorToPortal = testCase.direction === 'actor_to_portal'
 return (
 <div key={`${testCase.suite}-${testCase.testCaseCode}`} className="rounded-2xl border border-slate-200 p-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div>
 <div className="text-sm font-semibold text-slate-950">{testCase.title}</div>
 <div className="mt-1 text-xs text-slate-700">{testCase.suite} · {testCase.messageCode} · {directionLabel(testCase.direction)}</div>
 </div>
 <Badge tone={caseTone(hasRun)}>{hasRun ? `run ${activeRun?.status}` : 'ej skapad'}</Badge>
 </div>
 <p className="mt-3 text-sm leading-6 text-slate-700">{notesText(testCase.notes)}</p>

 {actorToPortal ? (
 <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
 <div className="font-semibold">Kontroll innan skick</div>
 <div>UNB sender: leverantörens Ediel-id + registrerad sender-subadress om den finns.</div>
 <div>UNB receiver: {EDIEL_AGT_PORTAL_EDIEL_ID}:ZZ:{EDIEL_AGT_PRODAT_RECEIVER_SUB_ADDRESS}</div>
 <div>L1/L7 ska innehålla NAD+Z02 enligt portalens validering. Fyll i balansansvarig/BRP Ediel-id innan du skickar outbound.</div>
 </div>
 ) : (
 <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
 <div className="font-semibold">Portal → Aktör</div>
 <div>Starta testet i Edielportalen och importera inbound {testCase.messageCode}. Skapa sedan CONTRL + APERAK från inbound-raden.</div>
 </div>
 )}

 <div className="mt-4 flex flex-wrap gap-2">
 <Link
 href={`/admin/ediel/agt/${testCase.testCaseCode}`}
 className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
 >
 Öppna testmotor
 </Link>

 <form action={createAgtSupplierTestRunAction}>
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
 Skapa run {testCase.testCaseCode}
 </button>
 </form>

 {actorToPortal ? (
 <form action={createAgtSupplierOutboundCommandAction}>
 <input type="hidden" name="test_case_code" value={testCase.testCaseCode} />
 <input type="hidden" name="test_run_id" value={activeRun?.id ?? ''} />
 <button
 disabled={!hasRun || runtime.issues.some((issue) => issue.severity === 'error')}
 className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
 >
 {hasRun ? 'Generera + skicka' : 'Skapa run först'}
 </button>
 </form>
 ) : (
 <Link
 href={`/admin/ediel/agt/${testCase.testCaseCode}`}
 className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
 >
 Importera/koppla inbound
 </Link>
 )}
 </div>
 </div>
 )
 })}
 </div>
 </section>

 <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
 <h2 className="text-lg font-semibold text-slate-950">Praktisk körordning</h2>
 <p className="mt-2 text-sm leading-6 text-emerald-900">
 Spara AGT-runtime först. Starta L1 i Edielportalen, skapa L1-run här, fyll i balansansvarig/BRP Ediel-id och skicka L1 direkt från GridCore. L2-L5 är Portal → Aktör: starta testet i portalen, importera inbound PRODAT och skapa CONTRL + APERAK från inbound-raden. Kör L7 sist som outbound Z09-kommandot.
 </p>
 </section>
 </div>
 )
}
