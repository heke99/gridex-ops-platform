import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { listPlatformControlTowerAlerts } from '@/lib/tenant/controlTower'
import { listBatch2CControlTowerSummary, listBatch2CDriftQueue } from '@/lib/operations/batch2cAutomation'
import {
  createControlTowerCasesAction,
  resolveControlTowerQueueItemAction,
  runControlTowerPeriodMotorAction,
} from './actions'

export const dynamic = 'force-dynamic'

function numberValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toneClass(severity: string | null | undefined): string {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-950'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950'
  return 'border-slate-200 bg-white text-slate-950'
}

function badgeClass(severity: string | null | undefined): string {
  if (severity === 'critical') return 'border-red-200 bg-red-100 text-red-800'
  if (severity === 'warning') return 'border-amber-200 bg-amber-100 text-amber-800'
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function monthsBack(count: number) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1)).toISOString().slice(0, 7)
}

type ControlTowerSearchParams = {
  status?: string | string[]
  message?: string | string[]
}

type ResolvedControlTowerParams = {
  status: string | null
  message: string | null
}

function firstParamValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

async function resolveControlTowerSearchParams(
  searchParams?: ControlTowerSearchParams | Promise<ControlTowerSearchParams>
): Promise<ResolvedControlTowerParams> {
  const params = await Promise.resolve(searchParams ?? {})

  return {
    status: firstParamValue(params.status),
    message: firstParamValue(params.message),
  }
}

export default async function AdminControlTowerPage({ searchParams }: { searchParams?: ControlTowerSearchParams | Promise<ControlTowerSearchParams> }) {
  const admin = await requireAdminPageKeyAccess('operations.control_tower')
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyFilter = isPlatformAdmin ? null : scope.companyId
  const [summaryRows, queueRows, platformAlerts, params] = await Promise.all([
    listBatch2CControlTowerSummary(companyFilter),
    listBatch2CDriftQueue(companyFilter),
    isPlatformAdmin ? listPlatformControlTowerAlerts() : Promise.resolve([]),
    resolveControlTowerSearchParams(searchParams),
  ])

  const tenantSummary = summaryRows[0] ?? null
  const totals = summaryRows.reduce(
    (acc, row) => {
      acc.open += numberValue(row.open_queue_count)
      acc.critical += numberValue(row.critical_queue_count)
      acc.gaps += numberValue(row.open_metering_gap_count)
      acc.blockedExports += numberValue(row.blocked_export_row_count)
      acc.external += numberValue(row.open_external_intake_count)
      acc.portal += numberValue(row.open_portal_completion_count)
      return acc
    },
    { open: 0, critical: 0, gaps: 0, blockedExports: 0, external: 0, portal: 0 }
  )

  return (
    <div className="space-y-6 p-6 xl:p-8">
      <AdminHeader
        title="Control Tower"
        subtitle={isPlatformAdmin ? 'Global SaaS-drift för tenants, Ediel, mätvärden, export, portal och externa avtalsflöden.' : `Live drift för ${scope.companyName ?? 'ditt bolag'}: åtgärdsköer, mätvärdesluckor, partnerexport och kundärenden.`}
        userEmail={admin.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />

      {params?.message ? (
        <section className={`rounded-3xl border p-5 text-sm font-semibold ${params.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          {params.message}
        </section>
      ) : null}

      {scope.message && !isPlatformAdmin ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-sm">
          {scope.message}
        </section>
      ) : null}

      {platformAlerts.length > 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Superadmin-larm</h2>
            <p className="mt-1 text-sm text-slate-700">Tenant-, Ediel-, route-, export- och behörighetslarm som påverkar SaaS-driften.</p>
          </div>
          <div className="grid gap-4 p-5 xl:grid-cols-3">
            {platformAlerts.map((alert) => (
              <Link key={alert.id} href={alert.href} className={`rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass(alert.severity === 'danger' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info')}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-950">{alert.title}</h3>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(alert.severity === 'danger' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info')}`}>{alert.count}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{alert.description}</p>
                {alert.meta ? <p className="mt-2 text-xs text-slate-600">{alert.meta}</p> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className={`rounded-3xl border p-5 shadow-sm ${totals.open > 0 ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}>
          <div className="text-sm font-medium">Öppna köer</div>
          <div className="mt-2 text-3xl font-semibold">{totals.open}</div>
        </div>
        <div className={`rounded-3xl border p-5 shadow-sm ${totals.critical > 0 ? 'border-red-200 bg-red-50 text-red-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}>
          <div className="text-sm font-medium">Kritiska</div>
          <div className="mt-2 text-3xl font-semibold">{totals.critical}</div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-slate-700">Mätvärdesluckor</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">{totals.gaps}</div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-slate-700">Blockerade export</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">{totals.blockedExports}</div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-slate-700">Externa avtal</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">{totals.external}</div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-medium text-slate-700">Portalkomplettering</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">{totals.portal}</div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Live åtgärdskö</h2>
            <p className="mt-1 text-sm text-slate-700">Blockerade rader, mätvärdesluckor, partnerexporter, externa avtal och kundärenden i en gemensam driftvy.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {queueRows.length === 0 ? (
              <div className="px-5 py-10 text-sm text-slate-600">Inga öppna driftköer just nu.</div>
            ) : queueRows.slice(0, 80).map((row) => (
              <article key={`${row.queue_type}-${row.source_id}`} className="px-5 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-950">{row.title}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(row.severity)}`}>{row.status}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">{row.queue_type}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{row.description}</p>
                    <p className="mt-1 text-xs text-slate-500">Uppdaterad {formatDate(row.updated_at)} · Kund {row.customer_id ?? '—'}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {row.customer_id ? (
                      <Link href={`/admin/customers/${row.customer_id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Öppna kund</Link>
                    ) : null}
                    <form action={resolveControlTowerQueueItemAction}>
                      <input type="hidden" name="queue_type" value={row.queue_type} />
                      <input type="hidden" name="source_id" value={row.source_id} />
                      <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Markera hanterad</button>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <form action={runControlTowerPeriodMotorAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">Mätvärdesperioder</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Skanna perioder</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Skapar luckor, requests och ärenden per mätpunkt och period.</p>
            <div className="mt-4 grid gap-3">
              <input name="start_month" type="month" defaultValue={monthsBack(11)} className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="end_month" type="month" defaultValue={currentMonth()} className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <button className="rounded-2xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-800">Kör periodmotor</button>
            </div>
          </form>

          <form action={createControlTowerCasesAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-800">Ärendekoppling</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Koppla köer till ärenden</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Skapar eller återanvänder kundärenden för alla öppna driftköer.</p>
            <button className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-900 hover:bg-violet-100">Skapa ärenden</button>
          </form>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Snabblänkar</h2>
            <div className="mt-4 grid gap-3">
              <Link href="/admin/operations/automation" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Automationsmotor</Link>
              <Link href="/admin/operations/perioder" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Mätvärdesluckor</Link>
              <Link href="/admin/billing/export-center" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Exportcenter</Link>
              <Link href="/admin/platform/security" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">RLS-policyrapport</Link>
            </div>
          </section>
        </aside>
      </section>

      {isPlatformAdmin && summaryRows.length > 1 ? (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Tenantstatus</h2>
            <p className="mt-1 text-sm text-slate-700">Volymer och blockerare per bolag.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {summaryRows.slice(0, 50).map((row) => (
              <div key={row.company_id} className="grid gap-3 px-5 py-4 text-sm lg:grid-cols-[1.2fr_repeat(5,0.6fr)] lg:items-center">
                <div className="font-semibold text-slate-950">{row.company_name ?? row.company_id}</div>
                <div>Köer: {numberValue(row.open_queue_count)}</div>
                <div>Kritiska: {numberValue(row.critical_queue_count)}</div>
                <div>Mätvärden: {numberValue(row.open_metering_gap_count)}</div>
                <div>Export: {numberValue(row.blocked_export_row_count)}</div>
                <div>Live: {row.live_ediel_enabled ? 'Ja' : 'Nej'}</div>
              </div>
            ))}
          </div>
        </section>
      ) : tenantSummary ? (
        <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
          Produktionsstatus: <span className="font-semibold text-slate-950">{tenantSummary.production_status ?? 'ej angiven'}</span> · Live Ediel: <span className="font-semibold text-slate-950">{tenantSummary.live_ediel_enabled ? 'aktiv' : 'ej aktiv'}</span>
        </section>
      ) : null}
    </div>
  )
}
