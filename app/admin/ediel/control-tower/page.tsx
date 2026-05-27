import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getOperationalCompanyScope, isMissingRelationError } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

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
    if (isSafeDbError(error)) return []
    throw error
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
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
    outboundQueued,
    unresolvedRoutes,
    recentMessages,
    disabledRoutes,
  ] = await Promise.all([
    safeCount('ediel_messages', companyId),
    safeCount('ediel_messages', companyId, [{ column: 'status', value: 'failed' }]),
    safeCount('ediel_messages', companyId, [
      { column: 'ack_due_at', op: 'neq', value: null },
      { column: 'status', op: 'in', value: ['queued', 'prepared', 'sent', 'received', 'validated'] },
    ]),
    safeCount('ediel_messages', companyId, [{ column: 'ack_outcome', op: 'in', value: ['negative', 'rejected'] }]),
    safeCount('ediel_messages', companyId, [{ column: 'dedupe_status', op: 'in', value: ['duplicate', 'blocked'] }]),
    safeCount('ediel_messages', companyId, [{ column: 'direction', value: 'outbound' }, { column: 'status', op: 'in', value: ['queued', 'prepared'] }]),
    safeCount('outbound_requests', companyId, [{ column: 'channel_type', value: 'unresolved' }]),
    safeRows<EdielMessageRow>(
      'ediel_messages',
      companyId,
      'id, message_family, message_code, direction, status, ack_status, interchange_reference, transaction_reference, sender_ediel_id, receiver_ediel_id, created_at',
      [],
      12
    ),
    safeRows<RouteIssueRow>('ediel_route_profiles', companyId, 'id, route_name, counterparty_name, status, is_enabled, updated_at', [{ column: 'is_enabled', value: false }], 8, 'updated_at'),
  ])

  const workspaceName = tenantScope.isPlatformAdmin
    ? 'Gridex Platform'
    : companyScope.companyName ?? 'Bolag saknas'

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel Control Tower"
        subtitle="Kvittenser, fel, dubbletter, route-problem och senaste Ediel-meddelanden."
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Ediel-meddelanden" value={totalMessages} href="/admin/ediel/messages" tone="info" />
          <StatCard label="Misslyckade" value={failedMessages} href="/admin/ediel/messages?status=failed" tone={failedMessages > 0 ? 'danger' : 'success'} />
          <StatCard label="Försenade kvittenser" value={overdueAcks} href="/admin/ediel/messages" tone={overdueAcks > 0 ? 'danger' : 'success'} />
          <StatCard label="Negativa APERAK" value={negativeAperaks} href="/admin/ediel/messages" tone={negativeAperaks > 0 ? 'warning' : 'success'} />
          <StatCard label="Dubblett/blockerat" value={duplicateBlocked} href="/admin/ediel/messages" tone={duplicateBlocked > 0 ? 'warning' : 'success'} />
          <StatCard label="Outbound köad" value={outboundQueued} href="/admin/ediel/messages?direction=outbound" tone={outboundQueued > 0 ? 'warning' : 'success'} />
          <StatCard label="Outbound saknar route" value={unresolvedRoutes} href="/admin/outbound/unresolved" tone={unresolvedRoutes > 0 ? 'danger' : 'success'} />
          <StatCard
            label="Inaktiva route-profiler"
            value={disabledRoutes.length}
            href={tenantScope.isPlatformAdmin ? '/admin/ediel/routes' : '/admin/company-actor-status'}
            tone={disabledRoutes.length > 0 ? 'warning' : 'success'}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
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
                      <td className="px-4 py-3 font-semibold text-slate-900">{message.message_family ?? 'EDIEL'} {message.message_code ?? ''}</td>
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

          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Snabblänkar</h2>
            <Link href="/admin/ediel/messages" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Live-meddelanden</Link>
            {tenantScope.isPlatformAdmin ? (
              <>
                <Link href="/admin/ediel/routes" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Adressering & routes</Link>
                <Link href="/admin/ediel/settings" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Ediel-inställningar</Link>
              </>
            ) : null}
            <Link href="/admin/company-actor-status" className="block rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Live-status & godkännande</Link>

            {disabledRoutes.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Inaktiva route-profiler</p>
                <ul className="mt-2 space-y-1">
                  {disabledRoutes.slice(0, 5).map((route) => (
                    <li key={route.id}>{route.route_name ?? route.counterparty_name ?? route.id}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </section>
      </main>
    </div>
  )
}
