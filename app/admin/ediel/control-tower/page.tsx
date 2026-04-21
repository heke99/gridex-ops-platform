// app/admin/ediel/control-tower/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { listEdielMessages, listEdielTestRuns } from '@/lib/ediel/db'
import { getEdielSummary } from '@/lib/ediel/summary'
import { sendEdielMessageAction } from '@/app/admin/ediel/actions'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

function badgeTone(
  status: string | null | undefined
): 'green' | 'yellow' | 'red' | 'blue' | 'slate' {
  if (status === 'acknowledged' || status === 'passed' || status === 'received') return 'green'
  if (status === 'queued' || status === 'prepared' || status === 'draft' || status === 'running') return 'yellow'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'sent' || status === 'validated' || status === 'parsed') return 'blue'
  return 'slate'
}

function Pill({
  text,
  tone,
}: {
  text: string
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'yellow'
        ? 'bg-amber-100 text-amber-700'
        : tone === 'red'
          ? 'bg-rose-100 text-rose-700'
          : tone === 'blue'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-100 text-slate-700'

  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${toneClass}`}>{text}</span>
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function isAckPending(message: EdielMessageRow) {
  return message.aperak_status === 'pending' || message.contrl_status === 'pending'
}

function isAckOverdue(message: EdielMessageRow) {
  if (!isAckPending(message) || !message.ack_due_at) return false
  const due = new Date(message.ack_due_at)
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now()
}

function isUnlinkedInbound(message: EdielMessageRow) {
  return (
    message.direction === 'inbound' &&
    !message.outbound_request_id &&
    !message.switch_request_id &&
    !message.grid_owner_data_request_id &&
    (message.status === 'received' ||
      message.status === 'parsed' ||
      message.status === 'validated' ||
      message.status === 'failed')
  )
}

function sortNewest<T extends { created_at: string }>(rows: T[]) {
  return [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

function MessageTable({
  title,
  subtitle,
  rows,
  showSendButton = false,
}: {
  title: string
  subtitle: string
  rows: EdielMessageRow[]
  showSendButton?: boolean
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-3">Tid</th>
              <th className="px-3 py-3">Meddelande</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Ack</th>
              <th className="px-3 py-3">Länkar</th>
              <th className="px-3 py-3">Åtgärd</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-slate-500">
                  Inga rader.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/ediel/messages/${row.id}`}
                      className="font-medium text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {row.message_family} {row.message_code}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.direction} • {row.environment} • {row.message_version ?? 'ingen version'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 break-all">
                      {row.external_reference ?? row.transaction_reference ?? row.id}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Pill text={row.status} tone={badgeTone(row.status)} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {row.requires_contrl ? (
                        <Pill
                          text={`CONTRL ${row.contrl_status ?? 'pending'}`}
                          tone={badgeTone(row.contrl_status)}
                        />
                      ) : null}
                      {row.requires_aperak ? (
                        <Pill
                          text={`APERAK ${row.aperak_status ?? 'pending'}`}
                          tone={badgeTone(row.aperak_status)}
                        />
                      ) : null}
                      {row.utilts_err_status ? (
                        <Pill
                          text={`UTILTS_ERR ${row.utilts_err_status}`}
                          tone={badgeTone(row.utilts_err_status)}
                        />
                      ) : null}
                      {isAckOverdue(row) ? <Pill text="Ack försenad" tone="red" /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    <div>Outbound: {row.outbound_request_id ? 'Ja' : '—'}</div>
                    <div>Switch: {row.switch_request_id ? 'Ja' : '—'}</div>
                    <div>Data request: {row.grid_owner_data_request_id ? 'Ja' : '—'}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/admin/ediel/messages/${row.id}`}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        Öppna
                      </Link>

                      {showSendButton &&
                      (row.status === 'queued' || row.status === 'prepared') ? (
                        <form action={sendEdielMessageAction}>
                          <input type="hidden" name="edielMessageId" value={row.id} />
                          <button
                            type="submit"
                            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                          >
                            Skicka nu
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function AdminEdielControlTowerPage() {
  const context = await requireAnyPermissionServer(['communication.read'])
  const supabase = await createSupabaseServerClient()

  const [summary, messages, testRuns] = await Promise.all([
  getEdielSummary(supabase),
  listEdielMessages({ limit: 250 }),
  listEdielTestRuns(),
])

  const sortedMessages = sortNewest(messages)
  const pendingAck = sortedMessages.filter(isAckPending)
  const overdueAck = sortedMessages.filter(isAckOverdue)
  const failedMessages = sortedMessages.filter((row) => row.status === 'failed')
  const unlinkedInbound = sortedMessages.filter(isUnlinkedInbound)
  const queuedOutbound = sortedMessages.filter(
    (row) =>
      row.direction === 'outbound' &&
      (row.status === 'queued' || row.status === 'prepared')
  )
  const activeTests = (testRuns as EdielTestRunRow[])
  .filter((row) => ['draft', 'running'].includes(row.status))
  .slice(0, 20)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel control tower"
        subtitle="Samlad driftvy för kö, ack, fel, olänkade meddelanden och testkörningar."
        userEmail={context.email}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Totala meddelanden</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.totalMessages}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Kö / prepared</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.queuedMessages}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Pending ack</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.pendingAckMessages}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Failed</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.failedMessages}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Aktiva routes</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.activeRoutes}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Aktiva test runs</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.activeTestRuns}
            </div>
          </div>
        </section>

        <MessageTable
          title="Ack som väntar"
          subtitle="Meddelanden där CONTRL eller APERAK fortfarande väntas."
          rows={pendingAck.slice(0, 30)}
        />

        <MessageTable
          title="Ack försenad"
          subtitle="Meddelanden där ack-due-at har passerat men kvittens saknas."
          rows={overdueAck.slice(0, 30)}
        />

        <MessageTable
          title="Köade outbound"
          subtitle="Prepared eller queued outbound som fortfarande kan skickas."
          rows={queuedOutbound.slice(0, 30)}
          showSendButton
        />

        <MessageTable
          title="Olänkade inbound"
          subtitle="Inbound som kommit in men ännu inte kopplats till switch, outbound eller data request."
          rows={unlinkedInbound.slice(0, 30)}
        />

        <MessageTable
          title="Failures"
          subtitle="Felade meddelanden där detaljvyn ska användas för orsak och nästa åtgärd."
          rows={failedMessages.slice(0, 30)}
        />

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Aktiva testkörningar</h2>
            <p className="mt-1 text-sm text-slate-500">
              Test runs som fortfarande är i draft eller running.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-3">Tid</th>
                  <th className="px-3 py-3">Testfall</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Roll</th>
                </tr>
              </thead>
              <tbody>
                {activeTests.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-slate-500">
                      Inga aktiva test runs.
                    </td>
                  </tr>
                ) : (
                  activeTests.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-slate-900">
                          {row.test_case_code}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.title ?? '—'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Pill text={row.status} tone={badgeTone(row.status)} />
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.role_code}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}