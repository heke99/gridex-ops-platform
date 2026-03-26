import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { getGridOwnerById, listGridOwners } from '@/lib/masterdata/db'
import GridOwnerForm from '@/components/admin/masterdata/GridOwnerForm'
import GridOwnersTable from '@/components/admin/masterdata/GridOwnersTable'

export const dynamic = 'force-dynamic'

type NetworkOwnersPageProps = {
  searchParams?: Promise<{
    edit?: string
  }>
}

export default async function NetworkOwnersPage({
  searchParams,
}: NetworkOwnersPageProps) {
  await requireAdminPageAccess([MASTERDATA_PERMISSIONS.READ])

  const supabase = await createSupabaseServerClient()
  const params = await searchParams
  const editId = params?.edit

  const [gridOwners, editingGridOwner] = await Promise.all([
    listGridOwners(supabase),
    editId ? getGridOwnerById(supabase, editId) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Masterdata
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Nätägare
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Hantera register över nätägare med kod, EDIEL-id, org.nr och kontaktuppgifter.
              Dessa används senare av kundkort, anläggningar, mätpunkter och leverantörsbyte.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
            <div className="text-slate-500 dark:text-slate-400">Antal nätägare</div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
              {gridOwners.length}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <GridOwnerForm gridOwner={editingGridOwner} />
        <GridOwnersTable gridOwners={gridOwners} />
      </div>
    </div>
  )
}