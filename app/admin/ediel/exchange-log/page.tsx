import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type MessageRow = {
  id: string
  company_id: string | null
  direction: string | null
  message_family: string | null
  message_code: string | null
  status: string | null
  ack_status: string | null
  environment_type?: string | null
  sender_ediel_id: string | null
  receiver_ediel_id: string | null
  interchange_reference: string | null
  transaction_reference: string | null
  route_profile_id?: string | null
  created_at: string | null
}

type EventRow = {
  id: string
  company_id: string | null
  ediel_message_id: string | null
  event_type: string | null
  event_status: string | null
  message: string | null
  created_at: string | null
}

type TimelineItem = {
  id: string
  kind: 'message' | 'event'
  companyId: string | null
  title: string
  detail: string
  status: string | null
  createdAt: string | null
  href?: string
}

async function safeList<T>(table: string, select: string, orderColumn = 'created_at', limit = 80): Promise<T[]> {
  try {
    const { data, error } = await supabaseService
      .from(table)
      .select(select)
      .order(orderColumn, { ascending: false })
      .limit(limit)
    if (error) return []
    return (data ?? []) as T[]
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

function statusTone(status: string | null | undefined) {
  if (!status) return 'border-slate-200 bg-white text-slate-800'
  if (['failed', 'error', 'cancelled', 'blocked'].includes(status)) return 'border-red-200 bg-red-50 text-red-900'
  if (['queued', 'prepared', 'warning', 'awaiting_contrl', 'awaiting_aperak'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['sent', 'received', 'validated', 'acknowledged', 'success', 'linked'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  return 'border-slate-200 bg-white text-slate-800'
}

export default async function EdielExchangeLogPage() {
  const admin = await requirePlatformAdminAccess()
  const [messages, events] = await Promise.all([
    safeList<MessageRow>(
      'ediel_messages',
      'id,company_id,direction,message_family,message_code,status,ack_status,environment_type,sender_ediel_id,receiver_ediel_id,interchange_reference,transaction_reference,route_profile_id,created_at',
      'created_at',
      80
    ),
    safeList<EventRow>(
      'ediel_message_events',
      'id,company_id,ediel_message_id,event_type,event_status,message,created_at',
      'created_at',
      120
    ),
  ])

  const timeline: TimelineItem[] = [
    ...messages.map((message) => ({
      id: message.id,
      kind: 'message' as const,
      companyId: message.company_id,
      title: `${message.direction ?? 'direction?'} ${message.message_family ?? 'EDIEL'} ${message.message_code ?? ''}`,
      detail: [
        message.environment_type ? `env ${message.environment_type}` : null,
        message.sender_ediel_id && message.receiver_ediel_id ? `${message.sender_ediel_id} -> ${message.receiver_ediel_id}` : null,
        message.transaction_reference ?? message.interchange_reference,
      ].filter(Boolean).join(' · '),
      status: message.status ?? message.ack_status,
      createdAt: message.created_at,
      href: `/admin/ediel/messages/${message.id}`,
    })),
    ...events.map((event) => ({
      id: event.id,
      kind: 'event' as const,
      companyId: event.company_id,
      title: event.event_type ?? 'message event',
      detail: event.message ?? `message ${event.ediel_message_id ?? 'saknas'}`,
      status: event.event_status,
      createdAt: event.created_at,
      href: event.ediel_message_id ? `/admin/ediel/messages/${event.ediel_message_id}` : undefined,
    })),
  ].sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '')).slice(0, 140)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel exchange-log"
        subtitle="Teknisk tidslinje over Ediel-meddelanden, route snapshots, ACK-status och message events."
        userEmail={admin.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-600">Meddelanden</p><p className="mt-2 text-3xl font-black text-slate-950">{messages.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-600">Events</p><p className="mt-2 text-3xl font-black text-slate-950">{events.length}</p></div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm"><p className="text-sm font-semibold">Outbound</p><p className="mt-2 text-3xl font-black">{messages.filter((message) => message.direction === 'outbound').length}</p></div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 shadow-sm"><p className="text-sm font-semibold">Inbound</p><p className="mt-2 text-3xl font-black">{messages.filter((message) => message.direction === 'inbound').length}</p></div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Exchange timeline</p>
              <h1 className="mt-2 text-xl font-black text-slate-950">Senaste tekniska Ediel-handelser</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Raderna länkar tillbaka till meddelandedetaljen där raw EDIFACT, ACK-kedja och audit finns.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/ediel/messages" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50">Meddelanden</Link>
              <Link href="/admin/ediel/control-tower" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800">Control Tower</Link>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {timeline.map((item) => {
              const body = (
                <article className={`rounded-3xl border p-5 shadow-sm ${statusTone(item.status)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] opacity-75">{item.kind}</p>
                      <h2 className="mt-2 font-black">{item.title}</h2>
                      <p className="mt-1 text-sm leading-6 opacity-85">{item.detail || '-'}</p>
                      <p className="mt-1 text-xs opacity-70">{formatDate(item.createdAt)} · company {item.companyId ?? 'platform/okand'}</p>
                    </div>
                    <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-black">{item.status ?? 'status saknas'}</span>
                  </div>
                </article>
              )
              return item.href ? <Link key={`${item.kind}-${item.id}`} href={item.href}>{body}</Link> : <div key={`${item.kind}-${item.id}`}>{body}</div>
            })}
            {timeline.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">Ingen exchange-log hittades.</p> : null}
          </div>
        </section>
      </main>
    </div>
  )
}
