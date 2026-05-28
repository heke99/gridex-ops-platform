import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { processInboundMailQueueAction, runInboundMailEngineAction } from '@/app/admin/inbound-mail/actions'

export const dynamic = 'force-dynamic'

type MailboxRow = {
  id: string
  mailbox_name: string | null
  company_id: string | null
  email_address: string | null
  environment: string | null
  is_active: boolean | null
  poll_interval_minutes: number | null
  last_polled_at: string | null
  last_error: string | null
}

type InboundEmailRow = {
  id: string
  company_id: string | null
  mailbox_id: string | null
  from_address: string | null
  subject: string | null
  received_at: string | null
  processing_status: string | null
  match_status: string | null
  message_family?: string | null
  message_code?: string | null
  created_at: string
}

type ParseRow = {
  id: string
  inbound_email_message_id: string | null
  message_family: string | null
  message_code: string | null
  parse_status: string | null
  interchange_reference: string | null
  transaction_reference: string | null
  created_at: string
}

async function safeCount(table: string, filters: Record<string, string> = {}) {
  let query = supabaseService.from(table).select('id', { count: 'exact', head: true })
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value)
  const { count } = await query
  return count ?? 0
}

export default async function InboundMailPage() {
  const admin = await requirePlatformAdminAccess()

  const [mailboxesResult, messagesResult, parseResult, totalMessages, manualReviewCount, failedCount] = await Promise.all([
    supabaseService.from('ediel_mailboxes').select('*').order('updated_at', { ascending: false }).limit(50),
    supabaseService.from('inbound_email_messages').select('*').order('created_at', { ascending: false }).limit(25),
    supabaseService.from('inbound_ediel_parse_results').select('*').order('created_at', { ascending: false }).limit(25),
    safeCount('inbound_email_messages'),
    safeCount('inbound_email_messages', { match_status: 'manual_review' }),
    safeCount('inbound_email_messages', { processing_status: 'failed' }),
  ])

  if (mailboxesResult.error) throw mailboxesResult.error
  if (messagesResult.error) throw messagesResult.error
  if (parseResult.error) throw parseResult.error

  const mailboxes = (mailboxesResult.data ?? []) as MailboxRow[]
  const messages = (messagesResult.data ?? []) as InboundEmailRow[]
  const parseRows = (parseResult.data ?? []) as ParseRow[]
  const parseByMessageId = new Map(parseRows.map((row) => [row.inbound_email_message_id, row]))

  return (
    <div>
      <AdminHeader
        title="Inbound Mail Engine"
        subtitle="Platform-only yta för Ediel-mailboxar, raw payload, parserresultat och osäkra matchningar. Vanliga elbolag ska inte se denna tekniska vy."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <main className="space-y-6 px-6 py-6 sm:px-8">
        <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Engine-körning</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">Pollning och köprocessor</h2>
              <p className="mt-1 text-sm text-slate-700">Används av platform admin för manuell debug. I produktion kan samma runner anropas av Vercel Cron/API var 10:e minut.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={runInboundMailEngineAction}>
                <input type="hidden" name="environment" value="test" />
                <button className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-950/10 hover:bg-emerald-800">Kör engine nu</button>
              </form>
              <form action={processInboundMailQueueAction}>
                <button className="rounded-2xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Processa kö</button>
              </form>
              <Link href="/admin/inbound-mail/diagnostics" className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Diagnostics
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Inkommande mail</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{totalMessages}</p>
            <p className="mt-1 text-sm text-slate-700">Sparade raw email/EDIFACT-payloads.</p>
          </div>
          <div className="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm shadow-amber-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Manual review</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{manualReviewCount}</p>
            <p className="mt-1 text-sm text-slate-700">Osäkra tenant-/kund-/request-matchningar.</p>
          </div>
          <div className="rounded-3xl border border-red-100 bg-white p-5 shadow-sm shadow-red-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Fel</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{failedCount}</p>
            <p className="mt-1 text-sm text-slate-700">Mail eller parserjobb som behöver åtgärd.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Mailboxar</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">Aktiva Ediel-mailboxar</h2>
            </div>
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Polling var 10:e minut som standard
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mailboxes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-700">Inga mailboxar finns ännu.</div>
            ) : mailboxes.map((mailbox) => (
              <div key={mailbox.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{mailbox.mailbox_name ?? mailbox.email_address ?? mailbox.id}</p>
                    <p className="mt-1 text-xs text-slate-500">{mailbox.environment ?? 'test'} · {mailbox.poll_interval_minutes ?? 10} min</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${mailbox.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    {mailbox.is_active ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-600">Senast pollad: {mailbox.last_polled_at ?? '—'}</p>
                {mailbox.last_error ? <p className="mt-2 text-xs font-medium text-red-700">{mailbox.last_error}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
          <div className="border-b border-slate-100 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Inkommande</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Senaste mail och parserresultat</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-emerald-50/60 text-left text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                <tr>
                  <th className="px-4 py-3">Mail</th>
                  <th className="px-4 py-3">Typ</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Referenser</th>
                  <th className="px-4 py-3 text-right">Öppna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messages.map((message) => {
                  const parsed = parseByMessageId.get(message.id)
                  return (
                    <tr key={message.id}>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-950">{message.subject ?? 'Utan ämne'}</div>
                        <div className="mt-1 text-xs text-slate-500">{message.from_address ?? 'okänd avsändare'} · {message.received_at ?? message.created_at}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-700">{parsed?.message_family ?? '—'} {parsed?.message_code ?? ''}</td>
                      <td className="px-4 py-4 text-slate-700">{message.processing_status ?? 'received'} · {message.match_status ?? 'not_checked'}</td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        <div>UNB: {parsed?.interchange_reference ?? '—'}</div>
                        <div>TN/ACW: {parsed?.transaction_reference ?? '—'}</div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link href={`/admin/inbound-mail/${message.id}`} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          Visa
                        </Link>
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
