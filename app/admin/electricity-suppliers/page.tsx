import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import {
  getElectricitySupplierById,
  listElectricitySuppliers,
} from '@/lib/masterdata/db'
import ElectricitySupplierForm from '@/components/admin/masterdata/ElectricitySupplierForm'
import ElectricitySuppliersTable from '@/components/admin/masterdata/ElectricitySuppliersTable'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<{
    edit?: string
  }>
}

export default async function ElectricitySuppliersPage({
  searchParams,
}: PageProps) {
  await requireAdminPageAccess([MASTERDATA_PERMISSIONS.READ])

  const supabase = await createSupabaseServerClient()
  const params = await searchParams
  const editId = params?.edit

  const [suppliers, editingSupplier] = await Promise.all([
    listElectricitySuppliers(supabase),
    editId ? getElectricitySupplierById(supabase, editId) : Promise.resolve(null),
  ])

  const activeCount = suppliers.filter((supplier) => supplier.is_active).length

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Masterdata
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Elleverantörer
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Permanent register över elleverantörer. Dessa kan användas i switchflödet och
              uppdateras centralt så att kundkorten återanvänder samma uppgifter nästa gång.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/electricity-suppliers"
              className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Ny elleverantör
            </Link>
            <Link
              href="/admin/customers"
              className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Till kunder
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
            <div className="text-slate-500 dark:text-slate-400">Antal leverantörer</div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
              {suppliers.length}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
            <div className="text-slate-500 dark:text-slate-400">Aktiva</div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
              {activeCount}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
            <div className="text-slate-500 dark:text-slate-400">Redigeringsläge</div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
              {editingSupplier ? editingSupplier.name : 'Nej'}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <ElectricitySupplierForm supplier={editingSupplier} />
        <ElectricitySuppliersTable suppliers={suppliers} />
      </div>
    </div>
  )
}