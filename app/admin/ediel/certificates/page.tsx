import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { importEdielP12CertificateAction } from '@/app/admin/ediel/certificates/actions'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'

export const dynamic = 'force-dynamic'

export default async function EdielCertificatesPage() {
  const context = await requirePlatformAdminAccess()
  const { data } = await supabaseService
    .from('ediel_certificates')
    .select('id, company_id, scope, environment, display_name, subject, issuer, serial_number, fingerprint_sha256, certificate_fingerprint, valid_from, valid_to, certificate_valid_from, certificate_valid_to, encryption_status, last_validation_at, status, renewal_window_days, warning_days_before_expiry, critical_days_before_expiry')
    .order('updated_at', { ascending: false })
    .limit(100)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel certifikat" subtitle="S/MIME-certifikatmetadata. Nycklar lagras bara via secret_reference." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-black text-slate-950">Upload .p12</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Superadmin kan registrera Expisoft/Ediel S/MIME-certifikat. PIN används bara vid import/validering och sparas inte. Privat material refereras via secret_reference.
          </p>
          <form action={importEdielP12CertificateAction} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input name="displayName" placeholder="Certificate name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="scope" defaultValue="platform_shared" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="platform_shared">platform_shared</option>
              <option value="tenant_owned">tenant_owned</option>
              <option value="route_specific">route_specific</option>
            </select>
            <select name="environment" defaultValue="test" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="test">test</option>
              <option value="production">production</option>
            </select>
            <input name="password" type="password" placeholder="PIN/lösenord" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="certificateFile" type="file" accept=".p12,.pfx" className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">
              Upload .p12 och validera
            </button>
          </form>
        </section>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
              <tr><th className="p-4">Certificate</th><th className="p-4">Scope</th><th className="p-4">Bolag</th><th className="p-4">Giltigt</th><th className="p-4">Förnyelse</th><th className="p-4">Status</th></tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => {
                const certStatus = evaluateCertificateStatus(row)
                return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="p-4">
                    <div className="font-semibold text-slate-950">{row.display_name ?? 'Ediel certifikat'}</div>
                    <div className="mt-1 font-mono text-xs text-slate-600">{row.fingerprint_sha256 ?? row.certificate_fingerprint}</div>
                    <div className="mt-1 text-xs text-slate-600">{row.subject ?? 'Subject saknas'}</div>
                  </td>
                  <td className="p-4">{row.scope ?? 'platform_shared'} · {row.environment ?? 'test'}</td>
                  <td className="p-4">{row.company_id ?? 'Platform'}</td>
                  <td className="p-4">{row.valid_from ?? row.certificate_valid_from ?? '—'} → {row.valid_to ?? row.certificate_valid_to ?? '—'}</td>
                  <td className="p-4 text-xs text-slate-700">
                    Förnyelse från {certStatus.renewalAvailableFrom ?? '—'} · {certStatus.daysUntilExpiry ?? '—'} dagar kvar
                  </td>
                  <td className="p-4">
                    <div className="font-semibold text-slate-950">{certStatus.status}</div>
                    <div className="mt-1 text-xs text-slate-600">{certStatus.message}</div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
