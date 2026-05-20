import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type RuleRow = {
  id: string
  message_family: string | null
  message_code: string | null
  version_code: string | null
  valid_from: string | null
  valid_to: string | null
  is_active: boolean | null
}

export default async function PlatformEdielVersionsPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('ediel_message_rules')
    .select('id,message_family,message_code,version_code,valid_from,valid_to,is_active')
    .order('valid_from', { ascending: false, nullsFirst: false })

  if (error) throw error
  const rows = (data ?? []) as RuleRow[]

  return (
    <div className="min-h-screen">
      <AdminHeader title="Ediel-versioner" subtitle="Platform-only översikt över giltiga versioner och övergångar." userEmail={admin.email} />
      <div className="grid gap-4 p-4 sm:p-6 xl:grid-cols-2 xl:p-8">
        {rows.map((row) => (
          <article key={row.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{row.message_family ?? '–'}</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{row.message_code ?? '–'}</span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">{row.is_active ? 'Aktiv' : 'Inaktiv'}</span>
            </div>
            <h2 className="mt-4 text-xl font-black text-slate-950">{row.version_code ?? 'Version saknas'}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-700">Gäller från {row.valid_from ?? '–'} till {row.valid_to ?? 'tills vidare'}.</p>
          </article>
        ))}
      </div>
    </div>
  )
}
