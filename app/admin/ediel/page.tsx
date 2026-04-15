// app/admin/ediel/page.tsx

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
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'

export const dynamic = 'force-dynamic'

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

export default async function AdminEdielPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [messages, testRuns] = await Promise.all([
    listEdielMessages({ limit: 30 }),
    listEdielTestRuns(),
  ])

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel"
        subtitle="Tydlig inbox, outbox, mailbox-polling, SMTP-sändning, kvittenser och testspår mot Edielportalen."
        userEmail={user?.email ?? null}
      />

      <section className="grid gap-4 md:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Totalt</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">{messages.length}</div>
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
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Mailbox polling</h2>
          <p className="mt-1 text-sm text-slate-600">
            Hämta inkommande Ediel-trafik från IMAP, matcha mot kund/mätpunkt och skapa kvittenser.
          </p>

          <form action={pollMailboxAction} className="mt-4 space-y-3">
            <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
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
            <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
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
          <h2 className="text-lg font-semibold text-slate-950">Skapa Z03 från switchärende</h2>
          <form action={prepareSwitchZ03Action} className="mt-4 space-y-3">
            <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
            <div className="grid gap-3 md:grid-cols-2">
              <input name="switchRequestId" placeholder="Switch request-id" className="rounded-xl border border-slate-300 px-3 py-2" required />
              <input name="communicationRouteId" placeholder="Route-id" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="senderEdielId" placeholder="Gridex Ediel-id" className="rounded-xl border border-slate-300 px-3 py-2" required />
              <input name="receiverEdielId" placeholder="Nätägarens Ediel-id" className="rounded-xl border border-slate-300 px-3 py-2" required />
              <input name="receiverEmail" placeholder="Nätägarens e-post" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="mailbox" placeholder="Mailbox" className="rounded-xl border border-slate-300 px-3 py-2" />
            </div>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Förbered Z03
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Skapa Z09 från switchärende</h2>
          <form action={prepareSwitchZ09Action} className="mt-4 space-y-3">
            <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
            <div className="grid gap-3 md:grid-cols-2">
              <input name="switchRequestId" placeholder="Switch request-id" className="rounded-xl border border-slate-300 px-3 py-2" required />
              <input name="communicationRouteId" placeholder="Route-id" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="senderEdielId" placeholder="Gridex Ediel-id" className="rounded-xl border border-slate-300 px-3 py-2" required />
              <input name="receiverEdielId" placeholder="Nätägarens Ediel-id" className="rounded-xl border border-slate-300 px-3 py-2" required />
              <input name="receiverEmail" placeholder="Nätägarens e-post" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="mailbox" placeholder="Mailbox" className="rounded-xl border border-slate-300 px-3 py-2" />
            </div>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Förbered Z09
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Negativ UTILTS-respons</h2>
          <form action={createNegativeUtiltsResponseAction} className="mt-4 space-y-3">
            <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
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
          <h2 className="text-lg font-semibold text-slate-950">Manuellt PRODAT-utkast</h2>
          <form action={createProdatDraftAction} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input name="code" placeholder="Z03 / Z09 / Z01 / Z13 / Z18" className="rounded-xl border border-slate-300 px-3 py-2" required />
              <input name="receiverEdielId" placeholder="Mottagarens Ediel-id" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="senderEdielId" placeholder="Avsändarens Ediel-id" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="receiverEmail" placeholder="Mottagarens e-post" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="communicationRouteId" placeholder="Route-id" className="rounded-xl border border-slate-300 px-3 py-2" />
              <input name="switchRequestId" placeholder="Switch request-id" className="rounded-xl border border-slate-300 px-3 py-2" />
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
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Senaste Ediel-meddelanden</h2>
        <div className="mt-4 space-y-4">
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              Inga Ediel-meddelanden ännu.
            </div>
          ) : (
            messages.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-slate-950">
                    {row.message_family} {row.message_code}
                  </div>
                  <div className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">
                    {row.direction}
                  </div>
                  <div className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">
                    {row.status}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <Cell label="Message-id" value={row.id} />
                  <Cell label="External reference" value={row.external_reference} />
                  <Cell label="Correlation reference" value={row.correlation_reference} />
                  <Cell label="Transaction reference" value={row.transaction_reference} />
                  <Cell label="Sender Ediel-id" value={row.sender_ediel_id} />
                  <Cell label="Receiver Ediel-id" value={row.receiver_ediel_id} />
                  <Cell label="Switch request" value={row.switch_request_id} />
                  <Cell label="Data request" value={row.grid_owner_data_request_id} />
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
            ))
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
              <div key={run.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-slate-950">
                    {run.test_suite} / {run.test_case_code}
                  </div>
                  <div className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">
                    {run.role_code}
                  </div>
                  <div className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">
                    {run.status}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <Cell label="Run-id" value={run.id} />
                  <Cell label="Godkännandeversion" value={run.approval_version} />
                  <Cell label="Titel" value={run.title} />
                  <Cell label="Metering point-id" value={run.metering_point_id} />
                </div>

                <form action={attachMessageToTestRunAction} className="mt-4 grid gap-3 md:grid-cols-5">
                  <input type="hidden" name="testRunId" value={run.id} />
                  <input name="edielMessageId" placeholder="Ediel message-id" className="rounded-xl border border-slate-300 px-3 py-2" required />
                  <input name="stepNo" placeholder="Steg nr" className="rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="expectedDirection" placeholder="inbound / outbound" className="rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="expectedFamily" placeholder="PRODAT / UTILTS" className="rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="expectedCode" placeholder="Z03 / E66" className="rounded-xl border border-slate-300 px-3 py-2" />
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