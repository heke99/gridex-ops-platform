// Extracted from page.tsx; keep public imports on the facade module.













































import { type CommunicationLog } from "@/lib/email/communicationLogs"

import { resendCustomerEmailAction } from "./email-actions"




import { formatDateTime } from './page.part-1'

export function CustomerCommunicationSection({
  logs,
  isPlatformAdmin = false,
}: {
  logs: CommunicationLog[];
  isPlatformAdmin?: boolean;
}) {
  if (!isPlatformAdmin) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Kommunikation</h2>
        <p className="mt-1 text-sm text-slate-700">Skickade, köade och misslyckade kundmeddelanden i ett enkelt flöde.</p>
        <div className="mt-5 space-y-3">
          {logs.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Ingen kommunikation loggad ännu.</p>
          ) : null}
          {logs.slice(0, 25).map((log) => (
            <article key={log.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-950">{log.subject ?? log.event_key ?? log.template_key ?? "Kundmeddelande"}</p>
                  <p className="mt-1 text-sm text-slate-600">Till {log.recipient_email} · {formatDateTime(log.created_at)}</p>
                </div>
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                  log.status === "sent" || log.status === "delivered"
                    ? "bg-emerald-100 text-emerald-800"
                    : log.status === "failed"
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-900"
                }`}>
                  {log.status === "sent" || log.status === "delivered"
                    ? "Skickad"
                    : log.status === "failed"
                      ? "Misslyckades"
                      : log.status === "queued"
                        ? "Köad"
                        : log.status}
                </span>
              </div>
              {log.error_message ? <p className="mt-2 text-sm text-red-700">{log.error_message}</p> : null}
              <form action={resendCustomerEmailAction} className="mt-3">
                <input type="hidden" name="customer_id" value={log.customer_id ?? ""} />
                <input type="hidden" name="log_id" value={log.id} />
                <button className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Skicka igen</button>
              </form>
            </article>
          ))}
        </div>
      </section>
    );
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
                  {formatDateTime(log.created_at)}
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
                  {log.status}
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
                    <form action={resendCustomerEmailAction}>
                      <input
                        type="hidden"
                        name="customer_id"
                        value={log.customer_id ?? ""}
                      />
                      <input type="hidden" name="log_id" value={log.id} />
                      <button className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Skicka om
                      </button>
                    </form>
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
