import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { supabaseService } from '@/lib/supabase/service'
import AdminHeader from '@/components/admin/adminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  await requirePermissionServer('audit.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabaseService
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Audit"
        subtitle="Senaste händelser och ändringar i systemet."
        userEmail={user?.email ?? null}
      />

      <div className="p-8">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Senaste loggar</h2>
            <p className="mt-1 text-sm text-slate-500">
              Visar de 100 senaste audit-händelserna.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Tid
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Action
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Entity
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Entity ID
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 transition hover:bg-slate-50"
                  >
                    <td className="px-6 py-4 text-slate-600">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {row.action}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{row.entity_type}</td>
                    <td className="px-6 py-4 text-slate-500">{row.entity_id}</td>
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