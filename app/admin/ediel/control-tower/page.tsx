import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { getEdielOperationsEngineStatus } from '@/lib/ediel/operations/engineStatus'
import {
  buildEdielControlTowerOperationsSummary,
  type EdielOpsIncident,
  type EdielOpsMonitor,
  type EdielOpsMetric,
  type EdielOpsReadinessCheck,
} from '@/lib/ediel/operations/controlTower'

export const dynamic = 'force-dynamic'

type CountFilter = {
  column: string
  value: string | string[] | boolean | null
  op?: 'eq' | 'in' | 'is' | 'neq' | 'notIs'
}

type SafeSupabaseQuery = {
  eq: (column: string, value: unknown) => SafeSupabaseQuery
  neq: (column: string, value: unknown) => SafeSupabaseQuery
  in: (column: string, values: readonly unknown[]) => SafeSupabaseQuery
  is: (column: string, value: unknown) => SafeSupabaseQuery
  not: (column: string, operator: string, value: unknown) => SafeSupabaseQuery
  limit: (count: number) => SafeSupabaseQuery
  order: (column: string, options?: { ascending?: boolean }) => SafeSupabaseQuery
  then: PromiseLike<{ data?: unknown; count?: number | null; error?: unknown }>['then']
}

type EdielMessageRow = {
  id: string
  message_family: string | null
  message_code: string | null
  direction: string | null
  status: string | null
  ack_status: string | null
  interchange_reference: string | null
  transaction_reference: string | null
  sender_ediel_id: string | null
  receiver_ediel_id: string | null
  created_at: string | null
}

type RouteIssueRow = {
  id: string
  route_name?: string | null
  counterparty_name?: string | null
  status?: string | null
  is_active?: boolean | null
  is_enabled?: boolean | null
  updated_at?: string | null
}

function applyFilter(query: SafeSupabaseQuery, filter: CountFilter): SafeSupabaseQuery {
  if (filter.op === 'in') return query.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
  if (filter.op === 'is') return query.is(filter.column, filter.value)
  if (filter.op === 'notIs') return query.not(filter.column, 'is', filter.value)
  if (filter.op === 'neq') {
    if (filter.value === null) return query.not(filter.column, 'is', null)
    return query.neq(filter.column, filter.value)
  }
  return query.eq(filter.column, filter.value)
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
    console.warn(`[ediel-control-tower] Kunde inte räkna ${table}`, error)
    return 0
  }
}

async function safeRows<T>(
  table: string,
  companyId: string | null,
  select: string,
  filters: CountFilter[] = [],
  limit = 12,
  orderColumn = 'created_at'
): Promise<T[]> {
  try {
    let query = supabaseService.from(table).select(select).limit(limit) as unknown as SafeSupabaseQuery
    if (companyId) query = query.eq('company_id', companyId)
    for (const filter of filters) query = applyFilter(query, filter)
    query = query.order(orderColumn, { ascending: false })
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as T[]
  } catch (error) {
    console.warn(`[ediel-control-tower] Kunde inte hämta rader från ${table}`, error)
    return []
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function toneClass(tone: 'danger' | 'warning' | 'success' | 'info') {
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-800'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-white text-slate-800'
}

function statusClass(status: string) {
  if (status === 'blocked' || status === 'danger') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'attention' || status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'healthy' || status === 'ready' || status === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function StatCard({ label, value, href, tone = 'info' }: { label: string; value: number | string; href?: string; tone?: 'danger' | 'warning' | 'success' | 'info' }) {
  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </>
  )

  if (!href) {
    return <div className={`rounded-3xl border p-5 shadow-sm ${toneClass(tone)}`}>{content}</div>
  }

  return (
    <Link href={href} className={`rounded-3xl border p-5 shadow-sm transition hover:shadow-md ${toneClass(tone)}`}>
      {content}
    </Link>
  )
}

function MetricCard({ metric }: { metric: EdielOpsMetric }) {
  return (
    <StatCard label={metric.label} value={metric.value} href={metric.href} tone={metric.tone} />
  )
}

function MonitorCard({ monitor }: { monitor: EdielOpsMonitor }) {
  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${statusClass(monitor.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{monitor.title}</p>
          <p className="mt-2 text-2xl font-semibold">{monitor.value}</p>
        </div>
        <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] opacity-80">{monitor.status}</span>
      </div>
      <p className="mt-3 text-sm leading-6 opacity-85">{monitor.description}</p>
      {monitor.actionHref ? (
        <Link href={monitor.actionHref} className="mt-4 inline-flex rounded-2xl border border-current/25 px-4 py-2 text-sm font-semibold hover:bg-white/40">
          {monitor.actionLabel ?? 'Öppna'}
        </Link>
      ) : null}
    </div>
  )
}

function ReadinessList({ title, items }: { title: string; items: EdielOpsReadinessCheck[] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? <p className="text-sm text-slate-500">Inga poster att visa.</p> : null}
        {items.map((item) => (
          <div key={item.key} className={`rounded-2xl border p-4 ${statusClass(item.status)}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">{item.label}</p>
              <span className="rounded-full border border-current/20 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]">{item.status}</span>
            </div>
            <p className="mt-2 text-sm leading-6 opacity-85">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function IncidentList({ title, items }: { title: string; items: EdielOpsIncident[] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? <p className="text-sm text-slate-500">Inga händelser hittades.</p> : null}
        {items.map((item) => {
          const body = (
            <div className={`rounded-2xl border p-4 ${toneClass(item.tone)}`}>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-sm leading-6 opacity-85">{item.description}</p>
              <p className="mt-2 text-xs opacity-70">{formatDate(item.createdAt)}</p>
            </div>
          )

          return item.href ? <Link key={item.id} href={item.href}>{body}</Link> : <div key={item.id}>{body}</div>
        })}
      </div>
    </div>
  )
}

export default async function EdielControlTowerPage() {
  const context = await requireAdminPageKeyAccess('ediel.control_tower')
  const tenantScope = await resolveAdminTenantReadScope(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const companyId = tenantScope.companyId

  const [
    totalMessages,
    failedMessages,
    overdueAcks,
    negativeAperaks,
    duplicateBlocked,
    unresolvedEdielItems,
    outboundQueued,
    unresolvedRoutes,
    recentMessages,
    disabledRoutes,
    disabledRouteRows,
    operations,
  ] = await Promise.all([
    safeCount('ediel_messages', companyId),
    safeCount('ediel_messages', companyId, [{ column: 'status', value: 'failed' }]),
    safeCount('ediel_messages', companyId, [
      { column: 'ack_due_at', op: 'neq', value: null },
      { column: 'status', op: 'in', value: ['queued', 'prepared', 'sent', 'received', 'validated'] },
    ]),
    safeCount('ediel_messages', companyId, [{ column: 'ack_outcome', op: 'in', value: ['negative', 'rejected'] }]),
    safeCount('ediel_messages', companyId, [{ column: 'dedupe_status', op: 'in', value: ['duplicate', 'blocked'] }]),
    safeCount('ediel_unresolved_items', companyId, [{ column: 'status', op: 'in', value: ['open', 'manual_review'] }]),
    safeCount('ediel_messages', companyId, [{ column: 'direction', value: 'outbound' }, { column: 'status', op: 'in', value: ['queued', 'prepared'] }]),
    safeCount('outbound_requests', companyId, [{ column: 'channel_type', value: 'unresolved' }]),
    safeRows<EdielMessageRow>(
      'ediel_messages',
      companyId,
      'id, message_family, message_code, direction, status, ack_status, interchange_reference, transaction_reference, sender_ediel_id, receiver_ediel_id, created_at',
      [],
      12
    ),
    safeCount('ediel_route_profiles', companyId, [{ column: 'status', op: 'in', value: ['disabled', 'inactive'] }]),
    safeRows<RouteIssueRow>(
      'ediel_route_profiles',
      companyId,
      'id, route_name, counterparty_name, status, is_enabled, updated_at',
      [{ column: 'status', op: 'in', value: ['disabled', 'inactive'] }],
      8,
      'updated_at'
    ),
    buildEdielControlTowerOperationsSummary({
      companyId,
      scope: tenantScope.isPlatformAdmin ? 'platform' : 'tenant',
    }),
  ])

  const engineStatus = getEdielOperationsEngineStatus()
  const workspaceName = tenantScope.isPlatformAdmin
    ? 'Gridex Platform'
    : companyScope.companyName ?? 'Bolag saknas'

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel Control Tower"
        subtitle="Drift, kvittenser, transport, send-locks, dubbletter, route-problem och Ediel-meddelanden."
        userEmail={context.email}
        workspaceName={workspaceName}
        workspaceMode={tenantScope.isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="space-y-6 p-6 lg:p-8">
        {!tenantScope.isPlatformAdmin && !companyId ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
            <h2 className="text-lg font-semibold">Bolagskoppling saknas</h2>
            <p className="mt-2 text-sm leading-6">
              Kontot har Ediel-behörighet men saknar aktiv bolagskoppling. Koppla användaren till rätt bolag för att visa tenantens Ediel-flöden.
            </p>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Batch 2.5D-1</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Production Operations Foundation</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                Den här vyn bygger drift- och skyddslagret före full regression. Den visar mailbox/SMTP-health, ACK-övervakning, payload-preflight, route-resolution, tenant send-lock och audit. Nya tekniska regler ska fortfarande inte aktiveras som live-regler innan Batch 2.5C regression är grön.
              </p>
            </div>
            <div className={`rounded-3xl border p-4 text-sm ${statusClass(operations.sendLock.status)}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-75">Send-lock</p>
              <p className="mt-2 font-semibold">{operations.sendLock.title}</p>
              <p className="mt-1 leading-6 opacity-85">{operations.sendLock.description}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Ediel-meddelanden" value={totalMessages} href="/admin/ediel/messages" tone="info" />
          <StatCard label="Misslyckade" value={failedMessages} href="/admin/ediel/messages?status=failed" tone={failedMessages > 0 ? 'danger' : 'success'} />
          <StatCard label="Försenade kvittenser" value={overdueAcks} href="/admin/ediel/messages" tone={overdueAcks > 0 ? 'danger' : 'success'} />
          <StatCard label="Negativa APERAK" value={negativeAperaks} href="/admin/ediel/messages" tone={negativeAperaks > 0 ? 'warning' : 'success'} />
          <StatCard label="Dubblett/blockerat" value={duplicateBlocked} href="/admin/ediel/messages" tone={duplicateBlocked > 0 ? 'warning' : 'success'} />
          <StatCard label="Oupplösta Ediel" value={unresolvedEdielItems} href="/admin/ediel/unresolved" tone={unresolvedEdielItems > 0 ? 'danger' : 'success'} />
          <StatCard label="Outbound köad" value={outboundQueued} href="/admin/ediel/messages?direction=outbound" tone={outboundQueued > 0 ? 'warning' : 'success'} />
          <StatCard label="Outbound saknar route" value={unresolvedRoutes} href="/admin/outbound/unresolved" tone={unresolvedRoutes > 0 ? 'danger' : 'success'} />
          <StatCard
            label="Inaktiva route-profiler"
            value={disabledRoutes}
            href={tenantScope.isPlatformAdmin ? '/admin/ediel/routes' : '/admin'}
            tone={disabledRoutes > 0 ? 'warning' : 'success'}
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {operations.metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)}
        </section>

        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {operations.monitors.map((monitor) => <MonitorCard key={monitor.key} monitor={monitor} />)}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Senaste Ediel-meddelanden</h2>
                  <p className="mt-1 text-sm text-slate-600">Visar senaste meddelanden i valt tenant-/platform-scope.</p>
                </div>
                <Link href="/admin/ediel/messages" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Öppna meddelanden</Link>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Typ</th>
                      <th className="px-4 py-3">Riktning</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Referens</th>
                      <th className="px-4 py-3">Skapad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {recentMessages.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">Inga Ediel-meddelanden hittades.</td>
                      </tr>
                    ) : null}
                    {recentMessages.map((message) => (
                      <tr key={message.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <Link href={`/admin/ediel/messages/${message.id}`} className="hover:underline">
                            {message.message_family ?? 'EDIEL'} {message.message_code ?? ''}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{message.direction ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{message.status ?? '—'}{message.ack_status ? ` · ${message.ack_status}` : ''}</td>
                        <td className="px-4 py-3 text-slate-700">{message.transaction_reference ?? message.interchange_reference ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDate(message.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <section className="grid gap-6 lg:grid-cols-2">
              <ReadinessList title="Readiness checks" items={operations.readiness} />
              <ReadinessList title="Send-lock blockerare" items={[...operations.sendLock.blockers, ...operations.sendLock.warnings]} />
            </section>
          </div>

          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Snabblänkar</h2>
            <Link href="/admin/ediel/messages" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Live-meddelanden</Link>
            {tenantScope.isPlatformAdmin ? (
              <>
                <Link href="/admin/ediel/routes" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Adressering & routes</Link>
                <Link href="/admin/ediel/mailboxes" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Mailbox & polling</Link>
                <Link href="/admin/ediel/readiness" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Readiness</Link>
                <Link href="/admin/ediel/settings" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Ediel-inställningar</Link>
                <Link href="/admin/ediel/system-tests" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Systemtest & ACK</Link>
              </>
            ) : null}
            <Link href="/admin" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Översikt & godkännandestatus</Link>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-950">{engineStatus.title}</p>
              <p className="mt-2 leading-6">{engineStatus.description}</p>
              <div className="mt-3 space-y-2">
                {engineStatus.checks.map((check) => (
                  <div key={check.label} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                    <span>{check.label}</span>
                    <span className="font-semibold">{check.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {disabledRouteRows.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Inaktiva route-profiler</p>
                <ul className="mt-2 space-y-1">
                  {disabledRouteRows.slice(0, 5).map((route) => (
                    <li key={route.id}>{route.route_name ?? route.counterparty_name ?? route.id}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <IncidentList title="Driftincidenter" items={operations.incidents} />
          <IncidentList title="Audit timeline" items={operations.auditTimeline} />
        </section>
      </main>
    </div>
  )
}
