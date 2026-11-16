import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { assertSupabaseAdminHealth } from '@/lib/supabase/adminHealth'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function safeCount(table: string) {
  try {
    const { count, error } = await supabaseService.from(table).select('*', { count: 'exact', head: true })
    if (error) return { table, count: null, error: error.message }
    return { table, count: count ?? 0, error: null }
  } catch (error) {
    return { table, count: null, error: error instanceof Error ? error.message : 'Okänt fel' }
  }
}

async function loadAuthProbe() {
  try {
    const health = await assertSupabaseAdminHealth()
    const { data, error } = await supabaseService.auth.admin.listUsers({ page: 1, perPage: 5 })
    if (error) throw error
    return {
      ok: true as const,
      projectRef: health.projectRef,
      urlHost: health.urlHost,
      users: (data.users ?? []).map((user) => ({ id: user.id, email: user.email ?? null, createdAt: user.created_at ?? null })),
      error: null,
    }
  } catch (error) {
    return {
      ok: false as const,
      projectRef: null,
      urlHost: null,
      users: [],
      error: error instanceof Error ? error.message : 'Supabase Auth-admin kunde inte verifieras.',
    }
  }
}

export default async function AuthDiagnosticsPage() {
  const admin = await requirePlatformAdminAccess()
  const [probe, counts] = await Promise.all([
    loadAuthProbe(),
    Promise.all([
      safeCount('companies'),
      safeCount('user_profiles'),
      safeCount('company_memberships'),
      safeCount('user_roles'),
      safeCount('company_invitations'),
      safeCount('auth_provisioning_events'),
    ]),
  ])

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Auth-diagnostik"
        subtitle="Kontrollerar att Vercel-servern kan skapa och läsa riktiga Supabase Authentication-användare med service-role."
        userEmail={admin.email}
      />

      <main className="space-y-5 p-6">
        <section className={probe.ok ? 'rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900' : 'rounded-3xl border border-red-200 bg-red-50 p-5 text-red-900'}>
          <p className="text-sm font-semibold">Auth-admin status</p>
          <p className="mt-2 text-2xl font-semibold">{probe.ok ? 'OK' : 'Fel'}</p>
          {probe.error ? <p className="mt-2 text-sm font-medium">{probe.error}</p> : null}
          {probe.ok ? (
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
              <p><span className="font-semibold">Supabase host:</span> {probe.urlHost ?? 'okänd'}</p>
              <p><span className="font-semibold">Project ref:</span> {probe.projectRef ?? 'okänd'}</p>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Databastabeller</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {counts.map((row) => (
              <div key={row.table} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-600">{row.table}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{row.count ?? '–'}</p>
                {row.error ? <p className="mt-1 text-xs text-red-700">{row.error}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Senaste Auth-users som servern ser</h2>
          <p className="mt-1 text-sm text-slate-600">Om en ny användare inte syns här efter skapande kör appen mot fel projekt eller saknar fungerande service-role.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="py-2 pr-4">E-post</th>
                  <th className="py-2 pr-4">Auth-ID</th>
                  <th className="py-2 pr-4">Skapad</th>
                </tr>
              </thead>
              <tbody>
                {probe.users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-medium text-slate-900">{user.email ?? '–'}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{user.id}</td>
                    <td className="py-2 pr-4 text-slate-600">{user.createdAt ?? '–'}</td>
                  </tr>
                ))}
                {probe.users.length === 0 ? (
                  <tr>
                    <td className="py-4 text-slate-600" colSpan={3}>Inga Auth-users kunde läsas.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
