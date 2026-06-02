import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export default async function EdielActorsPage() {
  const context = await requirePlatformAdminAccess()
  const { data } = await supabaseService
    .from('ediel_actor_settings')
    .select('id, company_id, ediel_id, actor_ediel_id, actor_role, role, sub_role, environment, is_active, status, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel aktörer" subtitle="Aktörsidentitet, roll, subadress och miljö per tenant." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="grid gap-4 p-8 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((row) => (
          <section key={row.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{row.environment ?? 'miljö saknas'}</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">{row.ediel_id ?? row.actor_ediel_id ?? 'Ediel-id saknas'}</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="font-bold text-slate-500">Bolag</dt><dd>{row.company_id ?? 'Platform'}</dd></div>
              <div><dt className="font-bold text-slate-500">Roll</dt><dd>{row.actor_role ?? row.role ?? '—'} / {row.sub_role ?? '—'}</dd></div>
              <div><dt className="font-bold text-slate-500">Status</dt><dd>{row.status ?? (row.is_active ? 'active' : 'inactive')}</dd></div>
            </dl>
          </section>
        ))}
      </main>
    </div>
  )
}
