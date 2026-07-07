import type { CustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import type { CustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'
import type { EdielDispatchStateResult } from '@/lib/ediel/intent/dispatchState'

export type TenantCustomerTab =
  | 'overview'
  | 'legal-readiness'
  | 'sites'
  | 'switch-operations'
  | 'billing-metering'
  | 'notes'

export type TenantCustomerProcessStatus = 'done' | 'current' | 'waiting' | 'blocked'

export type TenantCustomerCardView = {
  processSteps: Array<{
    id: string
    label: string
    status: TenantCustomerProcessStatus
    explanation: string
  }>
  primaryAction: {
    id: string
    label: string
    kind?: 'customer_data' | 'supplier_switch'
    enabled: boolean
    reason?: string | null
  } | null
  statusCards: Array<{
    label: string
    value: string
    description: string
    targetTab?: TenantCustomerTab
  }>
  blockers: string[]
}

function stepStatus(isDone: boolean, isCurrent: boolean, isBlocked = false): TenantCustomerProcessStatus {
  if (isBlocked) return 'blocked'
  if (isDone) return 'done'
  if (isCurrent) return 'current'
  return 'waiting'
}

export function buildTenantCustomerCardView(params: {
  snapshot: CustomerCardSnapshot
  workflow: CustomerCardWorkflow
  dispatchState?: EdielDispatchStateResult | null
}): TenantCustomerCardView {
  const { snapshot, workflow } = params
  const isBlocked = workflow.primaryAction === 'review_blocker'
  // A facility lookup is only "sent / waiting for grid owner" when a real
  // outbox/message dispatch exists. ready_to_send / queued is pre-send.
  const dispatchSent =
    (params.dispatchState ? params.dispatchState.state === 'sent' : false) ||
    workflow.primaryAction === 'wait_for_grid_owner'
  const facilityInProgress = [
    'request_data',
    'continue_data_request',
    'approve_and_send',
    'dispatch_in_progress',
    'wait_for_grid_owner',
  ].includes(workflow.primaryAction)

  const legalDone = snapshot.hasAuthorization && snapshot.hasContract
  const facilityDone = snapshot.hasFacilityId && snapshot.hasMeteringPoint && snapshot.hasGridOwner

  return {
    processSteps: [
      {
        id: 'customer',
        label: 'Kund mottagen',
        status: 'done',
        explanation: 'Ansökan är mottagen och kunden är skapad.',
      },
      {
        id: 'legal',
        label: 'Avtal och fullmakt',
        status: stepStatus(legalDone, workflow.primaryAction === 'request_data'),
        explanation: legalDone
          ? 'Avtal och fullmakt är klara.'
          : 'Avtal och signerad fullmakt behöver vara klara innan nästa steg.',
      },
      {
        id: 'facility',
        label: 'Uppgifter från nätägare',
        status: stepStatus(facilityDone, facilityInProgress, isBlocked),
        explanation: facilityDone
          ? 'Anläggningsuppgifter finns.'
          : isBlocked
            ? workflow.blockerAdminMessage ?? 'Uppgifterna kan inte hämtas just nu. Se nästa steg.'
            : dispatchSent
              ? 'Vi väntar på svar från nätägaren.'
              : facilityInProgress
                ? 'Uppgifter begärs från nätägaren.'
                : 'Anläggningsuppgifter saknas ännu.',
      },
      {
        id: 'switch',
        label: 'Leverantörsbyte',
        status: stepStatus(false, workflow.primaryAction === 'create_supplier_switch'),
        explanation: workflow.primaryAction === 'create_supplier_switch'
          ? 'Allt underlag är klart. Leverantörsbytet kan startas.'
          : 'Leverantörsbyte kan inte starta förrän anläggningsuppgifter finns.',
      },
      {
        id: 'delivery',
        label: 'Leverans aktiv',
        status: 'waiting',
        explanation: 'Startar när leverantörsbytet är bekräftat.',
      },
      {
        id: 'billing',
        label: 'Fakturering',
        status: 'waiting',
        explanation: 'Startar automatiskt när leverans och mätvärden är klara.',
      },
    ],
    primaryAction:
      workflow.primaryAction === 'create_supplier_switch'
        ? {
            id: 'start_supplier_switch',
            label: 'Starta leverantörsbyte',
            kind: 'supplier_switch',
            enabled: true,
          }
        : ['request_data', 'continue_data_request', 'approve_and_send'].includes(workflow.primaryAction)
          ? {
              id: 'request_grid_owner_information',
              label: 'Hämta uppgifter från nätägare',
              kind: 'customer_data',
              enabled: true,
            }
          : workflow.primaryAction === 'dispatch_in_progress'
            ? {
                id: 'dispatch_in_progress',
                label: 'Köad för Ediel-sändning',
                enabled: false,
                reason: workflow.nextRequiredAction,
              }
            : workflow.primaryAction === 'wait_for_grid_owner'
              ? {
                  id: 'wait_for_grid_owner',
                  label: 'Väntar på svar från nätägare',
                  enabled: false,
                  reason: workflow.nextRequiredAction,
                }
              : null,
    statusCards: [
      {
        label: 'Avtal',
        value: snapshot.hasContract ? 'Klart' : 'Saknas',
        description: snapshot.hasContract ? 'Avtal finns på kunden.' : 'Avtal behöver finnas innan nästa steg.',
        targetTab: 'legal-readiness',
      },
      {
        label: 'Anläggning',
        value: snapshot.hasMeteringPoint
          ? 'Klar'
          : dispatchSent
            ? 'Väntar på nätägare'
            : facilityInProgress
              ? 'Hämtas'
              : 'Saknas',
        description: snapshot.hasMeteringPoint ? 'Anläggningsuppgifter finns.' : 'Systemet hämtar uppgifter från nätägaren när route och fullmakt är klara.',
        targetTab: 'sites',
      },
      {
        label: 'Leverantörsbyte',
        value: workflow.primaryAction === 'create_supplier_switch' ? 'Redo' : 'Inte startat',
        description: 'Startas när kundens uppgifter är klara.',
        targetTab: 'switch-operations',
      },
      {
        label: 'Fakturering',
        value: 'Automatisk',
        description: 'Startar när leverans och mätvärden är klara.',
        targetTab: 'billing-metering',
      },
    ],
    blockers: snapshot.switchBlockerLabels,
  }
}
