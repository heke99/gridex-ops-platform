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
  company_id: string | null
  request_id: string | null
  grid_owner_id: string | null
  customer_id: string | null
  customer_site_id: string | null
  metering_point_id: string | null
  resolution_status: string
  tenant_resolution_method: string | null
  entity_resolution_method: string | null
  intent: string | null
  business_process: string | null
  processing_state: string | null
  from_email: string | null
  to_email: string | null
  subject: string | null
  provider_message_id: string | null
  in_reply_to: string | null
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

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : '—'
}

function resolutionLabel(value: string): string {
  if (value === 'matched') return 'Matchad'
  if (value === 'ambiguous') return 'Tvetydig'
  if (value === 'ignored') return 'Ej betrodd'
  return 'Ej matchad'
}

export default async function ManualRequestDiagnosticsPage() {
  const context = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()

  const [{ data: requestData }, { data: recentInboundData }] = await Promise.all([
    supabase
      .from('grid_owner_information_requests')
      .select('id,company_id,customer_id,customer_site_id,grid_owner_id,request_type,channel,status,dispatch_status,case_reference,recipient_email,from_email,reply_to,poa_id,confidence_score,last_error_code,last_error_message,created_at,updated_at')
      .eq('channel', 'manual_email')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase
      .from('manual_inbound_messages')
      .select('id,company_id,request_id,grid_owner_id,customer_id,customer_site_id,metering_point_id,resolution_status,tenant_resolution_method,entity_resolution_method,intent,business_process,processing_state,from_email,to_email,subject,provider_message_id,in_reply_to,confidence_score,received_at')
      .order('received_at', { ascending: false })
      .limit(150),
  ])

  const requests = (requestData ?? []) as RequestRow[]
  const recentInbound = (recentInboundData ?? []) as InboundRow[]
  const requestIds = requests.map((row) => row.id)

  const outboxResult = requestIds.length
    ? await supabase
        .from('manual_email_outbox')
        .select('id,request_id,status,provider,provider_message_id,attempts,last_error,to_email,from_email,sent_at')
        .in('request_id', requestIds)
        .limit(300)
    : { data: [] as OutboxRow[] }

  const outboxByRequest = new Map<string, OutboxRow[]>()
  for (const row of (outboxResult.data ?? []) as OutboxRow[]) {
    if (!row.request_id) continue
    const list = outboxByRequest.get(row.request_id) ?? []
    list.push(row)
    outboxByRequest.set(row.request_id, list)
  }

  const inboundByRequest = new Map<string, InboundRow[]>()
  for (const row of recentInbound) {
    if (!row.request_id) continue
    const list = inboundByRequest.get(row.request_id) ?? []
    list.push(row)
    inboundByRequest.set(row.request_id, list)
  }

  const unresolvedCount = recentInbound.filter((row) => row.resolution_status !== 'matched').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Manuella informationsbegäranden – diagnostik"
        subtitle="Teknisk diagnostik för utgående nätägarärenden och inkommande tenant/kund-korrelation. Endast plattformsadmin."
        userEmail={context.email}
        workspaceName="Gridex Platform"
        workspaceMode="platform"
      />

      <main className="space-y-6 p-6 lg:p-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Manuella ärenden</div>
            <div className="mt-2 text-3xl font-black text-slate-950">{requests.length}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Senaste inkommande</div>
            <div className="mt-2 text-3xl font-black text-slate-950">{recentInbound.length}</div>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-amber-800">Behöver korrelationskontroll</div>
            <div className="mt-2 text-3xl font-black text-amber-950">{unresolvedCount}</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-black text-slate-950">Nätägarärenden</h2>
            <p className="mt-1 text-sm text-slate-500">Utgående mail, provider-ID och svar som har bundits till respektive canonical request.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Ärende</th>
                  <th className="px-4 py-3">Status / Dispatch</th>
                  <th className="px-4 py-3">Adresser</th>
                  <th className="px-4 py-3">Utgående</th>
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
                        <div className="mt-1 text-xs text-slate-400">tenant {shortId(row.company_id)} · kund {shortId(row.customer_id)} · site {shortId(row.customer_site_id)}</div>
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
                          <div key={o.id} className="mb-2">
                            <span className="font-semibold">{o.status}</span> · försök {o.attempts}
                            <div className="break-all text-slate-500">{o.provider_message_id ?? 'inget provider-ID'}{o.sent_at ? ` · ${formatDate(o.sent_at)}` : ''}</div>
                            {o.last_error ? <div className="text-red-700">{o.last_error}</div> : null}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {inbound.length === 0 ? '—' : inbound.map((i) => (
                          <div key={i.id} className="mb-2">
                            <span className="font-semibold">{resolutionLabel(i.resolution_status)}</span>
                            <div className="text-slate-500">{i.intent ?? 'unknown'} · {i.processing_state ?? 'received'}</div>
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

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-black text-slate-950">Inkommande korrelationskö</h2>
            <p className="mt-1 text-sm text-slate-500">Alla senaste manuella mail visas här, även svar utan GX-FIR och mail som ännu inte kan bindas säkert till tenant/kund.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Mottaget</th>
                  <th className="px-4 py-3">Korrelation</th>
                  <th className="px-4 py-3">Tenant / Kund / Site</th>
                  <th className="px-4 py-3">Process</th>
                  <th className="px-4 py-3">Reply-evidens</th>
                  <th className="px-4 py-3">Avsändare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {recentInbound.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-600">Inga inkommande manuella mail ännu.</td></tr>
                ) : recentInbound.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-semibold">{formatDate(row.received_at)}</div>
                      <div className="mt-1 max-w-[280px] truncate text-slate-500">{row.subject ?? '(utan ämne)'}</div>
                      <div className="text-slate-400">mail {shortId(row.id)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-bold">{resolutionLabel(row.resolution_status)}</div>
                      <div className="mt-1 text-slate-500">tenant: {row.tenant_resolution_method ?? '—'}</div>
                      <div className="text-slate-500">entity: {row.entity_resolution_method ?? '—'}</div>
                      <div className="text-slate-500">state: {row.processing_state ?? 'received'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div>tenant {shortId(row.company_id)}</div>
                      <div>kund {shortId(row.customer_id)}</div>
                      <div>site {shortId(row.customer_site_id)}</div>
                      <div>mätpunkt {shortId(row.metering_point_id)}</div>
                      <div>request {shortId(row.request_id)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-semibold">{row.intent ?? 'unknown'}</div>
                      <div className="text-slate-500">{row.business_process ?? 'unknown'}</div>
                      <div className="text-slate-500">parse-confidence {row.confidence_score ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="max-w-[260px] break-all">In-Reply-To: {row.in_reply_to ?? '—'}</div>
                      <div className="mt-1 max-w-[260px] break-all text-slate-500">Message-ID: {row.provider_message_id ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="break-all">{row.from_email ?? '—'}</div>
                      <div className="mt-1 break-all text-slate-500">till {row.to_email ?? '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
