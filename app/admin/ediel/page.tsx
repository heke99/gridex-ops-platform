import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listEdielMessages, listEdielTestRuns } from '@/lib/ediel/db'
import {
  attachMessageToTestRunAction,
  createAckDraftAction,
  createEdielTestRunAction,
  createNegativeUtiltsResponseAction,
  createProdatDraftAction,
  pollMailboxAction,
  prepareSwitchZ03Action,
  prepareSwitchZ09Action,
  registerInboundUtiltsAction,
  runEdielSelfTestAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'

export const dynamic = 'force-dynamic'

type SimpleSwitchRequestRow = {
  id: string
  status: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

type SimpleDataRequestRow = {
  id: string
  status: string
  request_scope: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

type SimpleOutboundRow = {
  id: string
  request_type: string
  source_type: string | null
  source_id: string | null
  status: string
  channel_type: string | null
  communication_route_id: string | null
  external_reference: string | null
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  created_at: string
}

function Cell({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-900">
        {value && value.length > 0 ? value : '—'}
      </div>
    </div>
  )
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'yellow'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : tone === 'red'
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : tone === 'blue'
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : 'bg-slate-50 text-slate-700 border-slate-200'

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  )
}

function getOutboundStatusTone(
  status: string | null | undefined
): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'acknowledged') return 'green'
  if (status === 'sent' || status === 'prepared') return 'blue'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'queued') return 'yellow'
  return 'slate'
}

function getRouteTone(routeId: string | null | undefined): 'green' | 'red' {
  return routeId ? 'green' : 'red'
}

function getMessageTone(
  direction: string | null | undefined
): 'blue' | 'green' | 'slate' {
  if (direction === 'outbound') return 'blue'
  if (direction === 'inbound') return 'green'
  return 'slate'
}

function getRequestTone(
  status: string | null | undefined
): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'completed' || status === 'received' || status === 'accepted') {
    return 'green'
  }
  if (status === 'submitted' || status === 'sent') return 'blue'
  if (status === 'failed' || status === 'cancelled' || status === 'rejected') {
    return 'red'
  }
  if (status === 'queued' || status === 'pending' || status === 'draft') {
    return 'yellow'
  }
  return 'slate'
}

function findOutboundForSource(
  outboundRequests: SimpleOutboundRow[],
  sourceType: string,
  sourceId: string
): SimpleOutboundRow | null {
  return (
    outboundRequests.find(
      (row) => row.source_type === sourceType && row.source_id === sourceId
    ) ?? null
  )
}

function findMessagesForOutbound(
  messages: Awaited<ReturnType<typeof listEdielMessages>>,
  outboundRequestId: string
) {
  return messages.filter((row) => row.outbound_request_id === outboundRequestId)
}

function findMessagesForDataRequest(
  messages: Awaited<ReturnType<typeof listEdielMessages>>,
  dataRequestId: string
) {
  return messages.filter((row) => row.grid_owner_data_request_id === dataRequestId)
}

function findMessagesForSwitchRequest(
  messages: Awaited<ReturnType<typeof listEdielMessages>>,
  switchRequestId: string
) {
  return messages.filter((row) => row.switch_request_id === switchRequestId)
}

export default async function AdminEdielPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [messages, testRuns, switchRequestsRaw, dataRequestsRaw, outboundRaw] =
    await Promise.all([
      listEdielMessages({ limit: 50 }),
      listEdielTestRuns(),
      supabase
        .from('supplier_switch_requests')
        .select(
          'id,status,customer_id,site_id,metering_point_id,external_reference,created_at'
        )
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('grid_owner_data_requests')
        .select(
          'id,status,request_scope,customer_id,site_id,metering_point_id,external_reference,created_at'
        )
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('outbound_requests')
        .select(
          'id,request_type,source_type,source_id,status,channel_type,communication_route_id,external_reference,customer_id,site_id,metering_point_id,created_at'
        )
        .order('created_at', { ascending: false })
        .limit(40),
    ])

  if (switchRequestsRaw.error) throw switchRequestsRaw.error
  if (dataRequestsRaw.error) throw dataRequestsRaw.error
  if (outboundRaw.error) throw outboundRaw.error

  const switchRequests = (switchRequestsRaw.data ?? []) as SimpleSwitchRequestRow[]
  const dataRequests = (dataRequestsRaw.data ?? []) as SimpleDataRequestRow[]
  const outboundRequests = (outboundRaw.data ?? []) as SimpleOutboundRow[]

  const outboundWithoutRoute = outboundRequests.filter(
    (row) => !row.communication_route_id
  ).length
  const acknowledgedOutboundCount = outboundRequests.filter(
    (row) => row.status === 'acknowledged'
  ).length
  const unresolvedOutboundCount = outboundRequests.filter(
    (row) => row.channel_type === 'unresolved'
  ).length
  const outboundBackedByEdielCount = outboundRequests.filter((row) =>
    messages.some((message) => message.outbound_request_id === row.id)
  ).length

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel"
        subtitle="Tydlig inbox, outbox, mailbox-polling, SMTP-sändning, kvittenser, self-test och testspår mot Edielportalen."
        userEmail={user?.email ?? null}
      />

      <section className="grid gap-4 md:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Totalt</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Outbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.direction === 'outbound').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Inbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.direction === 'inbound').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">PRODAT</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.message_family === 'PRODAT').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">UTILTS</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.filter((row) => row.message_family === 'UTILTS').length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Self-test / runs</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {testRuns.length}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Outbound i kö</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {outboundRequests.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Intern queue som driver dispatch och Ediel-flöden.
          </div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-700">Saknar route</div>
          <div className="mt-2 text-3xl font-semibold text-amber-900">
            {outboundWithoutRoute}
          </div>
          <div className="mt-2 text-xs text-amber-700">
            Dessa är registrerade men inte skickbara ännu.
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm text-emerald-700">Kvitterade outbound</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-900">
            {acknowledgedOutboundCount}
          </div>
          <div className="mt-2 text-xs text-emerald-700">
            Har fått svar eller kvittens tillbaka i kedjan.
          </div>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm text-blue-700">Outbound med Ediel-koppling</div>
          <div className="mt-2 text-3xl font-semibold text-blue-900">
            {outboundBackedByEdielCount}
          </div>
          <div className="mt-2 text-xs text-blue-700">
            Outbound som verkligen blivit Ediel-meddelanden.
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Outbound queue som driver Ediel/CIS
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Här ser du om ett leverantörsbyte eller en nätägarbegäran verkligen
              har köats, vilken kanal som valts, om route saknas och om det sedan
              blivit ett riktigt Ediel-meddelande.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={unresolvedOutboundCount > 0 ? 'red' : 'green'}>
              unresolved: {unresolvedOutboundCount}
            </Badge>
            <Badge tone="blue">totalt: {outboundRequests.length}</Badge>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Källa</th>
                <th className="px-3 py-2">Source-id</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Kanal</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Ediel</th>
                <th className="px-3 py-2">Extern ref</th>
                <th className="px-3 py-2">Skapad</th>
              </tr>
            </thead>
            <tbody>
              {outboundRequests.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Inga outbound requests ännu.
                  </td>
                </tr>
              ) : (
                outboundRequests.map((row) => {
                  const relatedMessages = findMessagesForOutbound(messages, row.id)
                  const outboundHasEdiel = relatedMessages.length > 0

                  return (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-3 font-medium text-slate-950">{row.id}</td>
                      <td className="px-3 py-3">{row.request_type}</td>
                      <td className="px-3 py-3">{row.source_type ?? '—'}</td>
                      <td className="px-3 py-3">{row.source_id ?? '—'}</td>
                      <td className="px-3 py-3">
                        <Badge tone={getOutboundStatusTone(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-3 py-3">{row.channel_type ?? '—'}</td>
                      <td className="px-3 py-3">
                        <Badge tone={getRouteTone(row.communication_route_id)}>
                          {row.communication_route_id ? 'route finns' : 'saknas'}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        {outboundHasEdiel ? (
                          <div className="space-y-1">
                            <Badge tone="green">ja</Badge>
                            {relatedMessages.slice(0, 2).map((message) => (
                              <div key={message.id} className="text-xs text-slate-500">
                                {message.message_family} {message.message_code} · {message.id}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Badge tone="yellow">inte än</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3">{row.external_reference ?? '—'}</td>
                      <td className="px-3 py-3">{formatDateTime(row.created_at)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          Ediel self-test / simulator
        </h2>
        <p className="mt-1 text-sm text-slate-700">
          Kör interna testscenarier mot riktiga switch requests och data requests
          innan du fått ditt test-Ediel-id. Detta simulerar inbound Ediel, kopplar
          meddelandena till riktiga poster, uppdaterar statusar och skapar
          kvittenser.
        </p>

        <form action={runEdielSelfTestAction} className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <input
              name="scenario"
              placeholder="Scenario, t.ex. PRODAT_Z04_IN"
              className="rounded-xl border border-slate-300 px-3 py-2"
              required
            />
            <input
              name="switchRequestId"
              placeholder="Switch request-id för PRODAT-scenarier"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
            <input
              name="gridOwnerDataRequestId"
              placeholder="Data request-id för UTILTS-scenarier"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />

            <input
              name="senderEdielId"
              placeholder="Simulerad avsändare, t.ex. 91100"
              defaultValue="91100"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
            <input
              name="receiverEdielId"
              placeholder="Simulerad mottagare"
              defaultValue="GRIDEX-SIM"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
            <input
              name="mailbox"
              placeholder="Mailbox"
              defaultValue="SELFTEST"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />

            <input
              name="senderEmail"
              placeholder="Avsändare e-post"
              defaultValue="svk-selftest@gridex.local"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
            <input
              name="receiverEmail"
              placeholder="Mottagare e-post"
              defaultValue="ediel@gridex.se"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">Stödda scenarier</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>PRODAT_Z04_IN</div>
              <div>PRODAT_Z05_IN</div>
              <div>PRODAT_Z06_IN</div>
              <div>PRODAT_Z10_IN</div>
              <div>UTILTS_S02_IN</div>
              <div>UTILTS_S03_IN</div>
              <div>UTILTS_E66_KVART_IN</div>
              <div>UTILTS_E66_SCH_IN</div>
              <div>UTILTS_E31_SCH_IN</div>
              <div>UTILTS_NEGATIVE</div>
            </div>
          </div>

          <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
            Kör self-test scenario
          </button>
        </form>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Senaste switch requests
          </h2>
          <div className="mt-4 space-y-3">
            {switchRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                Inga switch requests ännu.
              </div>
            ) : (
              switchRequests.map((row) => {
                const outbound = findOutboundForSource(
                  outboundRequests,
                  'supplier_switch_request',
                  row.id
                )
                const linkedMessages = findMessagesForSwitchRequest(messages, row.id)

                return (
                  <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-950">{row.id}</div>
                      <Badge tone={getRequestTone(row.status)}>{row.status}</Badge>
                      {outbound ? (
                        <Badge tone={getOutboundStatusTone(outbound.status)}>
                          outbound {outbound.status}
                        </Badge>
                      ) : (
                        <Badge tone="yellow">ingen outbound ännu</Badge>
                      )}
                      {linkedMessages.length > 0 ? (
                        <Badge tone="green">ediel-kopplad</Badge>
                      ) : (
                        <Badge tone="slate">ingen ediel ännu</Badge>
                      )}
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      kund {row.customer_id ?? '—'} · site {row.site_id ?? '—'} ·
                      mätpunkt {row.metering_point_id ?? '—'}
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="font-medium text-slate-900">Outbound</div>
                        <div className="mt-1">
                          {outbound
                            ? `${outbound.id} · ${outbound.request_type} · ${outbound.channel_type ?? '—'}`
                            : 'Ingen outbound skapad'}
                        </div>
                        <div className="mt-1">
                          route: {outbound?.communication_route_id ?? 'saknas'}
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="font-medium text-slate-900">Ediel</div>
                        <div className="mt-1">
                          {linkedMessages.length > 0
                            ? linkedMessages
                                .slice(0, 2)
                                .map((message) => `${message.message_family} ${message.message_code}`)
                                .join(', ')
                            : 'Inget Ediel-meddelande ännu'}
                        </div>
                        <div className="mt-1">skapad: {formatDateTime(row.created_at)}</div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Senaste data requests
          </h2>
          <div className="mt-4 space-y-3">
            {dataRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                Inga grid owner data requests ännu.
              </div>
            ) : (
              dataRequests.map((row) => {
                const outboundMeterValues = findOutboundForSource(
                  outboundRequests,
                  'grid_owner_data_request',
                  row.id
                )
                const linkedMessages = findMessagesForDataRequest(messages, row.id)

                return (
                  <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-950">{row.id}</div>
                      <Badge tone={getRequestTone(row.status)}>
                        {row.request_scope} · {row.status}
                      </Badge>
                      {outboundMeterValues ? (
                        <Badge tone={getOutboundStatusTone(outboundMeterValues.status)}>
                          outbound {outboundMeterValues.status}
                        </Badge>
                      ) : (
                        <Badge tone="yellow">ingen outbound ännu</Badge>
                      )}
                      {linkedMessages.some((message) => message.direction === 'inbound') ? (
                        <Badge tone="green">inbound svar finns</Badge>
                      ) : (
                        <Badge tone="slate">inget inbound ännu</Badge>
                      )}
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      kund {row.customer_id ?? '—'} · site {row.site_id ?? '—'} ·
                      mätpunkt {row.metering_point_id ?? '—'}
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="font-medium text-slate-900">Outbound</div>
                        <div className="mt-1">
                          {outboundMeterValues
                            ? `${outboundMeterValues.id} · ${outboundMeterValues.request_type} · ${outboundMeterValues.channel_type ?? '—'}`
                            : 'Ingen outbound skapad'}
                        </div>
                        <div className="mt-1">
                          route: {outboundMeterValues?.communication_route_id ?? 'saknas'}
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="font-medium text-slate-900">Ediel</div>
                        <div className="mt-1">
                          {linkedMessages.length > 0
                            ? linkedMessages
                                .slice(0, 3)
                                .map((message) => `${message.direction}:${message.message_family} ${message.message_code}`)
                                .join(', ')
                            : 'Ingen Ediel-koppling ännu'}
                        </div>
                        <div className="mt-1">skapad: {formatDateTime(row.created_at)}</div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Mailbox polling</h2>
          <p className="mt-1 text-sm text-slate-600">
            Hämta inkommande Ediel-trafik från IMAP, matcha mot kund/mätpunkt och
            skapa kvittenser.
          </p>

          <form action={pollMailboxAction} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <input
                name="mailbox"
                defaultValue="INBOX"
                placeholder="Mailbox"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="communicationRouteId"
                placeholder="Route-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="limit"
                defaultValue="10"
                placeholder="Limit"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Poll mailbox
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">SMTP-sändning</h2>
          <p className="mt-1 text-sm text-slate-600">
            Skicka köade Ediel-meddelanden på riktigt via din Strato-mailbox.
          </p>

          <form action={sendEdielMessageAction} className="mt-4 space-y-3">
            <input
              name="edielMessageId"
              placeholder="Ediel message-id"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Skicka Ediel-meddelande
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Skapa Z03 från switchärende
          </h2>
          <form action={prepareSwitchZ03Action} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="switchRequestId"
                placeholder="Switch request-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="communicationRouteId"
                placeholder="Route-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="senderEdielId"
                placeholder="Gridex Ediel-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="receiverEdielId"
                placeholder="Nätägarens Ediel-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="receiverEmail"
                placeholder="Nätägarens e-post"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="mailbox"
                placeholder="Mailbox"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Förbered Z03
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Skapa Z09 från switchärende
          </h2>
          <form action={prepareSwitchZ09Action} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="switchRequestId"
                placeholder="Switch request-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="communicationRouteId"
                placeholder="Route-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="senderEdielId"
                placeholder="Gridex Ediel-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="receiverEdielId"
                placeholder="Nätägarens Ediel-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="receiverEmail"
                placeholder="Nätägarens e-post"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="mailbox"
                placeholder="Mailbox"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Förbered Z09
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Negativ UTILTS-respons
          </h2>
          <form action={createNegativeUtiltsResponseAction} className="mt-4 space-y-3">
            <input
              name="edielMessageId"
              placeholder="Inbound UTILTS message-id"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
            <textarea
              name="messageText"
              placeholder="Felorsak"
              className="min-h-[100px] w-full rounded-xl border border-slate-300 px-3 py-2"
            />
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Skapa UTILTS-ERR
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Manuellt PRODAT-utkast
          </h2>
          <form action={createProdatDraftAction} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="code"
                placeholder="Z03 / Z09 / Z01 / Z13 / Z18"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="receiverEdielId"
                placeholder="Mottagarens Ediel-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="senderEdielId"
                placeholder="Avsändarens Ediel-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="receiverEmail"
                placeholder="Mottagarens e-post"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="communicationRouteId"
                placeholder="Route-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="switchRequestId"
                placeholder="Switch request-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <textarea
              name="payload"
              placeholder='{"meterPointId":"735999...","customerName":"Test Customer"}'
              className="min-h-[140px] w-full rounded-xl border border-slate-300 px-3 py-2"
            />
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Skapa PRODAT-utkast
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Registrera inbound UTILTS manuellt
          </h2>
          <form action={registerInboundUtiltsAction} className="mt-4 space-y-3">
            <input
              name="code"
              placeholder="S02 / S03 / E31 / E66"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
            <textarea
              name="rawPayload"
              placeholder="Klistra in rå UTILTS-payload"
              className="min-h-[140px] w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Registrera inbound UTILTS
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Skapa ACK-utkast
          </h2>
          <form action={createAckDraftAction} className="mt-4 space-y-3">
            <input
              name="sourceMessageId"
              placeholder="Källmeddelande-id"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
              required
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="ackType"
                placeholder="CONTRL / APERAK / UTILTS_ERR"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="outcome"
                placeholder="positive / negative"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <textarea
              name="messageText"
              placeholder="Meddelandetext"
              className="min-h-[100px] w-full rounded-xl border border-slate-300 px-3 py-2"
            />
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Skapa ACK-utkast
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Skapa testrun
          </h2>
          <form action={createEdielTestRunAction} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="testSuite"
                placeholder="PRODAT / UTILTS / NBS_XML / OTHER"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="roleCode"
                placeholder="supplier / grid_owner / balance_responsible / esco"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="testCaseCode"
                placeholder="Test case code"
                className="rounded-xl border border-slate-300 px-3 py-2"
                required
              />
              <input
                name="approvalVersion"
                placeholder="Godkännandeversion"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="customerId"
                placeholder="Customer-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="siteId"
                placeholder="Site-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="meteringPointId"
                placeholder="Metering point-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="gridOwnerId"
                placeholder="Grid owner-id"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <input
              name="title"
              placeholder="Titel"
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            />
            <textarea
              name="notes"
              placeholder="Anteckningar"
              className="min-h-[90px] w-full rounded-xl border border-slate-300 px-3 py-2"
            />
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Skapa testrun
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          Senaste Ediel-meddelanden
        </h2>
        <div className="mt-4 space-y-4">
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              Inga Ediel-meddelanden ännu.
            </div>
          ) : (
            messages.map((row) => {
              const relatedOutbound = row.outbound_request_id
                ? outboundRequests.find((outbound) => outbound.id === row.outbound_request_id) ?? null
                : null

              return (
                <div
                  key={row.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-950">
                      {row.message_family} {row.message_code}
                    </div>
                    <Badge tone={getMessageTone(row.direction)}>{row.direction}</Badge>
                    <Badge tone={getRequestTone(row.status)}>{row.status}</Badge>
                    {relatedOutbound ? (
                      <Badge tone={getOutboundStatusTone(relatedOutbound.status)}>
                        outbound {relatedOutbound.status}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <Cell label="Message-id" value={row.id} />
                    <Cell label="External reference" value={row.external_reference} />
                    <Cell
                      label="Correlation reference"
                      value={row.correlation_reference}
                    />
                    <Cell
                      label="Transaction reference"
                      value={row.transaction_reference}
                    />
                    <Cell label="Sender Ediel-id" value={row.sender_ediel_id} />
                    <Cell label="Receiver Ediel-id" value={row.receiver_ediel_id} />
                    <Cell label="Switch request" value={row.switch_request_id} />
                    <Cell
                      label="Data request"
                      value={row.grid_owner_data_request_id}
                    />
                    <Cell
                      label="Outbound request"
                      value={row.outbound_request_id}
                    />
                    <Cell
                      label="Outbound kanal"
                      value={relatedOutbound?.channel_type ?? null}
                    />
                    <Cell
                      label="Communication route"
                      value={relatedOutbound?.communication_route_id ?? row.communication_route_id}
                    />
                    <Cell
                      label="Skapad"
                      value={formatDateTime(row.created_at)}
                    />
                  </div>

                  <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">
                      Visa rå payload
                    </summary>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-800">
                      {row.raw_payload ?? '—'}
                    </pre>
                  </details>
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Testruns</h2>
        <div className="mt-4 space-y-4">
          {testRuns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              Inga testruns ännu.
            </div>
          ) : (
            testRuns.map((run) => (
              <div
                key={run.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-slate-950">
                    {run.test_suite} / {run.test_case_code}
                  </div>
                  <Badge tone="slate">{run.role_code}</Badge>
                  <Badge tone={getRequestTone(run.status)}>{run.status}</Badge>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <Cell label="Run-id" value={run.id} />
                  <Cell
                    label="Godkännandeversion"
                    value={run.approval_version}
                  />
                  <Cell label="Titel" value={run.title} />
                  <Cell label="Metering point-id" value={run.metering_point_id} />
                </div>

                <form
                  action={attachMessageToTestRunAction}
                  className="mt-4 grid gap-3 md:grid-cols-5"
                >
                  <input type="hidden" name="testRunId" value={run.id} />
                  <input
                    name="edielMessageId"
                    placeholder="Ediel message-id"
                    className="rounded-xl border border-slate-300 px-3 py-2"
                    required
                  />
                  <input
                    name="stepNo"
                    placeholder="Steg nr"
                    className="rounded-xl border border-slate-300 px-3 py-2"
                  />
                  <input
                    name="expectedDirection"
                    placeholder="inbound / outbound"
                    className="rounded-xl border border-slate-300 px-3 py-2"
                  />
                  <input
                    name="expectedFamily"
                    placeholder="PRODAT / UTILTS"
                    className="rounded-xl border border-slate-300 px-3 py-2"
                  />
                  <input
                    name="expectedCode"
                    placeholder="Z03 / E66"
                    className="rounded-xl border border-slate-300 px-3 py-2"
                  />
                  <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white md:col-span-5">
                    Koppla meddelande till testrun
                  </button>
                </form>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}