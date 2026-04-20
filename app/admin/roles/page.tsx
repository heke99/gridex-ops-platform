import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { getAllPermissions } from '@/lib/rbac/getAllPermissions'
import { getAllRoles } from '@/lib/rbac/getAllRoles'
import { getPermissionMeta, getRoleMeta, getInternalRoleOptions, sortPermissions } from '@/lib/rbac/catalog'
import { supabaseService } from '@/lib/supabase/service'
import AdminHeader from '@/components/admin/AdminHeader'

export const dynamic = 'force-dynamic'

type RolePermissionCountRow = {
  role_key: string
  role_name: string
  permission_count: number
}

export default async function AdminRolesPage() {
  const context = await requireAnyPermissionServer(['roles.manage', 'permissions.manage', 'users.read'])

  const [roles, permissions, countsResponse] = await Promise.all([
    getAllRoles(),
    getAllPermissions(),
    supabaseService
      .from('roles')
      .select('key, name, role_permissions(count)')
      .order('name'),
  ])

  if (countsResponse.error) {
    throw countsResponse.error
  }

  const countRows: RolePermissionCountRow[] = (countsResponse.data ?? []).map((row) => {
    const nestedCount =
      Array.isArray(row.role_permissions) && row.role_permissions[0]
        ? Number((row.role_permissions[0] as { count?: number }).count ?? 0)
        : 0

    return {
      role_key: String(row.key),
      role_name: String(row.name),
      permission_count: nestedCount,
    }
  })

  const internalRoles = getInternalRoleOptions(roles)
  const sortedPermissions = sortPermissions(permissions)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Roller och permissions"
        subtitle="Översikt över rollstrukturen i databasen och vad varje permission betyder i praktiken."
        userEmail={context.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Roller i databasen</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{roles.length}</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Permissions i databasen</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{permissions.length}</p>
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-amber-700">Viktig regel</p>
            <p className="mt-2 text-lg font-semibold text-amber-950">
              Kund = inte intern adminroll
            </p>
            <p className="mt-2 text-sm text-amber-800">
              Rollen <strong>customer</strong> ska inte användas för intern adminåtkomst.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Rollstatus</h2>
          <p className="mt-1 text-sm text-slate-500">
            Visar hur många permissions varje roll faktiskt har i databasen just nu.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Roll</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Nyckel</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Permissions</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Beskrivning</th>
                </tr>
              </thead>
              <tbody>
                {countRows.map((row) => {
                  const meta = getRoleMeta(row.role_key)
                  return (
                    <tr key={row.role_key} className="border-b border-slate-100 align-top">
                      <td className="px-4 py-4 font-medium text-slate-950">
                        {meta.label || row.role_name}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{row.role_key}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                            row.permission_count === 0
                              ? 'border-rose-200 bg-rose-50 text-rose-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {row.permission_count}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{meta.description}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Rollkatalog</h2>
          <p className="mt-1 text-sm text-slate-500">
            Mänsklig förklaring av rollerna så att admin och super admin förstår vad de innebär.
          </p>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            {internalRoles.map((role) => {
              const meta = getRoleMeta(role.key)
              return (
                <article
                  key={role.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-950">{meta.label}</h3>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {role.key}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">{meta.description}</p>
                  <p className="mt-3 text-xs text-slate-500">
                    Rekommenderas för: {meta.recommendedFor}
                  </p>
                </article>
              )
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Permissionkatalog</h2>
          <p className="mt-1 text-sm text-slate-500">
            Förklarar vad varje permission faktiskt ger för åtkomst.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Permission</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Område</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Förklaring</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">Risk</th>
                </tr>
              </thead>
              <tbody>
                {sortedPermissions.map((permission) => {
                  const meta = getPermissionMeta(permission.key)
                  return (
                    <tr key={permission.id} className="border-b border-slate-100 align-top">
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-950">{meta.label}</p>
                          <p className="text-xs text-slate-500">{permission.key}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{meta.area}</td>
                      <td className="px-4 py-4 text-slate-600">{meta.description}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                            meta.risk === 'high'
                              ? 'border-rose-200 bg-rose-50 text-rose-700'
                              : meta.risk === 'medium'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {meta.risk === 'high'
                            ? 'Hög risk'
                            : meta.risk === 'medium'
                              ? 'Medelrisk'
                              : 'Låg risk'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}