import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminAccess } from '@/lib/admin/guards'

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

export default async function AdminPage() {
  const admin = await requireAdminAccess()
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Översikt"
        subtitle="Startpunkt för administration, CIS-flöden, dispatch och operativ kontroll."
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Vad som är aktivt nu
          </h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            {[
              'RBAC och access',
              'Kundregister',
              'Anläggningar',
              'Mätpunkter',
              'Switching',
              'Outbound dispatch',
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

        <section className="grid gap-5 xl:grid-cols-3">
          <OverviewCard
            eyebrow="Routes"
            title="Kommunikationsroutes"
            text="Definiera hur varje scope routas per nätägare eller global default."
            href="/admin/integrations/routes"
            cta="Hantera routes"
          />

          <OverviewCard
            eyebrow="Bulk"
            title="Saknade mätvärden"
            text="Identifiera mätpunkter utan importerade värden och köa extern förfrågan i bulk."
            href="/admin/outbound/missing-meter-values"
            cta="Öppna bulk mätvärden"
          />

          <OverviewCard
            eyebrow="Bulk"
            title="Redo för byte"
            text="Köa externa leverantörsbytesrequests i bulk för ärenden som är klara att skickas vidare."
            href="/admin/outbound/ready-switches"
            cta="Öppna bulk switch"
          />
        </section>
      </div>
    </div>
  )
}