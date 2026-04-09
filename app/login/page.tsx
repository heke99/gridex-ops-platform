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
    <main className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-2">
        <section className="hidden justify-between border-r bg-white/70 p-12 backdrop-blur lg:flex lg:flex-col">
          <div>
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Gridex CIS
            </Link>

            <div className="mt-10 max-w-xl">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900">
                Ett internt system för kundservice, operations och elhandelsdrift
              </h1>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Logga in för att hantera kunder, anläggningar, mätpunkter,
                leverantörsbyten, mätvärden, fakturaunderlag och partnerexporter.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-900">Kundservice</p>
              <p className="mt-2 text-sm text-slate-600">
                Kundkort, kontaktlogg och supportflöden.
              </p>
            </div>

            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-900">Operations</p>
              <p className="mt-2 text-sm text-slate-600">
                Fullmakter, readiness, tasks och switchärenden.
              </p>
            </div>

            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-900">CIS Core</p>
              <p className="mt-2 text-sm text-slate-600">
                Metering, billing, partnerexporter och intern kontroll.
              </p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
              <div className="mb-8">
                <div className="mb-3 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                  Intern inloggning
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  Logga in till Gridex CIS
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Efter inloggning skickas du vidare till systemets dashboard.
                </p>
              </div>

              {error ? (
                <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <form action={loginAction} className="space-y-5">
                <input type="hidden" name="next" value={next} />

                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-slate-700">
                    E-post
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
                    placeholder="namn@bolag.se"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="text-sm font-medium text-slate-700"
                    >
                      Lösenord
                    </label>
                    <Link
                      href="/login/forgot-password"
                      className="text-sm font-medium text-slate-600 hover:text-slate-900"
                    >
                      Glömt lösenord?
                    </Link>
                  </div>

                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black focus:outline-none focus:ring-4 focus:ring-slate-300"
                >
                  Logga in
                </button>
              </form>

              <div className="mt-6 border-t pt-6">
                <p className="text-xs leading-6 text-slate-500">
                  Den här inloggningen är avsedd för interna användare i Gridex
                  CIS. Åtkomst styrs av roller, permissions och individuella
                  overrides.
                </p>

                <div className="mt-4">
                  <Link
                    href="/"
                    className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
                  >
                    Tillbaka till startsidan
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}