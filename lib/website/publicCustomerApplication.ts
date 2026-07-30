import { publicReference } from '@/lib/integrations/publicReferences'

const PUBLIC_SCALAR_FIELDS = [
  'customer_number',
  'application_number',
  'external_customer_id',
  'external_customer_reference',
  'contract_number',
  'contract_status',
  'offer_reference',
  'quote_reference',
  'quote_valid_until',
  'quote_bound',
  'price_option_reference',
  'area_price_reference',
  'invoice_delivery_method',
  'site_count',
  'energy_direction',
  'status',
  'created_customer',
  'next_step',
  'requested_start_date',
  'confirmed_start_date',
  'actual_start_date',
  'requested_start_mode',
  'calculated_earliest_start_date',
  'grid_area_code',
  'price_area_code',
  'resolution_status',
  'resolution_confidence',
  'grid_owner_verification_status',
  'can_request_grid_owner_information',
  'can_send_agreement_confirmation',
  'can_activate_customer',
  'signed_at',
  'withdrawal_deadline_at',
  'signature_snapshot_sha256',
  'workflow_state',
] as const

const PUBLIC_ARRAY_FIELDS = [
  'missing_fields',
  'blocking_reasons',
  'grid_owner_verification_issues',
  'selected_component_references',
  'mandatory_component_references',
  'conditional_component_references',
  'warnings',
] as const

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function publicStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function publicNextAction(value: unknown): Record<string, unknown> | null {
  const input = record(value)
  if (!input) return null
  const code = text(input.code)
  const message = text(input.message)
  if (!code && !message) return null
  return {
    code,
    message,
  }
}

function publicCommunicationItem(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return { code: value }
  const input = record(value)
  if (!input) return null
  const output: Record<string, unknown> = {}
  for (const key of ['event_type', 'code', 'status', 'message', 'occurred_at']) {
    const item = text(input[key])
    if (item) output[key] = item
  }
  return Object.keys(output).length > 0 ? output : null
}

function publicCommunication(value: unknown): Record<string, unknown> | null {
  const input = record(value)
  if (!input) return null
  const output: Record<string, unknown> = {
    pending: input.pending === true,
    source_of_truth: text(input.source_of_truth) ?? 'communication_logs',
  }
  for (const key of ['triggered', 'queued', 'sent', 'failed']) {
    output[key] = Array.isArray(input[key])
      ? input[key].map(publicCommunicationItem).filter(Boolean)
      : []
  }
  return output
}

function publicSupplierSwitch(input: Record<string, unknown>): Record<string, unknown> {
  const requestId = text(input.supplier_switch_request_id)
  const canCreate = input.can_start_switch === true && !requestId
  const blockers = publicStringArray(input.blocking_reasons)
  return {
    request_id: requestId,
    status: requestId ? 'created' : 'not_created',
    can_create_request: canCreate,
    // Dispatch requires customer-specific POA, route, certificate and business
    // readiness. The application intake response must never infer it.
    can_dispatch: false,
    blockers,
    next_action: requestId
      ? 'await_supplier_switch_processing'
      : canCreate
        ? 'create_supplier_switch_request'
        : 'resolve_switch_blockers',
  }
}

/**
 * Explicit external DTO for website application responses.
 *
 * The canonical intake keeps internal IDs in its durable snapshot for
 * operations and repair. The HTTP boundary exposes only documented,
 * tenant-bound public resource IDs and business state.
 */
export function publicWebsiteCustomerApplicationData(
  value: unknown,
  companyId?: string,
): Record<string, unknown> {
  const input = record(value) ?? {}
  const output: Record<string, unknown> = {}
  for (const key of PUBLIC_SCALAR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = input[key] ?? null
  }
  for (const key of PUBLIC_ARRAY_FIELDS) {
    output[key] = publicStringArray(input[key])
  }
  if (companyId) {
    const references = [
      ['customer_reference', 'customer', input.customer_id],
      ['application_reference', 'application', input.application_id],
      ['facility_reference', 'facility', input.customer_site_id ?? input.site_id],
      ['metering_point_reference', 'metering_point', input.metering_point_id],
      ['contract_reference', 'contract', input.contract_id],
    ] as const
    for (const [field, kind, id] of references) {
      if (text(id)) output[field] = publicReference(kind, companyId, id)
    }
  }

  const nextAction = publicNextAction(input.next_action)
  if (nextAction) output.next_action = nextAction
  const communication = publicCommunication(input.communication)
  if (communication) output.communication = communication
  output.supplier_switch = publicSupplierSwitch(input)

  if (text(input.power_of_attorney_id)) {
    output.power_of_attorney = { status: 'signed' }
  } else if (publicStringArray(input.missing_fields).includes('power_of_attorney')) {
    output.power_of_attorney = { status: 'missing' }
  }

  return output
}
