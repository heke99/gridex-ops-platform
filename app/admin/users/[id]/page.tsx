import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getAdminUserById } from '@/lib/rbac/getAdminUserById'
import { getAllRoles } from '@/lib/rbac/getAllRoles'
import { getAllPermissions } from '@/lib/rbac/getAllPermissions'
import {
  assignUserRoleAction,
  removeUserRoleAction,
  addUserPermissionOverrideAction,
  removeUserPermissionOverrideAction,
} from './actions'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requirePermissionServer('users.read')
  const { id } = await params

  const user = await getAdminUserById(id)
  const roles = await getAllRoles()
  const permissions = await getAllPermissions()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{user.authUser.email ?? 'Användare'}</h1>
        <p className="text-sm text-gray-600">{user.authUser.id}</p>
      </div>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Aktiva roller</h2>

        <div className="mb-6 space-y-3">
          {user.roles.length === 0 && (
            <p className="text-sm text-gray-500">Inga aktiva roller.</p>
          )}

          {user.roles.map((role) => (
            <div
              key={role.id}
              className="flex items-center justify-between rounded-xl border p-3"
            >
              <div>
                <p className="font-medium">{role.roles?.name}</p>
                <p className="text-sm text-gray-500">{role.roles?.key}</p>
              </div>

              <form action={removeUserRoleAction}>
                <input type="hidden" name="userRoleId" value={role.id} />
                <input type="hidden" name="userId" value={id} />
                <button className="rounded-lg border px-3 py-2 hover:bg-gray-50">
                  Ta bort
                </button>
              </form>
            </div>
          ))}
        </div>

        <form action={assignUserRoleAction} className="flex gap-3">
          <input type="hidden" name="userId" value={id} />
          <select
            name="roleId"
            className="rounded-lg border px-3 py-2"
            defaultValue=""
            required
          >
            <option value="" disabled>
              Välj roll
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.key})
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-black px-4 py-2 text-white">
            Lägg till roll
          </button>
        </form>
      </section>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Permission overrides</h2>

        <div className="mb-6 space-y-3">
          {user.overrides.length === 0 && (
            <p className="text-sm text-gray-500">Inga overrides.</p>
          )}

          {user.overrides.map((override) => (
            <div
              key={override.id}
              className="flex items-center justify-between rounded-xl border p-3"
            >
              <div>
                <p className="font-medium">
                  {override.permissions?.name} ({override.permissions?.key})
                </p>
                <p className="text-sm text-gray-500">
                  Effekt: {override.effect}
                  {override.reason ? ` • ${override.reason}` : ''}
                </p>
              </div>

              <form action={removeUserPermissionOverrideAction}>
                <input type="hidden" name="overrideId" value={override.id} />
                <input type="hidden" name="userId" value={id} />
                <button className="rounded-lg border px-3 py-2 hover:bg-gray-50">
                  Ta bort
                </button>
              </form>
            </div>
          ))}
        </div>

        <form action={addUserPermissionOverrideAction} className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="userId" value={id} />

          <select
            name="permissionId"
            className="rounded-lg border px-3 py-2"
            defaultValue=""
            required
          >
            <option value="" disabled>
              Välj permission
            </option>
            {permissions.map((permission) => (
              <option key={permission.id} value={permission.id}>
                {permission.name} ({permission.key})
              </option>
            ))}
          </select>

          <select name="effect" className="rounded-lg border px-3 py-2" defaultValue="allow">
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>

          <input
            name="reason"
            placeholder="Anledning"
            className="rounded-lg border px-3 py-2"
          />

          <button className="rounded-lg bg-black px-4 py-2 text-white">
            Lägg till override
          </button>
        </form>
      </section>
    </div>
  )
}