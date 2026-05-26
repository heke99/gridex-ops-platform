import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getOperationalCompanyScope, isMissingRelationError } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import {
  createControlTowerCasesAction,
  resolveControlTowerQueueItemAction,
  runControlTowerPeriodMotorAction,
} from './actions'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  status?: string
  message?: string
}>

type CountFilter = {
  column: string
  value: string | string[] | boolean | null
  op?: 'eq' | 'in' | 'is' | 'neq'
}

type SafeSupabaseQuery = {
  eq: (column: string, value: unknown) => SafeSupabaseQuery
  neq: (column: string, value: unknown) => SafeSupabaseQuery
  in: (column: string, values: readonly unknown[]) => SafeSupabaseQuery
  is: (column: string, value: unknown) => SafeSupabaseQuery
  limit: (count: number) => SafeSupabaseQuery
  order: (column: string, options?: { ascending?: boolean }) => SafeSupabaseQuery
  then: PromiseLike<{ data?: unknown; count?: number | null; error?: unknown }>['then']
}

type RecentCaseRow = {
  id: string
  title: string | null
  status: string | null
  priority: string | null
  created_at: string | null
  customer_id: string | null
}

type QueueRow = {
  queue_type: string | null
  source_id: string | null
  title: string | null
  severity: string | null
  status: string | null
  created_at: string | null
}

function applyFilter(query: SafeSupabaseQuery, filter: CountFilter): SafeSupabaseQuery {
  if (filter.op === 'in') return query.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
  if (filter.op === 'is') return query.is(filter.column, filter.value)
  if (filter.op === 'neq') return query.neq(filter.column, filter.value)
  return query.eq(filter.column, filter.value)
}

function isSafeDbError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? '')
  return isMissingRelationError(error) || ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
}

async function safeCount(table: string, companyId: string | null, filters: CountFilter[] = []): Promise<number> {
  try {
    let query = supabaseService.from(table).select('*', { count: 'exact', head: true }) as unknown as SafeSupabaseQuery
    if (companyId) query = query.eq('company_id', companyId)
    for (const filter of filters) query = applyFilter(query, filter)
    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  } catch (error) {
    if (isSafeDbError(error)) return 0
    throw error
  }
}

async function safeRows<T>(
  table: string,
  companyId: string | null,
  select: string,
  filters: CountFilter[] = [],
  limit = 8
): Promise<T[]> {
  try {
    let query = supabaseService.from(table).select(select).limit(limit) as unknown as SafeSupabaseQuery
    if (companyId) query = query.eq('company_id', companyId)
    for (const filter of filters) query = applyFilter(query, filter)
    query = query.order('created_at', { ascending: false })
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as T[]
  } catch (error) {
    if (isSafeDbError(error)) return []
    throw error
  }
}

function toneClass(tone: 'danger' | 'warning' | 'success' | 'info') {
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-800'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-white text-slate-800'
}

function StatCard({ label, value, href, tone = 'info' }: { label: string; value: number; href: string; tone?: 'danger' | 'warning' | 'success' | 'info' }) {
  return (
    <Link href={href} className={`rounded-3xl border p-5 shadow-sm transition hover:shadow-md ${toneClass(tone)}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </Link>
  )
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function AdminControlTowerPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireAdminPageKeyAccess('operations.control_tower')
  const tenantScope = await resolveAdminTenantReadScope(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const resolvedSearchParams = await searchParams
  const companyId = tenantScope.companyId

  const [
    openCases,
    highCases,
    switchBlocked,
    switchOpen,
    outboundFailed,
    outboundUnresolved,
    meteringGaps,
    blockedBilling,
    recentCases,
    queueRows,
  ] = await Promise.all([
    safeCount('customer_cases', companyId, [{ column: 'status', op: 'in', value: ['open', 'action_required', 'manual_follow_up', 'billing_blocked'] }]),
    safeCount('customer_cases', companyId, [{ column: 'priority', op: 'in', value: ['high', 'critical'] }]),
    safeCount('supplier_switch_requests', companyId, [{ column: 'status', op: 'in', value: ['blocked', 'rejected', 'cancelled'] }]),
    safeCount('supplier_switch_requests', companyId, [{ column: 'status', op: 'in', value: ['draft', 'ready', 'queued', 'submitted', 'accepted', 'pending'] }]),
    safeCount('outbound_requests', companyId, [{ column: 'status', value: 'failed' }]),
    safeCount('outbound_requests', companyId, [{ column: 'channel_type', value: 'unresolved' }]),
    safeCount('metering_value_gaps', companyId, [{ column: 'status', op: 'in', value: ['open', 'missing', 'pending'] }]),
    safeCount('billing_underlays', companyId, [{ column: 'readiness_status', op: 'in', value: ['warning', 'blocked', 'requires_correction'] }]),
    safeRows<RecentCaseRow>('customer_cases', companyId, 'id, title, status, priority, created_at, customer_id', [], 8),
    safeRows<QueueRow>('batch2c_drift_queue', companyId, 'queue_type, source_id, title, severity, status, created_at', [{ column: 'status', op: 'in', value: ['open', 'new', 'pending', 'action_required'] }], 8),
  ])

  const workspaceName = tenantScope.isPlatformAdmin
    ? 'Gridex Platform'
    : companyScope.companyName ?? 'Bolag saknas'

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="System Control Tower"
        subtitle="Överblick över kundärenden, leverantörsbyten, outbound, mätvärden och faktureringsblockeringar."
        userEmail={context.email}
        workspaceName={workspaceName}
        workspaceMode={tenantScope.isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-6 p-6 lg:p-8">
        {resolvedSearchParams.message ? (
          <section className={`rounded-3xl border p-4 text-sm font-semibold ${resolvedSearchParams.status === 'error' ? toneClass('danger') : toneClass('success')}`}>
            {resolvedSearchParams.message}
          </section>
        ) : null}

        {!tenantScope.isPlatformAdmin && !companyId ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
            <h2 className="text-lg font-semibold">Bolagskoppling saknas</h2>
            <p className="mt-2 text-sm leading-6">
              Kontot har adminåtkomst men saknar aktiv koppling till ett elhandelsbolag. Koppla användaren till rätt bolag för att visa tenantens Control Tower.
            </p>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Öppna kundärenden" value={openCases} href="/admin/customer-cases" tone={openCases > 0 ? 'warning' : 'success'} />
          <StatCard label="Hög prioritet" value={highCases} href="/admin/customer-cases" tone={highCases > 0 ? 'danger' : 'success'} />
          <StatCard label="Blockerade switchar" value={switchBlocked} href="/admin/operations/switches" tone={switchBlocked > 0 ? 'danger' : 'success'} />
          <StatCard label="Aktiva switchar" value={switchOpen} href="/admin/operations/switches" tone={switchOpen > 0 ? 'warning' : 'success'} />
          <StatCard label="Outbound fel" value={outboundFailed} href="/admin/outbound" tone={outboundFailed > 0 ? 'danger' : 'success'} />
          <StatCard label="Saknar route" value={outboundUnresolved} href="/admin/outbound/unresolved" tone={outboundUnresolved > 0 ? 'warning' : 'success'} />
          <StatCard label="Mätvärdesluckor" value={meteringGaps} href="/admin/outbound/missing-meter-values" tone={meteringGaps > 0 ? 'warning' : 'success'} />
          <StatCard label="Faktura blockerad" value={blockedBilling} href="/admin/billing/export-center" tone={blockedBilling > 0 ? 'danger' : 'success'} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Senaste problem</h2>
                <p className="mt-1 text-sm text-slate-600">Kundärenden och driftköer som kräver uppföljning.</p>
              </div>
              <Link href="/admin/customer-cases" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Öppna ärenden</Link>
            </div>

            <div className="mt-5 space-y-3">
              {recentCases.length === 0 && queueRows.length === 0 ? (
                <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga öppna problem hittades för valt scope.</p>
              ) : null}

              {recentCases.map((row) => (
                <Link key={row.id} href={`/admin/customer-cases`} className="block rounded-2xl border border-slate-200 p-4 hover:bg-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{row.title ?? 'Kundärende'}</p>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{row.priority ?? 'normal'} · {row.status ?? 'open'}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{formatDate(row.created_at)}</p>
                </Link>
              ))}

              {queueRows.map((row) => (
                <form key={`${row.queue_type}-${row.source_id}`} action={resolveControlTowerQueueItemAction} className="rounded-2xl border border-slate-200 p-4">
                  <input type="hidden" name="queue_type" value={row.queue_type ?? ''} />
                  <input type="hidden" name="source_id" value={row.source_id ?? ''} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{row.title ?? row.queue_type ?? 'Driftkö'}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.severity ?? 'info'} · {row.status ?? 'open'} · {formatDate(row.created_at)}</p>
                    </div>
                    <button className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Markera hanterad</button>
                  </div>
                </form>
              ))}
            </div>
          </div>

          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Snabbåtgärder</h2>
            <form action={runControlTowerPeriodMotorAction} className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Kör periodmotor</p>
              <p className="mt-1 text-xs text-slate-600">Skapar saknade mätvärdesluckor, outbound och ärenden där underlag saknas.</p>
              <div className="mt-3 grid gap-2">
                <input name="start_month" placeholder="Startmånad, t.ex. 2026-01" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <input name="end_month" placeholder="Slutmånad, t.ex. 2026-05" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <button className="mt-3 w-full rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Kör</button>
            </form>

            <form action={createControlTowerCasesAction} className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Skapa ärenden från köer</p>
              <p className="mt-1 text-xs text-slate-600">Återanvänder befintliga ärenden och skapar bara där det saknas.</p>
              <button className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Skapa/uppdatera ärenden</button>
            </form>
          </aside>
        </section>
      </main>
    </div>
  )
}
