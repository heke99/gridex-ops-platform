import Link from 'next/link'
import type { GridOwnerRow } from '@/lib/masterdata/types'

type GridOwnersTableProps = {
 gridOwners: GridOwnerRow[]
}

function StatusBadge({ active }: { active: boolean }) {
 return (
 <span
 className={[
 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
 active
 ? 'bg-emerald-100 text-emerald-700 '
 : 'bg-slate-100 text-slate-700 ',
 ].join(' ')}
 >
 {active ? 'Aktiv' : 'Inaktiv'}
 </span>
 )
}

export default function GridOwnersTable({
 gridOwners,
}: GridOwnersTableProps) {
 if (gridOwners.length === 0) {
 return (
 <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center ">
 <h3 className="text-lg font-semibold text-slate-900 ">
 Inga nätägare ännu
 </h3>
 <p className="mt-2 text-sm text-slate-700 ">
 Skapa första nätägaren för att börja koppla anläggningar och mätpunkter korrekt.
 </p>
 </div>
 )
 }

 return (
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-4 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Registrerade nätägare
 </h2>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="text-left text-slate-700 ">
 <th className="px-6 py-3 font-medium">Namn</th>
 <th className="px-6 py-3 font-medium">Kod</th>
 <th className="px-6 py-3 font-medium">EDIEL-id</th>
 <th className="px-6 py-3 font-medium">Org.nr</th>
 <th className="px-6 py-3 font-medium">Kontakt</th>
 <th className="px-6 py-3 font-medium">Status</th>
 <th className="px-6 py-3 font-medium text-right">Åtgärd</th>
 </tr>
 </thead>

 <tbody className="divide-y divide-slate-200 ">
 {gridOwners.map((owner) => (
 <tr
 key={owner.id}
 className="align-top text-slate-800 "
 >
 <td className="px-6 py-4">
 <div className="font-medium">{owner.name}</div>
 <div className="mt-1 text-xs text-slate-700 ">
 {owner.city || '—'} {owner.country ? `• ${owner.country}` : ''}
 </div>
 </td>
 <td className="px-6 py-4">{owner.owner_code}</td>
 <td className="px-6 py-4">{owner.ediel_id ?? '—'}</td>
 <td className="px-6 py-4">{owner.org_number ?? '—'}</td>
 <td className="px-6 py-4">
 <div>{owner.contact_name ?? '—'}</div>
 <div className="mt-1 text-xs text-slate-700 ">
 {owner.email ?? owner.phone ?? 'Ingen kontaktinfo'}
 </div>
 </td>
 <td className="px-6 py-4">
 <StatusBadge active={owner.is_active} />
 </td>
 <td className="px-6 py-4 text-right">
 <Link
 href={`/admin/network-owners?edit=${owner.id}`}
 className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
 >
 Redigera
 </Link>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )
}