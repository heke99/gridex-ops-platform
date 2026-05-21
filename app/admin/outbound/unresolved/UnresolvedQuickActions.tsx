import Link from 'next/link'
import { rerunAllUnresolvedRouteResolutionsAction } from './actions'

export default function UnresolvedQuickActions() {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Snabbåtgärder
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Använd detta när du vill försöka lösa hela unresolved-kön eller gå direkt till rätt arbetsyta.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <form action={rerunAllUnresolvedRouteResolutionsAction}>
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Kör route-upplösning för alla
 </button>
 </form>

 <Link
 href="/admin/integrations/routes"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Öppna communication routes
 </Link>

 <Link
 href="/admin/outbound"
 className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Öppna utskickskö
 </Link>
 </div>
 </div>
 </section>
 )
}