import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { formatStatusLabel } from '@/lib/ui/format'

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
  last_polled_at?: string | null
  last_poll_at?: string | null
  last_poll_status?: string | null
  last_error?: string | null
  locked_at?: string | null
  is_active?: boolean | null
}

const statusTones = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
}

type Status = {
  label: string
  tone: keyof typeof statusTones
  action?: { href: string; label: string }
}

function StatusBadge({ label, tone, action }: Status) {
  return (
    <>
      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${statusTones[tone]}`}>{label}</div>
      {action ? (
        <Link href={action.href} prefetch={false} className="mt-1 block text-xs font-semibold text-slate-700 underline">
          {action.label}
        </Link>
      ) : null}
    </>
  )
}

function readPollTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function formatDate(time: number | null): string {
  if (time === null) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(time)
}

function latestPollAttempt(mailbox: MailboxRow): number | null {
  const current = readPollTime(mailbox.last_polled_at)
  const legacy = readPollTime(mailbox.last_poll_at)
  if (current === null || legacy === null) return current ?? legacy
  return Math.max(current, legacy)
}

function securityStatus(mailbox: MailboxRow): Status {
  switch (mailbox.security_status?.trim().toLowerCase()) {
    case 'failed':
    case 'error':
      return {
        label: 'Säkerhetskontrollen misslyckades',
        tone: 'warning',
        action: { href: '/admin/ediel/certificates', label: 'Kontrollera Ediel-certifikaten' },
      }
    case 'private_certificate_configured':
      return { label: 'Certifikat konfigurerat', tone: 'neutral' }
    case 'receiver_certificate_on_route_required':
      return { label: 'Mottagarcertifikat krävs på rutten', tone: 'warning' }
    case 'test_unencrypted_allowed':
      if (mailbox.environment === 'test') {
        return { label: 'Okrypterat tillåtet i test', tone: 'neutral' }
      }
      break
  }
  return { label: 'Säkerhetsstatus okänd', tone: 'neutral' }
}

function pollStatus(mailbox: MailboxRow, attempt: number | null, success: number | null): Status {
  const previousStatus = mailbox.last_poll_status?.trim().toLowerCase()
  if (mailbox.last_error?.trim() || previousStatus === 'failed' || previousStatus === 'error') {
    return {
      label: 'Pollning misslyckades',
      tone: 'warning',
      action: { href: '/admin/inbound-mail/diagnostics', label: 'Öppna polldiagnostik' },
    }
  }
  if (mailbox.is_active === false) return { label: 'Pollning inaktiv', tone: 'neutral' }
  if (mailbox.is_active === true && !mailbox.locked_at && success !== null && (attempt === null || success >= attempt)) {
    return { label: 'Senaste poll lyckades', tone: 'success' }
  }
  return { label: 'Pollresultat okänt', tone: 'neutral' }
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
            <p className="mt-3 text-3xl font-black text-slate-950">{mailboxes.filter((m) => m.is_active === true).length}</p>
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
                  <th className="p-3">Aktivering</th>
                </tr>
              </thead>
              <tbody>
                {mailboxes.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-slate-500">Inga mailboxes hittades.</td></tr>
                ) : null}
                {mailboxes.map((mailbox) => {
                  const attempt = latestPollAttempt(mailbox)
                  const success = readPollTime(mailbox.last_successful_poll_at)
                  const activation = mailbox.is_active == null ? null : mailbox.is_active ? 'active' : 'inactive'

                  return (
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
                        <StatusBadge {...securityStatus(mailbox)} />
                        <div className="mt-2">
                          <StatusBadge
                            label={mailbox.tls_required === false ? 'TLS ej krav' : 'TLS krävs'}
                            tone={mailbox.tls_required === false ? 'warning' : 'neutral'}
                          />
                        </div>
                        <div className="text-xs text-slate-600">S/MIME: {mailbox.encryption_mode ?? 'none'} / {mailbox.signing_mode ?? 'none'}</div>
                        <div className="font-mono text-xs text-slate-500">{mailbox.certificate_id ?? 'certifikat saknas'}</div>
                      </td>
                      <td className="p-3 text-slate-700">
                        <StatusBadge {...pollStatus(mailbox, attempt, success)} />
                        <div className="mt-2 text-xs">Senaste pollförsök: {formatDate(attempt)}</div>
                        <div className="text-xs">Senaste lyckade poll: {formatDate(success)}</div>
                      </td>
                      <td className="p-3">
                        <StatusBadge label={formatStatusLabel(activation, 'Aktivering okänd')} tone="neutral" />
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
