import type { CustomerCardWorkflow, WorkflowPrimaryAction } from '@/lib/customer-operations/customerCardWorkflow'
import { GRIDEX_BUSINESS_PROCESSES, type GridexBusinessProcessKey } from '@/lib/customer-operations/businessProcesses'

export type CustomerBusinessActionVisibility = 'tenant' | 'superadmin'

export type CustomerBusinessActionItem = {
  id: GridexBusinessProcessKey
  label: string
  description: string
  status: 'available' | 'waiting' | 'blocked' | 'background' | 'superadmin_only'
  primary: boolean
  showToTenant: boolean
  requiresTechnicalPanel: boolean
}

function statusFromPrimaryAction(action: WorkflowPrimaryAction): CustomerBusinessActionItem['status'] {
  if (action === 'wait_for_grid_owner' || action === 'no_action_required') return 'waiting'
  if (action === 'review_blocker') return 'blocked'
  return 'available'
}

export function buildCustomerBusinessActionPlan(input: {
  workflow: CustomerCardWorkflow
  visibility?: CustomerBusinessActionVisibility
}): CustomerBusinessActionItem[] {
  const visibility = input.visibility ?? 'tenant'
  const primaryMap: Partial<Record<WorkflowPrimaryAction, GridexBusinessProcessKey>> = {
    request_data: 'grid_owner_information_request',
    continue_data_request: 'grid_owner_information_request',
    approve_and_send: 'grid_owner_information_request',
    wait_for_grid_owner: 'grid_owner_information_request',
    create_supplier_switch: 'supplier_switch',
    review_blocker: 'grid_owner_information_request',
  }
  const primaryKey = primaryMap[input.workflow.primaryAction] ?? 'grid_owner_information_request'

  const tenantKeys: GridexBusinessProcessKey[] = [
    'grid_owner_information_request',
    'supplier_switch',
    'supplier_switch_cancellation',
    'customer_move_out',
    'end_supply',
    'disconnection_case',
    'metering_values_ingestion',
    'monthly_billing_underlay',
    'billing_partner_export',
  ]

  return tenantKeys.map((key) => {
    const process = GRIDEX_BUSINESS_PROCESSES[key]
    const background = process.isBackgroundAutomation
    const primary = key === primaryKey && !background
    const status: CustomerBusinessActionItem['status'] = background
      ? 'background'
      : primary
        ? statusFromPrimaryAction(input.workflow.primaryAction)
        : 'available'
    return {
      id: key,
      label: process.tenantLabel,
      description: process.tenantDescription,
      status: visibility === 'tenant' && key === 'disconnection_case' ? status : status,
      primary,
      showToTenant: true,
      requiresTechnicalPanel: false,
    }
  })
}

export function tenantBusinessActionStatusLabel(status: CustomerBusinessActionItem['status']) {
  switch (status) {
    case 'available':
      return 'Tillgänglig'
    case 'waiting':
      return 'Väntar'
    case 'blocked':
      return 'Kräver åtgärd'
    case 'background':
      return 'Automatiskt'
    case 'superadmin_only':
      return 'Teknisk åtgärd'
  }
}
