import AdminHeader from '@/components/admin/AdminHeader'
import GridOwnerAgreementForm from '@/components/admin/agreements/GridOwnerAgreementForm'
import GridOwnerAgreementTable from '@/components/admin/agreements/GridOwnerAgreementTable'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { listGridOwnerAccessAgreements } from '@/lib/routes/gridOwnerAgreements'

export const dynamic = 'force-dynamic'

type Option = { id: string; name: string | null }
type GridOwnerOption = Option & { ediel_id?: string | null; owner_code?: string | null }
type RouteOption = { id: string; route_name: string | null; route_scope: string | null; route_type: string | null; grid_owner_id: string | null }

function lookup<T extends { id: string }>(rows: T[], label: (row: T) => string | null | undefined) {
  return Object.fromEntries(rows.map((row) => [row.id, label(row) ?? row.id]))
}

export default async function GridOwnerAgreementsPage() {
  const admin = await requirePlatformAdminAccess()

  const [companiesResult, gridOwnersResult, routesResult, agreements] = await Promise.all([
    supabaseService.from('companies').select('id,name').order('name'),
    supabaseService.from('grid_owners').select('id,name,ediel_id,owner_code').order('name'),
    supabaseService.from('communication_routes').select('id,route_name,route_scope,route_type,grid_owner_id').order('updated_at', { ascending: false }).limit(250),
    listGridOwnerAccessAgreements({ limit: 250 }),
  ])

  if (companiesResult.error) throw companiesResult.error
  if (gridOwnersResult.error) throw gridOwnersResult.error
  if (routesResult.error) throw routesResult.error

  const companies = (companiesResult.data ?? []) as Option[]
  const gridOwners = (gridOwnersResult.data ?? []) as GridOwnerOption[]
  const routes = (routesResult.data ?? []) as RouteOption[]

  const activeCount = agreements.filter((agreement) => agreement.status === 'active').length
  const blockedCount = agreements.filter((agreement) => agreement.status === 'blocked').length

  return (
    <div>
      <AdminHeader
        title="Nätägaravtal"
        subtitle="Platform-only yta för avtal, referenskrav, Application Reference och route-kopplingar som route engine använder innan Z13/Z18 skickas."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <main className="space-y-6 px-6 py-6 sm:px-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Avtal</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{agreements.length}</p>
            <p className="mt-1 text-sm text-slate-700">Totalt registrerade nätägaravtal.</p>
          </div>
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Aktiva</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{activeCount}</p>
            <p className="mt-1 text-sm text-slate-700">Kan användas av agreement resolver.</p>
          </div>
          <div className="rounded-3xl border border-red-100 bg-white p-5 shadow-sm shadow-red-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Blockerade</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{blockedCount}</p>
            <p className="mt-1 text-sm text-slate-700">Ska inte användas för automatiska utskick.</p>
          </div>
        </section>

        <GridOwnerAgreementForm companies={companies} gridOwners={gridOwners} routes={routes} />
        <GridOwnerAgreementTable
          agreements={agreements}
          companyById={lookup(companies, (row) => row.name)}
          gridOwnerById={lookup(gridOwners, (row) => row.name)}
          routeById={lookup(routes, (row) => row.route_name)}
        />
      </main>
    </div>
  )
}
