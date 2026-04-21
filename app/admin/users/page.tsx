import Link from 'next/link'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getAdminUsers } from '@/lib/rbac/getAdminUsers'
import { getAllRoles } from '@/lib/rbac/getAllRoles'
import { getInternalRoleOptions, getRoleMeta } from '@/lib/rbac/catalog'
import AdminHeader from '@/components/admin/AdminHeader'
import { inviteUserAction, createUserAction } from './actions'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('sv-SE')
}

export default async function AdminUsersPage() {
  const context = await requirePermissionServer('users.read')
  const users = await getAdminUsers()
  const allRoles = await getAllRoles()
  const assignableRoles = getInternalRoleOptions(allRoles)

  const canWriteUsers = context.permissions.includes('users.write')
  const canManageRoles = context.permissions.includes('roles.manage')

  const userCount = users.length
  const privilegedCount = users.filter((row) =>
    row.roles.some((role) => ['admin', 'super_admin'].includes(role))
  ).length

  async function inviteUserFormAction(formData: FormData) {
    'use server'
    await inviteUserAction({} as Parameters<typeof inviteUserAction>[0], formData)
  }

  async function createUserFormAction(formData: FormData) {
    'use server'
    await createUserAction({} as Parameters<typeof createUserAction>[0], formData)
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Användare och access"
        subtitle="Hantera interna konton, roller och individuella behörigheter. Kundrollen ska inte användas för intern adminåtkomst."
        userEmail={context.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Interna konton</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{userCount}</p>
            <p className="mt-2 text-sm text-slate-500">
              Auth-användare som idag finns i systemet.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Admin / super admin</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {privilegedCount}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Högaccess-konton som bör hållas få och tydligt granskade.
            </p>
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-amber-700">Kundrollen</p>
            <p className="mt-2 text-lg font-semibold text-amber-950">
              Inte för intern admin
            </p>
            <p className="mt-2 text-sm text-amber-800">
              Rollen <strong>customer</strong> ska inte användas i intern invite- eller accesshantering för adminytan.
            </p>
          </div>
        </section>

        {canWriteUsers ? (
          <section className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">Bjud in användare</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Skicka e-postinbjudan. Välj startroll direkt om du också har rätt att hantera roller.
                </p>
              </div>

              <form action={inviteUserFormAction} className="grid gap-4 px-6 py-6 md:grid-cols-3">
                <label className="grid gap-2 md:col-span-1">
                  <span className="text-sm font-medium text-slate-700">E-post</span>
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="namn@bolag.se"
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2 md:col-span-1">
                  <span className="text-sm font-medium text-slate-700">Startroll</span>
                  <select
                    name="roleId"
                    defaultValue=""
                    disabled={!canManageRoles}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">Ingen roll ännu</option>
                    {assignableRoles.map((role) => {
                      const meta = getRoleMeta(role.key)
                      return (
                        <option key={role.id} value={role.id}>
                          {meta.label} ({role.key})
                        </option>
                      )
                    })}
                  </select>
                </label>

                <div className="flex items-end">
                  <button className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
                    Skicka inbjudan
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">Skapa konto direkt</h2>
                <p className="mt-1 text-sm text-slate-500">
                  För intern personal när du vill skapa användaren direkt med lösenord.
                </p>
              </div>

              <form action={createUserFormAction} className="grid gap-4 px-6 py-6 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Namn</span>
                  <input
                    type="text"
                    name="fullName"
                    placeholder="För- och efternamn"
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">E-post</span>
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="namn@bolag.se"
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Lösenord</span>
                  <input
                    type="text"
                    name="password"
                    required
                    minLength={10}
                    placeholder="Minst 10 tecken"
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Startroll</span>
                  <select
                    name="roleId"
                    defaultValue=""
                    disabled={!canManageRoles}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">Ingen roll ännu</option>
                    {assignableRoles.map((role) => {
                      const meta = getRoleMeta(role.key)
                      return (
                        <option key={role.id} value={role.id}>
                          {meta.label} ({role.key})
                        </option>
                      )
                    })}
                  </select>
                </label>

                <div className="md:col-span-2 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-600">
                    Skapa konto kräver <code>users.write</code>. Att sätta roll direkt kräver också <code>roles.manage</code>.
                  </p>
                  <button className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
                    Skapa konto
                  </button>
                </div>
              </form>
            </section>
          </section>
        ) : (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-amber-950">Endast läsbehörighet</h2>
            <p className="mt-2 text-sm text-amber-800">
              Du kan se användare här men du saknar <code>users.write</code>, så du kan inte bjuda in eller skapa konton.
            </p>
          </section>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Alla användare</h2>
              <p className="mt-1 text-sm text-slate-500">
                Totalt {users.length} användare i systemet.
              </p>
            </div>

            <Link
              href="/admin/roles"
              className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Öppna roller och permissions
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">E-post</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Roller</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Skapad</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 transition hover:bg-slate-50"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-slate-900">
                          {row.email ?? 'Saknar e-post'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{row.id}</p>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      {row.roles.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {row.roles.map((role) => {
                            const meta = getRoleMeta(role)
                            return (
                              <span
                                key={role}
                                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                                title={meta.description}
                              >
                                {meta.label}
                              </span>
                            )
                          })}
                        </div>
                      ) : (
                        <span className="text-slate-400">Inga roller</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-slate-600">
                      {formatDate(row.created_at)}
                    </td>

                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/users/${row.id}`}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Öppna
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}