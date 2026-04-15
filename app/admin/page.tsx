// app/admin/page.tsx

import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminAccess } from '@/lib/admin/guards'
import { getEdielSummary } from '@/lib/ediel/summary'

export const dynamic = 'force-dynamic'

function OverviewCard({
  eyebrow,
  title,
  text,
  href,
  cta,
}: {
  eyebrow: string
  title: string
  text: string
  href: string
  cta: string
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
        {text}
      </p>
      <div className="mt-5">
        <Link
          href={href}
          className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {cta}
        </Link>
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  tone = 'slate',
  href,
  sublabel,
}: {
  label: string
  value: number | string
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue'
  href?: string
  sublabel?: string
}) {
  const toneClasses: Record<typeof tone, string> = {
    slate:
      'border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-white',
    emerald:
      'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100',
    amber:
      'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
    rose:
      'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100',
    blue:
      'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100',
  }

  const content = (
    <div className={`rounded-3xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      {sublabel ? <div className="mt-2 text-xs opacity-75">{sublabel}</div> : null}
    </div>
  )

  if (!href) return content

  return (
    <Link href={href} className="block transition hover:scale-[1.01]">
      {content}
    </Link>
  )
}

export default async function AdminPage() {
  const admin = await requireAdminAccess()
  const supabase = await createSupabaseServerClient()

  const [
    {
      data: { user },
    },
    ediel,
  ] = await Promise.all([supabase.auth.getUser(), getEdielSummary(supabase)])

  const hasEdielAttention =
    ediel.queuedMessages > 0 ||
    ediel.failedMessages > 0 ||
    ediel.pendingAckMessages > 0

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Översikt"
        subtitle="Startpunkt för administration, CIS-flöden, dispatch, Ediel och operativ kontroll."
        userEmail={user?.email ?? admin.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-5 xl:grid-cols-4">
          <OverviewCard
            eyebrow="Admin"
            title="Roller och behörigheter"
            text="Hantera användare, tilläggsroller och individuella overrides för systemåtkomst."
            href="/admin/users"
            cta="Öppna användare"
          />

          <OverviewCard
            eyebrow="Operations"
            title="Switching och tasks"
            text="Följ leverantörsbyten, readiness, tasks och operativa avvikelser."
            href="/admin/operations"
            cta="Öppna operations"
          />

          <OverviewCard
            eyebrow="CIS"
            title="Metering, billing och exports"
            text="Arbeta med mätvärden, billing-underlag, partnerexporter och kundkort."
            href="/admin/metering"
            cta="Öppna CIS-moduler"
          />

          <OverviewCard
            eyebrow="Dispatch"
            title="Outbound queue"
            text="Routa extern kommunikation via partner_api, ediel_partner, file_export eller email_manual."
            href="/admin/outbound"
            cta="Öppna outbound"
          />
        </section>

        <section
          className={`rounded-3xl border p-6 shadow-sm ${
            hasEdielAttention
              ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'
              : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Ediel / Svenska kraftnät
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Ediel-läget just nu
              </h3>
              <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
                Den här rutan måste vara tydlig på dashboarden, eftersom Ediel är en
                kritisk extern kanal. Du ska direkt se om något väntar, har felat
                eller kräver kvittens.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/ediel"
                className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
              >
                Öppna Ediel-center
              </Link>
              <Link
                href="/admin/ediel/routes"
                className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Ediel-routes
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Totala Ediel-meddelanden"
              value={ediel.totalMessages}
              tone="blue"
              href="/admin/ediel"
              sublabel="All inbound och outbound historik"
            />
            <KpiCard
              label="Köade / förberedda"
              value={ediel.queuedMessages}
              tone={ediel.queuedMessages > 0 ? 'amber' : 'slate'}
              href="/admin/ediel"
              sublabel="Behöver skickas eller hanteras"
            />
            <KpiCard
              label="Felade"
              value={ediel.failedMessages}
              tone={ediel.failedMessages > 0 ? 'rose' : 'slate'}
              href="/admin/ediel"
              sublabel="Kräver manuell uppföljning"
            />
            <KpiCard
              label="Aktiva Ediel-routes"
              value={ediel.activeRoutes}
              tone={ediel.activeRoutes > 0 ? 'emerald' : 'amber'}
              href="/admin/ediel/routes"
              sublabel={`${ediel.configuredProfiles} profiler totalt`}
            />
            <KpiCard
              label="Aktiva testruns"
              value={ediel.activeTestRuns}
              tone={ediel.activeTestRuns > 0 ? 'amber' : 'slate'}
              href="/admin/ediel"
              sublabel="TGT / testspår under arbete"
            />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <KpiCard
              label="Inbound"
              value={ediel.inboundMessages}
              tone="slate"
              href="/admin/ediel"
              sublabel="Från nätägare / Edieltrafik in"
            />
            <KpiCard
              label="Outbound"
              value={ediel.outboundMessages}
              tone="slate"
              href="/admin/ediel"
              sublabel="Z03, Z09, kvittenser och annan trafik ut"
            />
            <KpiCard
              label="Drafts"
              value={ediel.draftMessages}
              tone={ediel.draftMessages > 0 ? 'amber' : 'slate'}
              href="/admin/ediel"
              sublabel="Klara att granskas eller skickas"
            />
            <KpiCard
              label="Väntande kvittenser"
              value={ediel.pendingAckMessages}
              tone={ediel.pendingAckMessages > 0 ? 'amber' : 'slate'}
              href="/admin/ediel"
              sublabel="APERAK / CONTRL som väntar"
            />
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Vad som är aktivt nu
          </h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-7">
            {[
              'RBAC och access',
              'Kundregister',
              'Anläggningar',
              'Mätpunkter',
              'Switching',
              'Outbound dispatch',
              'Ediel operations',
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-4">
          <OverviewCard
            eyebrow="Routes"
            title="Kommunikationsroutes"
            text="Definiera hur varje scope routas per nätägare eller global default."
            href="/admin/integrations/routes"
            cta="Hantera routes"
          />

          <OverviewCard
            eyebrow="Ediel"
            title="Ediel-center"
            text="Arbeta med PRODAT, UTILTS, mailbox polling, SMTP-sändning, kvittenser och testspår."
            href="/admin/ediel"
            cta="Öppna Ediel"
          />

          <OverviewCard
            eyebrow="Ediel"
            title="Ediel-routes"
            text="Ställ in Gridex Ediel-id, mottagare, subadresser, mailbox och Strato SMTP/IMAP per route."
            href="/admin/ediel/routes"
            cta="Konfigurera Ediel"
          />

          <OverviewCard
            eyebrow="Bulk"
            title="Redo för byte"
            text="Köa externa leverantörsbytesrequests i bulk för ärenden som är klara att skickas vidare."
            href="/admin/outbound/ready-switches"
            cta="Öppna bulk switch"
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          <OverviewCard
            eyebrow="Bulk"
            title="Saknade mätvärden"
            text="Identifiera mätpunkter utan importerade värden och köa extern förfrågan i bulk."
            href="/admin/outbound/missing-meter-values"
            cta="Öppna bulk mätvärden"
          />

          <OverviewCard
            eyebrow="Outbound"
            title="Unresolved requests"
            text="Hantera ärenden där route, payload eller mottagare ännu inte är tillräckligt tydliga."
            href="/admin/outbound/unresolved"
            cta="Öppna unresolved"
          />

          <OverviewCard
            eyebrow="Partner"
            title="Partner exports"
            text="Följ billing-underlag, exports och vad som lämnas vidare till extern partner."
            href="/admin/partner-exports"
            cta="Öppna partner exports"
          />
        </section>
      </div>
    </div>
  )
}