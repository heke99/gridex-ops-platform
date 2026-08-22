//lib/operations/controlTower.ts
import type {
  BillingUnderlayRow,
  OutboundRequestRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type {
  SwitchReadinessResult,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'

export type SwitchLifecycleStage =
  | 'blocked'
  | 'queued_for_outbound'
  | 'awaiting_dispatch'
  | 'awaiting_response'
  | 'awaiting_market_confirmation'
  | 'awaiting_effective_date'
  | 'ready_to_execute'
  | 'completed'
  | 'failed'

export function summarizeReadinessIssues(
  readiness: SwitchReadinessResult
): string {
  if (readiness.isReady || readiness.issues.length === 0) {
    return 'Inga aktiva blockers.'
  }

  return readiness.issues.map((issue) => issue.title).join(', ')
}

export function getSwitchLifecycle(params: {
  request: SupplierSwitchRequestRow
  readiness?: SwitchReadinessResult | null
  outboundRequest?: OutboundRequestRow | null
}): {
  stage: SwitchLifecycleStage
  label: string
  reason: string
} {
  const { request, readiness, outboundRequest } = params

  if (['failed', 'rejected'].includes(request.status)) {
    return {
      stage: 'failed',
      label: 'Misslyckad',
      reason: request.failure_reason ?? 'Switchärendet har stoppats eller avvisats.',
    }
  }

  if (request.status === 'completed') {
    return { stage: 'completed', label: 'Klar', reason: 'Leveransen är aktiverad för det bekräftade startdatumet.' }
  }

  if (request.status === 'accepted') {
    const activation = getSupplierSwitchActivationReadiness(request)
    if (activation.ready) {
      return { stage: 'ready_to_execute', label: 'Redo för leveransstart', reason: activation.reason }
    }
    if (activation.code === 'awaiting_effective_start_date') {
      return { stage: 'awaiting_effective_date', label: 'Väntar på startdatum', reason: activation.reason }
    }
    return { stage: 'blocked', label: 'Kontroll krävs', reason: activation.reason }
  }

  if (readiness && !readiness.isReady) {
    return { stage: 'blocked', label: 'Blockerad', reason: summarizeReadinessIssues(readiness) }
  }

  if (!outboundRequest) {
    return { stage: 'queued_for_outbound', label: 'Redo att köa Z03', reason: 'Ärendet är redo men saknar outbound PRODAT Z03.' }
  }

  if (['queued', 'prepared'].includes(outboundRequest.status)) {
    return { stage: 'awaiting_dispatch', label: 'Väntar på dispatch', reason: 'PRODAT Z03 finns men har inte skickats ännu.' }
  }

  if (outboundRequest.status === 'sent') {
    return { stage: 'awaiting_response', label: 'Väntar på kvittens', reason: 'PRODAT Z03 är skickad och väntar på transport-/applikationskvittens.' }
  }

  if (outboundRequest.status === 'acknowledged') {
    return {
      stage: 'awaiting_market_confirmation',
      label: 'Kvitterad – väntar på Z04',
      reason: 'Transport/applikation är kvitterad. Leverantörsbytet är inte affärsmässigt bekräftat förrän inbound PRODAT Z04 mottas.',
    }
  }

  if (outboundRequest.status === 'failed' || outboundRequest.status === 'cancelled') {
    return {
      stage: 'failed',
      label: 'Dispatch-fel',
      reason: outboundRequest.failure_reason ?? 'Outbound-requesten stoppades.',
    }
  }

  return { stage: 'queued_for_outbound', label: 'Oklassificerad', reason: 'Kunde inte fastställa livscykel tydligt.' }
}

export function explainWhySwitchIsStuck(params: {
  request: SupplierSwitchRequestRow
  readiness?: SwitchReadinessResult | null
  outboundRequest?: OutboundRequestRow | null
}): string {
  const { request, readiness, outboundRequest } = params

  if (['failed', 'rejected'].includes(request.status)) {
    return request.failure_reason ?? 'Switchärendet har felstatus.'
  }

  if (request.status === 'accepted') {
    return getSupplierSwitchActivationReadiness(request).reason
  }

  if (readiness && !readiness.isReady) {
    return `Readiness blockerar: ${summarizeReadinessIssues(readiness)}`
  }

  if (!outboundRequest) return 'Switchen saknar outbound PRODAT Z03 och har därför inte dispatchats.'
  if (outboundRequest.channel_type === 'unresolved') return 'Outbound saknar route/kanal och kan inte dispatchas.'
  if (['queued', 'prepared'].includes(outboundRequest.status)) return 'PRODAT Z03 väntar fortfarande på dispatch.'
  if (outboundRequest.status === 'sent') return 'PRODAT Z03 är skickad och väntar på transport-/applikationskvittens.'
  if (outboundRequest.status === 'failed' || outboundRequest.status === 'cancelled') {
    return outboundRequest.failure_reason ?? 'Outbound-dispatchen misslyckades och behöver retry eller manuell åtgärd.'
  }
  if (outboundRequest.status === 'acknowledged') {
    return 'Transport/applikation är kvitterad. Inbound PRODAT Z04 från nätägaren krävs fortfarande innan bytet är affärsmässigt bekräftat.'
  }
  return 'Ingen tydlig blockerare kunde fastställas.'
}

export function summarizeDispatchAttempt(
  outboundRequest: OutboundRequestRow | null | undefined
): string {
  if (!outboundRequest) {
    return 'Inget dispatchförsök ännu.'
  }

  if (outboundRequest.failed_at) {
    return `Senaste försök misslyckades ${outboundRequest.failed_at}. Försök: ${outboundRequest.attempts_count}.`
  }

  if (outboundRequest.acknowledged_at) {
    return `Kvitterad ${outboundRequest.acknowledged_at}. Försök: ${outboundRequest.attempts_count}.`
  }

  if (outboundRequest.sent_at) {
    return `Skickad ${outboundRequest.sent_at}. Försök: ${outboundRequest.attempts_count}.`
  }

  if (outboundRequest.prepared_at) {
    return `Förberedd ${outboundRequest.prepared_at}. Försök: ${outboundRequest.attempts_count}.`
  }

  return `Köad ${outboundRequest.queued_at}. Försök: ${outboundRequest.attempts_count}.`
}

export function getBillingExportReadiness(params: {
  underlay: BillingUnderlayRow
  existingExport?: PartnerExportRow | null
}): {
  isReady: boolean
  label: string
  reason: string
} {
  const { underlay, existingExport } = params

  if (existingExport) {
    return {
      isReady: false,
      label: 'Export finns',
      reason: `Partner-export finns redan i status ${existingExport.status}.`,
    }
  }

  if (!['received', 'validated'].includes(underlay.status)) {
    return {
      isReady: false,
      label: 'Ej redo',
      reason:
        'Billing-underlag måste vara mottaget eller validerat innan export.',
    }
  }

  return {
    isReady: true,
    label: 'Redo för export',
    reason: 'Underlaget kan skickas vidare till partner.',
  }
}