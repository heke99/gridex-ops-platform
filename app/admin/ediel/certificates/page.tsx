import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { importEdielP12CertificateAction } from '@/app/admin/ediel/certificates/actions'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'

export const dynamic = 'force-dynamic'

type CertificatesPageProps = {
  searchParams?: Promise<{
    certStatus?: string
    certMessage?: string
  }>
}

type CertificateDisplayRow = {
  id: string
  company_id?: string | null
  scope?: string | null
  environment?: string | null
  display_name?: string | null
  subject?: string | null
  issuer?: string | null
  serial_number?: string | null
  fingerprint_sha256?: string | null
  certificate_fingerprint?: string | null
  valid_from?: string | null
  valid_to?: string | null
  certificate_valid_from?: string | null
  certificate_valid_to?: string | null
  encryption_status?: string | null
  last_validation_at?: string | null
  status?: string | null
  renewal_window_days?: number | null
  warning_days_before_expiry?: number | null
  critical_days_before_expiry?: number | null
  owner_ediel_id?: string | null
  owner_subaddress?: string | null
  message_type?: string | null
  purpose?: string | null
  usage?: string | null
  is_private_material_available?: boolean | null
  needs_verification?: boolean | null
  metadata?: Record<string, unknown> | null
}

function textFromMetadata(row: CertificateDisplayRow, key: string): string | null {
  const value = row.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function uniqueIdentifierFromMetadata(row: CertificateDisplayRow): string | null {
  return (
    textFromMetadata(row, 'uniqueIdentifier') ??
    textFromMetadata(row, 'certificateUniqueIdentifier') ??
    textFromMetadata(row, 'expisoftUniqueIdentifier')
  )
}

async function listCertificateRows(): Promise<{
  rows: CertificateDisplayRow[]
  warning: string | null
}> {
  const rich = await supabaseService
    .from('ediel_certificates')
    .select('id, company_id, scope, environment, display_name, subject, issuer, serial_number, fingerprint_sha256, certificate_fingerprint, valid_from, valid_to, certificate_valid_from, certificate_valid_to, encryption_status, last_validation_at, status, renewal_window_days, warning_days_before_expiry, critical_days_before_expiry, owner_ediel_id, owner_subaddress, message_type, purpose, usage, is_private_material_available, needs_verification, metadata')
    .order('updated_at', { ascending: false })
    .limit(100)

  if (!rich.error) {
    return { rows: (rich.data ?? []) as CertificateDisplayRow[], warning: null }
  }

  const legacy = await supabaseService
    .from('ediel_certificates')
    .select('id, company_id, certificate_fingerprint, certificate_valid_from, certificate_valid_to, encryption_status, last_validation_at, status, metadata')
    .order('updated_at', { ascending: false })
    .limit(100)

  if (legacy.error) {
    return {
      rows: [],
      warning: `Kunde inte läsa certifikat: ${legacy.error.message}`,
    }
  }

  return {
    rows: (legacy.data ?? []) as CertificateDisplayRow[],
    warning: 'Databasen saknar några nya certifikatkolumner. Certifikaten visas från legacyfält/metadata. Kör senaste Supabase-migrationen för full funktion.',
  }
}

export default async function EdielCertificatesPage({ searchParams }: CertificatesPageProps) {
  const context = await requirePlatformAdminAccess()
  const resolvedSearchParams = await searchParams
  const certStatus = resolvedSearchParams?.certStatus === 'success' ? 'success' : resolvedSearchParams?.certStatus === 'error' ? 'error' : null
  const certMessage = resolvedSearchParams?.certMessage ?? null
  const { rows, warning } = await listCertificateRows()

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel certifikat" subtitle="S/MIME-certifikatmetadata. Nycklar lagras bara via secret_reference." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="space-y-6 p-8">
        {certStatus && certMessage ? (
          <section className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            certStatus === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            {certMessage}
          </section>
        ) : null}
        {warning ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {warning}
          </section>
        ) : null}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-black text-slate-950">Lägg till certifikat</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
Superadmin kan registrera S/MIME-certifikat. Importera vårt P12/PFX som privat inbound/signering. Importera mottagarens publika PEM/CER som outbound_recipient. Systemet kopplar inte längre P12/mailbox-certifikat till outbound routes automatiskt.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-950">Vårt privata certifikat för inkommande dekryptering/signering</div>
              <p className="mt-2 text-xs leading-5 text-slate-700">Välj usage inbound_private eller sender_signing och ladda upp .p12/.pfx. Det blir inte valbart som mottagarcertifikat.</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-black text-emerald-950">Mottagarens publika certifikat för utgående kryptering</div>
              <p className="mt-2 text-xs leading-5 text-emerald-900">Välj usage outbound_recipient, purpose encryption, ägare Ediel-ID/subadress och klistra in PEM/CER. Detta är enda certifikattypen som får länkas till krypterade outbound routes.</p>
            </div>
          </div>
          <form action={importEdielP12CertificateAction} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input name="displayName" placeholder="Certificate name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="mailboxEmail" defaultValue="ediel@gridex.se" placeholder="Mailbox/e-post" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="scope" defaultValue="platform_shared" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="platform_shared">platform_shared</option>
              <option value="tenant_owned">tenant_owned</option>
              <option value="route_specific">route_specific</option>
            </select>
            <select name="environment" defaultValue="test" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="test">test</option>
              <option value="production">production</option>
            </select>
            <select name="certificateUsage" defaultValue="inbound_private" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="inbound_private">Vårt privata certifikat: inbound_private</option>
              <option value="sender_signing">Vårt signeringscertifikat: sender_signing</option>
              <option value="outbound_recipient">Mottagarens publika certifikat: outbound_recipient</option>
            </select>
            <select name="certificatePurpose" defaultValue="both" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="both">both</option>
              <option value="encryption">encryption</option>
              <option value="signing">signing</option>
            </select>
            <input name="ownerEdielId" placeholder="Certifikatets ägare Ediel-ID, t.ex. 21660 eller 91100" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="ownerSubaddress" placeholder="Ägarens subadress, t.ex. PRODAT" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="messageType" defaultValue="PRODAT" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="PRODAT">PRODAT</option>
              <option value="UTILTS">UTILTS</option>
              <option value="APERAK">APERAK</option>
              <option value="CONTRL">CONTRL</option>
              <option value="">Generellt</option>
            </select>
            <input name="password" type="password" placeholder="PIN/lösenord endast för P12/PFX" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="certificateFile" type="file" accept=".p12,.pfx,.pem,.cer,.crt" className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
            <textarea
              name="certificateText"
              rows={8}
              placeholder="Klistra in PEM-certifikat (-----BEGIN CERTIFICATE-----...) eller base64-kodad .p12/.pfx"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2 xl:col-span-4"
            />
            <textarea
              name="uniqueIdentifier"
              rows={3}
              placeholder="Eller klistra bara in Unika identifieraren här (ingen PDF behövs). Den sparas som väntande identifierare tills certifikatet finns."
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2 xl:col-span-4"
            />
            <p className="text-xs leading-5 text-slate-600 md:col-span-2 xl:col-span-4">
P12/PFX med privat nyckel sparas som inbound_private/sender_signing och får inte väljas som mottagarcertifikat. Mottagarens publika PEM/CER ska sparas som outbound_recipient med rätt owner_ediel_id/subadress och kopplas till route.
            </p>
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">
Spara certifikat
            </button>
          </form>
        </section>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
              <tr><th className="p-4">Certificate</th><th className="p-4">Scope</th><th className="p-4">Bolag</th><th className="p-4">Giltigt</th><th className="p-4">Förnyelse</th><th className="p-4">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const certStatus = evaluateCertificateStatus(row)
                const displayName = row.display_name ?? textFromMetadata(row, 'displayName') ?? 'Ediel certifikat'
                const fingerprint = row.fingerprint_sha256 ?? row.certificate_fingerprint ?? textFromMetadata(row, 'fingerprintSha256')
                const subject = row.subject ?? textFromMetadata(row, 'subject') ?? 'Subject saknas'
                const scope = row.scope ?? textFromMetadata(row, 'scope') ?? 'platform_shared'
                const environment = row.environment ?? textFromMetadata(row, 'environment') ?? 'test'
                const usage = row.usage ?? textFromMetadata(row, 'usage') ?? 'usage saknas'
                const purpose = row.purpose ?? textFromMetadata(row, 'purpose') ?? 'purpose saknas'
                const ownerEdielId = row.owner_ediel_id ?? textFromMetadata(row, 'ownerEdielId') ?? textFromMetadata(row, 'owner_ediel_id')
                const ownerSubaddress = row.owner_subaddress ?? textFromMetadata(row, 'ownerSubaddress') ?? textFromMetadata(row, 'owner_subaddress')
                const messageType = row.message_type ?? textFromMetadata(row, 'messageType') ?? textFromMetadata(row, 'message_type')
                const uniqueIdentifier = uniqueIdentifierFromMetadata(row)
                return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="p-4">
                    <div className="font-semibold text-slate-950">{displayName}</div>
                    <div className="mt-1 font-mono text-xs text-slate-600">{fingerprint ?? 'Fingerprint saknas'}</div>
                    <div className="mt-1 text-xs text-slate-600">{subject}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-700">{usage} · {purpose} · owner {ownerEdielId ?? 'saknas'}{ownerSubaddress ? `:${ownerSubaddress}` : ''}{messageType ? ` · ${messageType}` : ''}</div>
                    {uniqueIdentifier ? (
                      <div className="mt-1 text-xs font-semibold text-amber-700">Unik identifierare: {uniqueIdentifier}</div>
                    ) : null}
                  </td>
                  <td className="p-4">{scope} · {environment}</td>
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
