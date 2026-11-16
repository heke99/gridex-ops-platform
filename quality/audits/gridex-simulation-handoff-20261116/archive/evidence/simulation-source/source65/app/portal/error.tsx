'use client'

import { useEffect } from 'react'

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Technical details go to the log, never to the customer.
    console.error('[portal] render_failed', { digest: error.digest })
  }, [error.digest])

  return (
    <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
      <h1 className="text-xl font-semibold">Vi kunde inte visa sidan just nu</h1>
      <p className="mt-2 text-sm">
        Något gick tillfälligt fel när vi hämtade dina uppgifter. Försök igen om en stund. Fungerar det fortfarande inte, kontakta kundservice.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-2xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
      >
        Försök igen
      </button>
    </section>
  )
}
