import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getBaseAppUrl } from '@/lib/auth/urls'
import { buildLinesPdfBuffer, customerContractTypeLabel, wrapPdfLines, type PdfLine } from '@/lib/customer-contracts/agreementPdf'
import { contractCommitment, todayInStockholm, type CommitmentContract } from '@/lib/customer-contracts/commitment'
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
// Any contract the customer has or had: the number on it changes, so the customer approves.
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

async function decide(companyId: string, requestId: string, outcome: 'applied' | 'rejected' | 'expired' | 'cancelled', decidedBy: 'customer' | 'staff' | 'system', actorUserId: string | null, acceptance: Record<string, unknown> | null = null) {
  const { data, error } = await supabaseService.rpc('gridex_decide_customer_identity_change_v1', {
    p_company_id: companyId,
    p_request_id: requestId,
    p_outcome: outcome,
    p_decided_by: decidedBy,
    p_actor_user_id: actorUserId,
    p_acceptance: acceptance,
  })
  if (error) {
    const message = String(error.message ?? '')
    if (message.includes('identity_change_stale')) {
      throw new IdentityChangeError('identity_change_stale', 'Numret har ändrats på annat sätt sedan begäran skapades. Skapa en ny begäran.', 409)
    }
    if (message.includes('identity_change_takeover_acceptance_required')) {
      throw new IdentityChangeError('identity_change_takeover_acceptance_required', 'Bekräfta alla tre punkterna för att ta över avtalen.', 422)
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
  | { status: 'pending_customer_approval'; requestId: string; recipientMasked: string; expiresAt: string; contractCount: number; takeoverRequired: boolean }

type ContractRow = CommitmentContract & { contract_number?: string | null; legal_bundle_version_id?: string | null }

export type TakeoverSnapshot = {
  contracts: Array<{
    contract_id: string
    contract_number: string | null
    contract_type: string | null
    status: string | null
    binding_ends_on: string | null
    notice_months: number | null
    termination_pending: boolean
    legal_bundle_version_id: string | null
  }>
  terms: Array<{ legal_bundle_version_id: string; title: string; content_sha256: string }>
}

const CONTRACT_COMMITMENT_COLUMNS = 'id,status,contract_type,binding_months,notice_months,ends_at,termination_notice_date,actual_start_at,confirmed_start_at,starts_at,expected_start_at,contract_number,legal_bundle_version_id'

function snapshotSha256(snapshot: TakeoverSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex')
}

/** The terms (exact document versions) of the contracts being taken over. Tenant-checked. */
async function loadTakeoverTerms(companyId: string, bundleIds: string[]): Promise<TakeoverSnapshot['terms']> {
  if (bundleIds.length === 0) return []
  const owned = await tenantSelect(companyId, 'legal_bundle_versions', 'id').in('id', bundleIds)
  if (owned.error) throw owned.error
  const ownedIds = ((owned.data ?? []) as Array<{ id: string }>).map((row) => row.id)
  if (ownedIds.length === 0) return []
  // legal_bundle_version_documents has no company_id; ownership is proven through the bundle above.
  const documents = await tenantDb(companyId).unscoped()
    .from('legal_bundle_version_documents')
    .select('legal_bundle_version_id,title,content_sha256,sort_order')
    .in('legal_bundle_version_id', ownedIds)
    .order('sort_order', { ascending: true })
  if (documents.error) throw documents.error
  return ((documents.data ?? []) as Array<{ legal_bundle_version_id: string; title: string; content_sha256: string }>)
    .map((doc) => ({ legal_bundle_version_id: doc.legal_bundle_version_id, title: doc.title, content_sha256: doc.content_sha256 }))
}

function contractTypeText(value: string | null): string {
  return customerContractTypeLabel(value) ?? value ?? 'Elavtal'
}

/** The PDF sent to the customer: what is requested, from the customer card. */
export function buildIdentityChangePdf(input: {
  companyName: string
  customerName: string
  customerNumber: string | null
  field: IdentityField
  previousValue: string | null
  newValue: string
  reason: string
  requestedAt: string
  expiresAt: string
  approvalUrl: string
  takeover: TakeoverSnapshot | null
  requestId: string
}): Buffer {
  const label = input.field === 'personal_number' ? 'personnummer' : 'organisationsnummer'
  const labelTitle = input.field === 'personal_number' ? 'Personnummer' : 'Organisationsnummer'
  const date = (iso: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(iso))
  const lines: PdfLine[] = [
    { text: `Begäran om ändring av ${label}`, style: 'title' },
    { text: input.companyName, style: 'small' },
    { text: `Skapad ${date(input.requestedAt)} · Referens ${input.requestId}`, style: 'small' },
    { text: 'Kund', style: 'heading' },
    { text: `Namn: ${input.customerName || '—'}` },
    { text: `Kundnummer: ${input.customerNumber ?? '—'}` },
    { text: 'Begärd ändring', style: 'heading' },
    { text: `Nuvarande ${label}: ${input.previousValue ?? 'saknas'}` },
    { text: `Nytt ${label}: ${input.newValue}` },
    ...wrapPdfLines(`Orsak: ${input.reason}`),
  ]
  if (input.takeover) {
    lines.push({ text: 'Övertagande av avtal', style: 'heading' })
    lines.push(...wrapPdfLines(`Ändringen innebär att avtalen nedan förs över till innehavaren av ${labelTitle.toLowerCase()} ${input.newValue}. Avtalen har bindningstid eller uppsägningstid och förs bara över om den nya avtalsparten godkänner att ta över avtalen med alla rättigheter och skyldigheter, inklusive kvarvarande bindningstid, uppsägningstid och villkoren nedan.`))
    for (const contract of input.takeover.contracts) {
      const parts = [
        `Avtal ${contract.contract_number ?? contract.contract_id} (${contractTypeText(contract.contract_type)})`,
        contract.binding_ends_on ? `bindningstid till ${contract.binding_ends_on}` : null,
        contract.notice_months ? `uppsägningstid ${contract.notice_months} mån` : null,
        contract.termination_pending ? 'uppsägning pågår' : null,
      ].filter(Boolean)
      lines.push(...wrapPdfLines(`• ${parts.join(', ')}`))
    }
    if (input.takeover.terms.length > 0) {
      lines.push({ text: 'Villkor som ska godkännas', style: 'heading' })
      for (const term of input.takeover.terms) {
        lines.push(...wrapPdfLines(`• ${term.title} (version ${term.content_sha256.slice(0, 12)})`))
      }
    }
  }
  lines.push({ text: 'Så godkänner du', style: 'heading' })
  lines.push(...wrapPdfLines(`Ändringen görs bara om du godkänner den via länken i mejlet. Länken gäller till ${date(input.expiresAt)} och kan bara användas en gång. Känner du inte igen ändringen, neka den via länken eller kontakta ${input.companyName}.`))
  lines.push(...wrapPdfLines(input.approvalUrl, 'small', 95))
  return buildLinesPdfBuffer(lines)
}

/** Staff starts a change. Applies at once without contracts; otherwise e-mails the customer for approval. */
export async function requestCustomerIdentityChange(input: {
  companyId: string
  customerId: string
  field: IdentityField
  newValue: string
  reason: string
  actorUserId: string
  channel?: 'ops' | 'staff_api'
  apiClientId?: string
}): Promise<IdentityChangeResult> {
  const reason = input.reason.trim()
  if (reason.length < 3 || reason.length > 500) {
    throw new IdentityChangeError('identity_change_reason_required', 'Ange varför numret ändras (3–500 tecken).')
  }
  const newValue = normalizeIdentityNumber(input.field, input.newValue)

  const customerQuery = await tenantSelect(input.companyId, 'customers', 'id,customer_type,customer_number,personal_number,org_number,email,full_name,first_name,last_name,company_name,status')
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

  const contractsQuery = await tenantSelect(input.companyId, 'customer_contracts', CONTRACT_COMMITMENT_COLUMNS)
    .eq('customer_id', input.customerId)
    .in('status', CONTRACT_STATUSES_REQUIRING_APPROVAL)
  if (contractsQuery.error) throw contractsQuery.error
  const contracts = (contractsQuery.data ?? []) as unknown as ContractRow[]
  const contractCount = contracts.length
  const approvalRequired = contractCount > 0
  // The approval e-mail only ever goes to the e-mail address on the customer card.
  const recipient = customer.email?.trim().toLowerCase() || null
  if (approvalRequired && !recipient) {
    throw new IdentityChangeError('identity_change_email_missing', 'Kunden har avtal men ingen e-postadress på kundkortet. Lägg till kundens e-post innan numret kan ändras.')
  }

  const today = todayInStockholm()
  const committed = contracts
    .map((contract) => ({ contract, commitment: contractCommitment(contract, today) }))
    .filter((entry) => entry.commitment.requiresTakeover)
  const takeoverRequired = committed.length > 0
  let takeover: TakeoverSnapshot | null = null
  if (takeoverRequired) {
    const bundleIds = [...new Set(committed.map((entry) => entry.contract.legal_bundle_version_id).filter((id): id is string => Boolean(id)))].sort()
    takeover = {
      contracts: committed.map(({ contract, commitment }) => ({
        contract_id: contract.id,
        contract_number: contract.contract_number ?? null,
        contract_type: contract.contract_type ?? null,
        status: contract.status ?? null,
        binding_ends_on: commitment.bindingEndsOn,
        notice_months: commitment.noticeMonths,
        termination_pending: commitment.terminationPending,
        legal_bundle_version_id: contract.legal_bundle_version_id ?? null,
      })),
      terms: await loadTakeoverTerms(input.companyId, bundleIds),
    }
  }

  const token = approvalRequired ? randomBytes(32).toString('hex') : null
  const requestedAt = new Date().toISOString()
  const expiresAt = approvalRequired ? new Date(Date.now() + IDENTITY_APPROVAL_TTL_HOURS * 3600_000).toISOString() : null
  const company = approvalRequired
    ? await tenantDb(input.companyId).unscoped().from('companies').select('name').eq('id', input.companyId).maybeSingle()
    : null
  const companyName = String((company?.data as { name?: string } | null)?.name ?? 'Din elhandlare')
  const customerName = customer.full_name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || ''
  const approvalUrl = token ? `${getBaseAppUrl()}/confirm/identity/${token}` : ''
  const requestId = randomUUID()
  const pdf = approvalRequired
    ? buildIdentityChangePdf({
        companyName, customerName, customerNumber: customer.customer_number ?? null, field: input.field,
        previousValue, newValue, reason, requestedAt, expiresAt: expiresAt as string, approvalUrl, takeover, requestId,
      })
    : null

  const inserted = await tenantInsert(input.companyId, 'customer_identity_change_requests', {
    id: requestId,
    customer_id: input.customerId,
    field: input.field,
    previous_value: previousValue,
    new_value: newValue,
    reason,
    requested_by: input.actorUserId,
    // Existing OPS requests retain their default schema path until the additive migration is deployed.
    ...(input.channel === 'staff_api' ? { source_channel: 'staff_api', api_client_id: input.apiClientId ?? null } : {}),
    requested_at: requestedAt,
    approval_required: approvalRequired,
    affected_contract_count: contractCount,
    recipient_email: approvalRequired ? recipient : null,
    token_hash: token ? hashIdentityApprovalToken(token) : null,
    expires_at: expiresAt,
    takeover_required: takeoverRequired,
    takeover_snapshot: takeover,
    takeover_snapshot_sha256: takeover ? snapshotSha256(takeover) : null,
    document_sha256: pdf ? createHash('sha256').update(pdf).digest('hex') : null,
    status: 'pending_customer_approval',
  }).select('id').single()
  if (inserted.error) {
    if (String((inserted.error as { code?: string }).code) === '23505') {
      throw new IdentityChangeError('identity_change_already_pending', 'Det finns redan en begäran som väntar på kundens godkännande. Avbryt den först.', 409)
    }
    throw inserted.error
  }
  await appendEvent({ companyId: input.companyId, customerId: input.customerId, requestId, eventType: 'requested', actorUserId: input.actorUserId, field: input.field, previousValue, newValue, detail: { reason, approval_required: approvalRequired, affected_contract_count: contractCount, takeover_required: takeoverRequired, ...(input.channel === 'staff_api' ? { channel: 'staff_api', api_client_id: input.apiClientId ?? null } : {}) } })

  if (!approvalRequired) {
    await decide(input.companyId, requestId, 'applied', 'staff', input.actorUserId)
    return { status: 'applied', requestId }
  }

  try {
    const label = input.field === 'personal_number' ? 'personnummer' : 'organisationsnummer'
    const takeoverText = takeoverRequired
      ? `<p><strong>Dina avtal har bindningstid eller uppsägningstid.</strong> Ändringen innebär att avtalen förs över till den nya avtalsparten, som då måste godkänna att ta över avtalen och villkoren. Detaljerna finns i bifogad PDF och på godkännandesidan.</p>`
      : ''
    const html = `<p>Hej${customerName ? ` ${escapeHtml(customerName)}` : ''},</p>
<p>${escapeHtml(companyName)} har fått en begäran om att ändra ${label} på ditt kundkonto och dina avtal. Vad som ska ändras står i bifogad PDF.</p>
${takeoverText}
<p>Ändringen görs bara om du godkänner den:</p>
<p><a href="${approvalUrl}">Granska och godkänn ändringen</a></p>
<p>Länken gäller i ${IDENTITY_APPROVAL_TTL_HOURS} timmar och kan bara användas en gång. Om du inte känner igen ändringen kan du neka den via länken eller kontakta ${escapeHtml(companyName)}.</p>`
    const text = `${companyName} har fått en begäran om att ändra ${label} på ditt kundkonto och dina avtal (se bifogad PDF).${takeoverRequired ? ' Dina avtal har bindningstid eller uppsägningstid och förs över till den nya avtalsparten om ändringen godkänns.' : ''} Ändringen görs bara om du godkänner den: ${approvalUrl} (gäller i ${IDENTITY_APPROVAL_TTL_HOURS} timmar).`
    await queueAndTrySendTenantEmail({
      companyId: input.companyId,
      customerId: input.customerId,
      emailType: 'customer_identity_change_approval',
      toEmail: recipient as string,
      subject: `Godkänn ändring av ${label}`,
      htmlBody: html,
      textBody: text,
      actorUserId: input.actorUserId,
      attachments: [{ filename: `andring-${label}-${requestId.slice(0, 8)}.pdf`, content: (pdf as Buffer).toString('base64'), contentType: 'application/pdf' }],
    })
  } catch (error) {
    // Without a delivered approval request the change must not stay open.
    await decide(input.companyId, requestId, 'cancelled', 'system', null).catch(() => undefined)
    throw new IdentityChangeError('identity_change_email_failed', `Godkännandemejlet kunde inte skickas: ${error instanceof Error ? error.message : 'okänt fel'}`, 503)
  }
  await appendEvent({ companyId: input.companyId, customerId: input.customerId, requestId, eventType: 'approval_sent', actorUserId: null, field: input.field, previousValue, newValue, detail: { recipient: maskEmail(recipient as string), expires_at: expiresAt, takeover_required: takeoverRequired, ...(input.channel === 'staff_api' ? { channel: 'staff_api', api_client_id: input.apiClientId ?? null } : {}) } })
  return { status: 'pending_customer_approval', requestId, recipientMasked: maskEmail(recipient as string), expiresAt: expiresAt as string, contractCount, takeoverRequired }
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
  takeover_required: boolean
  takeover_snapshot: TakeoverSnapshot | null
  takeover_snapshot_sha256: string | null
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
  newValue: string
  status: 'pending' | 'applied' | 'rejected' | 'expired' | 'cancelled'
  expiresAt: string | null
  contractCount: number
  companyName: string
  takeover: null | {
    snapshotSha256: string
    contracts: TakeoverSnapshot['contracts']
    terms: Array<{ title: string; contentSha256: string; body: string | null }>
  }
}

/**
 * What the token holder sees: the new number in full (so it can be checked), the current number
 * masked, and for a takeover the exact contracts and terms texts that are being accepted.
 */
export async function loadIdentityChangeForApproval(token: string): Promise<PublicIdentityChangeView> {
  const row = await loadByToken(token)
  const company = await tenantDb(row.company_id).unscoped().from('companies').select('name').eq('id', row.company_id).maybeSingle()
  const expired = row.status === 'pending_customer_approval' && row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now()
  let takeover: PublicIdentityChangeView['takeover'] = null
  if (row.takeover_required && row.takeover_snapshot && row.takeover_snapshot_sha256) {
    const snapshot = row.takeover_snapshot
    const bundleIds = [...new Set(snapshot.terms.map((term) => term.legal_bundle_version_id))]
    const bodies = new Map<string, string>()
    if (bundleIds.length > 0) {
      const documents = await tenantDb(row.company_id).unscoped()
        .from('legal_bundle_version_documents')
        .select('legal_bundle_version_id,content_sha256,rendered_body')
        .in('legal_bundle_version_id', bundleIds)
      if (documents.error) throw documents.error
      for (const doc of (documents.data ?? []) as Array<{ legal_bundle_version_id: string; content_sha256: string; rendered_body: string }>) {
        // Keyed by the recorded version hash: only the exact document version from the snapshot is shown.
        bodies.set(`${doc.legal_bundle_version_id}:${doc.content_sha256}`, doc.rendered_body)
      }
    }
    takeover = {
      snapshotSha256: row.takeover_snapshot_sha256,
      contracts: snapshot.contracts,
      terms: snapshot.terms.map((term) => ({ title: term.title, contentSha256: term.content_sha256, body: bodies.get(`${term.legal_bundle_version_id}:${term.content_sha256}`) ?? null })),
    }
  }
  return {
    field: row.field,
    previousMasked: maskIdentityNumber(row.previous_value),
    newValue: row.new_value,
    status: expired ? 'expired' : row.status === 'pending_customer_approval' ? 'pending' : (row.status as PublicIdentityChangeView['status']),
    expiresAt: row.expires_at,
    contractCount: row.affected_contract_count,
    companyName: String((company.data as { name?: string } | null)?.name ?? 'Din elhandlare'),
    takeover,
  }
}

export type TakeoverConfirmations = { identity: boolean; contracts: boolean; terms: boolean }

/**
 * The customer approves or declines via the e-mail link. Single use. For a takeover of binding
 * contracts all three confirmations are required and are recorded as evidence together with the
 * snapshot hash of exactly the contracts and terms that were shown.
 */
export async function decideIdentityChangeByToken(
  token: string,
  decision: 'approve' | 'reject',
  evidence: { confirmations?: TakeoverConfirmations; snapshotSha256?: string | null; ipHash?: string | null; userAgent?: string | null } = {},
): Promise<'applied' | 'rejected' | 'expired'> {
  const row = await loadByToken(token)
  let acceptance: Record<string, unknown> | null = null
  if (decision === 'approve' && row.takeover_required) {
    const confirmations = evidence.confirmations
    if (!confirmations?.identity || !confirmations.contracts || !confirmations.terms) {
      throw new IdentityChangeError('identity_change_takeover_acceptance_required', 'Bekräfta alla tre punkterna för att ta över avtalen.', 422)
    }
    if (evidence.snapshotSha256 !== row.takeover_snapshot_sha256) {
      throw new IdentityChangeError('identity_change_takeover_changed', 'Avtalsunderlaget har ändrats. Ladda om sidan och granska igen.', 409)
    }
    acceptance = {
      snapshot_sha256: row.takeover_snapshot_sha256,
      confirmations: { identity: true, contracts: true, terms: true },
      ip_hash: evidence.ipHash ?? null,
      user_agent: evidence.userAgent ? evidence.userAgent.slice(0, 500) : null,
    }
  } else if (decision === 'approve') {
    acceptance = { ip_hash: evidence.ipHash ?? null, user_agent: evidence.userAgent ? evidence.userAgent.slice(0, 500) : null }
  }
  const result = await decide(row.company_id, row.id, decision === 'approve' ? 'applied' : 'rejected', 'customer', null, acceptance)
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
