import type { CustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'
import type { CustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import {
  buildCustomerStatusCards,
  buildCustomerVisibleActions,
  customerActionStatusLabel,
  type CustomerVisibleAction,
  type CustomerStatusCard,
} from '@/lib/customer-operations/customerActionRegistry'

export type CustomerBusinessActionVisibility = 'tenant' | 'superadmin'

export type CustomerBusinessActionItem = CustomerVisibleAction & {
  primary: boolean
  showToTenant: boolean
  requiresTechnicalPanel: boolean
}

export function buildCustomerBusinessActionPlan(input: {
  workflow: CustomerCardWorkflow
  snapshot: CustomerCardSnapshot
  visibility?: CustomerBusinessActionVisibility
}): CustomerBusinessActionItem[] {
  return buildCustomerVisibleActions({
    workflow: input.workflow,
    snapshot: input.snapshot,
    isPlatformAdmin: input.visibility === 'superadmin',
  }).map((action) => ({
    ...action,
    primary: action.priority === 'primary',
    showToTenant: action.priority !== 'hidden',
    requiresTechnicalPanel: false,
  }))
}

export function buildCustomerBusinessStatusCards(input: {
  workflow: CustomerCardWorkflow
  snapshot: CustomerCardSnapshot
}): CustomerStatusCard[] {
  return buildCustomerStatusCards(input)
}

export function tenantBusinessActionStatusLabel(status: CustomerBusinessActionItem['status']) {
  return customerActionStatusLabel(status)
}
