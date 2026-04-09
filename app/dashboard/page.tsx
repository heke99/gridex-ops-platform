import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function DashboardCard({
  title,
  description,
  href,
  cta,
}: {
  title: string
  description: string
  href: string
  cta: string
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-6">
        <Link
          href={href}
          className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          {cta}
        </Link>
      </div>
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="space-y-8">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">
              Startyta
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Välkommen till Gridex CIS
            </h1>

            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
              Det här är den interna arbetsytan för kundservice, operations och
              elhandelsadministration. Härifrån går du vidare till kunder,
              switchflöden, roller, audit och kommande CIS-moduler som metering,
              billing och partnerexporter.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Inloggad användare
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">
              {user?.email ?? 'Okänd användare'}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Arbetsyta</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            CIS
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Kundservice, drift, switching och intern kontroll.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Admin</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            Aktiv
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Roller, audit och admin foundation är igång.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Operations</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            Live
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Tasks, switchärenden och operativ uppföljning finns på plats.
          </p>
        </div>

        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <p className="text-sm font-medium text-emerald-700">Nästa fokus</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-emerald-900">
            CIS-moduler
          </p>
          <p className="mt-2 text-sm text-emerald-800">
            Metering, billing, partner exports, cases och dokumentflöden.
          </p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <DashboardCard
          title="Admin Console"
          description="Gå till den interna adminytan för användare, roller, audit, kunder och systemets kärnmoduler."
          href="/admin"
          cta="Öppna admin"
        />

        <DashboardCard
          title="Operations Center"
          description="Följ tasks, readiness, fullmakter och leverantörsbyten i den centrala operationskön."
          href="/admin/operations"
          cta="Öppna operations"
        />

        <DashboardCard
          title="Kundregister"
          description="Sök upp kundkort, se anläggningar, mätpunkter, interna anteckningar och operativ historik."
          href="/admin/customers"
          cta="Öppna kunder"
        />

        <DashboardCard
          title="Användare & access"
          description="Hantera interna användare, roller och permission overrides för kundservice, operations och admin."
          href="/admin/users"
          cta="Öppna användare"
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Vad systemet används till
        </h2>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            'Hantera kunder och kundkort',
            'Driva leverantörsbyten och fullmakter',
            'Följa mätpunkter och kommande mätvärdesflöden',
            'Skicka underlag och partnerexporter med kontroll',
          ].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700"
            >
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}