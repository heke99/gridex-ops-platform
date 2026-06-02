import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type MailboxRow = {
  id: string
  company_id: string | null
  mailbox_name: string | null
  email_address: string | null
  environment: string | null
  is_active: boolean | null
  provider: string | null
  imap_host: string | null
  smtp_host: string | null
  encryption_mode?: string | null
  certificate_id?: string | null
  last_polled_at: string | null
  last_poll_at?: string | null
  last_poll_status?: string | null
  last_error?: string | null
  locked_at?: string | null
  updated_at: string | null
}

type PollRunRow = {
  id: string
  environment: string | null
  status: string | null
  configured_mailboxes: number | null
  due_mailboxes: number | null
  fetched_messages: number | null
  stored_emails: number | null
  failed_jobs: number | null
  started_at: string | null
  finished_at: string | null
}

async function listRows<T>(table: string, select: string, orderColumn: string, limit = 50): Promise<T[]> {
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

function statusTone(active: boolean | null | undefined, error?: string | null) {
  if (error) return 'border-red-200 bg-red-50 text-red-800'
  if (active) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default async function EdielMailboxesPage() {
  const admin = await requirePlatformAdminAccess()
  const [mailboxes, pollRuns] = await Promise.all([
    listRows<MailboxRow>(
      'ediel_mailboxes',
      'id,company_id,mailbox_name,email_address,environment,is_active,provider,imap_host,smtp_host,encryption_mode,certificate_id,last_polled_at,last_poll_at,last_poll_status,last_error,locked_at,updated_at',
      'updated_at',
      100
    ),
    listRows<PollRunRow>(
      'ediel_inbound_poll_runs',
      'id,environment,status,configured_mailboxes,due_mailboxes,fetched_messages,stored_emails,failed_jobs,started_at,finished_at',
      'started_at',
      12
    ),
  ])
  const active = mailboxes.filter((mailbox) => mailbox.is_active).length
  const shared = mailboxes.filter((mailbox) => mailbox.company_id === null).length
  const locked = mailboxes.filter((mailbox) => mailbox.locked_at).length
  const withErrors = mailboxes.filter((mailbox) => mailbox.last_error || mailbox.last_poll_status === 'failed').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel mailboxes"
        subtitle="Shared och tenant-specifika Ediel-mailboxar, poll-status och S/MIME-defaults."
        userEmail={admin.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-600">Mailboxar</p><p className="mt-2 text-3xl font-black text-slate-950">{mailboxes.length}</p></div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 shadow-sm"><p className="text-sm font-semibold">Aktiva</p><p className="mt-2 text-3xl font-black">{active}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-600">Shared</p><p className="mt-2 text-3xl font-black text-slate-950">{shared}</p></div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm"><p className="text-sm font-semibold">Låsta/fel</p><p className="mt-2 text-3xl font-black">{locked}/{withErrors}</p></div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Mailbox registry</p>
              <h1 className="mt-2 text-xl font-black text-slate-950">Transportkanaler</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Tenant routing sker efter EDIFACT-aktorer och route-profiler. Mailboxen ar en transportresurs.
              </p>
            </div>
            <Link href="/admin/inbound-mail" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50">Inbound Mail Engine</Link>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mailboxes.map((mailbox) => (
              <article key={mailbox.id} className={`rounded-3xl border p-5 shadow-sm ${statusTone(mailbox.is_active, mailbox.last_error)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-black">{mailbox.mailbox_name ?? mailbox.email_address ?? mailbox.id}</h2>
                    <p className="mt-1 break-all text-xs opacity-80">{mailbox.email_address ?? 'email saknas'}</p>
                  </div>
                  <span className="rounded-full border border-current/20 px-2 py-1 text-xs font-black">{mailbox.environment ?? 'test'}</span>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div><dt className="font-bold opacity-75">Scope</dt><dd>{mailbox.company_id ? `Tenant ${mailbox.company_id}` : 'Platform shared'}</dd></div>
                  <div><dt className="font-bold opacity-75">IMAP/SMTP</dt><dd>{mailbox.imap_host ?? '-'} / {mailbox.smtp_host ?? '-'}</dd></div>
                  <div><dt className="font-bold opacity-75">Kryptering</dt><dd>{mailbox.encryption_mode ?? 'none'}{mailbox.certificate_id ? ` · cert ${mailbox.certificate_id}` : ''}</dd></div>
                  <div><dt className="font-bold opacity-75">Senast pollad</dt><dd>{formatDate(mailbox.last_polled_at ?? mailbox.last_poll_at)}</dd></div>
                </dl>
                {mailbox.last_error ? <p className="mt-3 rounded-2xl border border-red-200 bg-white/70 p-3 text-xs font-semibold text-red-800">{mailbox.last_error}</p> : null}
              </article>
            ))}
            {mailboxes.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 p-6 text-sm text-slate-700">Inga mailboxar hittades.</div> : null}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Senaste poll-runs</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr><th className="px-4 py-3">Start</th><th className="px-4 py-3">Miljo</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Mailboxar</th><th className="px-4 py-3">Resultat</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pollRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3">{formatDate(run.started_at)}</td>
                    <td className="px-4 py-3">{run.environment ?? '-'}</td>
                    <td className="px-4 py-3">{run.status ?? '-'}</td>
                    <td className="px-4 py-3">{run.configured_mailboxes ?? 0} konfig · {run.due_mailboxes ?? 0} due</td>
                    <td className="px-4 py-3">{run.fetched_messages ?? 0} hamtade · {run.stored_emails ?? 0} sparade · {run.failed_jobs ?? 0} fel</td>
                  </tr>
                ))}
                {pollRuns.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">Inga poll-runs hittades.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
