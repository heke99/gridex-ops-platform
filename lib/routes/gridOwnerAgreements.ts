import 'server-only'
import { z } from 'zod'
import { isGridOwnerAgreementBucket, parseGridOwnerAgreementDocumentKey } from './gridOwnerAgreementDocumentKey'
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
  revision: number
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
  actor: { userId: string; sessionId: string }
  expectedRevision: number
  idempotencyKey: string
  newGridOwner?: { name: string; orgNumber: string | null; edielId: string | null; email: string | null; phone: string | null }
  documentFile?: { bucket: string; name: string; sha256: string; size: number; contentType: string }
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

export class GridOwnerAgreementCommandError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = 'GridOwnerAgreementCommandError' }
}
export type GridOwnerAgreementCommand = {
  operation: 'save' | 'archive'; actorUserId: string; sessionId: string; companyId: string | null;
  id?: string | null; expectedRevision: number; idempotencyKey: string; payload: Record<string, unknown>;
}
export type AgreementUploadIntent = { id: string; token: string; bucket: string; path: string }
export type GridOwnerAgreementResult = { agreement: GridOwnerAccessAgreementRow; changed: boolean; replayed: boolean; gridOwnerCreated: boolean }
const receiptSchema = z.object({
  agreement: z.object({ id: z.string().uuid(), company_id: z.string().uuid().nullable(), revision: z.number().int().nonnegative().safe() }).passthrough(),
  changed: z.boolean(), replayed: z.boolean(), gridOwnerCreated: z.boolean(),
}).passthrough()
const intentSchema = z.object({ id: z.string().uuid(), token: z.string().uuid(), bucket: z.string(), path: z.string() }).strict()

export function agreementSaveCommand(input: GridOwnerAccessAgreementInput): GridOwnerAgreementCommand {
  const payload = {
    gridOwnerId: input.gridOwnerId ?? null, agreementType: input.agreementType, agreementScope: input.agreementScope, status: input.status,
    agreementReference: normalizeText(input.agreementReference), externalAgreementNumber: normalizeText(input.externalAgreementNumber),
    validFrom: normalizeText(input.validFrom), validTo: normalizeText(input.validTo), signedAt: normalizeText(input.signedAt),
    documentId: normalizeText(input.documentId), documentPath: normalizeText(input.documentPath),
    requiresCustomerAuthorization: input.requiresCustomerAuthorization ?? true, requiresMeteringPointId: input.requiresMeteringPointId ?? true,
    requiresFacilityId: input.requiresFacilityId ?? false, requiresCustomerPersonalNumber: input.requiresCustomerPersonalNumber ?? false,
    requiresReportPeriod: input.requiresReportPeriod ?? false, preferredApplicationReference: normalizeText(input.preferredApplicationReference),
    preferredMessageVersion: normalizeText(input.preferredMessageVersion), preferredReceiverEdielId: normalizeText(input.preferredReceiverEdielId),
    preferredReceiverSubAddress: normalizeText(input.preferredReceiverSubAddress), preferredRouteId: normalizeText(input.preferredRouteId),
    referenceRequirements: input.referenceRequirements ?? {}, metadata: input.metadata ?? {},
    ...(input.newGridOwner ? { newGridOwner: input.newGridOwner } : {}), ...(input.documentFile ? { documentFile: input.documentFile } : {}),
  }
  return { operation: 'save', actorUserId: input.actor.userId, sessionId: input.actor.sessionId, companyId: input.companyId ?? null,
    id: input.id ?? null, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, payload }
}

async function callAgreementCommand(command: Record<string, unknown>) {
  const { data, error } = await supabaseService.rpc('gridex_grid_owner_agreement_command_v1', { p_command: command })
  if (error) {
    if (['42883','42P01','42703','PGRST202','PGRST204','PGRST205'].includes(error.code)) throw new GridOwnerAgreementCommandError('agreement_schema_unavailable', 503)
    if (error.code === '42501') throw new GridOwnerAgreementCommandError('agreement_actor_forbidden', 403)
    if (error.code === 'PT409') throw new GridOwnerAgreementCommandError('agreement_command_conflict', 409)
    if (error.code === 'PT404') throw new GridOwnerAgreementCommandError('agreement_resource_unavailable', 404)
    if (['22023','22P02','22007','22008','23502','23514'].includes(error.code)) throw new GridOwnerAgreementCommandError('invalid_agreement_command', 422)
    throw new GridOwnerAgreementCommandError('agreement_unavailable', 503)
  }
  return data
}
function verifiedResult(data: unknown, command: GridOwnerAgreementCommand): GridOwnerAgreementResult {
  const parsed = receiptSchema.safeParse(data)
  if (!parsed.success || parsed.data.agreement.company_id !== command.companyId ||
    (command.id && parsed.data.agreement.id !== command.id)) throw new GridOwnerAgreementCommandError('agreement_invalid_receipt', 503)
  return parsed.data as GridOwnerAgreementResult
}
function verifiedIntent(data: unknown, bucket: string): AgreementUploadIntent {
  const parsed = intentSchema.safeParse(data)
  if (!parsed.success || parsed.data.bucket !== bucket || !isGridOwnerAgreementBucket(bucket) || bucket === 'customer-support-quarantine' ||
    !parseGridOwnerAgreementDocumentKey(parsed.data.path, bucket)) throw new GridOwnerAgreementCommandError('agreement_invalid_receipt', 503)
  return parsed.data
}
export async function prepareAgreementDocumentUpload(command: GridOwnerAgreementCommand, bucket: string): Promise<{ intent?: AgreementUploadIntent; committed?: GridOwnerAgreementResult }> {
  const data = await callAgreementCommand({ ...command, operation: 'prepare_upload' }) as { intent?: unknown; committed?: unknown }
  if (data?.committed) return { committed: verifiedResult(data.committed, command) }
  return { intent: verifiedIntent(data?.intent, bucket) }
}
export async function executeAgreementCommand(command: GridOwnerAgreementCommand, intent?: AgreementUploadIntent): Promise<GridOwnerAgreementResult> {
  const data = await callAgreementCommand({ ...command, ...(intent ? { uploadIntentId: intent.id, cleanupToken: intent.token } : {}) })
  return verifiedResult(data, command)
}
export async function reconcileAgreementUpload(command: GridOwnerAgreementCommand, intent: AgreementUploadIntent) {
  const data = await callAgreementCommand({ ...command, operation: 'abort_upload', uploadIntentId: intent.id, cleanupToken: intent.token }) as { committed?: unknown; cleanup?: unknown }
  const committed = data?.committed ? verifiedResult(data.committed, command) : undefined
  const cleanup = data?.cleanup ? verifiedIntent(data.cleanup, intent.bucket) : undefined
  if (cleanup && (cleanup.id !== intent.id || cleanup.token !== intent.token || cleanup.path !== intent.path)) throw new GridOwnerAgreementCommandError('agreement_invalid_receipt', 503)
  return { committed, cleanup }
}
export async function completeAgreementUploadCleanup(command: GridOwnerAgreementCommand, intent: AgreementUploadIntent) {
  const data = await callAgreementCommand({ ...command, operation: 'cleanup_complete', uploadIntentId: intent.id, cleanupToken: intent.token }) as { cleaned?: unknown }
  if (data?.cleaned !== true) throw new GridOwnerAgreementCommandError('agreement_invalid_receipt', 503)
}
export async function saveGridOwnerAccessAgreement(input: GridOwnerAccessAgreementInput): Promise<GridOwnerAccessAgreementRow> {
  return (await executeAgreementCommand(agreementSaveCommand(input))).agreement
}
export async function archiveGridOwnerAccessAgreement(input: {
  id: string; companyId: string | null; actor: { userId: string; sessionId: string }; expectedRevision: number; idempotencyKey: string;
}): Promise<void> {
  await executeAgreementCommand({ operation: 'archive', actorUserId: input.actor.userId, sessionId: input.actor.sessionId,
    companyId: input.companyId, id: input.id, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, payload: {} })
}
