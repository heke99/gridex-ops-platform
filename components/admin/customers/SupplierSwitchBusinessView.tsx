import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'
import CustomerName from '@/components/admin/CustomerName'
import { formatStatusLabel } from '@/lib/ui/format'
import type { CustomerSiteRow, GridOwnerRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow, SwitchReadinessResult } from '@/lib/operations/types'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type { SwitchLifecycleStage } from '@/lib/operations/controlTower'
import { queueSupplierSwitchOutboundAction } from '@/app/admin/cis/actions'
import { finalizeSupplierSwitchExecutionAction, retryOutboundFromSwitchDetailAction, validateSupplierSwitchBeforeProcessingAction } from '@/app/admin/operations/actions'

const progress: Record<SwitchLifecycleStage, { label: string; description: string }> = {
  blocked: { label: 'Uppgifter behöver kompletteras', description: 'Kontrollera anläggningsuppgifterna och fullmakten.' },
  queued_for_outbound: { label: 'Utskick förbereds', description: 'Uppgifterna behöver vara klara innan begäran skickas.' },
  awaiting_dispatch: { label: 'Väntar på utskick', description: 'Begäran är förberedd och väntar på att skickas.' },
  awaiting_response: { label: 'Väntar på svar', description: 'Begäran är skickad. Nätägarens bekräftelse återstår.' },
  awaiting_market_confirmation: { label: 'Väntar på nätägarens bekräftelse', description: 'Utskicket har tagits emot. Leverantörsbytet är ännu inte bekräftat.' },
  awaiting_effective_date: { label: 'Väntar på startdatum', description: 'Bytet är bekräftat och inväntar avtalad leveransstart.' },
  ready_to_execute: { label: 'Redo för leveransstart', description: 'Kontrollera det bekräftade startdatumet innan bytet slutförs.' },
  completed: { label: 'Klart', description: 'Leverantörsbytet är slutfört.' },
  failed: { label: 'Behöver granskas', description: 'Begäran har stoppats eller avvisats. Granska orsaken innan nästa försök.' },
}

function date(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }).format(new Date(value)) : 'Saknas'
}

/** Server component: diagnostic records never enter a client component's props. */
export default function SupplierSwitchBusinessView({ request, site, gridOwner, readiness, outboundRequest, stage, canManage, canQueue }: {
  request: SupplierSwitchRequestRow
  site: CustomerSiteRow | null
  gridOwner: GridOwnerRow | null
  readiness: SwitchReadinessResult | null
  outboundRequest: OutboundRequestRow | null
  stage: SwitchLifecycleStage
  canManage: boolean
  canQueue: boolean
}) {
  const activation = request.status === 'accepted' ? getSupplierSwitchActivationReadiness(request) : null
  const paused = Boolean(request.paused_at || request.lifecycle_blocked)
  const current = String(request.status) === 'cancelled'
    ? { label: 'Avbrutet', description: 'Leverantörsbytet är avbrutet och går inte vidare till leveransstart.' }
    : request.status === 'rejected'
      ? { label: 'Avvisat', description: 'Leverantörsbytet har avvisats. Granska orsaken på kundkortet.' }
      : paused
        ? { label: 'Pausat', description: request.pause_reason ?? 'Ärendet är pausat och behöver granskas innan det kan fortsätta.' }
        : stage === 'blocked' && activation?.code === 'missing_z04_confirmation'
          ? { label: 'Nätägarens bekräftelse behöver kontrolleras', description: 'Bekräftelsen saknas i ärendet. Kontakta support innan leveransstart.' }
          : stage === 'blocked' && activation?.code === 'missing_effective_start_date'
            ? { label: 'Startdatum saknas', description: 'Nätägaren har bekräftat bytet. Komplettera och kontrollera startdatumet innan leveransstart.' }
            : progress[stage]
  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status)
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    <a href={`/admin/customers/${request.customer_id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">← Kundkort</a>
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-xl font-semibold text-slate-950">Leverantörsbyte</h1><p className="mt-1 text-sm text-slate-700"><CustomerName id={request.customer_id} /></p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">{formatStatusLabel(request.status, 'Status saknas', 'Behöver granskning')}</span></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          ['Anläggning', site?.facility_id ?? site?.site_name ?? 'Saknas'],
          ['Adress', site?.street ?? 'Saknas'],
          ['Nätägare', gridOwner?.name ?? 'Saknas'],
          ['Nuvarande elleverantör', request.current_supplier_name ?? 'Saknas'],
          ['Ny elleverantör', request.incoming_supplier_name ?? 'Saknas'],
          ['Önskad leveransstart', date(request.requested_start_date)],
          ['Bekräftad leveransstart', date(request.confirmed_start_date)],
          ['Fullmaktsunderlag', request.power_of_attorney_id || request.authorization_document_id ? 'Registrerat' : 'Saknas'],
          ['Slutfört', request.completed_at ? date(request.completed_at) : 'Inte slutfört'],
        ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{value}</dd></div>)}
      </dl>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Nästa steg">
      <h2 className="text-base font-semibold text-slate-950">{!readiness && !closed ? 'Uppgifterna behöver kontrolleras' : current.label}</h2>
      <p className="mt-2 text-sm text-slate-700">{!readiness && !closed ? 'Anläggningen saknas eller kunde inte läsas. Komplettera uppgifterna innan bytet går vidare.' : current.description}</p>
      {request.failure_reason ? <p className="mt-2 break-words text-sm text-red-800">{request.failure_reason}</p> : null}
      {readiness && !readiness.isReady ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{readiness.issues.map(issue => <li key={issue.code}>{issue.title}</li>)}</ul> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canManage && !closed ? <form action={validateSupplierSwitchBeforeProcessingAction}><input type="hidden" name="request_id" value={request.id} /><button className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Kontrollera uppgifter</button></form> : null}
        {canQueue && readiness?.isReady && stage === 'queued_for_outbound' && !outboundRequest && !closed && !paused ? <form action={queueSupplierSwitchOutboundAction}><input type="hidden" name="request_id" value={request.id} /><button className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Förbered utskick</button></form> : null}
        {canManage && readiness?.isReady && stage === 'ready_to_execute' && !closed && !paused ? <form action={finalizeSupplierSwitchExecutionAction}><input type="hidden" name="request_id" value={request.id} /><button className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Slutför leverantörsbyte</button></form> : null}
      </div>
    </section>
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Utskick och datum</summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Utskick</dt><dd>{outboundRequest ? formatStatusLabel(outboundRequest.status, 'Status saknas', 'Behöver granskning') : 'Inget utskick ännu'}</dd></div><div><dt className="text-slate-500">Skickat</dt><dd>{date(outboundRequest?.sent_at)}</dd></div></dl>
      {outboundRequest?.failure_reason ? <p className="mt-3 break-words text-sm text-red-800">{outboundRequest.failure_reason}</p> : null}
      {canManage && !closed && !paused && request.status !== 'accepted' && outboundRequest && ['failed', 'cancelled'].includes(outboundRequest.status) ? <form action={retryOutboundFromSwitchDetailAction} className="mt-3"><input type="hidden" name="switch_request_id" value={request.id} /><input type="hidden" name="outbound_request_id" value={outboundRequest.id} /><input type="hidden" name="customer_id" value={request.customer_id} /><button className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Försök skicka igen</button></form> : null}
    </details>
  </main>
}
