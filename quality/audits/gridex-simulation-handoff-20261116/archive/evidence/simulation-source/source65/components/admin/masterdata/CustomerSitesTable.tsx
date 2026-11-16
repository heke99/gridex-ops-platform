import Link from 'next/link'
import type {
 CustomerSiteRow,
 GridOwnerRow,
 MeteringPointRow,
} from '@/lib/masterdata/types'

type CustomerSitesTableProps = {
 customerId: string
 sites: CustomerSiteRow[]
 gridOwners: GridOwnerRow[]
 meteringPoints: MeteringPointRow[]
 selectedSiteId?: string | null
}

function getGridOwnerName(
 gridOwnerId: string | null,
 gridOwners: GridOwnerRow[]
): string {
 if (!gridOwnerId) return '—'
 return gridOwners.find((owner) => owner.id === gridOwnerId)?.name ?? '—'
}

function getMeteringPointCount(
 siteId: string,
 meteringPoints: MeteringPointRow[]
): number {
 return meteringPoints.filter((point) => point.site_id === siteId).length
}

function StatusBadge({ value }: { value: string }) {
 const styles: Record<string, string> = {
 active:
 'bg-emerald-100 text-emerald-700 ',
 draft:
 'bg-amber-100 text-amber-700 ',
 pending_move:
 'bg-emerald-100 text-emerald-700 ',
 inactive:
 'bg-slate-100 text-slate-700 ',
 closed:
 'bg-red-100 text-red-700 ',
 }

 return (
 <span
 className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
 styles[value] ??
 'bg-slate-100 text-slate-700 '
 }`}
 >
 {value}
 </span>
 )
}

export default function CustomerSitesTable({
 customerId,
 sites,
 gridOwners,
 meteringPoints,
 selectedSiteId,
}: CustomerSitesTableProps) {
 if (sites.length === 0) {
 return (
 <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center ">
 <h3 className="text-lg font-semibold text-slate-900 ">
 Inga anläggningar ännu
 </h3>
 <p className="mt-2 text-sm text-slate-700 ">
 Lägg till första anläggningen för att senare koppla mätpunkter, avtal och switchflöden.
 </p>
 </div>
 )
 }

 return (
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 ">
 <div>
 <h2 className="text-lg font-semibold text-slate-900 ">
 Kundens anläggningar
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Öppna en rad för att redigera befintlig anläggning i formuläret.
 </p>
 </div>

 {selectedSiteId ? (
 <Link
 href={`/admin/customers/${customerId}`}
 className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
 >
 Rensa val
 </Link>
 ) : null}
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="text-left text-slate-700 ">
 <th className="px-6 py-3 font-medium">Anläggning</th>
 <th className="px-6 py-3 font-medium">Typ</th>
 <th className="px-6 py-3 font-medium">Nätägare</th>
 <th className="px-6 py-3 font-medium">Elområde</th>
 <th className="px-6 py-3 font-medium">Mätpunkter</th>
 <th className="px-6 py-3 font-medium">Status</th>
 <th className="px-6 py-3 font-medium">Åtgärd</th>
 </tr>
 </thead>

 <tbody className="divide-y divide-slate-200 ">
 {sites.map((site) => {
 const isSelected = selectedSiteId === site.id

 return (
 <tr
 key={site.id}
 className={`align-top text-slate-800 ${
 isSelected ? 'bg-emerald-50/70 ' : ''
 }`}
 >
 <td className="px-6 py-4">
 <div className="font-medium">{site.site_name}</div>
 <div className="mt-1 text-xs text-slate-700 ">
 {site.facility_id ?? 'Inget anläggnings-ID'}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 {site.street ?? 'Ingen adress'}
 {site.city ? ` • ${site.city}` : ''}
 </div>
 </td>
 <td className="px-6 py-4">{site.site_type}</td>
 <td className="px-6 py-4">
 {getGridOwnerName(site.grid_owner_id, gridOwners)}
 </td>
 <td className="px-6 py-4">{site.price_area_code ?? '—'}</td>
 <td className="px-6 py-4">
 {getMeteringPointCount(site.id, meteringPoints)}
 </td>
 <td className="px-6 py-4">
 <StatusBadge value={site.status} />
 </td>
 <td className="px-6 py-4">
 <Link
 href={`/admin/customers/${customerId}?editSite=${site.id}`}
 className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
 >
 Redigera
 </Link>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 </div>
 )
}