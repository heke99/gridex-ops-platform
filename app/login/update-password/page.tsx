import Link from 'next/link'
import { sanitizeUpdatePasswordErrorFlash } from '@/lib/auth/loginError'
import { getSafeNextPath } from '@/lib/auth/urls'
import { updatePasswordAction } from './actions'

export const dynamic = 'force-dynamic'

type UpdatePasswordPageProps = {
  searchParams: Promise<{
    error?: string
    next?: string
  }>
}

export default async function UpdatePasswordPage({
  searchParams,
}: UpdatePasswordPageProps) {
  const params = await searchParams
  const error = sanitizeUpdatePasswordErrorFlash(params.error)
  const next = getSafeNextPath(params.next)

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-slate-50 to-slate-100 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
            Kontoåtkomst
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Välj nytt lösenord
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Ange ett nytt lösenord för ditt användarkonto.
          </p>
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form action={updatePasswordAction} className="space-y-5">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Nytt lösenord
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="confirmPassword"
              className="text-sm font-medium text-slate-700"
            >
              Bekräfta lösenord
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
            />
          </div>

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black focus:outline-none focus:ring-4 focus:ring-slate-300"
          >
            Uppdatera lösenord
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
    </main>
  )
}
