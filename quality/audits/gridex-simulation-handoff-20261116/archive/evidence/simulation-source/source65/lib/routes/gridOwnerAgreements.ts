import { supabaseService } from '@/lib/supabase/service'
import type { RouteScope } from '@/lib/routes/routeDecisionTypes'

export type GridOwnerAccessAgreementStatus = 'draft' | 'active' | 'expired' | 'blocked' | 'archived'

export type GridOwnerAccessAgreementRow = {
  id: string
  company_id: string | null
  grid_owner_id: string | null
  agreement_type: string
  agreement_scope: string
  status: GridOwnerAccessAgreementStatus | string
  agreement_reference: string | null
  external_agreement_number: string | null
  valid_from: string | null
  valid_to: string | null
  signed_at: string | null
  document_id: string | null
  document_path: string | null
  requires_customer_authorization: boolean
  requires_metering_point_id: boolean
  requires_facility_id: boolean
  requires_customer_personal_number: boolean
  requires_report_period: boolean
  preferred_application_reference: string | null
  preferred_message_version: string | null
  preferred_receiver_ediel_id: string | null
  preferred_receiver_sub_address: string | null
  preferred_route_id: string | null
  reference_requirements: Record<string, unknown>
  metadata: Record<string, unknown>
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type GridOwnerAccessAgreementInput = {
  id?: string | null
  companyId?: string | null
  gridOwnerId?: string | null
  agreementType: string
  agreementScope: RouteScope | string
  status: GridOwnerAccessAgreementStatus | string
  agreementReference?: string | null
  externalAgreementNumber?: string | null
  validFrom?: string | null
  validTo?: string | null
  signedAt?: string | null
  documentId?: string | null
  documentPath?: string | null
  requiresCustomerAuthorization?: boolean
  requiresMeteringPointId?: boolean
  requiresFacilityId?: boolean
  requiresCustomerPersonalNumber?: boolean
  requiresReportPeriod?: boolean
  preferredApplicationReference?: string | null
  preferredMessageVersion?: string | null
  preferredReceiverEdielId?: string | null
  preferredReceiverSubAddress?: string | null
  preferredRouteId?: string | null
  referenceRequirements?: Record<string, unknown>
  metadata?: Record<string, unknown>
  actorUserId?: string | null
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isAgreementActiveForDate(
  agreement: Pick<GridOwnerAccessAgreementRow, 'status' | 'valid_from' | 'valid_to'>,
  atDate = todayDateOnly()
): boolean {
  if (agreement.status !== 'active') return false
  if (agreement.valid_from && agreement.valid_from > atDate) return false
  if (agreement.valid_to && agreement.valid_to < atDate) return false
  return true
}

export async function listGridOwnerAccessAgreements(options: {
  companyId?: string | null
  gridOwnerId?: string | null
  agreementScope?: string | null
  status?: string | null
  limit?: number
} = {}): Promise<GridOwnerAccessAgreementRow[]> {
  let query = supabaseService
    .from('grid_owner_access_agreements')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(options.limit ?? 200)

  if (options.companyId) query = query.eq('company_id', options.companyId)
  if (options.gridOwnerId) query = query.eq('grid_owner_id', options.gridOwnerId)
  if (options.agreementScope && options.agreementScope !== 'all') {
    query = query.eq('agreement_scope', options.agreementScope)
  }
  if (options.status && options.status !== 'all') query = query.eq('status', options.status)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as GridOwnerAccessAgreementRow[]
}

export async function getGridOwnerAccessAgreementById(
  id: string,
  companyId?: string | null
): Promise<GridOwnerAccessAgreementRow | null> {
  let query = supabaseService
    .from('grid_owner_access_agreements')
    .select('*')
    .eq('id', id)

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return (data as GridOwnerAccessAgreementRow | null) ?? null
}

export async function findActiveGridOwnerAccessAgreement(options: {
  companyId: string
  gridOwnerId: string
  agreementScope: RouteScope | string
  atDate?: string | null
}): Promise<{
  status: 'none' | 'single' | 'multiple'
  agreement: GridOwnerAccessAgreementRow | null
  matches: GridOwnerAccessAgreementRow[]
}> {
  const atDate = options.atDate ?? todayDateOnly()
  const rows = await listGridOwnerAccessAgreements({
    companyId: options.companyId,
    gridOwnerId: options.gridOwnerId,
    agreementScope: options.agreementScope,
    status: 'active',
    limit: 50,
  })

  const active = rows.filter((row) => isAgreementActiveForDate(row, atDate))

  if (active.length === 0) return { status: 'none', agreement: null, matches: [] }
  if (active.length > 1) return { status: 'multiple', agreement: null, matches: active }
  return { status: 'single', agreement: active[0], matches: active }
}

export async function saveGridOwnerAccessAgreement(
  input: GridOwnerAccessAgreementInput
): Promise<GridOwnerAccessAgreementRow> {
  const payload = {
    company_id: input.companyId ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    agreement_type: input.agreementType,
    agreement_scope: input.agreementScope,
    status: input.status,
    agreement_reference: normalizeText(input.agreementReference),
    external_agreement_number: normalizeText(input.externalAgreementNumber),
    valid_from: normalizeText(input.validFrom),
    valid_to: normalizeText(input.validTo),
    signed_at: normalizeText(input.signedAt),
    document_id: normalizeText(input.documentId),
    document_path: normalizeText(input.documentPath),
    requires_customer_authorization: input.requiresCustomerAuthorization ?? true,
    requires_metering_point_id: input.requiresMeteringPointId ?? true,
    requires_facility_id: input.requiresFacilityId ?? false,
    requires_customer_personal_number: input.requiresCustomerPersonalNumber ?? false,
    requires_report_period: input.requiresReportPeriod ?? false,
    preferred_application_reference: normalizeText(input.preferredApplicationReference),
    preferred_message_version: normalizeText(input.preferredMessageVersion),
    preferred_receiver_ediel_id: normalizeText(input.preferredReceiverEdielId),
    preferred_receiver_sub_address: normalizeText(input.preferredReceiverSubAddress),
    preferred_route_id: normalizeText(input.preferredRouteId),
    reference_requirements: input.referenceRequirements ?? {},
    metadata: input.metadata ?? {},
    updated_by: input.actorUserId ?? null,
  }

  if (input.id) {
    const { data, error } = await supabaseService
      .from('grid_owner_access_agreements')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single()

    if (error) throw error
    return data as GridOwnerAccessAgreementRow
  }

  const { data, error } = await supabaseService
    .from('grid_owner_access_agreements')
    .insert({ ...payload, created_by: input.actorUserId ?? null })
    .select('*')
    .single()

  if (error) throw error
  return data as GridOwnerAccessAgreementRow
}

export async function archiveGridOwnerAccessAgreement(input: {
  id: string
  actorUserId?: string | null
}): Promise<void> {
  const { error } = await supabaseService
    .from('grid_owner_access_agreements')
    .update({ status: 'archived', updated_by: input.actorUserId ?? null })
    .eq('id', input.id)

  if (error) throw error
}
