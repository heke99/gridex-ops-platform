'use client'

// Global fallback error boundary for public routes (start page, /teckna-avtal,
// /login, /legal, ...). Admin and portal segments have their own boundaries.
// Never exposes stack traces — only the safe message provided by the server.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
      <section className="w-full max-w-lg rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-xl font-semibold">Sidan kunde inte laddas</h1>
        <p className="mt-2 text-sm">
          {error.message || 'Ett tillfälligt fel uppstod. Försök igen.'}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-2xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          Försök igen
        </button>
      </section>
    </div>
  )
}
