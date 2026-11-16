import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type MailboxRow = {
  id: string
  mailbox_name?: string | null
  email_address?: string | null
  environment?: string | null
  mailbox_type?: string | null
  transport_mode?: string | null
  tls_required?: boolean | null
  smtp_host?: string | null
  smtp_to?: string | null
  smtp_from?: string | null
  imap_host?: string | null
  encryption_mode?: string | null
  signing_mode?: string | null
  certificate_id?: string | null
  security_status?: string | null
  last_successful_poll_at?: string | null
  last_poll_at?: string | null
  last_poll_status?: string | null
  last_error?: string | null
  is_active?: boolean | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function statusTone(ok: boolean): string {
  return ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'
}

export default async function EdielMailboxesPage() {
  const context = await requirePlatformAdminAccess()
  const { data, error } = await supabaseService
    .from('ediel_mailboxes')
    .select('*')
    .order('email_address', { ascending: true })
    .limit(100)

  const mailboxes = error ? [] : (data ?? []) as MailboxRow[]

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel mailboxes"
        subtitle="Shared SMTP/IMAP transport för ediel@gridex.se. Mailboxen är fysisk transport; tenant avgörs av EDIFACT route keys."
        userEmail={context.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em]">Shared transport policy</p>
          <h1 className="mt-2 text-2xl font-black">ediel@gridex.se är transport, inte tenant-identitet</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6">
            UNB/NAD sender ska vara tenantens Ediel-ID. Subaddress är optional route field och får bara blockera när route explicit kräver det.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Mailboxes</p>
            <p className="mt-3 text-3xl font-black text-slate-950">{mailboxes.length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Aktiva</p>
            <p className="mt-3 text-3xl font-black text-slate-950">{mailboxes.filter((m) => m.is_active !== false).length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">S/MIME</p>
            <p className="mt-3 text-3xl font-black text-slate-950">{mailboxes.filter((m) => m.encryption_mode === 'smime' || m.signing_mode === 'smime').length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">TLS required</p>
            <p className="mt-3 text-3xl font-black text-slate-950">{mailboxes.filter((m) => m.tls_required !== false).length}</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-slate-950">Mailbox status</h2>
            <div className="flex gap-2">
              <Link href="/admin/inbound-mail" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">Inbound mail engine</Link>
              <Link href="/admin/inbound-mail/diagnostics" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Diagnostik</Link>
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr>
                  <th className="p-3">Mailbox</th>
                  <th className="p-3">Transport</th>
                  <th className="p-3">Security</th>
                  <th className="p-3">Polling</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {mailboxes.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-slate-500">Inga mailboxes hittades.</td></tr>
                ) : null}
                {mailboxes.map((mailbox) => (
                  <tr key={mailbox.id} className="border-t border-slate-100">
                    <td className="p-3">
                      <div className="font-bold text-slate-950">{mailbox.email_address ?? '—'}</div>
                      <div className="text-xs text-slate-500">{mailbox.mailbox_name ?? mailbox.mailbox_type ?? 'shared'}</div>
                    </td>
                    <td className="p-3 text-slate-700">
                      <div>{mailbox.transport_mode ?? 'smtp_imap'} · {mailbox.environment ?? '—'}</div>
                      <div className="text-xs">SMTP {mailbox.smtp_from ?? mailbox.smtp_host ?? '—'} → {mailbox.smtp_to ?? 'route-specific'}</div>
                      <div className="text-xs">IMAP {mailbox.imap_host ?? '—'}</div>
                    </td>
                    <td className="p-3">
                      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${statusTone(mailbox.tls_required !== false)}`}>TLS {mailbox.tls_required === false ? 'ej krav' : 'krävs'}</div>
                      <div className="mt-2 text-xs text-slate-600">S/MIME: {mailbox.encryption_mode ?? 'none'} / {mailbox.signing_mode ?? 'none'}</div>
                      <div className="font-mono text-xs text-slate-500">{mailbox.certificate_id ?? 'certifikat saknas'}</div>
                    </td>
                    <td className="p-3 text-slate-700">
                      <div>Senaste poll: {formatDate(mailbox.last_poll_at ?? mailbox.last_successful_poll_at)}</div>
                      <div className="text-xs">Senaste lyckad: {formatDate(mailbox.last_successful_poll_at)}</div>
                    </td>
                    <td className="p-3">
                      <div className={`rounded-xl border px-3 py-2 ${statusTone(mailbox.is_active !== false && !mailbox.last_error)}`}>
                        {mailbox.last_error ?? mailbox.security_status ?? mailbox.last_poll_status ?? 'okänd'}
                      </div>
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
