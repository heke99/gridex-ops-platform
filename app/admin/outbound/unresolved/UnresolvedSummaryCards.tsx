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
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Öppna unresolved</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {requestsCount}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Totala undantag i dispatch-kedjan.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Switch-relaterade</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {switchRelatedCount}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Leverantörsbyten som fastnat före dispatch.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Meter / billing</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {meteringAndBillingCount}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Data requests för mätvärden och billing-underlag.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Saknar grid owner</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {requestsMissingGridOwner}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Requestdata som inte räcker för nätägarspecifik routing.
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Inaktiva route-träffar</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {requestsWithInactiveRouteMatch}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Route finns, men är inte aktiv just nu.
 </div>
 </div>

 <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm ">
 <div className="text-sm text-slate-700 ">Manuellt valbar route</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950 ">
 {requestsWithManualChoiceAvailable}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 Requests där du kan välja aktiv route direkt från denna sida.
 </div>
 </div>
 </section>
 )
}