import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getMailReadiness, type MailLaneReadiness } from '@/lib/ediel/mailReadiness'

export const dynamic = 'force-dynamic'

function tone(status: string) {
  if (status === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'error') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-amber-200 bg-amber-50 text-amber-900'
}

function LaneCard({ lane }: { lane: MailLaneReadiness }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{lane.lane}</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">{lane.provider === 'strato' ? 'Ediel lane - Strato SMTP' : 'Application events lane - Resend'}</h2>
          <p className="mt-2 text-sm text-slate-700">Sender: <span className="font-mono font-semibold">{lane.sender}</span></p>
          {lane.smtpHost ? <p className="text-sm text-slate-700">SMTP: {lane.smtpHost}:{lane.smtpPort} secure={String(lane.smtpSecure)}</p> : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Last checked: {lane.lastCheckedAt.replace('T', ' ').slice(0, 16)}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {lane.statuses.map((item) => (
          <div key={item.key} className={`rounded-2xl border p-4 text-sm ${tone(item.status)}`}>
            <div className="font-black">{item.key}: {item.status}</div>
            <div className="mt-1">{item.message}</div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-black text-slate-950">DNS checklist</h3>
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="p-3">Type</th>
                <th className="p-3">Host/name</th>
                <th className="p-3">Value</th>
                <th className="p-3">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {lane.requiredRecords.map((record) => (
                <tr key={`${record.type}:${record.host}:${record.value}`} className="border-t border-slate-100">
                  <td className="p-3 font-mono">{record.type}</td>
                  <td className="p-3 font-mono">{record.host}</td>
                  <td className="p-3 font-mono">{record.value}</td>
                  <td className="p-3">{record.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default async function EdielMailReadinessPage() {
  const context = await requirePlatformAdminAccess()
  const readiness = await getMailReadiness()

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel mail readiness" subtitle="Separata mail-lanes för Ediel/Strato och produktmail/Resend." userEmail={context.email} workspaceName="Platform" workspaceMode="platform" />
      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
          <div className="font-black">Viktigt</div>
          <p>Ediel ska skickas via Strato SMTP som ediel@gridex.se. Resend ska bara användas för application events/customer notifications. Skapa inte root CNAME för gridex.se och lägg inte Resend MX på root-domänen när ediel@gridex.se ligger hos Strato.</p>
          <p className="mt-2">Befintlig CNAME app.gridex.se mot Vercel ska lämnas orörd.</p>
        </section>
        <div className="grid gap-6 xl:grid-cols-2">
          <LaneCard lane={readiness.ediel} />
          <LaneCard lane={readiness.events} />
        </div>
      </main>
    </div>
  )
}
