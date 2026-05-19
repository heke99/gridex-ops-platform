import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminAccess } from '@/lib/admin/guards'
import { getEdielSummary, type EdielSummary } from '@/lib/ediel/summary'

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
  tone?: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose'
}) {
  const classes: Record<typeof tone, string> = {
    slate: 'border-slate-200 bg-white text-slate-950',
    blue: 'border-sky-200 bg-sky-50 text-sky-950',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    amber: 'border-amber-200 bg-amber-50 text-amber-950',
    rose: 'border-rose-200 bg-rose-50 text-rose-950',
  }

  const content = (
    <div className={`rounded-[2rem] border p-5 shadow-sm ${classes[tone]}`}>
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
  tone?: 'default' | 'primary' | 'attention'
}) {
  const styles: Record<typeof tone, string> = {
    default: 'border-emerald-100 bg-white text-slate-950 shadow-emerald-950/5',
    primary: 'border-emerald-700 bg-emerald-700 text-white shadow-emerald-700/20',
    attention: 'border-amber-200 bg-amber-50 text-amber-950',
  }
  const muted = tone === 'primary' ? 'text-emerald-50/80' : 'text-slate-500'
  const button =
    tone === 'primary'
      ? 'bg-white text-emerald-900 hover:bg-emerald-50'
      : 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'

  return (
    <div className={`rounded-[2rem] border p-6 shadow-sm ${styles[tone]}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${muted}`}>{eyebrow}</p>
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className={`mt-2 text-sm leading-6 ${muted}`}>{text}</p>
      <Link href={href} className={`mt-5 inline-flex rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${button}`}>
        {cta}
      </Link>
    </div>
  )
}

export default async function AdminPage() {
  const admin = await requireAdminAccess()
  const supabase = await createSupabaseServerClient()

  const [
    { data: user },
    ediel,
    companies,
    activeCompanies,
    customers,
    activeCustomers,
    sites,
    meteringPoints,
    switchRequests,
    unresolvedOutbound,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getEdielSummary(supabase).catch(() => EMPTY_EDIEL_SUMMARY),
    safeCount(supabase, 'companies'),
    safeCount(supabase, 'companies', [{ column: 'status', value: 'active' }]),
    safeCount(supabase, 'customers'),
    safeCount(supabase, 'customers', [{ column: 'status', value: 'active' }]),
    safeCount(supabase, 'customer_sites'),
    safeCount(supabase, 'metering_points'),
    safeCount(supabase, 'supplier_switch_requests'),
    safeCount(supabase, 'outbound_requests', [
      { column: 'status', op: 'in', value: ['failed', 'blocked', 'unresolved'] },
    ]),
  ])

  const edielNeedsAttention =
    ediel.failedMessages +
    ediel.queuedMessages +
    ediel.ackPendingMessages +
    ediel.ackOverdueMessages
  const totalActions = edielNeedsAttention + unresolvedOutbound

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Dashboard"
        subtitle="Översikt för bolag, kunddrift, operations, Ediel och partnerhandoff."
        userEmail={user.user?.email ?? admin.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="rounded-[2.25rem] border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-6 shadow-sm shadow-emerald-950/5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Control Center</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                Daglig översikt för elhandelsdrift
              </h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600">
                Följ det som behöver prioriteras: nya kunder, avtal, anläggningar,
                leverantörsbyten, Ediel-kvittenser, mätdata och externa handoffs.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/companies" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                Företag
              </Link>
              <Link href="/admin/customers/intake" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-700/20 hover:bg-emerald-800">
                Lägg till kund
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-5">
          <NumberCard label="Företag" value={companies} hint={`${activeCompanies} aktiva bolag`} href="/admin/companies" tone="emerald" />
          <NumberCard label="Kunder" value={customers} hint={`${activeCustomers} aktiva kunder`} href="/admin/customers" tone="blue" />
          <NumberCard label="Anläggningar" value={sites} hint={`${meteringPoints} mätpunkter i systemet`} href="/admin/customers" tone="slate" />
          <NumberCard label="Switchärenden" value={switchRequests} hint="Leverantörsbyten och onboarding" href="/admin/operations/switches" tone="emerald" />
          <NumberCard
            label="Kräver åtgärd"
            value={totalActions}
            hint={`${edielNeedsAttention} Ediel + ${unresolvedOutbound} outbound`}
            href={edielNeedsAttention > 0 ? '/admin/ediel/control-tower' : '/admin/outbound/unresolved'}
            tone={totalActions > 0 ? 'amber' : 'emerald'}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <WorkCard
            eyebrow="SaaS-admin"
            title="Företag och användare"
            text="Skapa bolagskonton, bjud in bolagsansvariga och koppla användare till rätt arbetsyta."
            href="/admin/companies"
            cta="Öppna företag"
            tone="primary"
          />
          <WorkCard
            eyebrow="Daglig drift"
            title="Kunder och kundkort"
            text="Sök kund, se avtal, anläggningar, mätpunkter, fullmakter, intern historik och status för byten."
            href="/admin/customers"
            cta="Öppna kunder"
          />
          <WorkCard
            eyebrow="Operations"
            title="Switchar och outbound"
            text="Följ vad som är redo, vad som väntar på svar och vad som behöver manuell kontroll."
            href="/admin/operations"
            cta="Öppna operations"
            tone={totalActions > 0 ? 'attention' : 'default'}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <WorkCard
            eyebrow="Ediel"
            title="Meddelanden och kvittenser"
            text="Följ PRODAT, UTILTS, CONTRL och APERAK med tydlig koppling till drift och ärenden."
            href="/admin/ediel/messages"
            cta="Öppna meddelanden"
            tone={edielNeedsAttention > 0 ? 'attention' : 'default'}
          />
          <WorkCard
            eyebrow="Konfiguration"
            title="Routes och aktörsprofiler"
            text="Styr Ediel-id, subadresser, mailbox, SMTP, ack-policy och motparter per bolag."
            href="/admin/ediel/routes"
            cta="Hantera routing"
          />
          <WorkCard
            eyebrow="Underlag"
            title="Mätvärden och billing-underlag"
            text="Kontrollera underlag och exportkedjan som lämnas vidare till faktureringspartner."
            href="/admin/billing"
            cta="Öppna underlag"
          />
        </section>

        <section className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Ediel-status</h2>
              <p className="mt-1 text-sm text-slate-500">
                Snabb kontroll av liveflöde, köer, fel och väntande kvittenser.
              </p>
            </div>
            <Link href="/admin/ediel/control-tower" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
              Control tower
            </Link>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <NumberCard label="Totalt" value={ediel.totalMessages} hint="Alla Ediel-meddelanden" href="/admin/ediel/messages" tone="blue" />
            <NumberCard label="Drafts" value={ediel.draftMessages} hint="Ska granskas innan skick" href="/admin/ediel/messages" tone={ediel.draftMessages > 0 ? 'amber' : 'slate'} />
            <NumberCard label="Köade" value={ediel.queuedMessages + ediel.preparedMessages} hint="Väntar på dispatch" href="/admin/ediel/messages" tone={ediel.queuedMessages + ediel.preparedMessages > 0 ? 'amber' : 'slate'} />
            <NumberCard label="Felade" value={ediel.failedMessages} hint="Kräver kontroll" href="/admin/ediel/control-tower" tone={ediel.failedMessages > 0 ? 'rose' : 'slate'} />
            <NumberCard label="Kvittenser" value={ediel.ackPendingMessages} hint={`${ediel.ackOverdueMessages} försenade`} href="/admin/ediel/control-tower" tone={ediel.ackPendingMessages > 0 ? 'amber' : 'emerald'} />
          </div>
        </section>
      </div>
    </div>
  )
}
