import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminAccess } from '@/lib/admin/guards'
import { getEdielSummary, type EdielSummary } from '@/lib/ediel/summary'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielOperationsEngineStatus } from '@/lib/ediel/operations/engineStatus'

export const dynamic = 'force-dynamic'

type CountFilter = {
  column: string
  op?: 'eq' | 'in'
  value: string | number | boolean | Array<string | number | boolean>
}

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
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  filters: CountFilter[] = []
): Promise<number> {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true })

    for (const filter of filters) {
      if (filter.op === 'in' && Array.isArray(filter.value)) {
        query = query.in(filter.column, filter.value)
      } else {
        query = query.eq(filter.column, filter.value as string | number | boolean)
      }
    }

    const { count, error } = await query
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

function NumberCard({
  label,
  value,
  hint,
  href,
  tone = 'slate',
}: {
  label: string
  value: number | string
  hint: string
  href?: string
  tone?: 'slate' | 'mint' | 'emerald' | 'amber' | 'rose'
}) {
  const classes: Record<typeof tone, string> = {
    slate: 'border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-white',
    mint: 'border-emerald-100 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100',
    rose: 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-100',
  }

  const content = (
    <div className={`rounded-3xl border p-5 shadow-sm ${classes[tone]}`}>
      <div className="text-sm font-medium opacity-75">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs leading-5 opacity-75">{hint}</div>
    </div>
  )

  if (!href) return content

  return (
    <Link href={href} className="block transition hover:-translate-y-0.5 hover:shadow-sm">
      {content}
    </Link>
  )
}

function WorkCard({
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
  tone?: 'default' | 'primary' | 'test' | 'danger'
}) {
  const styles: Record<typeof tone, string> = {
    default: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    primary: 'border-slate-900 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950',
    test: 'border-emerald-100 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20',
    danger: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20',
  }
  const muted = tone === 'primary' ? 'text-white/70 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'
  const button =
    tone === 'primary'
      ? 'border-white/20 bg-white text-slate-950 dark:border-slate-200 dark:bg-slate-950 dark:text-white'
      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'

  return (
    <div className={`rounded-3xl border p-6 shadow-sm ${styles[tone]}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${muted}`}>{eyebrow}</p>
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className={`mt-2 text-sm leading-6 ${muted}`}>{text}</p>
      <Link href={href} className={`mt-5 inline-flex rounded-2xl border px-4 py-2.5 text-sm font-semibold ${button}`}>
        {cta}
      </Link>
    </div>
  )
}

function ModeRow({
  label,
  value,
  description,
  tone,
}: {
  label: string
  value: string
  description: string
  tone: 'green' | 'mint' | 'amber'
}) {
  const color =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
      : tone === 'mint'
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-950 dark:text-white">{label}</div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{value}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  )
}

export default async function AdminPage() {
  const admin = await requireAdminAccess()
  const supabase = await createSupabaseServerClient()
  const companyScope = await getOperationalCompanyScope(admin.userId)
  const companyFilters: CountFilter[] = companyScope.companyId
    ? [{ column: 'company_id', value: companyScope.companyId }]
    : []

  const [{ data: user }, ediel, customers, activeCustomers, sites, meteringPoints, switchRequests, unresolvedOutbound] = await Promise.all([
    supabase.auth.getUser(),
    getEdielSummary(supabase).catch(() => EMPTY_EDIEL_SUMMARY),
    safeCount(supabase, 'customers', companyFilters),
    safeCount(supabase, 'customers', [...companyFilters, { column: 'status', value: 'active' }]),
    safeCount(supabase, 'customer_sites', companyFilters),
    safeCount(supabase, 'metering_points', companyFilters),
    safeCount(supabase, 'supplier_switch_requests', companyFilters),
    safeCount(supabase, 'outbound_requests', [
      ...companyFilters,
      { column: 'status', op: 'in', value: ['failed', 'blocked', 'unresolved'] },
    ]),
  ])

  const edielNeedsAttention = ediel.failedMessages + ediel.queuedMessages + ediel.ackPendingMessages + ediel.ackOverdueMessages
  const engineStatus = getEdielOperationsEngineStatus()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Systemöversikt"
        subtitle="Översikt för kunddrift, Ediel, leverantörsbyten och externa överlämningar. Godkännandeflöden hålls separerade från daglig drift."
        userEmail={user.user?.email ?? admin.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Driftöversikt</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Fokusera på det som driver ett elhandelsbolag
              </h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                Översikten visar bara kärnflödena: kund, avtal, anläggning, leverantörsbyte, Ediel och export till faktureringspartner. TGT/AGT-ytor ligger separat så de inte blandas med produktion.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/customers/intake" className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                Lägg till kund
              </Link>
              <Link href="/admin/ediel" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                Öppna Ediel-center
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <NumberCard label="Kunder" value={customers} hint={`${activeCustomers} aktiva kunder`} href="/admin/customers" tone="mint" />
          <NumberCard label="Anläggningar" value={sites} hint={`${meteringPoints} mätpunkter i systemet`} href="/admin/customers" tone="slate" />
          <NumberCard label="Switchärenden" value={switchRequests} hint="Leverantörsbyte och onboardingflöden" href="/admin/operations/switches" tone="emerald" />
          <NumberCard
            label="Kräver åtgärd"
            value={edielNeedsAttention + unresolvedOutbound}
            hint={`${edielNeedsAttention} Ediel + ${unresolvedOutbound} ej matchade`}
            href={edielNeedsAttention > 0 ? '/admin/ediel/control-tower' : '/admin/outbound/unresolved'}
            tone={edielNeedsAttention + unresolvedOutbound > 0 ? 'amber' : 'emerald'}
          />
        </section>


        <section className="rounded-[2rem] border border-emerald-100 bg-white/90 p-6 shadow-sm shadow-emerald-950/5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Engine</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{engineStatus.title}</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{engineStatus.description}</p>
            </div>
            <Link href="/admin/ediel/agt" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
              Öppna AGT-engine
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {engineStatus.checks.map((check) => (
              <div key={check.label} className="rounded-2xl border border-emerald-100 bg-[#f7fbf8] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{check.label}</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{check.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <ModeRow
            label="Verklig körning"
            value="Produktion"
            tone="green"
            description="Kundkort, switchar, mätvärden, faktureringsunderlag, partnerexporter och aktiva Ediel-meddelanden."
          />
          <ModeRow
            label="Godkännande"
            value="AGT/TGT separat"
            tone="mint"
            description="Edielportalen, leverantörstester och testkörningar ska inte blandas med kunddrift eller produktionsköer."
          />
          <ModeRow
            label="Bolagsstruktur"
            value="Bolagsseparerad"
            tone="amber"
            description="Alla aktörs-id, routes och Ediel-profiler ska komma från bolagets konfiguration, inte från hårdkodade värden."
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <WorkCard
            eyebrow="Daglig drift"
            title="Kunder och kundkort"
            text="Sök kund, se avtal, anläggningar, mätpunkter, fullmakter, intern historik och status för byten."
            href="/admin/customers"
            cta="Öppna kunder"
            tone="primary"
          />
          <WorkCard
            eyebrow="Operations"
            title="Switchar och utskick"
            text="Följ vad som är redo, vad som väntar på svar och vad som fastnat i extern kommunikation."
            href="/admin/operations"
            cta="Öppna operations"
          />
          <WorkCard
            eyebrow="Ediel"
            title="Meddelanden och kvittenser"
            text="Liveflödet för PRODAT, UTILTS, CONTRL och APERAK. Här ska produktionskedjan följas."
            href="/admin/ediel/messages"
            cta="Öppna meddelanden"
            tone={edielNeedsAttention > 0 ? 'danger' : 'default'}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <WorkCard
            eyebrow="Ediel-godkännande"
            title="Leverantörs-AGT"
            text="L1/L7-utskick och L2–L5 inbound hålls i en egen testyta så testdata inte blandas med verkliga kundflöden."
            href="/admin/ediel/agt"
            cta="Öppna AGT"
            tone="test"
          />
          <WorkCard
            eyebrow="Konfiguration"
            title="Rutter och bolagsinställningar"
            text="Styr Ediel-id, subadresser, mailbox, SMTP, ack-policy och motparter per bolag."
            href="/admin/ediel/routes"
            cta="Hantera rutter"
          />
          <WorkCard
            eyebrow="Fakturering"
            title="Mätvärden och faktureringsunderlag"
            text="Kontrollera underlag och exportkedjan som senare lämnas vidare till faktureringspartner."
            href="/admin/billing"
            cta="Öppna underlag"
          />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Ediel-status</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Snabb kontroll av liveflödet. Godkännandekörningar ska följas i AGT-ytan, inte här.
              </p>
            </div>
            <Link href="/admin/ediel/control-tower" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Öppna driftkontroll
            </Link>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <NumberCard label="Totalt" value={ediel.totalMessages} hint="Alla Ediel-meddelanden" href="/admin/ediel/messages" tone="mint" />
            <NumberCard label="Förbereds" value={ediel.draftMessages} hint="Ska granskas innan skick" href="/admin/ediel/messages" tone={ediel.draftMessages > 0 ? 'amber' : 'slate'} />
            <NumberCard label="Köade" value={ediel.queuedMessages + ediel.preparedMessages} hint="Väntar på utskick" href="/admin/ediel/messages" tone={ediel.queuedMessages + ediel.preparedMessages > 0 ? 'amber' : 'slate'} />
            <NumberCard label="Felade" value={ediel.failedMessages} hint="Kräver manuell kontroll" href="/admin/ediel/control-tower" tone={ediel.failedMessages > 0 ? 'rose' : 'slate'} />
            <NumberCard label="Kvittenser" value={ediel.ackPendingMessages} hint={`${ediel.ackOverdueMessages} försenade`} href="/admin/ediel/control-tower" tone={ediel.ackPendingMessages > 0 ? 'amber' : 'emerald'} />
          </div>
        </section>
      </div>
    </div>
  )
}
