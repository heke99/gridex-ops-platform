import { createHash, randomBytes } from 'node:crypto'
import { getBaseAppUrl } from '@/lib/auth/urls'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { tenantInsert, tenantSelect } from '@/lib/supabase/tenantQuery'
import { queueAndTrySendTenantEmail } from '@/lib/tenant/emailBranding'
import { digitsOnly, isValidSwedishOrganizationNumber, isValidSwedishPersonalNumber } from '@/lib/validation/customerFields'

/**
 * Tenantservice F12: personal / organization number changes are a high-risk flow, separate from
 * the ordinary profile form.
 *
 * - Every change is a request with an append-only, masked history (customer_identity_change_events)
 *   and an audit_logs row written in the same transaction as the change.
 * - A customer without contracts is changed at once by staff (still audited).
 * - A customer with contracts must approve: the customer receives an e-mail with a single-use link
 *   that expires (only the SHA-256 of the token is stored). Nothing changes until the customer
 *   approves; declining or letting the link expire leaves the number untouched.
 *
 * Contracts reference the customer row, so an approved change applies to all of the customer's
 * contracts. Already signed contract documents are historical evidence and are never rewritten.
 */

export type IdentityField = 'personal_number' | 'org_number'
export const IDENTITY_APPROVAL_TTL_HOURS = 72
const CONTRACT_STATUSES_REQUIRING_APPROVAL = ['pending_signature', 'signed', 'active', 'terminated', 'expired']

export class IdentityChangeError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) {
    super(message)
    this.name = 'IdentityChangeError'
  }
}

export function maskIdentityNumber(value: string | null | undefined): string | null {
  const digits = digitsOnly(value)
  return digits ? `••••${digits.slice(-4)}` : null
}

export function hashIdentityApprovalToken(token: string): string {
  const normalized = token.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new IdentityChangeError('identity_change_link_invalid', 'Länken är ogiltig.', 404)
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/** Canonical stored form: personnummer YYYYMMDD-XXXX, organisationsnummer NNNNNN-NNNN. */
export function normalizeIdentityNumber(field: IdentityField, raw: string): string {
  const digits = digitsOnly(raw)
  if (field === 'personal_number') {
    if (!digits || !isValidSwedishPersonalNumber(raw)) {
      throw new IdentityChangeError('personal_number_invalid', 'Personnumret är inte giltigt (kontrollsiffran stämmer inte).')
    }
    const ten = digits.length === 12 ? digits.slice(2) : digits
    const century = digits.length === 12 ? digits.slice(0, 2) : (Number(ten.slice(0, 2)) > new Date().getFullYear() % 100 ? '19' : '20')
    return `${century}${ten.slice(0, 6)}-${ten.slice(6)}`
  }
  if (!digits || !isValidSwedishOrganizationNumber(raw)) {
    throw new IdentityChangeError('org_number_invalid', 'Organisationsnumret är inte giltigt (kontrollsiffran stämmer inte).')
  }
  const ten = digits.length === 12 ? digits.slice(2) : digits
  return `${ten.slice(0, 6)}-${ten.slice(6)}`
}

/** True when both values denote the same number (ignores separators and the century prefix). */
export function identityNumbersEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = digitsOnly(a)
  const right = digitsOnly(b)
  return (left.length === 12 ? left.slice(2) : left) === (right.length === 12 ? right.slice(2) : right)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string)
}

async function appendEvent(input: {
  companyId: string
  customerId: string
  requestId: string
  eventType: 'requested' | 'approval_sent'
  actorUserId: string | null
  field: IdentityField
  previousValue: string | null
  newValue: string
  detail?: Record<string, unknown>
}) {
  const { error } = await tenantInsert(input.companyId, 'customer_identity_change_events', {
    customer_id: input.customerId,
    request_id: input.requestId,
    event_type: input.eventType,
    actor_kind: input.actorUserId ? 'staff' : 'system',
    actor_user_id: input.actorUserId,
    field: input.field,
    previous_value_masked: maskIdentityNumber(input.previousValue),
    new_value_masked: maskIdentityNumber(input.newValue),
    detail: input.detail ?? {},
  })
  if (error) throw error
}

async function decide(companyId: string, requestId: string, outcome: 'applied' | 'rejected' | 'expired' | 'cancelled', decidedBy: 'customer' | 'staff' | 'system', actorUserId: string | null) {
  const { data, error } = await supabaseService.rpc('gridex_decide_customer_identity_change_v1', {
    p_company_id: companyId,
    p_request_id: requestId,
    p_outcome: outcome,
    p_decided_by: decidedBy,
    p_actor_user_id: actorUserId,
  })
  if (error) {
    const message = String(error.message ?? '')
    if (message.includes('identity_change_stale')) {
      throw new IdentityChangeError('identity_change_stale', 'Numret har ändrats på annat sätt sedan begäran skapades. Skapa en ny begäran.', 409)
    }
    if (message.includes('identity_change_not_pending')) {
      throw new IdentityChangeError('identity_change_not_pending', 'Begäran är redan avgjord.', 409)
    }
    throw error
  }
  return data as { status: string; request_id: string }
}

export type IdentityChangeResult =
  | { status: 'applied'; requestId: string }
  | { status: 'pending_customer_approval'; requestId: string; recipientMasked: string; expiresAt: string; contractCount: number }

/** Staff starts a change. Applies at once without contracts; otherwise e-mails the customer for approval. */
export async function requestCustomerIdentityChange(input: {
  companyId: string
  customerId: string
  field: IdentityField
  newValue: string
  reason: string
  actorUserId: string
}): Promise<IdentityChangeResult> {
  const reason = input.reason.trim()
  if (reason.length < 3 || reason.length > 500) {
    throw new IdentityChangeError('identity_change_reason_required', 'Ange varför numret ändras (3–500 tecken).')
  }
  const newValue = normalizeIdentityNumber(input.field, input.newValue)

  const customerQuery = await tenantSelect(input.companyId, 'customers', 'id,customer_type,personal_number,org_number,email,full_name,first_name,last_name,company_name,status')
    .eq('id', input.customerId)
    .maybeSingle()
  if (customerQuery.error) throw customerQuery.error
  const customer = customerQuery.data as Record<string, string | null> | null
  if (!customer) throw new IdentityChangeError('customer_not_found', 'Kunden hittades inte.', 404)
  if (customer.status === 'archived') throw new IdentityChangeError('customer_archived', 'Arkiverad kund kan inte ändras.', 409)
  const expectedField: IdentityField = customer.customer_type === 'private' ? 'personal_number' : 'org_number'
  if (input.field !== expectedField) {
    throw new IdentityChangeError('identity_field_mismatch', input.field === 'personal_number'
      ? 'Företagskunder har organisationsnummer, inte personnummer.'
      : 'Privatkunder har personnummer, inte organisationsnummer.')
  }
  const previousValue = customer[input.field] ?? null
  if (identityNumbersEqual(previousValue, newValue)) {
    throw new IdentityChangeError('identity_change_unchanged', 'Det nya numret är samma som det nuvarande.')
  }

  const contracts = await tenantSelect(input.companyId, 'customer_contracts', 'id', { count: 'exact', head: true })
    .eq('customer_id', input.customerId)
    .in('status', CONTRACT_STATUSES_REQUIRING_APPROVAL)
  if (contracts.error) throw contracts.error
  const contractCount = contracts.count ?? 0
  const approvalRequired = contractCount > 0
  const recipient = customer.email?.trim().toLowerCase() || null
  if (approvalRequired && !recipient) {
    throw new IdentityChangeError('identity_change_email_missing', 'Kunden har avtal men ingen e-postadress. Lägg till kundens e-post innan numret kan ändras.')
  }

  const token = approvalRequired ? randomBytes(32).toString('hex') : null
  const expiresAt = approvalRequired ? new Date(Date.now() + IDENTITY_APPROVAL_TTL_HOURS * 3600_000).toISOString() : null
  const inserted = await tenantInsert(input.companyId, 'customer_identity_change_requests', {
    customer_id: input.customerId,
    field: input.field,
    previous_value: previousValue,
    new_value: newValue,
    reason,
    requested_by: input.actorUserId,
    approval_required: approvalRequired,
    affected_contract_count: contractCount,
    recipient_email: approvalRequired ? recipient : null,
    token_hash: token ? hashIdentityApprovalToken(token) : null,
    expires_at: expiresAt,
    status: 'pending_customer_approval',
  }).select('id').single()
  if (inserted.error) {
    if (String((inserted.error as { code?: string }).code) === '23505') {
      throw new IdentityChangeError('identity_change_already_pending', 'Det finns redan en begäran som väntar på kundens godkännande. Avbryt den först.', 409)
    }
    throw inserted.error
  }
  const requestId = String((inserted.data as { id: string }).id)
  await appendEvent({ companyId: input.companyId, customerId: input.customerId, requestId, eventType: 'requested', actorUserId: input.actorUserId, field: input.field, previousValue, newValue, detail: { reason, approval_required: approvalRequired, affected_contract_count: contractCount } })

  if (!approvalRequired) {
    await decide(input.companyId, requestId, 'applied', 'staff', input.actorUserId)
    return { status: 'applied', requestId }
  }

  try {
    const company = await tenantDb(input.companyId).unscoped().from('companies').select('name').eq('id', input.companyId).maybeSingle()
    const companyName = String((company.data as { name?: string } | null)?.name ?? 'Din elhandlare')
    const label = input.field === 'personal_number' ? 'personnummer' : 'organisationsnummer'
    const url = `${getBaseAppUrl()}/confirm/identity/${token}`
    const name = customer.full_name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || ''
    const html = `<p>Hej${name ? ` ${escapeHtml(name)}` : ''},</p>
<p>${escapeHtml(companyName)} har fått en begäran om att ändra ${label} på ditt kundkonto och dina avtal från <strong>${escapeHtml(maskIdentityNumber(previousValue) ?? 'saknas')}</strong> till <strong>${escapeHtml(maskIdentityNumber(newValue) ?? '')}</strong>.</p>
<p>Ändringen görs bara om du godkänner den:</p>
<p><a href="${url}">Granska och godkänn ändringen</a></p>
<p>Länken gäller i ${IDENTITY_APPROVAL_TTL_HOURS} timmar och kan bara användas en gång. Om du inte känner igen ändringen kan du neka den via länken eller kontakta ${escapeHtml(companyName)}.</p>`
    const text = `${companyName} har fått en begäran om att ändra ${label} från ${maskIdentityNumber(previousValue) ?? 'saknas'} till ${maskIdentityNumber(newValue)}. Ändringen görs bara om du godkänner den: ${url} (gäller i ${IDENTITY_APPROVAL_TTL_HOURS} timmar).`
    await queueAndTrySendTenantEmail({
      companyId: input.companyId,
      customerId: input.customerId,
      emailType: 'customer_identity_change_approval',
      toEmail: recipient as string,
      subject: `Godkänn ändring av ${label}`,
      htmlBody: html,
      textBody: text,
      actorUserId: input.actorUserId,
    })
  } catch (error) {
    // Without a delivered approval request the change must not stay open.
    await decide(input.companyId, requestId, 'cancelled', 'system', null).catch(() => undefined)
    throw new IdentityChangeError('identity_change_email_failed', `Godkännandemejlet kunde inte skickas: ${error instanceof Error ? error.message : 'okänt fel'}`, 503)
  }
  await appendEvent({ companyId: input.companyId, customerId: input.customerId, requestId, eventType: 'approval_sent', actorUserId: null, field: input.field, previousValue, newValue, detail: { recipient: maskEmail(recipient as string), expires_at: expiresAt } })
  return { status: 'pending_customer_approval', requestId, recipientMasked: maskEmail(recipient as string), expiresAt: expiresAt as string, contractCount }
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '•••'
  return `${local.slice(0, 1)}•••@${domain}`
}

type RequestRow = {
  id: string
  company_id: string
  customer_id: string
  field: IdentityField
  previous_value: string | null
  new_value: string
  status: string
  expires_at: string | null
  affected_contract_count: number
}

async function loadByToken(token: string): Promise<RequestRow> {
  const hash = hashIdentityApprovalToken(token)
  // A public approval link identifies the request (and its tenant) only by the token hash; the
  // lookup is a dedicated database function instead of cross-tenant table access.
  const { data, error } = await supabaseService.rpc('gridex_find_customer_identity_change_by_token_v1', { p_token_hash: hash })
  if (error) throw error
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as RequestRow[]
  if (rows.length !== 1) throw new IdentityChangeError('identity_change_link_invalid', 'Länken är ogiltig.', 404)
  return rows[0]
}

export type PublicIdentityChangeView = {
  field: IdentityField
  previousMasked: string | null
  newMasked: string | null
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'cancelled'
  expiresAt: string | null
  contractCount: number
  companyName: string
}

/** What the customer sees on the approval page: masked numbers only. */
export async function loadIdentityChangeForApproval(token: string): Promise<PublicIdentityChangeView> {
  const row = await loadByToken(token)
  const company = await tenantDb(row.company_id).unscoped().from('companies').select('name').eq('id', row.company_id).maybeSingle()
  const expired = row.status === 'pending_customer_approval' && row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now()
  return {
    field: row.field,
    previousMasked: maskIdentityNumber(row.previous_value),
    newMasked: maskIdentityNumber(row.new_value),
    status: expired ? 'expired' : row.status === 'pending_customer_approval' ? 'pending' : (row.status as PublicIdentityChangeView['status']),
    expiresAt: row.expires_at,
    contractCount: row.affected_contract_count,
    companyName: String((company.data as { name?: string } | null)?.name ?? 'Din elhandlare'),
  }
}

/** The customer approves or declines via the e-mail link. Single use: a decided request cannot be decided again. */
export async function decideIdentityChangeByToken(token: string, decision: 'approve' | 'reject'): Promise<'applied' | 'rejected' | 'expired'> {
  const row = await loadByToken(token)
  const result = await decide(row.company_id, row.id, decision === 'approve' ? 'applied' : 'rejected', 'customer', null)
  return result.status as 'applied' | 'rejected' | 'expired'
}

/** Staff withdraws a pending request. */
export async function cancelCustomerIdentityChange(input: { companyId: string; requestId: string; actorUserId: string }) {
  await decide(input.companyId, input.requestId, 'cancelled', 'staff', input.actorUserId)
}

export type IdentityChangeHistoryEntry = {
  id: string
  request_id: string
  event_type: string
  actor_kind: string
  field: IdentityField
  previous_value_masked: string | null
  new_value_masked: string | null
  detail: Record<string, unknown>
  created_at: string
}

export async function listCustomerIdentityChanges(companyId: string, customerId: string) {
  const [events, pending] = await Promise.all([
    tenantSelect(companyId, 'customer_identity_change_events', 'id,request_id,event_type,actor_kind,field,previous_value_masked,new_value_masked,detail,created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(100),
    tenantSelect(companyId, 'customer_identity_change_requests', 'id,field,new_value,expires_at,recipient_email,status')
      .eq('customer_id', customerId)
      .eq('status', 'pending_customer_approval')
      .limit(2),
  ])
  if (events.error) throw events.error
  if (pending.error) throw pending.error
  const open = ((pending.data ?? []) as Array<{ id: string; field: IdentityField; new_value: string; expires_at: string | null; recipient_email: string | null }>)
    .map((row) => ({ id: row.id, field: row.field, newMasked: maskIdentityNumber(row.new_value), expiresAt: row.expires_at, recipientMasked: row.recipient_email ? maskEmail(row.recipient_email) : null }))
  return { events: (events.data ?? []) as unknown as IdentityChangeHistoryEntry[], pending: open }
}
