// app/admin/users/page.tsx
import Link from 'next/link'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getAdminUsers } from '@/lib/rbac/getAdminUsers'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  await requirePermissionServer('users.read')
  const users = await getAdminUsers()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Användare"
        subtitle="Hantera användare, roller och individuella behörigheter."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Alla användare</h2>
            <p className="mt-1 text-sm text-slate-500">
              Totalt {users.length} användare i systemet.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    E-post
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Roller
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Skapad
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Åtgärd
                  </th>
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
                          {row.roles.map((role) => (
                            <span
                              key={role}
                              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                            >
                              {role}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">Inga roller</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-slate-600">
                      {new Date(row.created_at).toLocaleString()}
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