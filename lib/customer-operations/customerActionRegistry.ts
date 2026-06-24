import type { CustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import type { CustomerCardWorkflow, WorkflowPrimaryAction } from '@/lib/customer-operations/customerCardWorkflow'

export type CustomerVisibleActionStatus = 'available' | 'disabled' | 'waiting' | 'blocked'
export type CustomerVisibleActionPriority = 'primary' | 'secondary' | 'hidden'

export type CustomerVisibleAction = {
  id: string
  label: string
  description: string
  kind?: 'customer_data' | 'supplier_switch'
  targetTab?: 'overview' | 'legal-readiness' | 'sites' | 'switch-operations' | 'billing-metering' | 'notes'
  status: CustomerVisibleActionStatus
  reason?: string | null
  priority: CustomerVisibleActionPriority
}

export type CustomerStatusCard = {
  id: 'authorization' | 'facility' | 'supplier_switch' | 'billing'
  label: string
  value: string
  description: string
  tone: 'ok' | 'waiting' | 'blocked' | 'neutral'
  targetTab?: 'overview' | 'legal-readiness' | 'sites' | 'switch-operations' | 'billing-metering' | 'notes'
}

function actionFromPrimaryAction(action: WorkflowPrimaryAction, workflow: CustomerCardWorkflow): CustomerVisibleAction | null {
  switch (action) {
    case 'request_data':
    case 'continue_data_request':
    case 'approve_and_send':
      return {
        id: 'request_grid_owner_information',
        label: 'Begär uppgifter från nätägare',
        description: 'Systemet begär anläggnings- och nätägaruppgifter och hanterar tekniken i bakgrunden.',
        kind: 'customer_data',
        status: 'available',
        priority: 'primary',
      }
    case 'create_supplier_switch':
      return {
        id: 'start_supplier_switch',
        label: 'Starta leverantörsbyte',
        description: 'Starta bytet när uppgifter, avtal och fullmakt är klara.',
        kind: 'supplier_switch',
        status: 'available',
        priority: 'primary',
      }
    case 'wait_for_grid_owner':
      return {
        id: 'waiting_for_grid_owner',
        label: 'Väntar på svar från nätägare',
        description: workflow.nextRequiredAction ?? 'Ingen åtgärd krävs just nu. Systemet fortsätter när svar kommer in.',
        status: 'waiting',
        priority: 'primary',
      }
    case 'review_blocker':
      return {
        id: 'review_customer_blocker',
        label: 'Kräver åtgärd',
        description: workflow.blockerAdminMessage ?? workflow.nextRequiredAction ?? 'En uppgift behöver granskas innan processen kan fortsätta.',
        status: 'blocked',
        priority: 'primary',
      }
    case 'no_action_required':
      return {
        id: 'no_action_required',
        label: 'Ingen åtgärd krävs',
        description: workflow.adminMessage,
        status: 'waiting',
        priority: 'primary',
      }
    default:
      return null
  }
}

function switchStatus(workflow: CustomerCardWorkflow): CustomerStatusCard {
  const switchStep = workflow.workflowSteps.find((step) => step.id === 'next_step')
  if (switchStep?.explanation?.toLowerCase().includes('leverantörsbyte pågår')) {
    return {
      id: 'supplier_switch',
      label: 'Leverantörsbyte',
      value: 'Pågår',
      description: 'Bytet är startat och inväntar nästa svar eller bekräftelse.',
      tone: 'waiting',
      targetTab: 'switch-operations',
    }
  }
  if (workflow.primaryAction === 'create_supplier_switch') {
    return {
      id: 'supplier_switch',
      label: 'Leverantörsbyte',
      value: 'Redo att starta',
      description: 'Uppgifter finns. Starta leverantörsbyte när startdatum är valt.',
      tone: 'ok',
      targetTab: 'switch-operations',
    }
  }
  return {
    id: 'supplier_switch',
    label: 'Leverantörsbyte',
    value: 'Inte startat',
    description: 'Bytet startas när uppgifter och fullmakt är klara.',
    tone: 'neutral',
    targetTab: 'switch-operations',
  }
}

export function buildCustomerStatusCards(input: {
  workflow: CustomerCardWorkflow
  snapshot: CustomerCardSnapshot
}): CustomerStatusCard[] {
  const { workflow, snapshot } = input
  const hasFacility = snapshot.hasFacilityId && snapshot.hasGridOwner
  const blocker = workflow.primaryAction === 'review_blocker'

  return [
    {
      id: 'authorization',
      label: 'Avtal och fullmakt',
      value: snapshot.hasAuthorization && snapshot.hasContract ? 'Klart' : snapshot.hasAuthorization ? 'Fullmakt finns' : 'Saknas',
      description: snapshot.hasAuthorization
        ? 'Kunden har tillräckligt underlag för nästa steg.'
        : 'Signerad fullmakt eller komplett avtal behöver finnas innan externa steg startas.',
      tone: snapshot.hasAuthorization ? 'ok' : 'blocked',
      targetTab: 'legal-readiness',
    },
    {
      id: 'facility',
      label: 'Anläggning och nätägare',
      value: hasFacility ? 'Kontrolleras' : 'Saknas',
      description: hasFacility
        ? 'Anläggnings- och nätägaruppgifter finns på kundkortet.'
        : 'Systemet behöver uppgifter från nätägaren eller komplettering på kundkortet.',
      tone: hasFacility ? 'ok' : blocker ? 'blocked' : 'waiting',
      targetTab: 'sites',
    },
    switchStatus(workflow),
    {
      id: 'billing',
      label: 'Fakturering',
      value: 'Automatisk',
      description: 'Mätvärden tas emot och fakturaunderlag skapas automatiskt när perioden är komplett.',
      tone: 'neutral',
      targetTab: 'billing-metering',
    },
  ]
}

export function buildCustomerVisibleActions(input: {
  workflow: CustomerCardWorkflow
  snapshot: CustomerCardSnapshot
  isPlatformAdmin?: boolean
}): CustomerVisibleAction[] {
  const primary = actionFromPrimaryAction(input.workflow.primaryAction, input.workflow)
  const secondary: CustomerVisibleAction[] = [
    {
      id: 'view_contracts',
      label: 'Visa avtal och fullmakt',
      description: 'Öppna kundens juridiska underlag.',
      targetTab: 'legal-readiness',
      status: 'available',
      priority: 'hidden',
    },
    {
      id: 'view_facility',
      label: 'Visa anläggning och nätägare',
      description: 'Öppna kundens anläggningsstatus.',
      targetTab: 'sites',
      status: 'available',
      priority: 'hidden',
    },
    {
      id: 'view_billing',
      label: 'Visa fakturering',
      description: 'Öppna automatisk faktureringsstatus.',
      targetTab: 'billing-metering',
      status: 'available',
      priority: 'hidden',
    },
  ]

  return [...(primary ? [primary] : []), ...secondary]
}

export function customerActionStatusLabel(status: CustomerVisibleActionStatus): string {
  switch (status) {
    case 'available':
      return 'Redo'
    case 'disabled':
      return 'Ej tillgänglig'
    case 'waiting':
      return 'Väntar'
    case 'blocked':
      return 'Kräver åtgärd'
  }
}

export function customerStatusToneClass(tone: CustomerStatusCard['tone']): string {
  switch (tone) {
    case 'ok':
      return 'border-emerald-200 bg-emerald-50 text-emerald-950'
    case 'waiting':
      return 'border-amber-200 bg-amber-50 text-amber-950'
    case 'blocked':
      return 'border-red-200 bg-red-50 text-red-950'
    case 'neutral':
      return 'border-slate-200 bg-slate-50 text-slate-950'
  }
}
