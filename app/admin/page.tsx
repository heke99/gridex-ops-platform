// app/admin/page.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getTenantLiveAccessForAdmin } from '@/lib/tenant/liveAccess'
import { getEdielSummary, type EdielSummary } from '@/lib/ediel/summary'
import { getActiveEdielActorSettings } from '@/lib/ediel/config'

export const dynamic = 'force-dynamic'

type CountFilter = {
  column: string
  value: string | number | boolean | null
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
  supabase: SupabaseClient,
  table: string,
  companyId?: string | null,
  filters: CountFilter[] = []
) {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true })

    if (companyId) {
      query = query.eq('company_id', companyId)
    }

    for (const filter of filters) {
      query = filter.value === null ? query.is(filter.column, null) : query.eq(filter.column, filter.value)
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

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black ${classes[tone]}`}>{children}</span>
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

function ActionCard({
  title,
  text,
  href,
  cta,
  tone = 'emerald',
}: {
  title: string
  text: string
  href: string
  cta: string
  tone?: 'emerald' | 'slate' | 'amber'
}) {
  const styles =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-white'

  return (
    <section className={`rounded-3xl border p-6 shadow-sm ${styles}`}>
      <h2 className="text-lg font-black tracking-tight text-slate-950">{title}</h2>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-700">{text}</p>
      <Link href={href} className="mt-5 inline-flex rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800">
        {cta}
      </Link>
    </section>
  )
}

function StatusLine({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'emerald' | 'amber' | 'red' }) {
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
  const liveAccess = await getTenantLiveAccessForAdmin(context)

  const [
    ediel,
    productionActor,
    testActor,
    customers,
    contracts,
    sites,
    meteringPoints,
    missingPowerOfAttorney,
    waitingInfoRequests,
    blockedCustomers,
    openCases,
    openSwitches,
    billingUnderlays,
    companies,
    platformCustomers,
    platformMeteringPoints,
  ] = await Promise.all([
    getEdielSummary(supabase, isPlatformAdmin ? null : companyId).catch(() => EMPTY_EDIEL_SUMMARY),
    getActiveEdielActorSettings('production', companyId).catch(() => null),
    getActiveEdielActorSettings('test', companyId).catch(() => null),
    safeCount(supabase, 'customers', companyId),
    safeCount(supabase, 'customer_contracts', companyId),
    safeCount(supabase, 'customer_sites', companyId),
    safeCount(supabase, 'metering_points', companyId),
    safeCount(supabase, 'customer_blockers', companyId, [
      { column: 'blocker_type', value: 'missing_power_of_attorney' },
      { column: 'status', value: 'open' },
    ]),
    safeCount(supabase, 'customer_info_requests', companyId, [{ column: 'status', value: 'waiting_response' }]),
    safeCount(supabase, 'customers', companyId, [{ column: 'status', value: 'blocked' }]),
    safeCount(supabase, 'customer_cases', companyId, [{ column: 'status', value: 'open' }]),
    safeCount(supabase, 'supplier_switch_requests', companyId, [{ column: 'status', value: 'open' }]),
    safeCount(supabase, 'billing_underlays', companyId),
    isPlatformAdmin ? safeCount(supabase, 'companies') : Promise.resolve(0),
    isPlatformAdmin ? safeCount(supabase, 'customers') : Promise.resolve(0),
    isPlatformAdmin ? safeCount(supabase, 'metering_points') : Promise.resolve(0),
  ])

  const actor = productionActor ?? testActor
  const tenantReady = Boolean(companyId && actor?.actor_ediel_id)
  const hasWork = missingPowerOfAttorney + waitingInfoRequests + blockedCustomers + openCases + openSwitches > 0

  if (isPlatformAdmin) {
    return (
      <div className="min-h-screen">
        <AdminHeader
          title="Plattformsöversikt"
          subtitle="Superadmin-yta för tenants, aktörsprofiler, Ediel, masterdata, användare, säkerhet och SaaS-drift. Vanliga elbolag ser inte den här tekniska vyn."
          userEmail={context.email}
          workspaceName="Gridex Platform"
          workspaceMode="platform"
        />

        <div className="space-y-8 p-8">
          <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-900">Platform Control</p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">SaaS-drift för alla elhandelsbolag</h1>
                <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-slate-700">
                  Här hanteras bolag, tekniska aktörsprofiler, Ediel-regler, masterdata, användare och plattformsövervakning. Den här sidan är avsedd för superadmin.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill tone="emerald">Platform admin</Pill>
                <Pill tone={ediel.failedMessages + ediel.ackOverdueMessages > 0 ? 'amber' : 'emerald'}>
                  {ediel.failedMessages + ediel.ackOverdueMessages > 0 ? 'Systemvarningar finns' : 'Inga akuta Ediel-varningar'}
                </Pill>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard label="Bolag" value={companies} hint="Tenants på plattformen" href="/admin/companies" tone="emerald" />
            <MetricCard label="Kunder" value={platformCustomers} hint="Kunder över alla tenants" href="/admin/customers" />
            <MetricCard label="Mätpunkter" value={platformMeteringPoints} hint="Mätpunkter över alla tenants" href="/admin/metering" />
            <MetricCard label="Ediel" value={ediel.totalMessages} hint="Totala Ediel-meddelanden" href="/admin/ediel" />
            <MetricCard label="Fel" value={ediel.failedMessages} hint="Meddelanden som kräver kontroll" href="/admin/ediel/control-tower" tone={ediel.failedMessages > 0 ? 'red' : 'emerald'} />
            <MetricCard label="Fakturaunderlag" value={billingUnderlays} hint="Underlag på plattformen" href="/admin/billing" />
          </section>

          <section className="grid gap-5 xl:grid-cols-4">
            <ActionCard title="Bolag och användare" text="Skapa, pausa och administrera tenants, användare och rolltilldelningar." href="/admin/companies" cta="Öppna bolag" />
            <ActionCard title="Ediel och routes" text="Hantera aktörsprofiler, routes, regler och teknisk Ediel-governance." href="/admin/ediel" cta="Öppna Ediel Center" tone="slate" />
            <ActionCard title="Masterdata" text="Styr nätägare, elleverantörer, elområden och kommunikationsrutter centralt." href="/admin/network-owners" cta="Öppna masterdata" tone="slate" />
            <ActionCard title="Säkerhet och audit" text="Kontrollera roller, revision, tenant-isolering och plattformsvarningar." href="/admin/platform/security" cta="Öppna säkerhet" tone="amber" />
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Start"
        subtitle="Daglig arbetsyta för kundintag, fullmakter, uppgiftsbegäran, leverantörsbyte, fakturering och export. Tekniska Ediel- och masterdataändringar hanteras av superadmin."
        userEmail={context.email}
        workspaceName={companyScope.companyName}
        workspaceMode="tenant"
      />

      <div className="space-y-8 p-8">
        <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-900">Dagens arbete</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{companyScope.companyName ?? 'Bolagsyta'}</h1>
              <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-slate-700">
                Börja med kunder som saknar fullmakt, begäran som väntar på svar och rader som behöver åtgärdas före fakturering eller export.
              </p>
              {companyScope.message ? (
                <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-black text-amber-950">{companyScope.message}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill tone={tenantReady ? 'emerald' : 'amber'}>{tenantReady ? 'Bolagsstatus aktiv' : 'Bolagsstatus kräver kontroll'}</Pill>
              <Pill tone={hasWork ? 'amber' : 'emerald'}>{hasWork ? 'Åtgärder finns' : 'Inga akuta åtgärder'}</Pill>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Saknar fullmakt" value={missingPowerOfAttorney} hint="Kunder eller objekt där fullmakt behöver kompletteras" href="/admin/operations/tasks" tone={missingPowerOfAttorney > 0 ? 'amber' : 'emerald'} />
          <MetricCard label="Väntar svar" value={waitingInfoRequests} hint="Uppgiftsbegäran där svar saknas" href="/admin/customer-info-requests" tone={waitingInfoRequests > 0 ? 'amber' : 'emerald'} />
          <MetricCard label="Redo / pågående byte" value={openSwitches} hint="Leverantörsbyten som behöver följas upp" href="/admin/operations/switches" tone={openSwitches > 0 ? 'amber' : 'emerald'} />
          <MetricCard label="Blockerade kunder" value={blockedCustomers} hint="Kundflöden som behöver åtgärdas" href="/admin/customers" tone={blockedCustomers > 0 ? 'red' : 'emerald'} />
          <MetricCard label="Öppna ärenden" value={openCases} hint="Kundärenden och avvikelser" href="/admin/customer-cases" tone={openCases > 0 ? 'amber' : 'emerald'} />
        </section>

        <section className="grid gap-5 xl:grid-cols-5">
          <ActionCard title="Skapa kund" text="Registrera kund, avtal, dokument och fullmakt utan att ofullständiga uppgifter stoppar intaget." href="/admin/customers/intake" cta="Nytt kundintag" />
          <ActionCard title="Importera kunder" text="Granska fil- och PDF-rader innan osäker data blir riktiga kunder." href="/admin/customers/imports" cta="Öppna import" tone="slate" />
          <ActionCard title="Begär uppgifter" text="Skapa uppgiftsbegäran när signerad fullmakt finns." href="/admin/customer-info-requests" cta="Öppna begäran" tone="slate" />
          <ActionCard title="Fakturering" text="Följ faktureringsunderlag, blockerade rader och exportstatus." href="/admin/billing" cta="Öppna fakturering" tone="slate" />
          <ActionCard title="Arbetskö" text="Samla fullmakter, blockerare och uppgifter som kräver åtgärd." href="/admin/operations/tasks" cta="Öppna arbetskö" tone="amber" />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Status</p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">Bolagsdrift</h2>
                <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-700">
                  Den här vyn visar status. Ediel-id, routes, regler och masterdata ändras av superadmin så att liveflöden inte riskerar att brytas.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/company-actor-status" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-900 transition hover:bg-slate-50">
                  Öppna driftstatus
                </Link>
                <Link href="/admin/company-settings" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white transition hover:bg-emerald-800">
                  Bolagsinställningar
                </Link>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <StatusLine label="Bolagskoppling" value={companyScope.companyName ?? 'Saknas'} tone={companyId ? 'emerald' : 'red'} />
              <StatusLine label="Ediel-status" value={liveAccess.canUseLiveEdiel ? 'Live' : actor?.actor_ediel_id ? 'Förberedd' : 'Ej live'} tone={liveAccess.canUseLiveEdiel ? 'emerald' : actor?.actor_ediel_id ? 'amber' : 'red'} />
              <StatusLine label="Fakturaunderlag" value={billingUnderlays} tone={billingUnderlays > 0 ? 'emerald' : 'slate'} />
              <StatusLine label="Kunder" value={customers} tone={customers > 0 ? 'emerald' : 'slate'} />
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Snabb översikt</p>
            <div className="mt-5 grid gap-3">
              <StatusLine label="Avtal" value={contracts} tone={contracts > 0 ? 'emerald' : 'slate'} />
              <StatusLine label="Anläggningar" value={sites} tone={sites > 0 ? 'emerald' : 'slate'} />
              <StatusLine label="Mätpunkter" value={meteringPoints} tone={meteringPoints > 0 ? 'emerald' : 'slate'} />
              <StatusLine label="Fakturaunderlag" value={billingUnderlays} tone={billingUnderlays > 0 ? 'emerald' : 'slate'} />
            </div>
          </section>
        </section>
      </div>
    </div>
  )
}
