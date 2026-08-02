import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { runEdielClockHealthCheckAction, saveAgtReadinessAction } from '@/app/admin/ediel/readiness/actions'

export const dynamic = 'force-dynamic'

type CompanyRow = { id: string; name: string | null }
type ReadinessRow = {
  id: string
  company_id: string
  actor_role: string
  message_family: string
  readiness_status: string
  needs_retest: boolean
  retest_reason?: string | null
  test_resource_name?: string | null
  test_resource_email?: string | null
  updated_at?: string | null
}
type LockRow = {
  id: string
  company_id: string
  actor_role: string
  message_family: string
  environment_type: string
  locked_at: string | null
  expires_at: string | null
  released_at: string | null
}
type HealthRow = {
  id: string
  status: string
  measured_offset_ms: number | null
  checked_at: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function tone(status: string): string {
  if (status === 'critical' || status === 'blocked' || status === 'not_ready') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'warning' || status === 'needs_retest') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

async function safeRows<T>(table: string, select: string, limit = 50): Promise<T[]> {
  const { data, error } = await supabaseService
    .from(table)
    .select(select)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data ?? []) as T[]
}

export default async function EdielReadinessPage() {
  const context = await requirePlatformAdminAccess()
  const [companiesResult, readiness, locks, health] = await Promise.all([
    supabaseService.from('companies').select('id,name').order('name', { ascending: true }).limit(200),
    safeRows<ReadinessRow>('ediel_agt_readiness', 'id,company_id,actor_role,message_family,readiness_status,needs_retest,retest_reason,test_resource_name,test_resource_email,updated_at', 100),
    safeRows<LockRow>('ediel_test_run_locks', 'id,company_id,actor_role,message_family,environment_type,locked_at,expires_at,released_at', 50),
    safeRows<HealthRow>('ediel_runtime_health_checks', 'id,status,measured_offset_ms,checked_at', 10),
  ])
  const companies = (companiesResult.data ?? []) as CompanyRow[]
  const latestHealth = health[0] ?? null

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel Readiness"
        subtitle="Systemtest/TGT, aktörtest/AGT, produktion och bilaterala tester med separata miljötyper och go-live guardrails."
        userEmail={context.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-8">
        <section className="grid gap-4 lg:grid-cols-4">
          {[
            ['Systemtest / TGT', 'tgt_test', 'PRODAT/UTILTS builder, parser och ACK-baslinjer.'],
            ['Aktörtest / AGT', 'agt_test', 'Ediel-ID, teknisk adress, portalresurs och krypteringsläge.'],
            ['Produktion', 'production', 'Go-live checklist, certifikat, route, mailbox och shadow/live.'],
            ['Bilaterala tester', 'bilateral_test', 'Direkta tester mellan verkliga Ediel-aktörer.'],
          ].map(([title, env, text]) => (
            <div key={env} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{env}</p>
              <h2 className="mt-2 text-lg font-black text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-700">{text}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-950">AGT readiness</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            AGT startar bara när readiness är komplett, TGT är godkänd och ingen aktiv AGT-lock finns.
          </p>
          <form action={saveAgtReadinessAction} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select name="companyId" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">Välj bolag</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name ?? company.id}</option>)}
            </select>
            <select name="actorRole" required defaultValue="" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">Välj aktörsroll</option>
              <option value="supplier">supplier / DDQ</option>
              <option value="esco">energy_service_company / DGI</option>
            </select>
            <select name="messageFamily" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="PRODAT">PRODAT</option>
              <option value="UTILTS">UTILTS</option>
            </select>
            <input name="currentApprovalVersion" placeholder="Approval version" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="testResourceName" placeholder="Testresurs namn" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="testResourceEmail" type="email" placeholder="Testresurs e-post" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            {[
              ['testResourceConfirmed', 'Testresurs bekräftad'],
              ['edielPortalLoginConfirmed', 'Edielportalen-login bekräftad'],
              ['applicationSystemSelected', 'Application system valt'],
              ['ediSystemSelected', 'EDI system valt'],
            ].map(([name, label]) => (
              <label key={name} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <input type="checkbox" name={name} />
                {label}
              </label>
            ))}
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Spara readiness</button>
          </form>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Aktuell AGT-status</h2>
            <div className="mt-4 space-y-3">
              {readiness.length === 0 ? <p className="text-sm text-slate-500">Ingen AGT-readiness registrerad ännu.</p> : null}
              {readiness.map((row) => (
                <div key={row.id} className={`rounded-2xl border p-4 ${tone(row.needs_retest ? 'needs_retest' : row.readiness_status)}`}>
                  <div className="font-bold">{row.actor_role} · {row.message_family}</div>
                  <div className="mt-1 text-sm">Status: {row.needs_retest ? 'needs_retest' : row.readiness_status}</div>
                  <div className="mt-1 text-xs">Testresurs: {row.test_resource_name ?? '—'} · {row.test_resource_email ?? '—'}</div>
                  {row.retest_reason ? <div className="mt-2 text-sm">{row.retest_reason}</div> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Aktiva testlås</h2>
            <div className="mt-4 space-y-3">
              {locks.filter((lock) => !lock.released_at).length === 0 ? <p className="text-sm text-slate-500">Inga aktiva lås.</p> : null}
              {locks.filter((lock) => !lock.released_at).map((lock) => (
                <div key={lock.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="font-bold">{lock.environment_type} · {lock.actor_role} · {lock.message_family}</div>
                  <div>Låst: {formatDate(lock.locked_at)} · Går ut: {formatDate(lock.expires_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-950">System clock health</h2>
              <p className="mt-2 text-sm text-slate-700">Senaste kontroll: {latestHealth ? `${latestHealth.status} · ${latestHealth.measured_offset_ms ?? 'okänd'} ms · ${formatDate(latestHealth.checked_at)}` : 'saknas'}</p>
            </div>
            <form action={runEdielClockHealthCheckAction} className="flex flex-wrap gap-2">
              <select name="environmentType" defaultValue="production" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="production">production</option>
                <option value="agt_test">agt_test</option>
                <option value="tgt_test">tgt_test</option>
                <option value="bilateral_test">bilateral_test</option>
              </select>
              <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Kontrollera klocka</button>
            </form>
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <Link href="/admin/ediel/test-center" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Öppna Test Center</Link>
          <Link href="/admin/platform/go-live" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">Go-live checklist</Link>
        </div>
      </main>
    </div>
  )
}
