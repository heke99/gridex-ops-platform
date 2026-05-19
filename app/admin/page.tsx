import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { getEdielSummary, type EdielSummary } from '@/lib/ediel/summary'
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
    slate: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    emerald: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20',
    amber: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20',
    red: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20',
  }

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${classes[tone]}`}>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{value}</div>
      <div className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</div>
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
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
    red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-500/15 dark:text-red-200',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200',
  }

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${classes[tone]}`}>{children}</span>
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
    default: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    production: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20',
    test: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20',
    settings: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20',
  }

  return (
    <div className={`rounded-3xl border p-6 shadow-sm ${styles[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{eyebrow}</p>
      <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{text}</p>
      <Link href={href} className="mt-5 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
          {number}
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-950 dark:text-white">{title}</div>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{text}</p>
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
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <span className="text-sm font-semibold text-slate-950 dark:text-white">{label}</span>
      <Pill tone={outbound ? 'emerald' : 'emerald'}>{outbound ? 'Leverantör → Portal' : 'Portal → Leverantör'}</Pill>
    </div>
  )
}

export default async function EdielPage() {
  const context = await requireAnyPermissionServer(['communication.read'])
  const supabase = await createSupabaseServerClient()
  const [ediel, agtRuntime] = await Promise.all([
    getEdielSummary(supabase).catch(() => EMPTY_EDIEL_SUMMARY),
    getEdielAgtSupplierRuntime().catch(() => null),
  ])

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
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Ediel Live</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Liveflödet först. Testmiljö separat.</h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                GridCore ska fungera som SaaS: varje bolag har egna aktörs-id, route-profiler och kvittensregler. Därför visas liveflöde, Ediel Control Tower och adressering tydligt här. AGT är bara en låst testmiljö för godkännande.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill tone={liveAttention > 0 ? 'amber' : 'emerald'}>{liveAttention > 0 ? `${liveAttention} live-ärenden` : 'live ok'}</Pill>
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Aktiv tenant och aktörsprofil</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{agtRuntime?.actor?.actor_name ?? 'Ingen aktiv leverantör vald'}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                Live Ediel och testmiljö ska alltid utgå från aktiv aktörsprofil. Byter du leverantör i SaaS-läget ska Ediel-id, mailbox, sender-namn och route-profiler styras av konfiguration – inte av kod.
              </p>
            </div>
            <div className="grid gap-2 text-sm md:min-w-72">
              <div className="flex justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Ediel-id</span>
                <span className="font-mono font-semibold text-slate-950 dark:text-white">{agtRuntime?.actor?.actor_ediel_id ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Mailbox</span>
                <span className="font-mono font-semibold text-slate-950 dark:text-white">{agtRuntime?.actor?.mailbox ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Testmiljö readiness</span>
                <span className="font-semibold text-slate-950 dark:text-white">{agtRuntime?.isReady ? 'redo' : `${agtErrors} fel / ${agtWarnings} varningar`}</span>
              </div>
            </div>
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
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rätt arbetssätt</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">När något händer i Ediel</h2>
              </div>
              <Link href="/admin/ediel/control-tower" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                Control Tower
              </Link>
            </div>
            <div className="mt-5 grid gap-3">
              <FlowStep number="1" title="Se om det är live eller testmiljö" text="Kunddrift, switchar och mätvärden hanteras i liveflödet. AGT-run och portaltester hanteras i låst testmiljö." />
              <FlowStep number="2" title="Följ meddelandekedjan" text="Öppna meddelandet och kontrollera länken mellan PRODAT/UTILTS, CONTRL, APERAK och relevant kund-/switchärende." />
              <FlowStep number="3" title="Skicka bara från rätt kontext" text="Outbound draft ska komma från kundflöde eller låst testkörning. Manuella filgeneratorer ska inte vara primär arbetsväg." />
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Testmiljö / AGT-tester</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">Låsta godkännandeflöden</h2>
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

            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-400">
              AGT används endast för aktörs- och leverantörsgodkännande. Vanliga SaaS-kunder ska arbeta i Live-meddelanden, Control Tower och Routes.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Separat från liveflödet</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">Testverktyg ska inte styra daglig drift</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              Filgeneratorer och testverktyg är inte primära flöden. De kan ligga kvar tekniskt men ska inte vara huvudväg för operatören.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              TGT/AGT och portaldiagnostik hör hemma i låst testmiljö, inte i live Ediel Center.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              Alla leverantörer ska kopplas via tenant-konfiguration: aktör, route, profil, mailbox och ack-policy.
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
