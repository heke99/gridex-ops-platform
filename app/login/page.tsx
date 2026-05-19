import Link from 'next/link'
import { loginAction } from './actions'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  error?: string
  next?: string
}>

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const error = params.error
  const next = params.next || '/dashboard'

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-emerald-50/70 to-sky-50 text-slate-950">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="hidden flex-col justify-between border-r border-emerald-100 bg-white/60 p-12 backdrop-blur lg:flex">
          <div>
            <Link href="/" className="inline-flex items-center gap-3 rounded-full border border-emerald-200 bg-white px-4 py-2 shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-700 text-sm font-bold text-white">
                G
              </span>
              <span>
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                  Gridex
                </span>
                <span className="block text-xs text-slate-500">Energy Operations</span>
              </span>
            </Link>

            <div className="mt-12 max-w-xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
                Säker arbetsyta
              </p>
              <h1 className="mt-4 text-5xl font-semibold tracking-[-0.04em] text-slate-950">
                Logga in till din elhandelsplattform.
              </h1>
              <p className="mt-6 text-lg leading-8 text-slate-600">
                Hantera kunder, anläggningar, avtal, fullmakter, leverantörsbyten,
                mätdata och operativa ärenden i ett samlat system.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ['Kunddrift', 'Kundkort, onboarding och dokument.'],
              ['Operations', 'Switchar, avvikelser och arbetsköer.'],
              ['SaaS-access', 'Bolag, användare och roller.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm shadow-emerald-950/5">
                <p className="text-sm font-semibold text-slate-950">{title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center lg:hidden">
              <Link href="/" className="inline-flex items-center justify-center rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm">
                Gridex Energy Operations
              </Link>
            </div>

            <div className="rounded-[2rem] border border-emerald-100 bg-white p-8 shadow-2xl shadow-emerald-950/10">
              <div className="mb-8">
                <div className="mb-3 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
                  Inloggning
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                  Välkommen tillbaka
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Åtkomst styrs av bolagstillhörighet, roll och behörigheter.
                </p>
              </div>

              {error ? (
                <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <form action={loginAction} className="space-y-5">
                <input type="hidden" name="next" value={next} />

                <label className="grid gap-2" htmlFor="email">
                  <span className="text-sm font-semibold text-slate-700">E-post</span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                    placeholder="namn@bolag.se"
                  />
                </label>

                <label className="grid gap-2" htmlFor="password">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-700">Lösenord</span>
                    <Link href="/login/forgot-password" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">
                      Glömt lösenord?
                    </Link>
                  </span>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                    placeholder="••••••••"
                  />
                </label>

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-emerald-700/20 transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                >
                  Logga in
                </button>
              </form>

              <div className="mt-6 border-t border-slate-200 pt-6">
                <p className="text-xs leading-6 text-slate-500">
                  Behöver du åtkomst till ett bolag? Be bolagets administratör eller plattformsansvarig att skicka en inbjudan.
                </p>
                <Link href="/" className="mt-4 inline-flex text-sm font-semibold text-slate-700 underline-offset-4 hover:underline">
                  Till startsidan
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
