import { tenantInsert, tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { publicReference } from '@/lib/integrations/publicReferences'
import { buildPortalDatabasePage, decodePortalCursor, portalPageLimit } from '@/lib/customer-portal/keysetPagination'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import type { CustomerCaseStatus } from '@/lib/customer-cases/types'
import { supabaseService } from '@/lib/supabase/service'

/**
 * Customer support conversation on top of the existing customer cases.
 *
 * One case can hold several kinds of entries, stored as customer_case_events:
 * - customer messages (written by the authenticated end customer through the tenant's portal),
 * - staff replies (written by a named tenant employee, visible to the customer),
 * - internal notes (never visible to the customer),
 * - phone interactions (internal log of a call; a summary is only shown to the customer when a
 *   staff member explicitly publishes it as a reply).
 *
 * Visibility is fail-closed: an entry is customer-visible only when BOTH its event type is in the
 * public allowlist AND its payload carries `visibility: 'customer'`. Every other event on the case
 * (status changes, technical events, e-mail logs, notes) stays internal.
 */

export const SUPPORT_EVENT_TYPES = {
  customerMessage: 'support_customer_message',
  staffReply: 'support_staff_reply',
  internalNote: 'support_internal_note',
  phoneInteraction: 'support_phone_interaction',
} as const

export const CUSTOMER_VISIBLE_SUPPORT_EVENT_TYPES = [
  SUPPORT_EVENT_TYPES.customerMessage,
  SUPPORT_EVENT_TYPES.staffReply,
] as const

export type SupportAuthorType = 'customer' | 'staff'
export type PublicSupportStatus = 'received' | 'in_progress' | 'resolved' | 'closed'

export class SupportConversationError extends Error {
  constructor(
    readonly code:
      | 'support_case_not_found'
      | 'support_message_required'
      | 'support_case_closed'
      | 'support_title_required'
      | 'support_phone_verification_invalid'
      | 'support_quota_exceeded',
    message: string,
    readonly status = 422,
  ) {
    super(message)
    this.name = 'SupportConversationError'
  }
}

const MESSAGE_MAX_LENGTH = 8_000
const SUPPORT_CASE_SELECT = 'id,company_id,customer_id,status,title,description,source,metadata,created_at,updated_at,resolved_at,closed_at'
const CLOSED_STATUSES: CustomerCaseStatus[] = ['resolved', 'cancelled', 'closed']

/** Closed cases accept no new customer content (messages or attachments). */
export function isClosedSupportCase(supportCase: Pick<SupportCaseRow, 'status'>): boolean {
  return CLOSED_STATUSES.includes(supportCase.status)
}

type SupportCaseRow = {
  id: string
  company_id: string
  customer_id: string
  status: CustomerCaseStatus
  title: string
  description: string | null
  source: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  closed_at: string | null
}

type SupportEventRow = {
  id: string
  customer_case_id: string
  event_type: string
  message: string
  payload: Record<string, unknown> | null
  created_by: string | null
  created_at: string
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\u0000/g, '').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

export function publicSupportStatus(status: string | null | undefined): PublicSupportStatus {
  if (status === 'open') return 'received'
  if (status === 'resolved') return 'resolved'
  if (status === 'cancelled' || status === 'closed') return 'closed'
  return 'in_progress'
}

function publicSupportChannel(channel: unknown) {
  if (channel === 'staff_api') return 'admin'
  if (channel === 'api' || channel === 'customer_portal' || channel === 'admin' ||
    channel === 'phone' || channel === 'operations_automation') return channel
  return null
}

export function supportCaseReference(companyId: string, caseId: string): string {
  return publicReference('support_case', companyId, caseId) as string
}

function supportMessageReference(companyId: string, eventId: string): string {
  return publicReference('support_message', companyId, eventId) as string
}

/** Explicit public field list for a support case. Nothing else from the case row is exposed. */
export function publicSupportCase(row: SupportCaseRow) {
  const metadata = row.metadata ?? {}
  return {
    case_reference: supportCaseReference(row.company_id, row.id),
    title: row.title,
    // Only text the customer wrote when opening the case is echoed back; staff-created case
    // descriptions may contain internal working notes.
    description: metadata.description_visibility === 'customer' ? row.description : null,
    status: publicSupportStatus(row.status),
    channel: publicSupportChannel(metadata.support_channel),
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at ?? null,
  }
}

/** Explicit public field list for a support message; author identity of staff is not exposed. */
export function publicSupportMessage(companyId: string, row: SupportEventRow) {
  const payload = row.payload ?? {}
  return {
    message_reference: supportMessageReference(companyId, row.id),
    author_type: row.event_type === SUPPORT_EVENT_TYPES.customerMessage ? 'customer' : 'staff',
    kind: payload.kind === 'phone_summary' ? 'phone_summary' : 'message',
    body: row.message,
    created_at: row.created_at,
  }
}

function isCustomerVisible(row: SupportEventRow): boolean {
  return (
    (CUSTOMER_VISIBLE_SUPPORT_EVENT_TYPES as readonly string[]).includes(row.event_type) &&
    row.payload?.visibility === 'customer'
  )
}

type CustomerScope = { companyId: string; customerId: string }

/** Lists only support cases of this customer in this tenant; filters run in the database. */
export async function listCustomerSupportCases(
  scope: CustomerScope,
  page: { limit?: number | null; cursor?: string | null },
) {
  const limit = portalPageLimit(page.limit)
  const cursor = decodePortalCursor({ cursor: page.cursor, companyId: scope.companyId, customerId: scope.customerId, resource: 'support_cases' })
  let query = tenantSelect(scope.companyId, 'customer_cases', SUPPORT_CASE_SELECT)
    .eq('customer_id', scope.customerId)
    .eq('metadata->>support_case', 'true')
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.orderValue},and(created_at.eq.${cursor.orderValue},id.lt.${cursor.id})`)
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (error) throw error
  const built = buildPortalDatabasePage((data ?? []) as unknown as Array<SupportCaseRow & Record<string, unknown>>, {
    limit,
    companyId: scope.companyId,
    customerId: scope.customerId,
    resource: 'support_cases',
    orderColumn: 'created_at',
  })
  return { items: built.items.map((row) => publicSupportCase(row)), page: built.page }
}

/**
 * Resolves a public case reference to the customer's own support case. A reference alone is never
 * proof of access: the lookup is always bounded to the authenticated customer in the tenant.
 */
export async function findCustomerSupportCase(scope: CustomerScope, caseReference: string): Promise<SupportCaseRow> {
  const reference = text(caseReference, 100)
  if (reference) {
    const direct = await tenantSelect(scope.companyId, 'customer_cases', SUPPORT_CASE_SELECT)
      .eq('customer_id', scope.customerId)
      .eq('metadata->>support_case', 'true')
      .eq('metadata->>support_public_reference', reference)
      .limit(1)
    if (direct.error) throw direct.error
    const hit = (direct.data ?? [])[0] as unknown as SupportCaseRow | undefined
    if (hit) return hit

    // Cases created before references were stored: bounded scan within this customer only.
    const legacy = await tenantSelect(scope.companyId, 'customer_cases', SUPPORT_CASE_SELECT)
      .eq('customer_id', scope.customerId)
      .eq('metadata->>support_case', 'true')
      .order('created_at', { ascending: false })
      .limit(500)
    if (legacy.error) throw legacy.error
    const match = ((legacy.data ?? []) as unknown as SupportCaseRow[]).find(
      (row) => supportCaseReference(scope.companyId, row.id) === reference,
    )
    if (match) return match
  }
  throw new SupportConversationError('support_case_not_found', 'Ärendet hittades inte.', 404)
}

/** Historical V1 page size of the customer message history (oldest first). */
export const SUPPORT_MESSAGE_PAGE_SIZE = 500

/** Customer-visible messages only, filtered in the database before limiting. */
export async function listCustomerSupportMessages(scope: CustomerScope, caseId: string) {
  return (await listCustomerSupportMessagesPage(scope, caseId)).items
}

/**
 * Oldest-first customer message history with an optional continuation cursor. Without a cursor the
 * first page is identical to the historical V1 response (oldest 500). The cursor is encrypted and
 * bound to tenant, customer and case; a cursor of another case/customer/tenant is rejected.
 */
export async function listCustomerSupportMessagesPage(scope: CustomerScope, caseId: string, input: { cursor?: string | null } = {}) {
  const resource = `support_messages:${caseId}`
  const cursor = decodePortalCursor({ cursor: input.cursor, companyId: scope.companyId, customerId: scope.customerId, resource })
  let query = tenantSelect(scope.companyId, 'customer_case_events', 'id,customer_case_id,event_type,message,payload,created_by,created_at')
    .eq('customer_id', scope.customerId)
    .eq('customer_case_id', caseId)
    .in('event_type', [...CUSTOMER_VISIBLE_SUPPORT_EVENT_TYPES])
    .eq('payload->>visibility', 'customer')
  if (cursor) query = query.or(`created_at.gt.${cursor.orderValue},and(created_at.eq.${cursor.orderValue},id.gt.${cursor.id})`)
  const { data, error } = await query
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(SUPPORT_MESSAGE_PAGE_SIZE + 1)
  if (error) throw error
  const built = buildPortalDatabasePage((data ?? []) as unknown as Array<SupportEventRow & Record<string, unknown>>, {
    limit: SUPPORT_MESSAGE_PAGE_SIZE,
    companyId: scope.companyId,
    customerId: scope.customerId,
    resource,
    orderColumn: 'created_at',
  })
  // Defence in depth: re-check visibility after the query.
  return {
    items: (built.items as SupportEventRow[]).filter(isCustomerVisible).map((row) => publicSupportMessage(scope.companyId, row)),
    nextCursor: built.page.next_cursor,
  }
}

async function insertSupportEvent(input: {
  companyId: string
  customerId: string
  caseId: string
  eventType: (typeof SUPPORT_EVENT_TYPES)[keyof typeof SUPPORT_EVENT_TYPES]
  message: string
  payload: Record<string, unknown>
  actorUserId: string | null
}): Promise<SupportEventRow> {
  if (input.payload.channel === 'staff_api') {
    if (!input.actorUserId || typeof input.payload.api_client_id !== 'string') {
      throw new Error('staff_support_actor_required')
    }
    // The staff API event and audit commit together. Existing OPS/customer callers retain
    // their established path; this boundary is typed by the migration's generated capture.
    type StaffEventRpc = (name: 'gridex_staff_support_event', args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
    const { data, error } = await (supabaseService.rpc as unknown as StaffEventRpc)('gridex_staff_support_event', {
      p_company_id: input.companyId, p_case_id: input.caseId, p_customer_id: input.customerId,
      p_actor_user_id: input.actorUserId, p_api_client_id: input.payload.api_client_id,
      p_event_type: input.eventType, p_message: input.message, p_payload: input.payload,
    })
    if (error) throw error
    return data as SupportEventRow
  }
  const { data, error } = await tenantInsert(input.companyId, 'customer_case_events', {
      customer_case_id: input.caseId,
      customer_id: input.customerId,
      event_type: input.eventType,
      event_status: 'info',
      message: input.message,
      payload: input.payload,
      created_by: input.actorUserId,
    })
    .select('id,customer_case_id,event_type,message,payload,created_by,created_at')
    .single()
  if (error) throw error
  return data as unknown as SupportEventRow
}

/**
 * Per-customer abuse quotas for the end-customer support API (threat T10). They complement the
 * per-API-client rate limit: one customer cannot flood a tenant's support queue through the
 * tenant's shared client. Counts come from the database, so they hold across instances.
 */
export const SUPPORT_CUSTOMER_QUOTAS = {
  newCasesPerDay: 50,
  messagesPerHour: 150,
} as const

async function assertSupportQuota(
  scope: CustomerScope,
  kind: 'case' | 'message',
): Promise<void> {
  const windowMs = kind === 'case' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
  const since = new Date(Date.now() - windowMs).toISOString()
  const query = kind === 'case'
    ? tenantSelect(scope.companyId, 'customer_cases', 'id', { count: 'exact', head: true })
        .eq('customer_id', scope.customerId)
        .eq('metadata->>support_case', 'true')
        .eq('metadata->>opened_by', 'customer')
        .gte('created_at', since)
    : tenantSelect(scope.companyId, 'customer_case_events', 'id', { count: 'exact', head: true })
        .eq('customer_id', scope.customerId)
        .eq('event_type', SUPPORT_EVENT_TYPES.customerMessage)
        .gte('created_at', since)
  const { count, error } = await query
  if (error) throw error
  const limit = kind === 'case' ? SUPPORT_CUSTOMER_QUOTAS.newCasesPerDay : SUPPORT_CUSTOMER_QUOTAS.messagesPerHour
  if ((count ?? 0) >= limit) {
    throw new SupportConversationError(
      'support_quota_exceeded',
      kind === 'case'
        ? 'För många nya ärenden från kunden det senaste dygnet. Försök igen senare eller kontakta kundtjänst.'
        : 'För många meddelanden från kunden den senaste timmen. Försök igen senare.',
      429,
    )
  }
}

/** The authenticated end customer opens a support case through the tenant's portal API. */
export async function createCustomerSupportCase(input: CustomerScope & {
  apiClientId: string
  portalIdentityId: string | null
  title: unknown
  message: unknown
  category?: unknown
  idempotencyKey: string
}) {
  const title = text(input.title, 180)
  if (!title) throw new SupportConversationError('support_title_required', 'Rubrik krävs.')
  const message = text(input.message, MESSAGE_MAX_LENGTH)
  if (!message) throw new SupportConversationError('support_message_required', 'Meddelande krävs.')
  // A retry with an idempotency key that already created a case replays it; it never counts
  // against (or is refused by) the new-case quota.
  const existing = await tenantSelect(input.companyId, 'customer_cases', 'id')
    .eq('customer_id', input.customerId)
    .eq('metadata->>support_idempotency_key', input.idempotencyKey)
    .limit(1)
  if (existing.error) throw existing.error
  if ((existing.data ?? []).length === 0) await assertSupportQuota(input, 'case')

  const created = await createTenantSupportCase({
    companyId: input.companyId,
    customerId: input.customerId,
    title,
    description: message,
    category: text(input.category, 120) ?? 'support',
    channel: 'customer_portal',
    idempotencyKey: input.idempotencyKey,
    actorUserId: null,
    metadata: {
      description_visibility: 'customer',
      opened_by: 'customer',
      api_client_id: input.apiClientId,
      portal_identity_id: input.portalIdentityId,
    },
  })
  const row = created.case as unknown as SupportCaseRow
  const reference = supportCaseReference(input.companyId, row.id)
  // Steps after the case insert are repeatable: a retry with the same idempotency key after a crash
  // completes the missing reference/first message instead of creating a second case.
  if (row.metadata?.support_public_reference !== reference) {
    const { error } = await tenantUpdate(input.companyId, 'customer_cases', { metadata: { ...(row.metadata ?? {}), support_public_reference: reference } })
      .eq('customer_id', input.customerId)
      .eq('id', row.id)
    if (error) throw error
  }
  const firstMessage = await tenantSelect(input.companyId, 'customer_case_events', 'id')
    .eq('customer_case_id', row.id)
    .eq('event_type', SUPPORT_EVENT_TYPES.customerMessage)
    .limit(1)
  if (firstMessage.error) throw firstMessage.error
  if ((firstMessage.data ?? []).length === 0) {
    await insertSupportEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      caseId: row.id,
      eventType: SUPPORT_EVENT_TYPES.customerMessage,
      message,
      payload: { visibility: 'customer', author_type: 'customer', channel: 'customer_portal', api_client_id: input.apiClientId, portal_identity_id: input.portalIdentityId },
      actorUserId: null,
    })
  }
  return { case: publicSupportCase({ ...row, metadata: { ...(row.metadata ?? {}), support_public_reference: reference } }), reused: created.reused }
}

/** The authenticated end customer adds a message to one of their own open cases. */
export async function addCustomerSupportMessage(input: CustomerScope & {
  caseReference: string
  apiClientId: string
  portalIdentityId: string | null
  message: unknown
}) {
  const body = text(input.message, MESSAGE_MAX_LENGTH)
  if (!body) throw new SupportConversationError('support_message_required', 'Meddelande krävs.')
  const supportCase = await findCustomerSupportCase(input, input.caseReference)
  if (CLOSED_STATUSES.includes(supportCase.status)) {
    throw new SupportConversationError('support_case_closed', 'Ärendet är avslutat. Skapa ett nytt ärende.', 409)
  }
  await assertSupportQuota(input, 'message')
  const row = await insertSupportEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    caseId: supportCase.id,
    eventType: SUPPORT_EVENT_TYPES.customerMessage,
    message: body,
    payload: { visibility: 'customer', author_type: 'customer', channel: 'customer_portal', api_client_id: input.apiClientId, portal_identity_id: input.portalIdentityId },
    actorUserId: null,
  })
  return publicSupportMessage(input.companyId, row)
}

type StaffScope = CustomerScope & {
  caseId: string
  actorUserId: string
  channel?: 'ops' | 'phone' | 'staff_api'
  apiClientId?: string
}

function staffAttribution(scope: StaffScope, defaultChannel: 'ops' | 'phone') {
  return {
    channel: scope.channel ?? defaultChannel,
    ...(scope.channel === 'staff_api' ? { actor_user_id: scope.actorUserId, api_client_id: scope.apiClientId } : {}),
  }
}

async function loadStaffCase(scope: StaffScope): Promise<SupportCaseRow> {
  const { data, error } = await tenantSelect(scope.companyId, 'customer_cases', SUPPORT_CASE_SELECT)
    .eq('customer_id', scope.customerId)
    .eq('id', scope.caseId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new SupportConversationError('support_case_not_found', 'Ärendet hittades inte för aktuell tenant.', 404)
  return data as unknown as SupportCaseRow
}

/**
 * A named tenant employee replies to the customer. `kind: 'phone_summary'` publishes a call
 * summary the employee wrote; it is labelled as staff-authored, never as a customer message.
 */
export async function replyToCustomer(scope: StaffScope & { message: unknown; kind?: 'message' | 'phone_summary' }) {
  const body = text(scope.message, MESSAGE_MAX_LENGTH)
  if (!body) throw new SupportConversationError('support_message_required', 'Meddelande krävs.')
  const supportCase = await loadStaffCase(scope)
  return insertSupportEvent({
    companyId: scope.companyId,
    customerId: scope.customerId,
    caseId: supportCase.id,
    eventType: SUPPORT_EVENT_TYPES.staffReply,
    message: body,
    payload: { visibility: 'customer', author_type: 'staff', kind: scope.kind ?? 'message', ...staffAttribution(scope, 'ops') },
    actorUserId: scope.actorUserId,
  })
}

/** Internal note; never customer-visible through any channel. */
export async function addInternalNote(scope: StaffScope & { message: unknown }) {
  const body = text(scope.message, MESSAGE_MAX_LENGTH)
  if (!body) throw new SupportConversationError('support_message_required', 'Anteckning krävs.')
  const supportCase = await loadStaffCase(scope)
  return insertSupportEvent({
    companyId: scope.companyId,
    customerId: scope.customerId,
    caseId: supportCase.id,
    eventType: SUPPORT_EVENT_TYPES.internalNote,
    message: body,
    payload: { visibility: 'internal', author_type: 'staff', ...staffAttribution(scope, 'ops') },
    actorUserId: scope.actorUserId,
  })
}

/**
 * How the caller was identified on the phone. Knowing a customer number, personal number, the
 * calling number or an e-mail address is never verification on its own.
 */
export const PHONE_VERIFICATION_METHODS = {
  unverified: 'Ej verifierad (begränsat intag)',
  strong_eid: 'Stark e-legitimation via befintlig tjänst',
  authenticated_portal_confirmation: 'Bekräftad av kunden i inloggad portal',
  callback_registered_number: 'Återuppringning till tidigare registrerat nummer',
} as const

export type PhoneVerificationMethod = keyof typeof PHONE_VERIFICATION_METHODS

export function phoneVerificationAllowsCustomerAccess(method: PhoneVerificationMethod): boolean {
  return method !== 'unverified'
}

/** Logs a phone call on a case. The summary stays internal until explicitly published. */
export async function recordPhoneInteraction(scope: StaffScope & {
  direction: 'inbound' | 'outbound'
  summary: unknown
  verificationMethod: PhoneVerificationMethod
  verificationReference?: unknown
  representative?: { name?: unknown; mandateReference?: unknown } | null
}) {
  const summary = text(scope.summary, MESSAGE_MAX_LENGTH)
  if (!summary) throw new SupportConversationError('support_message_required', 'Samtalsanteckning krävs.')
  if (!(scope.verificationMethod in PHONE_VERIFICATION_METHODS)) {
    throw new SupportConversationError('support_phone_verification_invalid', 'Ogiltig verifieringsmetod.')
  }
  const supportCase = await loadStaffCase(scope)
  return insertSupportEvent({
    companyId: scope.companyId,
    customerId: scope.customerId,
    caseId: supportCase.id,
    eventType: SUPPORT_EVENT_TYPES.phoneInteraction,
    message: summary,
    payload: {
      visibility: 'internal',
      author_type: 'staff',
      ...staffAttribution(scope, 'phone'),
      direction: scope.direction === 'outbound' ? 'outbound' : 'inbound',
      verification: {
        method: scope.verificationMethod,
        // Reference to evidence held elsewhere (e.g. an e-ID transaction id); never codes or secrets.
        reference: text(scope.verificationReference, 120),
        grants_customer_access: phoneVerificationAllowsCustomerAccess(scope.verificationMethod),
        verified_at: new Date().toISOString(),
      },
      representative: scope.representative
        ? { name: text(scope.representative.name, 160), mandate_reference: text(scope.representative.mandateReference, 120) }
        : null,
    },
    actorUserId: scope.actorUserId,
  })
}
