import type { CustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import type { CustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'

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
}): TenantCustomerCardView {
  const { snapshot, workflow } = params
  const isBlocked = workflow.primaryAction === 'review_blocker'

  return {
    processSteps: [
      { id: 'customer', label: 'Kund mottagen', status: 'done' },
      {
        id: 'legal',
        label: 'Avtal och fullmakt',
        status: stepStatus(snapshot.hasAuthorization && snapshot.hasContract, workflow.primaryAction === 'request_data'),
      },
      {
        id: 'facility',
        label: 'Uppgifter från nätägare',
        status: stepStatus(snapshot.hasFacilityId && snapshot.hasMeteringPoint && snapshot.hasGridOwner, ['request_data', 'continue_data_request', 'approve_and_send', 'wait_for_grid_owner'].includes(workflow.primaryAction), isBlocked),
      },
      {
        id: 'switch',
        label: 'Leverantörsbyte',
        status: stepStatus(false, workflow.primaryAction === 'create_supplier_switch'),
      },
      { id: 'delivery', label: 'Leverans aktiv', status: 'waiting' },
      { id: 'billing', label: 'Fakturering', status: 'waiting' },
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
        value: snapshot.hasMeteringPoint ? 'Klar' : ['request_data', 'continue_data_request', 'approve_and_send', 'wait_for_grid_owner'].includes(workflow.primaryAction) ? 'Hämtas' : 'Saknas',
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
