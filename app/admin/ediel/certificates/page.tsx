import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export default async function EdielCertificatesPage() {
  const context = await requirePlatformAdminAccess()
  const { data } = await supabaseService
    .from('ediel_certificates')
    .select('id, company_id, certificate_fingerprint, certificate_valid_from, certificate_valid_to, encryption_status, last_validation_at, status')
    .order('updated_at', { ascending: false })
    .limit(100)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel certifikat" subtitle="S/MIME-certifikatmetadata. Nycklar lagras bara via secret_reference." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="p-8">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
              <tr><th className="p-4">Fingerprint</th><th className="p-4">Bolag</th><th className="p-4">Giltigt</th><th className="p-4">Status</th></tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="p-4 font-mono text-xs">{row.certificate_fingerprint}</td>
                  <td className="p-4">{row.company_id ?? 'Platform'}</td>
                  <td className="p-4">{row.certificate_valid_from ?? '—'} → {row.certificate_valid_to ?? '—'}</td>
                  <td className="p-4">{row.encryption_status ?? row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
