import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type RuleRow = {
  id: string
  message_family: string | null
  message_code: string | null
  message_standard: string | null
  version_code: string | null
  direction: string | null
  is_active: boolean | null
  valid_from: string | null
  valid_to: string | null
}

export default async function PlatformEdielRulesPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('ediel_message_rules')
    .select('id,message_family,message_code,message_standard,version_code,direction,is_active,valid_from,valid_to')
    .order('message_family', { ascending: true })
    .order('message_code', { ascending: true })
    .order('valid_from', { ascending: false, nullsFirst: false })

  if (error) throw error
  const rules = (data ?? []) as RuleRow[]

  return (
    <div className="min-h-screen">
      <AdminHeader title="Globala Ediel-regler" subtitle="Platform-only rule governance. Company admins ska inte se eller ändra dessa regler." userEmail={admin.email} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Message rules</h2>
          <p className="mt-1 text-sm text-slate-700">Reglerna styr versioner, riktning och runtime-beteende för Ediel-meddelanden.</p>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr><th className="px-3 py-3">Family</th><th className="px-3 py-3">Kod</th><th className="px-3 py-3">Standard</th><th className="px-3 py-3">Version</th><th className="px-3 py-3">Riktning</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Giltig</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="px-3 py-3 font-semibold text-slate-900">{rule.message_family ?? '–'}</td>
                    <td className="px-3 py-3">{rule.message_code ?? '–'}</td>
                    <td className="px-3 py-3">{rule.message_standard ?? '–'}</td>
                    <td className="px-3 py-3">{rule.version_code ?? '–'}</td>
                    <td className="px-3 py-3">{rule.direction ?? '–'}</td>
                    <td className="px-3 py-3">{rule.is_active ? 'Aktiv' : 'Inaktiv'}</td>
                    <td className="px-3 py-3">{rule.valid_from ?? '–'} → {rule.valid_to ?? '–'}</td>
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
