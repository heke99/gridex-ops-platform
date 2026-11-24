import type { SupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'
import CustomerName from '@/components/admin/CustomerName'
import { formatStatusLabel } from '@/lib/ui/format'
import type { CustomerSiteRow, GridOwnerRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow, SwitchReadinessResult } from '@/lib/operations/types'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type { SwitchLifecycleStage } from '@/lib/operations/controlTower'
import { queueSupplierSwitchOutboundAction } from '@/app/admin/cis/actions'
import { finalizeSupplierSwitchExecutionAction, retryOutboundFromSwitchDetailAction, validateSupplierSwitchBeforeProcessingAction } from '@/app/admin/operations/actions'

export const supplierSwitchBusinessProgress: Record<SwitchLifecycleStage, { label: string; description: string }> = {
  blocked: { label: 'Uppgifter behöver kompletteras', description: 'Kontrollera anläggningsuppgifterna och fullmakten.' },
  queued_for_outbound: { label: 'Utskick förbereds', description: 'Uppgifterna behöver vara klara innan begäran skickas.' },
  awaiting_dispatch: { label: 'Väntar på utskick', description: 'Begäran är förberedd och väntar på att skickas.' },
  awaiting_response: { label: 'Väntar på svar', description: 'Begäran är skickad. Nätägarens bekräftelse återstår.' },
  awaiting_market_confirmation: { label: 'Väntar på nätägarens bekräftelse', description: 'Utskicket har tagits emot. Leverantörsbytet är ännu inte bekräftat.' },
  awaiting_effective_date: { label: 'Väntar på startdatum', description: 'Bytet är bekräftat och inväntar avtalad leveransstart.' },
  ready_to_execute: { label: 'Redo för leveransstart', description: 'Kontrollera det bekräftade startdatumet innan bytet slutförs.' },
  completed: { label: 'Klart', description: 'Leverantörsbytet är slutfört.' },
  cancelled: { label: 'Avbrutet före leveransstart', description: 'Ärendet är avbrutet och går inte vidare till leveransstart.' },
  failed: { label: 'Behöver granskas', description: 'Begäran har stoppats eller avvisats. Granska orsaken innan nästa försök.' },
}

export function getSupplierSwitchBusinessProgress(
  stage: SwitchLifecycleStage,
  activation: SupplierSwitchActivationReadiness | null,
) {
  const progress = supplierSwitchBusinessProgress[stage]
  if (activation?.code === 'market_start_unverified' || activation?.code === 'market_start_unavailable') {
    return { label: 'Marknadsstarten behöver kontrolleras', description: activation.reason }
  }
  if (activation && (stage === 'awaiting_effective_date' || stage === 'ready_to_execute')) {
    return { ...progress, description: activation.reason }
  }
  return progress
}

export function getSupplierSwitchBusinessState(
  request: Pick<SupplierSwitchRequestRow, 'status' | 'paused_at' | 'lifecycle_blocked'>,
  readiness: SwitchReadinessResult | null,
  stage: SwitchLifecycleStage,
  activation: SupplierSwitchActivationReadiness | null,
) {
  const paused = Boolean(request.paused_at || request.lifecycle_blocked)
  const cancellation = request.status === 'cancellation_requested' || request.status === 'cancellation_sent'
    ? { label: 'Avbrott pågår', description: 'Följ upp avbrottet innan ytterligare utskick eller aktivering.' }
    : null
  const closed = ['completed', 'cancelled', 'cancelled_before_start', 'rejected'].includes(request.status)
  const progress = cancellation ?? getSupplierSwitchRequestProgress(request.status, paused, stage, activation)
  return { closed, cancellation, paused, progress, showMissingReadiness: !readiness && !closed && !cancellation }
}

function getSupplierSwitchRequestProgress(
  status: SupplierSwitchRequestRow['status'],
  paused: boolean,
  stage: SwitchLifecycleStage,
  activation: SupplierSwitchActivationReadiness | null,
) {
  if (status === 'cancelled_before_start') return supplierSwitchBusinessProgress.cancelled
  if (String(status) === 'cancelled') return { label: 'Avbrutet', description: 'Leverantörsbytet är avbrutet och går inte vidare till leveransstart.' }
  if (status === 'rejected') return { label: 'Avvisat', description: 'Leverantörsbytet har avvisats. Kontrollera ärendet med nätägaren innan du gör ett nytt försök.' }
  if (status === 'completed') return supplierSwitchBusinessProgress.completed
  if (paused) return { label: 'Pausat', description: 'Ärendet är pausat och behöver granskas innan det kan fortsätta.' }
  if (stage === 'blocked' && activation?.code === 'missing_z04_confirmation') {
    return { label: 'Nätägarens bekräftelse behöver kontrolleras', description: 'Bekräftelsen saknas i ärendet. Kontakta support innan leveransstart.' }
  }
  if (stage === 'blocked' && activation?.code === 'missing_effective_start_date') {
    return { label: 'Startdatum saknas', description: 'Nätägaren har bekräftat bytet. Komplettera och kontrollera startdatumet innan leveransstart.' }
  }
  return getSupplierSwitchBusinessProgress(stage, activation)
}

const requestTypeLabels: Record<SupplierSwitchRequestRow['request_type'], string> = {
  switch: 'Leverantörsbyte',
  move_in: 'Inflytt',
  move_out_takeover: 'Övertagande vid utflytt',
}

export function supplierSwitchRequestTypeLabel(type: SupplierSwitchRequestRow['request_type']): string {
  return requestTypeLabels[type] ?? 'Leveransärende'
}

export function formatSupplierSwitchDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'Europe/Stockholm' }).format(new Date(value)) : 'Saknas'
}

export type SupplierSwitchRetrySelection = {
  companyId: string
  customerId: string
  switchId: string
  switchStatus: string
  switchUpdatedAt: string
  outboundId: string
  outboundStatus: string
  outboundUpdatedAt: string
}

export function SupplierSwitchRetryFields({ selection }: { selection: SupplierSwitchRetrySelection }) {
  return <>
    <input type="hidden" name="company_id" value={selection.companyId} />
    <input type="hidden" name="customer_id" value={selection.customerId} />
    <input type="hidden" name="switch_request_id" value={selection.switchId} />
    <input type="hidden" name="expected_switch_status" value={selection.switchStatus} />
    <input type="hidden" name="expected_switch_updated_at" value={selection.switchUpdatedAt} />
    <input type="hidden" name="outbound_request_id" value={selection.outboundId} />
    <input type="hidden" name="expected_outbound_status" value={selection.outboundStatus} />
    <input type="hidden" name="expected_outbound_updated_at" value={selection.outboundUpdatedAt} />
  </>
}

/** Server component: diagnostic records never enter a client component's props. */
export default function SupplierSwitchBusinessView({ request, site, gridOwner, readiness, outboundRequest, retrySelection, stage, activation, canManage, canQueue, canActivate, customerHref }: {
  request: Pick<SupplierSwitchRequestRow,
    'id' | 'customer_id' | 'request_type' | 'status' | 'current_supplier_name' | 'incoming_supplier_name'
    | 'requested_start_date' | 'confirmed_start_date' | 'power_of_attorney_id'
    | 'authorization_document_id' | 'completed_at' | 'paused_at' | 'lifecycle_blocked'>
  site: CustomerSiteRow | null
  gridOwner: GridOwnerRow | null
  readiness: SwitchReadinessResult | null
  outboundRequest: Pick<OutboundRequestRow, 'id' | 'status' | 'sent_at'> | null
  retrySelection: SupplierSwitchRetrySelection | null
  stage: SwitchLifecycleStage
  activation: SupplierSwitchActivationReadiness | null
  canManage: boolean
  canActivate: boolean
  canQueue: boolean
  customerHref?: string | null
}) {
  const { closed, cancellation, paused, progress, showMissingReadiness } = getSupplierSwitchBusinessState(request, readiness, stage, activation)
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    <a href={customerHref ?? '/admin/operations/switches'} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
      {customerHref ? '← Kundkort' : '← Leverantörsbyten'}
    </a>
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-xl font-semibold text-slate-950">{supplierSwitchRequestTypeLabel(request.request_type)}</h1><p className="mt-1 text-sm text-slate-700"><CustomerName id={request.customer_id} /></p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">{formatStatusLabel(request.status, 'Status saknas', 'Behöver granskning')}</span></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          ['Anläggning', site?.facility_id ?? site?.site_name ?? 'Saknas'],
          ['Adress', site?.street ?? 'Saknas'],
          ['Nätägare', gridOwner?.name ?? 'Saknas'],
          ['Nuvarande elleverantör', request.current_supplier_name ?? 'Saknas'],
          ['Ny elleverantör', request.incoming_supplier_name ?? 'Saknas'],
          ['Önskad leveransstart', formatSupplierSwitchDate(request.requested_start_date)],
          ['Bekräftad leveransstart', formatSupplierSwitchDate(request.confirmed_start_date)],
          ['Fullmaktsunderlag', request.power_of_attorney_id || request.authorization_document_id ? 'Registrerat' : 'Saknas'],
          ['Slutfört', request.completed_at ? formatSupplierSwitchDate(request.completed_at) : 'Inte slutfört'],
        ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{value}</dd></div>)}
      </dl>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Nästa steg">
      <h2 className="text-base font-semibold text-slate-950">{showMissingReadiness ? 'Uppgifterna behöver kontrolleras' : progress.label}</h2>
      <p className="mt-2 text-sm text-slate-700">{showMissingReadiness ? 'Anläggningen saknas eller kunde inte läsas. Komplettera uppgifterna innan bytet går vidare.' : progress.description}</p>
      {readiness && !readiness.isReady ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{readiness.issues.map(issue => <li key={issue.code}>{issue.title}</li>)}</ul> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canManage && !closed && !cancellation ? <form action={validateSupplierSwitchBeforeProcessingAction}><input type="hidden" name="request_id" value={request.id} /><button className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Kontrollera uppgifter</button></form> : null}
        {canQueue && readiness?.isReady && stage === 'queued_for_outbound' && !outboundRequest && !closed && !paused && !cancellation ? <form action={queueSupplierSwitchOutboundAction}><input type="hidden" name="request_id" value={request.id} /><button className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Förbered utskick</button></form> : null}
        {canActivate && stage === 'ready_to_execute' && !closed && !paused && !cancellation ? <form action={finalizeSupplierSwitchExecutionAction}><input type="hidden" name="request_id" value={request.id} /><button className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Slutför leverantörsbyte</button></form> : null}
      </div>
    </section>
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Utskick och datum</summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Utskick</dt><dd>{outboundRequest ? formatStatusLabel(outboundRequest.status, 'Status saknas', 'Behöver granskning') : 'Inget utskick ännu'}</dd></div><div><dt className="text-slate-500">Skickat</dt><dd>{formatSupplierSwitchDate(outboundRequest?.sent_at)}</dd></div></dl>
      {retrySelection ? <form action={retryOutboundFromSwitchDetailAction} className="mt-3">
        <SupplierSwitchRetryFields selection={retrySelection} />
        <button className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Försök skicka igen</button>
      </form> : null}
    </details>
  </main>
}
