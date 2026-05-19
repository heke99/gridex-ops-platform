import Link from 'next/link'
import { requestPasswordResetAction } from './actions'

export const dynamic = 'force-dynamic'

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    sent?: string
    error?: string
  }>
}

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams
  const sent = params.sent === '1'
  const error = params.error

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 p-6">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/60 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="hidden bg-slate-950 p-10 text-white lg:block">
            <Link
              href="/"
              className="inline-flex rounded-full border border-white/15 px-3 py-1 text-sm text-white/80 transition hover:bg-white/10"
            >
              Gridex CIS
            </Link>

            <div className="mt-16 max-w-md">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/50">
                Säker åtkomst
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">
                Återställ lösenordet på ett säkert sätt.
              </h1>
              <p className="mt-5 text-base leading-8 text-white/70">
                Ange din e-postadress så skickas en återställningslänk via Supabase Auth. Länken gäller endast för det konto som är kopplat till adressen.
              </p>
            </div>
          </section>

          <section className="p-8 sm:p-10">
            <div className="mx-auto max-w-md">
              <div className="mb-8">
                <div className="mb-3 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                  Kontoåtkomst
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  Glömt lösenord
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Skicka en återställningslänk till den e-postadress som är kopplad till ditt användarkonto.
                </p>
              </div>

              {sent ? (
                <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  Om adressen finns registrerad skickas en återställningslänk inom kort.
                </div>
              ) : null}

              {error ? (
                <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <form action={requestPasswordResetAction} className="space-y-5">
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

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black focus:outline-none focus:ring-4 focus:ring-slate-300"
                >
                  Skicka återställningslänk
                </button>
              </form>

              <div className="mt-6 border-t pt-6">
                <Link
                  href="/login"
                  className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
                >
                  Tillbaka till inloggning
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
