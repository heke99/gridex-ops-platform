import { createHash } from 'node:crypto'
import { ApiInputError } from '@/lib/api/strictRequest'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { supabaseService } from '@/lib/supabase/service'
import { publicReference } from '@/lib/integrations/publicReferences'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import type { CustomerCaseRow } from '@/lib/customer-cases/types'
import { buildPortalDatabasePage, decodePortalCursor, portalPageLimit } from '@/lib/customer-portal/keysetPagination'
import type { SupportAttachmentRow } from '@/lib/customer-service/supportAttachments'

export const STAFF_CASE_STATUSES = ['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'] as const
export const STAFF_CASE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const CASE_FIELDS = 'id,company_id,customer_id,status,priority,title,description,reason_category,assigned_to,source,metadata,created_at,updated_at,resolved_at,closed_at'
const STAFF_EVENT_TYPES = ['created', 'status_changed', 'assigned', 'support_customer_message', 'support_staff_reply', 'support_internal_note', 'support_phone_interaction']
type StaffCaseRow = Pick<CustomerCaseRow, 'id' | 'company_id' | 'customer_id' | 'status' | 'priority' | 'title' | 'description' | 'reason_category' | 'assigned_to' | 'source' | 'metadata' | 'created_at' | 'updated_at' | 'resolved_at' | 'closed_at'>
export type StaffCaseActor = { companyId: string; actorUserId: string; apiClientId: string }
type StaffEvent = { id: string; event_type: string; message: string; payload: Record<string, unknown> | null; created_by: string | null; created_at: string }

export function staffCaseDto(row: StaffCaseRow) {
  return {
    case_reference: publicReference('support_case', row.company_id, row.id),
    customer_reference: publicReference('customer', row.company_id, row.customer_id),
    title: row.title, description: row.description, status: row.status, priority: row.priority,
    category: row.reason_category, assignee_user_id: row.assigned_to,
    channel: typeof row.metadata?.support_channel === 'string' ? row.metadata.support_channel : null,
    created_at: row.created_at, updated_at: row.updated_at,
    resolved_at: row.resolved_at, closed_at: row.closed_at,
  }
}

function stringOrNull(value: unknown): string | null { return typeof value === 'string' ? value : null }
export function staffCaseEventDto(companyId: string, row: StaffEvent) {
  const payload = row.payload ?? {}
  const verification = payload.verification && typeof payload.verification === 'object' ? payload.verification as Record<string, unknown> : {}
  const representative = payload.representative && typeof payload.representative === 'object' ? payload.representative as Record<string, unknown> : null
  return {
    event_reference: publicReference('support_message', companyId, row.id),
    event_type: row.event_type, message: row.message,
    visibility: payload.visibility === 'customer' ? 'customer' : 'internal',
    author_type: row.event_type === 'support_customer_message' ? 'customer' : 'staff',
    author_user_id: row.created_by, channel: stringOrNull(payload.channel),
    kind: stringOrNull(payload.kind), direction: stringOrNull(payload.direction),
    verification_method: stringOrNull(verification.method), verification_reference: stringOrNull(verification.reference),
    representative: representative ? { name: stringOrNull(representative.name), mandate_reference: stringOrNull(representative.mandate_reference) } : null,
    created_at: row.created_at,
  }
}

export function staffAttachmentDto(row: SupportAttachmentRow) {
  return {
    attachment_reference: row.public_reference, file_name: row.file_name, mime_type: row.detected_mime_type,
    byte_size: row.byte_size, sha256: row.sha256, uploaded_by: row.uploaded_by_kind,
    visibility: row.visibility, scan_status: row.scan_status, scan_reason: row.scan_reason, created_at: row.created_at,
  }
}

export async function findStaffCase(companyId: string, reference: string): Promise<StaffCaseRow> {
  if (!/^support_case_[A-Za-z0-9_-]{32}$/.test(reference)) {
    throw new ApiInputError('Ärendet hittades inte.', 'support_case_not_found', 404)
  }
  const { data, error } = await tenantSelect(companyId, 'customer_cases', CASE_FIELDS)
    .eq('metadata->>support_case', 'true').eq('case_type', 'other').like('source', 'tenant\\_support\\_%')
    .eq('billing_blocked', false).eq('billing_manual_review', false).eq('cancellation_required', false)
    .eq('metadata->>support_public_reference', reference).maybeSingle()
  if (error) throw error
  if (!data) throw new ApiInputError('Ärendet hittades inte.', 'support_case_not_found', 404)
  return data as unknown as StaffCaseRow
}

export async function listStaffCases(input: { companyId: string; customerId?: string | null; status?: string | null; query?: string | null; limit?: number | null; cursor?: string | null }) {
  const limit = portalPageLimit(input.limit)
  const resource = JSON.stringify(['staff_cases', input.customerId ?? null, input.status ?? null, input.query ?? null])
  const cursor = decodePortalCursor({ cursor: input.cursor, companyId: input.companyId, customerId: 'staff', resource })
  let query = tenantSelect(input.companyId, 'customer_cases', CASE_FIELDS)
    .eq('metadata->>support_case', 'true').eq('case_type', 'other').like('source', 'tenant\\_support\\_%')
    .eq('billing_blocked', false).eq('billing_manual_review', false).eq('cancellation_required', false)
  if (input.customerId) query = query.eq('customer_id', input.customerId)
  if (input.status) query = query.eq('status', input.status)
  if (input.query) {
    // A single ilike predicate cannot inject PostgREST filter syntax. Escape wildcard input.
    const search = input.query.replace(/[\\%_]/g, (character) => `\\${character}`)
    query = query.ilike('title', `%${search}%`)
  }
  if (cursor) query = query.or(`created_at.lt.${cursor.orderValue},and(created_at.eq.${cursor.orderValue},id.lt.${cursor.id})`)
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
  if (error) throw error
  const page = buildPortalDatabasePage((data ?? []) as unknown as Array<StaffCaseRow & Record<string, unknown>>, {
    limit, companyId: input.companyId, customerId: 'staff', resource, orderColumn: 'created_at',
  })
  return { items: page.items.map(staffCaseDto), page: page.page }
}

export async function listStaffCaseEvents(companyId: string, customerId: string, caseId: string, input: { limit?: number | null; cursor?: string | null } = {}) {
  const limit = portalPageLimit(input.limit)
  const resource = `staff_case_events:${caseId}`
  const cursor = decodePortalCursor({ cursor: input.cursor, companyId, customerId, resource })
  let query = tenantSelect(companyId, 'customer_case_events', 'id,event_type,message,payload,created_by,created_at')
    .eq('customer_id', customerId).eq('customer_case_id', caseId).in('event_type', STAFF_EVENT_TYPES)
  if (cursor) query = query.or(`created_at.lt.${cursor.orderValue},and(created_at.eq.${cursor.orderValue},id.lt.${cursor.id})`)
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
  if (error) throw error
  const page = buildPortalDatabasePage((data ?? []) as unknown as Array<StaffEvent & Record<string, unknown>>, {
    limit, companyId, customerId, resource, orderColumn: 'created_at',
  })
  return { items: page.items.map((row) => staffCaseEventDto(companyId, row)), page: page.page }
}

export async function createStaffCase(input: StaffCaseActor & { customerId: string; title: string; description: string | null; category: string | null; priority: typeof STAFF_CASE_PRIORITIES[number]; idempotencyKey: string }) {
  const domainKey = createHash('sha256').update(JSON.stringify(['staff_api', input.apiClientId, input.actorUserId, input.idempotencyKey])).digest('hex')
  const result = await createTenantSupportCase({
    ...input, channel: 'staff_api', idempotencyKey: domainKey,
    metadata: { opened_by: 'staff', actor_user_id: input.actorUserId, api_client_id: input.apiClientId, description_visibility: 'internal', support_channel: 'staff_api' },
  })
  return staffCaseDto(result.case)
}

type StaffCaseRpc = (name: 'gridex_assign_customer_case', args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
export async function assignStaffCase(input: StaffCaseActor & { caseId: string; assigneeUserId: string | null; expectedSource: string | null }) {
  const { data, error } = await (supabaseService.rpc as unknown as StaffCaseRpc)('gridex_assign_customer_case', {
    p_company_id: input.companyId, p_case_id: input.caseId, p_actor_user_id: input.actorUserId,
    p_assignee_user_id: input.assigneeUserId, p_api_client_id: input.apiClientId, p_expected_source: input.expectedSource,
  })
  if (error) throw error
  return staffCaseDto(data as StaffCaseRow)
}
