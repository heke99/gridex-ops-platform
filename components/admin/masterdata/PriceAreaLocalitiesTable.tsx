import Link from 'next/link'
import type { PriceAreaLocalityRow } from '@/lib/masterdata/types'

type Props = {
  localities: PriceAreaLocalityRow[]
}

export default function PriceAreaLocalitiesTable({ localities }: Props) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Registrerade orter
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {localities.length} träffar.
        </p>
      </div>

      {localities.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          Inga orter ännu.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              <tr>
                <th className="px-6 py-3 font-medium">Elområde</th>
                <th className="px-6 py-3 font-medium">Ort</th>
                <th className="px-6 py-3 font-medium">Kommun</th>
                <th className="px-6 py-3 font-medium">Postnummer</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {localities.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-slate-200 dark:border-slate-800"
                >
                  <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                    {row.price_area_code}
                  </td>
                  <td className="px-6 py-4">{row.locality_name}</td>
                  <td className="px-6 py-4">{row.municipality ?? '—'}</td>
                  <td className="px-6 py-4">{row.postal_code ?? '—'}</td>
                  <td className="px-6 py-4">{row.is_active ? 'Aktiv' : 'Inaktiv'}</td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/admin/price-area-localities?edit=${row.id}`}
                      className="inline-flex rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Redigera
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}