import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { canonicalRulebookSummary } from '@/lib/ediel/rulebook/canonicalRules'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { activateEdielRuleProfileVersionAction, importEdielFieldMatrixAction } from './actions'

export const dynamic = 'force-dynamic'

type ProfileRow = {
  id: string
  profile_key: string
  message_family: string
  message_code: string | null
  profile_name: string
  active_version: string | null
  is_active: boolean
}

type VersionRow = {
  id: string
  profile_key: string
  version: string
  status: string
  created_at: string | null
  activated_at: string | null
  rules?: Record<string, unknown> | null
}

type ImportRow = {
  id: string
  version: string
  source: string
  status: string
  row_count: number
  warning_count: number
  created_at: string | null
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function text(value: unknown): string {
  const display = String(value ?? '').trim()
  return display.length > 0 ? display : '—'
}

function statusClass(status: string): string {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (status === 'review') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status === 'draft') return 'border-slate-200 bg-slate-50 text-slate-700'
  return 'border-red-200 bg-red-50 text-red-900'
}

function dateText(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function loadDashboard() {
  const supabase = await createSupabaseServerClient()
  const [profiles, versions, imports] = await Promise.all([
    supabase.from('ediel_rule_profiles').select('id, profile_key, message_family, message_code, profile_name, active_version, is_active').order('profile_key', { ascending: true }).limit(120),
    supabase.from('ediel_rule_profile_versions').select('id, profile_key, version, status, created_at, activated_at, rules').order('created_at', { ascending: false }).limit(160),
    supabase.from('ediel_field_matrix_imports').select('id, version, source, status, row_count, warning_count, created_at').order('created_at', { ascending: false }).limit(10),
  ])

  return {
    profiles: asRows<ProfileRow>(profiles.data),
    versions: asRows<VersionRow>(versions.data),
    imports: asRows<ImportRow>(imports.data),
    warnings: [profiles.error?.message, versions.error?.message, imports.error?.message].filter(Boolean),
  }
}

function SimpleStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
    </div>
  )
}

export default async function EdielRuleProfilesPage() {
  const context = await requirePlatformAdminAccess()
  const dashboard = await loadDashboard()
  const canonical = canonicalRulebookSummary()
  const activeCount = dashboard.versions.filter((version) => version.status === 'active').length
  const reviewCount = dashboard.versions.filter((version) => version.status === 'review').length
  const conflictCount = dashboard.versions.reduce((sum, version) => {
    const conflicts = version.rules?.conflicts
    return sum + (Array.isArray(conflicts) ? conflicts.length : 0)
  }, 0)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel regelprofiler"
        subtitle="Field Matrix-import + canonical rulebook. Enkel vy, tekniska detaljer bakom granskning."
        userEmail={context.email}
        workspaceName="Gridex Platform"
        workspaceMode="platform"
      />

      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Batch 4 · Rulebook</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Regelprofiler för test och produktion</h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-700">
                En gemensam engine används för både Edielportalen och live. Field Matrix kan importeras och aktiveras, men canonical safety rules kan inte skrivas över av admin.
              </p>
            </div>
            <Link href="/admin/ediel/certification" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Öppna certifiering</Link>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-5">
          <SimpleStat label="Profiler" value={dashboard.profiles.length} />
          <SimpleStat label="Aktiva versioner" value={activeCount} />
          <SimpleStat label="I review" value={reviewCount} />
          <SimpleStat label="Canonical regler" value={canonical.rules.length} />
          <SimpleStat label="Konflikter" value={conflictCount} />
        </section>

        {dashboard.warnings.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">{dashboard.warnings.join(' · ')}</section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <form action={importEdielFieldMatrixAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-700">Import</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Lägg in ny Field Matrix-version</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
              Klistra in Excel/TSV/CSV. Importen hamnar i review och måste aktiveras av superadmin.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                Version
                <input name="version" placeholder="prodat_26a_review_1" className="mt-1 block w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal" />
              </label>
              <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                Standardfamilj
                <select name="defaultFamily" defaultValue="PRODAT" className="mt-1 block w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal">
                  <option value="PRODAT">PRODAT</option>
                  <option value="UTILTS">UTILTS</option>
                  <option value="APERAK">APERAK</option>
                  <option value="CONTRL">CONTRL</option>
                  <option value="UTILTS_ERR">UTILTS_ERR</option>
                </select>
              </label>
              <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                Källdokument
                <input name="sourceDocument" defaultValue="PRODAT 26.A / APERAK 16.B" className="mt-1 block w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal" />
              </label>
              <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                Källversion
                <input name="sourceVersion" placeholder="26.A / 16.B" className="mt-1 block w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal" />
              </label>
              <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                Giltig från
                <input name="validFrom" type="date" defaultValue="2026-04-01" className="mt-1 block w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal" />
              </label>
              <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                Källa internt
                <input name="source" defaultValue="admin_field_matrix_import" className="mt-1 block w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal" />
              </label>
            </div>
            <label className="mt-3 block text-xs font-black uppercase tracking-[0.14em] text-slate-600">
              CSV/TSV-fil
              <input name="matrixFile" type="file" accept=".csv,.tsv,.txt" className="mt-1 block w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal" />
            </label>
            <label className="mt-3 block text-xs font-black uppercase tracking-[0.14em] text-slate-600">
              Eller klistra in från Excel
              <textarea name="matrixText" rows={10} placeholder={'profile_key\tmessage_family\tmessage_code\tsegment\tqualifier\trequirement\tnote\nprodat_z15_permission_ended\tPRODAT\tZ15\tRFF\tZ09\trequired\tPermission id'} className="mt-1 block w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal" />
            </label>
            <button type="submit" className="mt-5 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800">Importera till review</button>
          </form>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-700">Senaste importer</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Importlogg</h2>
            <div className="mt-4 space-y-3">
              {dashboard.imports.length === 0 ? <p className="text-sm font-medium text-slate-500">Inga importer ännu.</p> : null}
              {dashboard.imports.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-950">{item.version}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{item.source} · {dateText(item.created_at)}</div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(item.status)}`}>{item.status}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-700">{item.row_count} regler · {item.warning_count} varningar</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-700">Profiler</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Aktiva och importerade profiler</h2>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {dashboard.profiles.map((profile) => {
              const profileVersions = dashboard.versions.filter((version) => version.profile_key === profile.profile_key)
              const active = profileVersions.find((version) => version.version === profile.active_version) ?? profileVersions.find((version) => version.status === 'active')
              return (
                <div key={profile.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">{profile.message_family} {text(profile.message_code)}</p>
                      <h3 className="mt-1 text-base font-black text-slate-950">{profile.profile_name}</h3>
                      <p className="mt-1 break-all text-xs font-semibold text-slate-500">{profile.profile_key}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${profile.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{profile.is_active ? 'Aktiv' : 'Inaktiv'}</span>
                  </div>
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">Aktiv version: <span className="font-black text-slate-950">{text(active?.version ?? profile.active_version)}</span></div>
                  <div className="mt-3 space-y-2">
                    {profileVersions.slice(0, 3).map((version) => {
                      const conflictsRaw = version.rules?.conflicts
                      const conflicts = Array.isArray(conflictsRaw) ? conflictsRaw.length : 0
                      return (
                        <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 px-3 py-2">
                          <div>
                            <div className="text-sm font-black text-slate-950">{version.version}</div>
                            <div className="text-xs font-medium text-slate-500">{dateText(version.created_at)} · {conflicts} konflikter</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(version.status)}`}>{version.status}</span>
                            {version.status !== 'active' && conflicts === 0 ? (
                              <form action={activateEdielRuleProfileVersionAction}>
                                <input type="hidden" name="profileKey" value={version.profile_key} />
                                <input type="hidden" name="version" value={version.version} />
                                <button className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800" type="submit">Aktivera</button>
                              </form>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                    {profileVersions.length === 0 ? <p className="text-sm font-medium text-slate-500">Ingen version skapad ännu.</p> : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
