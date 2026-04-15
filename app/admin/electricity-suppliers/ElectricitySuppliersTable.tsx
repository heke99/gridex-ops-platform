import Link from 'next/link'
import type { ElectricitySupplierRow } from '@/lib/masterdata/types'

type Props = {
  suppliers: ElectricitySupplierRow[]
}

export default function ElectricitySuppliersTable({ suppliers }: Props) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Registrerade elleverantörer
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {suppliers.length} träffar.
        </p>
      </div>

      {suppliers.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          Inga elleverantörer ännu.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              <tr>
                <th className="px-6 py-3 font-medium">Namn</th>
                <th className="px-6 py-3 font-medium">Org.nr</th>
                <th className="px-6 py-3 font-medium">E-post</th>
                <th className="px-6 py-3 font-medium">Telefon</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr
                  key={supplier.id}
                  className="border-t border-slate-200 dark:border-slate-800"
                >
                  <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                    {supplier.name}
                  </td>
                  <td className="px-6 py-4">{supplier.org_number ?? '—'}</td>
                  <td className="px-6 py-4">{supplier.email ?? '—'}</td>
                  <td className="px-6 py-4">{supplier.phone ?? '—'}</td>
                  <td className="px-6 py-4">
                    {supplier.is_active ? 'Aktiv' : 'Inaktiv'}
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/admin/electricity-suppliers?edit=${supplier.id}`}
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