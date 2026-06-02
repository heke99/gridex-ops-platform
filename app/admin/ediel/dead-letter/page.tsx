import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type DeadLetterItem = {
  id: string
  source: string
  companyId: string | null
  title: string
  status: string | null
  reason: string | null
  createdAt: string | null
  href?: string
}

async function safeRows<T>(table: string, select: string, statusValues: string[], orderColumn = 'created_at', limit = 30): Promise<T[]> {
  try {
    const { data, error } = await supabaseService
      .from(table)
      .select(select)
      .in('status', statusValues)
      .order(orderColumn, { ascending: false })
      .limit(limit)
    if (error) return []
    return (data ?? []) as T[]
  } catch {
    return []
  }
}

async function safeInboundFailures(): Promise<DeadLetterItem[]> {
  try {
    const { data, error } = await supabaseService
      .from('inbound_email_messages')
      .select('id,company_id,subject,processing_status,match_status,from_address,created_at')
      .or('processing_status.eq.failed,processing_status.eq.manual_review,match_status.eq.manual_review')
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) return []
    return (data ?? []).map((row) => ({
      id: row.id,
      source: 'inbound_email_messages',
      companyId: row.company_id ?? null,
      title: row.subject ?? row.from_address ?? row.id,
      status: row.processing_status ?? row.match_status ?? null,
      reason: row.match_status === 'manual_review' ? 'Manual tenant/object review' : null,
      createdAt: row.created_at ?? null,
      href: `/admin/inbound-mail/${row.id}`,
    }))
  } catch {
    return []
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function tone(source: string) {
  if (source === 'ediel_messages') return 'border-red-200 bg-red-50 text-red-900'
  if (source === 'inbound_email_messages') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-white text-slate-800'
}

export default async function EdielDeadLetterPage() {
  const admin = await requirePlatformAdminAccess()
  const [edielMessages, eventOutboxRows, webhookRows, inboundFailures] = await Promise.all([
    safeRows<{
      id: string
      company_id: string | null
      message_family: string | null
      message_code: string | null
      status: string | null
      failure_reason?: string | null
      validation_status?: string | null
      created_at: string | null
    }>('ediel_messages', 'id,company_id,message_family,message_code,status,failure_reason,validation_status,created_at', ['failed', 'cancelled'], 'created_at', 40),
    safeRows<{
      id: string
      company_id: string | null
      destination_type: string | null
      destination_key: string | null
      status: string | null
      attempts: number | null
      max_attempts: number | null
      last_error: string | null
      created_at: string | null
    }>('event_outbox', 'id,company_id,destination_type,destination_key,status,attempts,max_attempts,last_error,created_at', ['dead_letter', 'failed'], 'created_at', 30),
    safeRows<{
      id: string
      company_id: string | null
      event_type: string | null
      status: string | null
      attempts: number | null
      max_attempts: number | null
      failure_reason: string | null
      response_status: number | null
      created_at: string | null
    }>('webhook_deliveries', 'id,company_id,event_type,status,attempts,max_attempts,failure_reason,response_status,created_at', ['dead_letter', 'failed'], 'created_at', 30),
    safeInboundFailures(),
  ])

  const items: DeadLetterItem[] = [
    ...edielMessages.map((row) => ({
      id: row.id,
      source: 'ediel_messages',
      companyId: row.company_id,
      title: `${row.message_family ?? 'EDIEL'} ${row.message_code ?? ''}`,
      status: row.status,
      reason: row.failure_reason ?? row.validation_status ?? null,
      createdAt: row.created_at,
      href: `/admin/ediel/messages/${row.id}`,
    })),
    ...inboundFailures,
    ...eventOutboxRows.map((row) => ({
      id: row.id,
      source: 'event_outbox',
      companyId: row.company_id,
      title: `${row.destination_type ?? 'outbox'} ${row.destination_key ?? ''}`,
      status: row.status,
      reason: row.last_error ?? `attempts ${row.attempts ?? 0}/${row.max_attempts ?? '-'}`,
      createdAt: row.created_at,
    })),
    ...webhookRows.map((row) => ({
      id: row.id,
      source: 'webhook_deliveries',
      companyId: row.company_id,
      title: row.event_type ?? 'webhook delivery',
      status: row.status,
      reason: row.failure_reason ?? (row.response_status ? `HTTP ${row.response_status}` : null),
      createdAt: row.created_at,
    })),
  ].sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel dead-letter"
        subtitle="Samlad superadmin-vy for felade Ediel-meddelanden, inbound mail och integrationsleveranser."
        userEmail={admin.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm"><p className="text-sm font-semibold">Ediel failed</p><p className="mt-2 text-3xl font-black">{edielMessages.length}</p></div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm"><p className="text-sm font-semibold">Inbound review</p><p className="mt-2 text-3xl font-black">{inboundFailures.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-600">Outbox</p><p className="mt-2 text-3xl font-black text-slate-950">{eventOutboxRows.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-600">Webhooks</p><p className="mt-2 text-3xl font-black text-slate-950">{webhookRows.length}</p></div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-red-800">Manual handling</p>
              <h1 className="mt-2 text-xl font-black text-slate-950">Dead-letter och failed queue</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Listan ar read-only. Aterforsok, route-fix och ACK-hantering sker i respektive underliggande vy.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/ediel/messages?status=failed" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-800">Felade Ediel</Link>
              <Link href="/admin/inbound-mail" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800">Inbound mail</Link>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {items.map((item) => {
              const body = (
                <article className={`rounded-3xl border p-5 shadow-sm ${tone(item.source)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] opacity-75">{item.source}</p>
                      <h2 className="mt-2 font-black">{item.title}</h2>
                      <p className="mt-1 text-xs opacity-75">{formatDate(item.createdAt)} · company {item.companyId ?? 'platform/okand'}</p>
                    </div>
                    <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-black">{item.status ?? 'status saknas'}</span>
                  </div>
                  {item.reason ? <p className="mt-3 text-sm leading-6 opacity-90">{item.reason}</p> : null}
                </article>
              )
              return item.href ? <Link key={`${item.source}-${item.id}`} href={item.href}>{body}</Link> : <div key={`${item.source}-${item.id}`}>{body}</div>
            })}
            {items.length === 0 ? <p className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-sm font-semibold text-emerald-900">Inga dead-letter eller failed-poster hittades.</p> : null}
          </div>
        </section>
      </main>
    </div>
  )
}
