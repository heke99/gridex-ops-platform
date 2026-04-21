// app/admin/ediel/control-tower/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { listEdielMessages, listEdielTestRuns } from '@/lib/ediel/db'
import { getEdielSummary } from '@/lib/ediel/summary'
import { sendEdielMessageAction } from '@/app/admin/ediel/actions'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  ACTIVE_EDIEL_TEST_SUITES,
  isActiveEdielMessageFamily,
  isActiveEdielTestSuite,
  type EdielMessageRow,
  type EdielTestRunRow,
} from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

function badgeTone(
  status: string | null | undefined
): 'green' | 'yellow' | 'red' | 'blue' | 'slate' {
  if (status === 'acknowledged' || status === 'passed' || status === 'received') return 'green'
  if (status === 'queued' || status === 'prepared' || status === 'draft' || status === 'running')
    return 'yellow'
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

  const scopedMessages = messages.filter((row) => isActiveEdielMessageFamily(row.message_family))
  const futureMessages = messages.filter((row) => !isActiveEdielMessageFamily(row.message_family))
  const scopedTestRuns = (testRuns as EdielTestRunRow[]).filter((row) =>
    isActiveEdielTestSuite(row.test_suite)
  )
  const futureTestRuns = (testRuns as EdielTestRunRow[]).filter(
    (row) => !isActiveEdielTestSuite(row.test_suite)
  )

  const sortedMessages = sortNewest(scopedMessages)
  const pendingAck = sortedMessages.filter(isAckPending)
  const overdueAck = sortedMessages.filter(isAckOverdue)
  const failedMessages = sortedMessages.filter((row) => row.status === 'failed')
  const unlinkedInbound = sortedMessages.filter(isUnlinkedInbound)
  const queuedOutbound = sortedMessages.filter(
    (row) =>
      row.direction === 'outbound' &&
      (row.status === 'queued' || row.status === 'prepared')
  )
  const activeTests = scopedTestRuns
    .filter((row) => ['draft', 'running'].includes(row.status))
    .slice(0, 20)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel control tower"
        subtitle="Samlad driftvy för aktiv release-scope: PRODAT, UTILTS, CONTRL, APERAK, UTILTS_ERR och AI-lista."
        userEmail={context.email}
      />

      <div className="space-y-8 p-8">
        <section className="rounded-3xl border border-blue-200 bg-blue-50 p-5">
          <div className="text-sm font-semibold text-slate-900">Aktivt Ediel-scope i release 1</div>
          <p className="mt-2 text-sm text-slate-700">
            Control towern visar nu bara aktivt scope: {ACTIVE_EDIEL_MESSAGE_FAMILIES.join(', ')}.
            Framtida familjer som NBS_XML eller övriga placeholders hålls utanför den operativa vyn tills de verkligen tas i bruk.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill text={`Aktiva familjer ${ACTIVE_EDIEL_MESSAGE_FAMILIES.length}`} tone="blue" />
            <Pill text={`Aktiva testsviter ${ACTIVE_EDIEL_TEST_SUITES.length}`} tone="blue" />
            <Pill
              text={`Dolda framtida meddelanden ${futureMessages.length}`}
              tone={futureMessages.length > 0 ? 'yellow' : 'slate'}
            />
            <Pill
              text={`Dolda framtida testruns ${futureTestRuns.length}`}
              tone={futureTestRuns.length > 0 ? 'yellow' : 'slate'}
            />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Totala meddelanden</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {scopedMessages.length}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Kö / prepared</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {queuedOutbound.length}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Pending ack</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {pendingAck.length}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Failed</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {failedMessages.length}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Aktiva routes</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.activeRoutes}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Aktiva testkörningar</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {activeTests.length}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Inbound</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {scopedMessages.filter((row) => row.direction === 'inbound').length}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Outbound</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {scopedMessages.filter((row) => row.direction === 'outbound').length}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Drafts</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {scopedMessages.filter((row) => row.status === 'draft').length}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">Profiler</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.configuredProfiles}
            </div>
          </div>
        </section>

        <MessageTable
          title="Ack försenad"
          subtitle="Meddelanden där kvittens förväntades men deadline har passerat."
          rows={overdueAck}
        />

        <MessageTable
          title="Pending ack"
          subtitle="Meddelanden som väntar på CONTRL, APERAK eller UTILTS_ERR."
          rows={pendingAck.filter((row) => !isAckOverdue(row))}
        />

        <MessageTable
          title="Queued outbound"
          subtitle="Prepared eller queued meddelanden som kan skickas direkt från control tower."
          rows={queuedOutbound}
          showSendButton
        />

        <MessageTable
          title="Failed messages"
          subtitle="Meddelanden som stoppat i parsing, validering eller transport."
          rows={failedMessages}
        />

        <MessageTable
          title="Unlinked inbound"
          subtitle="Inbound som ännu inte kopplats till outbound request, switch request eller data request."
          rows={unlinkedInbound}
        />

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Aktiva testkörningar</h2>
            <p className="mt-1 text-sm text-slate-500">
              Draft eller running inom aktivt release-scope.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-3">Skapad</th>
                  <th className="px-3 py-3">Suite</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Case</th>
                  <th className="px-3 py-3">Objekt</th>
                </tr>
              </thead>
              <tbody>
                {activeTests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-slate-500">
                      Inga aktiva testkörningar.
                    </td>
                  </tr>
                ) : (
                  activeTests.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.created_at)}</td>
                      <td className="px-3 py-3">
                        <Pill text={row.test_suite} tone="blue" />
                      </td>
                      <td className="px-3 py-3">
                        <Pill text={row.status} tone={badgeTone(row.status)} />
                      </td>
                      <td className="px-3 py-3 text-slate-900">{row.test_case_code}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        kund {row.customer_id ?? '—'} · site {row.site_id ?? '—'} · mp{' '}
                        {row.metering_point_id ?? '—'}
                      </td>
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