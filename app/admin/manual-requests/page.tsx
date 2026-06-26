import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type RequestRow = {
  id: string
  company_id: string
  customer_id: string | null
  customer_site_id: string | null
  grid_owner_id: string | null
  request_type: string
  channel: string | null
  status: string | null
  dispatch_status: string | null
  case_reference: string | null
  recipient_email: string | null
  from_email: string | null
  reply_to: string | null
  poa_id: string | null
  confidence_score: number | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string | null
  updated_at: string | null
}

type OutboxRow = {
  id: string
  request_id: string | null
  status: string
  provider: string
  provider_message_id: string | null
  attempts: number
  last_error: string | null
  to_email: string
  from_email: string | null
  sent_at: string | null
}

type InboundRow = {
  id: string
  request_id: string | null
  resolution_status: string
  from_email: string | null
  confidence_score: number | null
  received_at: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return '—'
  }
}

export default async function ManualRequestDiagnosticsPage() {
  const context = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()

  const { data: requestData } = await supabase
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,customer_site_id,grid_owner_id,request_type,channel,status,dispatch_status,case_reference,recipient_email,from_email,reply_to,poa_id,confidence_score,last_error_code,last_error_message,created_at,updated_at')
    .eq('channel', 'manual_email')
    .order('updated_at', { ascending: false })
    .limit(100)

  const requests = (requestData ?? []) as RequestRow[]
  const requestIds = requests.map((row) => row.id)

  const [outboxResult, inboundResult] = await Promise.all([
    requestIds.length
      ? supabase
          .from('manual_email_outbox')
          .select('id,request_id,status,provider,provider_message_id,attempts,last_error,to_email,from_email,sent_at')
          .in('request_id', requestIds)
          .limit(300)
      : Promise.resolve({ data: [] as OutboxRow[] }),
    requestIds.length
      ? supabase
          .from('manual_inbound_messages')
          .select('id,request_id,resolution_status,from_email,confidence_score,received_at')
          .in('request_id', requestIds)
          .order('received_at', { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] as InboundRow[] }),
  ])

  const outboxByRequest = new Map<string, OutboxRow[]>()
  for (const row of (outboxResult.data ?? []) as OutboxRow[]) {
    if (!row.request_id) continue
    const list = outboxByRequest.get(row.request_id) ?? []
    list.push(row)
    outboxByRequest.set(row.request_id, list)
  }
  const inboundByRequest = new Map<string, InboundRow[]>()
  for (const row of (inboundResult.data ?? []) as InboundRow[]) {
    if (!row.request_id) continue
    const list = inboundByRequest.get(row.request_id) ?? []
    list.push(row)
    inboundByRequest.set(row.request_id, list)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Manuella informationsbegäranden – diagnostik"
        subtitle="Teknisk diagnostik (case_reference, e-postkö, Resend-ID, inkommande svar, parse-confidence, fullmakt). Endast plattformsadmin."
        userEmail={context.email}
        workspaceName="Gridex Platform"
        workspaceMode="platform"
      />

      <main className="space-y-4 p-6 lg:p-8">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ärende</th>
                  <th className="px-4 py-3">Status / Dispatch</th>
                  <th className="px-4 py-3">Adresser</th>
                  <th className="px-4 py-3">Utgående (Resend)</th>
                  <th className="px-4 py-3">Inkommande</th>
                  <th className="px-4 py-3">Fullmakt / Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {requests.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-600">Inga manuella begäranden ännu.</td></tr>
                ) : requests.map((row) => {
                  const outbox = outboxByRequest.get(row.id) ?? []
                  const inbound = inboundByRequest.get(row.id) ?? []
                  return (
                    <tr key={row.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-950">{row.case_reference ?? row.id.slice(0, 8)}</div>
                        <div className="mt-1 text-xs text-slate-500">{row.request_type}</div>
                        <div className="mt-1 text-xs text-slate-400">company {row.company_id.slice(0, 8)} · site {row.customer_site_id?.slice(0, 8) ?? '—'}</div>
                        <div className="text-xs text-slate-400">Uppdaterad {formatDate(row.updated_at)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <div className="font-semibold">{row.status ?? '—'}</div>
                        <div className="text-slate-500">dispatch: {row.dispatch_status ?? '—'}</div>
                        {row.last_error_code ? <div className="mt-1 text-red-700">{row.last_error_code}: {row.last_error_message}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <div>till: {row.recipient_email ?? '—'}</div>
                        <div>från: {row.from_email ?? '—'}</div>
                        <div>reply-to: {row.reply_to ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {outbox.length === 0 ? '—' : outbox.map((o) => (
                          <div key={o.id} className="mb-1">
                            <span className="font-semibold">{o.status}</span> · försök {o.attempts}
                            <div className="text-slate-500">{o.provider_message_id ?? 'inget Resend-ID'}{o.sent_at ? ` · ${formatDate(o.sent_at)}` : ''}</div>
                            {o.last_error ? <div className="text-red-700">{o.last_error}</div> : null}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {inbound.length === 0 ? '—' : inbound.map((i) => (
                          <div key={i.id} className="mb-1">
                            <span className="font-semibold">{i.resolution_status}</span>
                            <div className="text-slate-500">{i.from_email ?? '—'} · conf {i.confidence_score ?? '—'} · {formatDate(i.received_at)}</div>
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <div>POA: {row.poa_id ? row.poa_id.slice(0, 8) : 'saknas'}</div>
                        <div className="text-slate-500">parse-confidence: {row.confidence_score ?? '—'}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
