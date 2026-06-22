import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    q?: string
    direction?: string
    family?: string
    status?: string
    from?: string
    to?: string
    grid_owner?: string
    customer_id?: string
  }>
}

function firstParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function formatDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('sv-SE')
}

function statusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    draft: 'Utkast',
    queued: 'I kö',
    prepared: 'Förberett',
    sent: 'Skickat',
    received: 'Mottaget',
    awaiting_contrl: 'Väntar kvittens',
    awaiting_aperak: 'Väntar godkännande',
    acknowledged: 'Kvitterat',
    failed: 'Misslyckat',
    cancelled: 'Avbrutet',
    parsed: 'Inläst',
    validated: 'Validerat',
  }
  return labels[String(status ?? '')] ?? String(status ?? '—')
}

function statusTone(status: string | null | undefined): string {
  const s = String(status ?? '')
  if (['sent', 'acknowledged', 'validated', 'received'].includes(s)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  if (['draft', 'queued', 'prepared', 'parsed', 'awaiting_contrl', 'awaiting_aperak'].includes(s)) {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  if (['failed', 'cancelled'].includes(s)) {
    return 'border-red-200 bg-red-50 text-red-700'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function directionLabel(direction: string | null): string {
  if (direction === 'outbound') return 'Utgående'
  if (direction === 'inbound') return 'Inkommande'
  return direction ?? '—'
}

function directionTone(direction: string | null): string {
  if (direction === 'outbound') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (direction === 'inbound') return 'border-purple-200 bg-purple-50 text-purple-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Pill({ text, tone }: { text: string; tone?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone ?? 'border-slate-200 bg-slate-50 text-slate-700'}`}
    >
      {text}
    </span>
  )
}

type CustomerRow = { id: string; first_name?: string | null; last_name?: string | null; company_name?: string | null }
type GridOwnerRow = { id: string; name?: string | null }

export default async function MessagesPage({ searchParams }: PageProps) {
  const access = await requireAdminPageKeyAccess('operations.tasks')
  const isPlatformAdmin = isPlatformAdminContext(access)
  const scope = await resolveAdminTenantReadScope(access)

  const params = await searchParams
  const q = firstParam(params.q)?.toLowerCase() ?? null
  const directionFilter = firstParam(params.direction)
  const familyFilter = firstParam(params.family)
  const statusFilter = firstParam(params.status)
  const fromFilter = firstParam(params.from)
  const toFilter = firstParam(params.to)
  const gridOwnerFilter = firstParam(params.grid_owner)

  // Query ediel_messages
  let query = supabaseService
    .from('ediel_messages')
    .select('id,company_id,direction,message_family,message_code,message_version,status,sender_ediel_id,receiver_ediel_id,customer_id,site_id,grid_owner_id,outbound_request_id,grid_owner_data_request_id,external_reference,transaction_reference,message_sent_at,message_received_at,created_at,failure_reason')
    .order('created_at', { ascending: false })
    .limit(100)

  if (!isPlatformAdmin && scope.companyId) {
    query = query.eq('company_id', scope.companyId)
  } else if (isPlatformAdmin && scope.companyId) {
    query = query.eq('company_id', scope.companyId)
  }

  if (directionFilter) query = query.eq('direction', directionFilter)
  if (familyFilter) query = query.eq('message_family', familyFilter)
  if (statusFilter) query = query.eq('status', statusFilter)
  if (fromFilter) query = query.gte('created_at', fromFilter)
  if (toFilter) query = query.lte('created_at', toFilter + 'T23:59:59Z')
  if (gridOwnerFilter) query = query.eq('grid_owner_id', gridOwnerFilter)

  const { data: rawMessages, error: messagesError } = await query
  if (messagesError && !['42703', 'PGRST204'].includes(String((messagesError as { code?: string }).code ?? ''))) {
    throw messagesError
  }

  let messages = ((rawMessages ?? []) as EdielMessageRow[])

  // Client-side search filter
  if (q) {
    messages = messages.filter((m) => {
      const haystack = [
        m.external_reference,
        m.transaction_reference,
        m.sender_ediel_id,
        m.receiver_ediel_id,
        m.message_family,
        m.message_code,
        m.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  // Fetch customer names for messages that have customer_id
  const customerIds = [...new Set(messages.map((m) => m.customer_id).filter((id): id is string => Boolean(id)))]
  const customerMap = new Map<string, CustomerRow>()
  if (customerIds.length > 0) {
    const { data: customers } = await supabaseService
      .from('customers')
      .select('id,first_name,last_name,company_name')
      .in('id', customerIds.slice(0, 50))
    for (const c of (customers ?? []) as CustomerRow[]) {
      customerMap.set(c.id, c)
    }
  }

  // Fetch grid owner names
  const gridOwnerIds = [...new Set(messages.map((m) => m.grid_owner_id).filter((id): id is string => Boolean(id)))]
  const gridOwnerMap = new Map<string, GridOwnerRow>()
  if (gridOwnerIds.length > 0) {
    const { data: gos } = await supabaseService
      .from('grid_owners')
      .select('id,name')
      .in('id', gridOwnerIds.slice(0, 50))
    for (const g of (gos ?? []) as GridOwnerRow[]) {
      gridOwnerMap.set(g.id, g)
    }
  }

  function customerLabel(customerId: string | null): string {
    if (!customerId) return '—'
    const c = customerMap.get(customerId)
    if (!c) return customerId.slice(0, 8)
    return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || customerId.slice(0, 8)
  }

  function gridOwnerLabel(id: string | null): string {
    if (!id) return '—'
    const g = gridOwnerMap.get(id)
    return g?.name ?? id.slice(0, 8)
  }

  const filterUrl = (overrides: Record<string, string | null>) => {
    const base: Record<string, string> = {}
    if (q) base.q = q
    if (directionFilter) base.direction = directionFilter
    if (familyFilter) base.family = familyFilter
    if (statusFilter) base.status = statusFilter
    if (fromFilter) base.from = fromFilter
    if (toFilter) base.to = toFilter
    if (gridOwnerFilter) base.grid_owner = gridOwnerFilter
    const merged: Record<string, string> = { ...base }
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) {
        delete merged[k]
      } else {
        merged[k] = v
      }
    }
    const qs = new URLSearchParams(merged).toString()
    return `/admin/messages${qs ? '?' + qs : ''}`
  }

  const MESSAGE_FAMILIES = ['PRODAT', 'UTILTS', 'CONTRL', 'APERAK']
  const STATUSES = ['draft', 'queued', 'prepared', 'sent', 'received', 'acknowledged', 'failed', 'cancelled']

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Meddelanden"
        subtitle="EDIEL-meddelanden, utskick och kommunikationshistorik"
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Filters */}
        <form method="GET" className="mb-6 flex flex-wrap gap-3">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Sök referens, Ediel-ID…"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <select
            name="direction"
            defaultValue={directionFilter ?? ''}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Alla riktningar</option>
            <option value="outbound">Utgående</option>
            <option value="inbound">Inkommande</option>
          </select>
          <select
            name="family"
            defaultValue={familyFilter ?? ''}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Alla typer</option>
            {MESSAGE_FAMILIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={statusFilter ?? ''}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Alla statusar</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <input
            name="from"
            type="date"
            defaultValue={fromFilter ?? ''}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          />
          <input
            name="to"
            type="date"
            defaultValue={toFilter ?? ''}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          />
          <button
            type="submit"
            className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Filtrera
          </button>
          {(q || directionFilter || familyFilter || statusFilter || fromFilter || toFilter) ? (
            <Link
              href="/admin/messages"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Rensa filter
            </Link>
          ) : null}
        </form>

        {/* Message count */}
        <p className="mb-4 text-sm text-slate-500">
          {messages.length} meddelande{messages.length !== 1 ? 'n' : ''} visas
        </p>

        {/* Messages list */}
        {messages.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            Inga meddelanden matchar filtret.
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => {
              const dateStr = formatDate(message.message_sent_at ?? message.message_received_at ?? message.created_at)
              const customerLink = message.customer_id
                ? `/admin/customers/${message.customer_id}`
                : null

              return (
                <div
                  key={message.id}
                  className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-200 hover:shadow transition-shadow"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill
                        text={directionLabel(message.direction)}
                        tone={directionTone(message.direction)}
                      />
                      <Pill text={`${message.message_family ?? '—'} ${message.message_code ?? ''}`.trim()} />
                      <Pill
                        text={statusLabel(message.status)}
                        tone={statusTone(message.status)}
                      />
                    </div>
                    <span className="text-xs text-slate-400">{dateStr}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-700">
                    <span>
                      <span className="font-medium">Kund:</span>{' '}
                      {customerLink ? (
                        <Link
                          href={customerLink}
                          className="text-emerald-700 hover:underline"
                        >
                          {customerLabel(message.customer_id)}
                        </Link>
                      ) : (
                        customerLabel(message.customer_id)
                      )}
                    </span>
                    <span>
                      <span className="font-medium">Motpart:</span>{' '}
                      {gridOwnerLabel(message.grid_owner_id)}
                    </span>
                    {message.external_reference ? (
                      <span className="font-mono text-xs text-slate-500">
                        {message.external_reference}
                      </span>
                    ) : null}
                    {message.failure_reason && message.status === 'failed' ? (
                      <span className="rounded-lg bg-red-50 px-2 py-0.5 text-xs text-red-700">
                        {message.failure_reason}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Link
                      href={`/admin/messages/${message.id}`}
                      className="text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      Visa detaljer →
                    </Link>
                    {isPlatformAdmin ? (
                      <>
                        {message.outbound_request_id ? (
                          <Link
                            href={`/admin/outbound?q=${message.outbound_request_id}`}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            Utskick
                          </Link>
                        ) : null}
                        <span className="font-mono text-[10px] text-slate-300">{message.id}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Quick filter shortcuts */}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={filterUrl({ direction: 'outbound', status: null })} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">Utgående</Link>
          <Link href={filterUrl({ direction: 'inbound', status: null })} className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100">Inkommande</Link>
          <Link href={filterUrl({ status: 'failed', direction: null })} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">Misslyckade</Link>
          <Link href={filterUrl({ status: 'sent', direction: null })} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">Skickade</Link>
          <Link href={filterUrl({ family: 'PRODAT', status: null, direction: null })} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">PRODAT</Link>
        </div>
      </main>
    </div>
  )
}
