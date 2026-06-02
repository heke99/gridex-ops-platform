import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export default async function EdielUnresolvedPage() {
  const context = await requirePlatformAdminAccess()
  const { data } = await supabaseService
    .from('ediel_unresolved_items')
    .select('id, company_id, issue_type, status, title, description, ediel_message_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel unresolved" subtitle="Osäkra tenant-, route-, certifikat- och objektmatchningar blockeras här för manuell granskning." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="space-y-4 p-8">
        {(data ?? []).map((item) => (
          <section key={item.id} className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">{item.issue_type ?? 'unresolved'} · {item.status ?? 'open'}</p>
                <h2 className="mt-2 text-lg font-black text-slate-950">{item.title ?? 'Behöver granskas'}</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">{item.description ?? 'Säker automatisk matchning saknas.'}</p>
              </div>
              {item.ediel_message_id ? <Link className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white" href={`/admin/ediel/messages/${item.ediel_message_id}`}>Öppna meddelande</Link> : null}
            </div>
            <p className="mt-3 text-xs text-slate-500">Bolag: {item.company_id ?? 'okänt'} · {item.created_at}</p>
          </section>
        ))}
      </main>
    </div>
  )
}
