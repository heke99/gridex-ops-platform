import type {
  BillingUnderlayRow,
  OutboundRequestRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type {
  SwitchReadinessResult,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'

export type SwitchLifecycleStage =
  | 'blocked'
  | 'queued_for_outbound'
  | 'awaiting_dispatch'
  | 'awaiting_response'
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
      reason:
        request.failure_reason ?? 'Switchärendet har stoppats eller avvisats.',
    }
  }

  if (request.status === 'completed') {
    return {
      stage: 'completed',
      label: 'Klar',
      reason: 'Switchärendet är slutfört.',
    }
  }

  if (readiness && !readiness.isReady) {
    return {
      stage: 'blocked',
      label: 'Blockerad',
      reason: summarizeReadinessIssues(readiness),
    }
  }

  if (!outboundRequest) {
    return {
      stage: 'queued_for_outbound',
      label: 'Redo att köa outbound',
      reason: 'Ärendet är redo men saknar outbound-request.',
    }
  }

  if (['queued', 'prepared'].includes(outboundRequest.status)) {
    return {
      stage: 'awaiting_dispatch',
      label: 'Väntar på dispatch',
      reason: 'Outbound finns men har inte skickats ännu.',
    }
  }

  if (outboundRequest.status === 'sent') {
    return {
      stage: 'awaiting_response',
      label: 'Väntar på svar',
      reason: 'Outbound är skickad men ännu inte kvitterad.',
    }
  }

  if (outboundRequest.status === 'acknowledged') {
    return {
      stage: 'ready_to_execute',
      label: 'Kvitterad',
      reason:
        'Outbound är kvitterad och väntar på nästa interna steg.',
    }
  }

  if (
    outboundRequest.status === 'failed' ||
    outboundRequest.status === 'cancelled'
  ) {
    return {
      stage: 'failed',
      label: 'Dispatch-fel',
      reason:
        outboundRequest.failure_reason ??
        'Outbound-requesten stoppades.',
    }
  }

  return {
    stage: 'queued_for_outbound',
    label: 'Oklassificerad',
    reason: 'Kunde inte fastställa livscykel tydligt.',
  }
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