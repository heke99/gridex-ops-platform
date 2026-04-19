'use client'

export default function UnresolvedSummaryCards({
  requestsCount,
  switchRelatedCount,
  meteringAndBillingCount,
  requestsMissingGridOwner,
  requestsWithInactiveRouteMatch,
  requestsWithManualChoiceAvailable,
}: {
  requestsCount: number
  switchRelatedCount: number
  meteringAndBillingCount: number
  requestsMissingGridOwner: number
  requestsWithInactiveRouteMatch: number
  requestsWithManualChoiceAvailable: number
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">Öppna unresolved</div>
        <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
          {requestsCount}
        </div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Totala undantag i dispatch-kedjan.
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">Switch-relaterade</div>
        <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
          {switchRelatedCount}
        </div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Leverantörsbyten som fastnat före dispatch.
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">Meter / billing</div>
        <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
          {meteringAndBillingCount}
        </div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Data requests för mätvärden och billing-underlag.
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">Saknar grid owner</div>
        <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
          {requestsMissingGridOwner}
        </div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Requestdata som inte räcker för nätägarspecifik routing.
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500 dark:text-slate-400">Inaktiva route-träffar</div>
        <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
          {requestsWithInactiveRouteMatch}
        </div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Route finns, men är inte aktiv just nu.
        </div>
      </div>

      <div className="rounded-3xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
        <div className="text-sm text-slate-500 dark:text-slate-400">Manuellt valbar route</div>
        <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
          {requestsWithManualChoiceAvailable}
        </div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Requests där du kan välja aktiv route direkt från denna sida.
        </div>
      </div>
    </section>
  )
}