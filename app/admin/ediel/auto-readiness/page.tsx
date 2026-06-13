import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listActorSendReadiness } from '@/lib/ediel/operations/actorAutoReadiness'
import { supabaseService } from '@/lib/supabase/service'
import { applyActorAutoSendReadinessAction, refreshActorCertificatesAction, runActorReadinessBackfillAction } from './actions'

export const dynamic = 'force-dynamic'

type RunRow = {
  id: string
  run_type: string
  status: string
  started_at: string
  finished_at: string | null
  checked_actor_count: number | null
  checked_route_count: number | null
  checked_certificate_count: number | null
  auto_enabled_count: number | null
  auto_disabled_count: number | null
  failed_count: number | null
}

type CertRow = {
  id: string
  actor_id: string | null
  ediel_id: string | null
  environment: string
  purpose: string
  status: string
  fingerprint_sha256: string | null
  subject: string | null
  issuer: string | null
  valid_from: string | null
  valid_to: string | null
  last_checked_at: string | null
  next_check_at: string | null
}

function field(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function statusLabel(value: string | null | undefined) {
  switch (value) {
    case 'ready_for_auto_send': return 'Redo för auto-send'
    case 'missing_certificate': return 'Saknar certifikat'
    case 'expired_certificate': return 'Certifikat utgånget'
    case 'certificate_expires_soon': return 'Certifikat går ut snart'
    case 'route_not_verified': return 'Route ej verifierad'
    case 'missing_smtp_address': return 'Saknar SMTP'
    case 'party_id_mismatch': return 'Ediel-ID mismatch'
    case 'needs_manual_review': return 'Behöver granskning'
    default: return field(value)
  }
}

function tone(value: string | null | undefined) {
  if (value === 'ready_for_auto_send') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (value === 'missing_certificate' || value === 'expired_certificate') return 'border-red-200 bg-red-50 text-red-800'
  if (value === 'certificate_expires_soon' || value === 'route_not_verified' || value === 'needs_manual_review') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function summarize(rows: Awaited<ReturnType<typeof listActorSendReadiness>>) {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.readiness_status ?? 'unknown', (counts.get(row.readiness_status ?? 'unknown') ?? 0) + 1)
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
}

async function loadRuns(): Promise<RunRow[]> {
  const result = await supabaseService
    .from('platform_actor_readiness_runs')
    .select('id,run_type,status,started_at,finished_at,checked_actor_count,checked_route_count,checked_certificate_count,auto_enabled_count,auto_disabled_count,failed_count')
    .order('started_at', { ascending: false })
    .limit(8)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }
  return (result.data ?? []) as RunRow[]
}

async function loadCertificates(): Promise<CertRow[]> {
  const result = await supabaseService
    .from('platform_actor_certificates')
    .select('id,actor_id,ediel_id,environment,purpose,status,fingerprint_sha256,subject,issuer,valid_from,valid_to,last_checked_at,next_check_at')
    .order('next_check_at', { ascending: true, nullsFirst: true })
    .limit(40)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }
  return (result.data ?? []) as CertRow[]
}

export default async function EdielAutoReadinessPage() {
  await requirePlatformAdminAccess()
  const [rows, runs, certificates] = await Promise.all([listActorSendReadiness(500), loadRuns(), loadCertificates()])
  const sortedRows = [...rows].sort((a, b) => {
    const byStatus = field(a.readiness_status).localeCompare(field(b.readiness_status), 'sv')
    if (byStatus !== 0) return byStatus
    return field(a.actor_name).localeCompare(field(b.actor_name), 'sv')
  })

  return (
    <main className="space-y-6">
      <AdminHeader
        title="Aktörsberedskap och autosändning"
        subtitle="Systemet backfillar aktörer, verifierar routes, kontrollerar certifikat och aktiverar autosändning endast när hela kedjan är grön."
      />

      <section className="grid gap-3 md:grid-cols-4">
        {summarize(rows).map(([status, count]) => (
          <div key={status} className={`rounded-2xl border p-4 ${tone(status)}`}>
            <div className="text-2xl font-semibold">{count}</div>
            <div className="mt-1 text-sm font-medium">{statusLabel(status)}</div>
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 md:col-span-4">
            Readiness-vyn saknas eller har inga rader. Kör migrationen och importera actor registry först.
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <form action={runActorReadinessBackfillAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Backfilla och verifiera</h2>
          <p className="mt-1 text-sm text-slate-600">Matchar XML-importerad aktörsdata, verifierar säkra PRODAT/UTILTS-routes och skapar certifikat-checkar.</p>
          <button className="mt-4 rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Kör backfill nu</button>
        </form>
        <form action={refreshActorCertificatesAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Kontrollera certifikat</h2>
          <p className="mt-1 text-sm text-slate-600">Uppdaterar status, nästa kontroll och blockerar auto-send vid utgångna eller saknade certifikat.</p>
          <button className="mt-4 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Kontrollera igen</button>
        </form>
        <form action={applyActorAutoSendReadinessAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Försök aktivera auto-send</h2>
          <p className="mt-1 text-sm text-slate-600">Sätter auto-send till ja endast för routes där readiness-vyn visar helt grön kedja.</p>
          <button className="mt-4 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">Aktivera där säkert</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Aktörer och routes</h2>
            <p className="text-sm text-slate-600">Klicka vidare via route-sidorna för manuell granskning. Här visas exakt vad som stoppar auto-send.</p>
          </div>
          <a href="/admin/ediel/routes" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Öppna routes</a>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Aktör</th>
                <th className="px-3 py-3">Route</th>
                <th className="px-3 py-3">Auto-send</th>
                <th className="px-3 py-3">Certifikat</th>
                <th className="px-3 py-3">Saknas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row) => (
                <tr key={`${row.route_id}-${row.actor_id}`} className="align-top">
                  <td className="px-3 py-4">
                    <div className="font-medium text-slate-950">{field(row.actor_name)}</div>
                    <div className="text-xs text-slate-500">Ediel-ID: {field(row.ediel_id)} · Roller: {(row.actor_roles ?? []).join(', ') || '—'}</div>
                  </td>
                  <td className="px-3 py-4 text-xs text-slate-700">
                    <div>{field(row.message_family)} · {field(row.environment)}</div>
                    <div>SMTP: {field(row.communication_address)}</div>
                    <div>Party: {field(row.party_id)} · UNB: {field(row.interchange_party_id)}</div>
                  </td>
                  <td className="px-3 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone(row.readiness_status)}`}>{statusLabel(row.readiness_status)}</span>
                    <div className="mt-2 text-xs text-slate-500">Tillåten: {row.auto_send_allowed ? 'Ja' : 'Nej'} · Route verifierad: {row.route_verified ? 'Ja' : 'Nej'}</div>
                  </td>
                  <td className="px-3 py-4 text-xs text-slate-700">
                    <div>Status: {field(row.certificate_status)}</div>
                    <div>Gäller till: {field(row.certificate_valid_to)}</div>
                    <div>Fingerprint: {row.certificate_fingerprint_sha256 ? `${row.certificate_fingerprint_sha256.slice(0, 16)}…` : '—'}</div>
                    <div>Nästa kontroll: {field(row.certificate_next_check_at)}</div>
                  </td>
                  <td className="px-3 py-4 text-xs text-slate-700">
                    {(row.blocking_reasons ?? []).length === 0 && (row.warnings ?? []).length === 0 ? 'Inga blockerande punkter' : null}
                    {(row.blocking_reasons ?? []).map((reason) => (
                      <div key={reason} className="mb-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-red-800">{reason}</div>
                    ))}
                    {(row.warnings ?? []).map((warning) => (
                      <div key={warning} className="mb-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">{warning}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Senaste körningar</h2>
          <div className="mt-3 space-y-2 text-sm">
            {runs.map((run) => (
              <div key={run.id} className="rounded-xl border border-slate-200 p-3">
                <div className="font-medium text-slate-950">{run.run_type} · {run.status}</div>
                <div className="text-xs text-slate-500">Start: {run.started_at} · Klar: {field(run.finished_at)}</div>
                <div className="mt-1 text-xs text-slate-600">Aktörer {field(run.checked_actor_count)} · Routes {field(run.checked_route_count)} · Certifikat {field(run.checked_certificate_count)} · Auto på {field(run.auto_enabled_count)} · Auto av {field(run.auto_disabled_count)}</div>
              </div>
            ))}
            {runs.length === 0 ? <div className="text-sm text-slate-500">Inga readiness-körningar ännu.</div> : null}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Certifikatkontroller</h2>
          <div className="mt-3 space-y-2 text-sm">
            {certificates.map((cert) => (
              <div key={cert.id} className="rounded-xl border border-slate-200 p-3">
                <div className="font-medium text-slate-950">Ediel-ID {field(cert.ediel_id)} · {cert.environment} · {cert.purpose}</div>
                <div className="text-xs text-slate-600">Status: {cert.status} · Gäller till: {field(cert.valid_to)}</div>
                <div className="text-xs text-slate-500">Nästa kontroll: {field(cert.next_check_at)} · Fingerprint: {cert.fingerprint_sha256 ? `${cert.fingerprint_sha256.slice(0, 18)}…` : '—'}</div>
              </div>
            ))}
            {certificates.length === 0 ? <div className="text-sm text-slate-500">Inga certifikatposter ännu. Kör backfill för att skapa saknade certifikatkontroller.</div> : null}
          </div>
        </div>
      </section>
    </main>
  )
}
