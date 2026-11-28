// Extracted from page.tsx; keep public imports on the facade module.













































import { type CommunicationLog } from "@/lib/email/communicationLogs"

import { resendCustomerEmailAction } from "./email-actions"
import CustomerEmailResendSubmitButton from "@/components/admin/customers/CustomerEmailResendSubmitButton"




import { formatAdminDateTime } from "@/lib/ui/format"
import { customerEmailStatus } from "@/lib/admin/customerCommunicationLabels"
import { formatStatusLabel } from '@/lib/ui/format'

const resendNotices = {
  queued: {
    warning: false,
    message: 'Omtaget har lagts i utskickskön.',
  },
  duplicate: {
    warning: false,
    message: 'Omtaget finns redan registrerat. Inget nytt utskick skapades.',
  },
  requires_reconciliation: {
    warning: true,
    message: 'Omtaget kräver granskning. Tidigare leverans eller meddelandets innehåll kunde inte verifieras. Granska tidigare försök i kommunikationshistoriken.',
  },
  failed: {
    warning: true,
    message: 'Omtaget kunde inte köas. Kontrollera kommunikationshistoriken eller kontakta support.',
  },
  already_pending: {
    warning: false,
    message: 'Ett omtag pågår redan. Följ dess status i kommunikationshistoriken.',
  },
} as const

function CustomerEmailResendNotice({ resend }: { resend?: string | string[] }) {
  if (typeof resend !== 'string' || !Object.hasOwn(resendNotices, resend)) return null
  const notice = resendNotices[resend as keyof typeof resendNotices]

  return (
    <p
      role={notice.warning ? 'alert' : 'status'}
      className={notice.warning
        ? 'mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950'
        : 'mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800'}
    >
      {notice.message}
    </p>
  )
}

export function CustomerCommunicationSection({
  logs,
  isPlatformAdmin = false,
  canResend = false,
  resend,
}: {
  logs: CommunicationLog[];
  isPlatformAdmin?: boolean;
  canResend?: boolean;
  resend?: string | string[];
}) {
  if (!isPlatformAdmin) {
    const renderLog = (log: CommunicationLog) => <article key={log.id} className="min-w-0 break-words rounded-xl border border-slate-200 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">{log.subject || 'Kundmeddelande'}</p>
          <p className="mt-1 text-sm text-slate-600">Till {log.recipient_email} · {formatAdminDateTime(log.created_at)}</p>
        </div>
        <span className={`w-fit shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${['sent', 'delivered'].includes(log.status) ? 'bg-emerald-100 text-emerald-800' : ['failed', 'bounced', 'complained'].includes(log.status) ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>{customerEmailStatus(log.status)}</span>
      </div>
      {['failed', 'bounced'].includes(log.status) ? <p className="mt-2 text-sm text-red-800">Utskicket kunde inte levereras. Kontrollera mottagaradressen eller kontakta support.</p> : null}
      {canResend && log.customer_id && log.template_key && log.recipient_email ? <details className="mt-3 text-xs text-slate-700"><summary className="cursor-pointer font-semibold">Fler åtgärder</summary><form action={resendCustomerEmailAction} className="mt-2">
        <input type="hidden" name="customer_id" value={log.customer_id} />
        <input type="hidden" name="log_id" value={log.id} />
        <CustomerEmailResendSubmitButton label="Skicka igen" />
      </form></details> : null}
    </article>;
    return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">Kommunikation</h2>
      <p className="mt-1 text-sm text-slate-700">Kundens senaste meddelanden och leveransstatus.</p>
      <CustomerEmailResendNotice resend={resend} />
      <div className="mt-4 space-y-3">{logs.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Ingen kommunikation loggad ännu.</p> : logs.slice(0, 10).map(renderLog)}</div>
      {logs.length > 10 ? <details id="earlier-customer-messages" className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Tidigare meddelanden ({logs.length - 10})</summary><div role="region" aria-label="Tidigare kundmeddelanden" tabIndex={0} className="mt-3 max-h-96 space-y-3 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{logs.slice(10).map(renderLog)}</div></details> : null}
    </section>;
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800 ">
          Kommunikation
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950 ">
          Kundens kommunikationshistorik
        </h2>
        <p className="mt-2 text-sm text-slate-700 ">
          Visar bara kundens utskick. DNS och domäninställningar hanteras på
          bolagskortet.
        </p>
      </div>
      <CustomerEmailResendNotice resend={resend} />
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 ">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600 ">
            <tr>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Typ</th>
              <th className="px-4 py-3">Från/till</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Spårning</th>
              <th className="px-4 py-3">Åtgärder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-slate-600"
                >
                  Ingen kommunikation loggad ännu.
                </td>
              </tr>
            ) : null}
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3 text-slate-700 ">
                  {formatAdminDateTime(log.created_at)}
                </td>
                <td className="px-4 py-3 text-slate-700 ">
                  {log.event_key ?? log.template_key ?? "E-post"}
                  <div className="text-xs text-slate-500">
                    Mall: {log.template_key ?? "—"} · v
                    {log.template_version ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700 ">
                  <div>Från: {log.sender_email ?? "—"}</div>
                  <div>Till: {log.recipient_email}</div>
                  <div className="text-xs text-slate-500">
                    Reply-to: {log.reply_to_email ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700 ">
                  {formatStatusLabel(log.status)}
                  <div className="text-xs text-slate-500">
                    {log.sender_mode ?? "sender okänd"}
                  </div>
                  {log.error_message ? (
                    <div className="text-xs text-red-700">
                      {log.error_message}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-slate-700 ">
                  <div>
                    {log.provider_message_id ?? "leverantörs-id saknas"}
                  </div>
                  <div>Kundnr: {log.customer_number ?? "—"}</div>
                  <div>External: {log.external_customer_id ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {canResend && log.customer_id && log.template_key && log.recipient_email ? <form action={resendCustomerEmailAction}>
                      <input
                        type="hidden"
                        name="customer_id"
                        value={log.customer_id ?? ""}
                      />
                      <input type="hidden" name="log_id" value={log.id} />
                      <CustomerEmailResendSubmitButton label="Skicka om" />
                    </form> : null}
                    <details className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                      <summary className="cursor-pointer">
                        Visa innehåll
                      </summary>
                      <p className="mt-2 max-w-sm text-slate-600">
                        Ämne: {log.subject ?? "—"}
                      </p>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
