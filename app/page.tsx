import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const primaryHref = user ? '/dashboard' : '/login?next=/dashboard'

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between">
          <div>
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
              Gridex CIS
            </div>
            <p className="mt-3 text-sm text-slate-400">
              Internt system för kundservice, drift och elhandelsoperationer
            </p>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Gå till dashboard
              </Link>
            ) : (
              <Link
                href="/login?next=/dashboard"
                className="inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Logga in
              </Link>
            )}
          </div>
        </header>

        <section className="flex flex-1 items-center py-14 lg:py-20">
          <div className="grid w-full gap-10 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-emerald-300">
                Backoffice / CIS
              </div>

              <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Ett internt CIS-system för att hantera hela elhandelsflödet.
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Gridex Ops används internt för kundregister, anläggningar,
                mätpunkter, fullmakter, leverantörsbyten, mätvärden,
                fakturaunderlag, partnerexporter och operativ uppföljning.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={primaryHref}
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  {user ? 'Öppna dashboard' : 'Logga in till systemet'}
                </Link>

                <Link
                  href="/admin"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Gå till admin
                </Link>
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    title: 'Kundservice',
                    text: 'Slå upp kund, följ ärenden och ge snabb återkoppling.',
                  },
                  {
                    title: 'Switching',
                    text: 'Hantera fullmakter, readiness och leverantörsbyten.',
                  },
                  {
                    title: 'Metering',
                    text: 'Följ mätpunkter, mätvärden och underlag för vidare processer.',
                  },
                  {
                    title: 'Billing & exports',
                    text: 'Skicka fakturaunderlag och partnerexporter med spårbarhet.',
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur"
                  >
                    <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200">
                      {item.title}
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Systemöversikt
                </p>

                <div className="mt-5 grid gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium text-white">Kundkort</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Kunder, anläggningar, mätpunkter, interna anteckningar och audit.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium text-white">Operations center</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Tasks, switchärenden, historik och operativa uppföljningar.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium text-white">RBAC</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Roller, permission overrides och åtkomststyrning för teamet.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <p className="text-sm font-medium text-emerald-200">
                      Nästa fokus
                    </p>
                    <p className="mt-2 text-sm text-emerald-100/80">
                      Billing, metering, partner exports och fler CIS-moduler.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-3xl border border-white/10 bg-black/20 p-5">
                <p className="text-sm font-medium text-white">
                  {user ? 'Du är redan inloggad.' : 'Intern åtkomst krävs.'}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Systemet är avsett för interna användare inom administration,
                  kundservice, drift, operations och behörighetsstyrd handläggning.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}