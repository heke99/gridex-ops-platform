'use client'

import { useEffect } from 'react'
import { usePortalSupportHref } from './supportContact'

export default function PortalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const supportHref = usePortalSupportHref()

  useEffect(() => {
    // Technical details go to the log, never to the customer.
    console.error('[portal] render_failed', { digest: error.digest })
  }, [error.digest])

  return (
    <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900">
      <h1 className="text-xl font-semibold">Vi kunde inte visa sidan just nu</h1>
      <p className="mt-2 text-sm">
        Något gick tillfälligt fel när vi hämtade dina uppgifter. Försök igen om en stund.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-4 rounded-2xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
      >
        Försök igen
      </button>
      {supportHref ? (
        <p className="mt-4 text-sm">
          Om problemet kvarstår kan du{' '}
          <a href={supportHref} className="font-semibold underline underline-offset-4">
            mejla ditt elbolags kundservice
          </a>.
        </p>
      ) : null}
    </section>
  )
}
