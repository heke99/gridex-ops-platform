import { createHash, randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

export type CanonicalOnboardingChannel =
  | 'admin'
  | 'website'
  | 'external_contract'
  | 'ediel_inbound'
  | 'api'
  | 'import'
  | 'repair'

export type CanonicalMatchingPolicy =
  | 'link_unique'
  | 'create_only'
  | 'create_separate'
  | 'link_selected'

export type CanonicalOnboardingCommand = {
  company_id: string
  actor_user_id?: string | null
  channel: CanonicalOnboardingChannel
  idempotency_key: string
  correlation_id?: string
  matching_policy?: CanonicalMatchingPolicy
  existing_customer_id?: string | null
  existing_site_id?: string | null
  existing_metering_point_id?: string | null
  update_existing?: boolean
  customer: Record<string, unknown>
  contact?: Record<string, unknown> | null
  address?: Record<string, unknown> | null
  site?: Record<string, unknown> | null
  metering_point?: Record<string, unknown> | null
  contract?: Record<string, unknown> | null
  price_snapshot?: Record<string, unknown> | null
  legal?: Record<string, unknown> | null
  quote?: Record<string, unknown> | null
  power_of_attorney?: Record<string, unknown> | null
  authorization_document?: Record<string, unknown> | null
  application?: Record<string, unknown> | null
  task?: Record<string, unknown> | null
  info_request?: Record<string, unknown> | null
  /** Integration tests only; DB requires gridex.allow_test_failpoints=on. */
  test_fail_after?: 'customer' | 'site' | 'complete'
}

export type CanonicalOnboardingSuccess = {
  ok: true
  code: 'customer_onboarding_committed'
  operation_id: string
  correlation_id: string
  customer_id: string
  customer_number: string
  created_new_customer: boolean
  contact_id: string | null
  address_id: string | null
  site_id: string | null
  metering_point_id: string | null
  contract_id: string | null
  contract_number: string | null
  price_snapshot_id: string | null
  power_of_attorney_id: string | null
  authorization_document_id: string | null
  authorization_scope_id: string | null
  legal_snapshot_id: string | null
  application_id: string
  task_id: string | null
  info_request_id: string | null
  outbox_event_id: string
}

export type CanonicalOnboardingAmbiguous = {
  ok: false
  code: 'ambiguous_customer_match'
  operation_id: string
  correlation_id: string
  candidate_customer_ids: string[]
}

export type CanonicalOnboardingResult =
  | CanonicalOnboardingSuccess
  | CanonicalOnboardingAmbiguous

export class CanonicalOnboardingError extends Error {
  readonly code: string
  readonly correlationId: string
  readonly causeValue: unknown

  constructor(input: {
    code: string
    message: string
    correlationId: string
    cause?: unknown
  }) {
    super(input.message)
    this.name = 'CanonicalOnboardingError'
    this.code = input.code
    this.correlationId = input.correlationId
    this.causeValue = input.cause
  }
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dbErrorCode(error: unknown): string {
  const record = error as { code?: unknown; message?: unknown } | null
  const message = clean(record?.message)?.toLowerCase() ?? ''
  if (message.includes('customer_number_assignment_failed')) return 'customer_number_assignment_failed'
  if (message.includes('facility_id_owned_by_another_customer')) return 'facility_identity_conflict'
  if (message.includes('metering_point_owned_by_another_customer')) return 'metering_point_identity_conflict'
  if (message.includes('canonical onboarding')) return 'canonical_onboarding_invalid_command'
  if (['PGRST202', '42883'].includes(String(record?.code ?? ''))) return 'canonical_onboarding_rpc_missing'
  return clean(record?.code) ?? 'canonical_onboarding_failed'
}

export function canonicalIdempotencyKey(input: {
  channel: CanonicalOnboardingChannel
  companyId: string
  sourceId?: string | null
  identityParts?: Array<string | null | undefined>
}): string {
  const sourceId = clean(input.sourceId)
  if (sourceId) return `${input.channel}:${sourceId}`
  const digest = createHash('sha256')
    .update(
      [input.channel, input.companyId, ...(input.identityParts ?? [])]
        .map((part) => clean(part) ?? '')
        .join('|'),
    )
    .digest('hex')
  return `${input.channel}:${digest}`
}

function validateCommand(command: CanonicalOnboardingCommand) {
  if (!clean(command.company_id)) throw new Error('company_id_required')
  if (!clean(command.idempotency_key)) throw new Error('idempotency_key_required')
  if (!command.customer || typeof command.customer !== 'object') throw new Error('customer_payload_required')
}

export async function onboardCustomerGraph(
  input: CanonicalOnboardingCommand,
): Promise<CanonicalOnboardingResult> {
  const correlationId = clean(input.correlation_id) ?? randomUUID()
  const command: CanonicalOnboardingCommand = {
    ...input,
    correlation_id: correlationId,
    matching_policy: input.matching_policy ?? 'link_unique',
  }

  try {
    validateCommand(command)
  } catch (error) {
    throw new CanonicalOnboardingError({
      code: error instanceof Error ? error.message : 'canonical_onboarding_invalid_command',
      message: 'Kundregistreringen saknar obligatoriska uppgifter.',
      correlationId,
      cause: error,
    })
  }

  const { data, error } = await supabaseService.rpc('gridex_onboard_customer_graph', {
    p_command: command,
  })

  if (error) {
    const code = dbErrorCode(error)
    throw new CanonicalOnboardingError({
      code,
      message: `${clean((error as { message?: unknown } | null)?.message) ?? 'Kundregistreringen misslyckades.'} Referens: ${correlationId}.`,
      correlationId,
      cause: error,
    })
  }

  const result = (Array.isArray(data) ? data[0] : data) as CanonicalOnboardingResult | null
  if (!result || typeof result !== 'object' || !clean(result.code)) {
    throw new CanonicalOnboardingError({
      code: 'canonical_onboarding_invalid_response',
      message: `Kundregistreringen returnerade inget verifierbart resultat. Referens: ${correlationId}.`,
      correlationId,
      cause: data,
    })
  }

  if (result.ok) {
    if (!clean(result.customer_id) || !clean(result.customer_number) || !clean(result.operation_id)) {
      throw new CanonicalOnboardingError({
        code: 'canonical_onboarding_incomplete_response',
        message: `Kundregistreringen saknar permanent kundnummer eller kärnidentitet. Referens: ${correlationId}.`,
        correlationId,
        cause: result,
      })
    }
  }

  return result
}

export function signedAuthorizationScopes(input: {
  gridOwnerData?: boolean
  currentSupplierContract?: boolean
  meteringData?: boolean
}): string[] {
  const scopes: string[] = []
  if (input.gridOwnerData) scopes.push('grid_owner_data')
  if (input.currentSupplierContract) scopes.push('current_supplier_contract')
  if (input.meteringData) scopes.push('metering_data')
  return scopes
}


export type CustomerMatchResolution = {
  ok: true
  case_id: string
  operation_id: string
  company_id: string
  resolution_type: 'link_customer' | 'create_separate'
  resolved_customer_id: string | null
}

export async function resolveCustomerMatchReviewCase(input: {
  caseId: string
  resolutionType: 'link_customer' | 'create_separate'
  selectedCustomerId?: string | null
  actorUserId: string
  resolutionNote?: string | null
}): Promise<CustomerMatchResolution> {
  const { data, error } = await supabaseService.rpc('gridex_resolve_customer_match_review_case', {
    p_case_id: input.caseId,
    p_resolution_type: input.resolutionType,
    p_selected_customer_id: input.resolutionType === 'link_customer' ? input.selectedCustomerId ?? null : null,
    p_actor_user_id: input.actorUserId,
    p_resolution_note: input.resolutionNote ?? null,
  })
  if (error) {
    throw new CanonicalOnboardingError({
      code: dbErrorCode(error),
      message: clean((error as { message?: unknown } | null)?.message) ?? 'Kundmatchningen kunde inte lösas.',
      correlationId: randomUUID(),
      cause: error,
    })
  }
  const result = (Array.isArray(data) ? data[0] : data) as CustomerMatchResolution | null
  if (!result?.ok || !clean(result.case_id) || !clean(result.operation_id)) {
    throw new CanonicalOnboardingError({
      code: 'customer_match_resolution_invalid_response',
      message: 'Kundmatchningen returnerade inget verifierbart beslut.',
      correlationId: randomUUID(),
      cause: data,
    })
  }
  return result
}
