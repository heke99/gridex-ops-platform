// lib/customer-operations/requestMissingFacilityInformation.ts
//
// Shared orchestrator for the manual (non-Ediel) grid-owner information request
// pipeline. This is the single entry point used by the website/API customer
// application, manual customer intake, the customer card button and any future
// import/intake flow. There must be NO duplicate logic between website and admin.
//
// It:
//   * resolves the tenant from the authenticated context + object ownership
//     (never trusts a company_id from form input),
//   * detects a missing facility_id (anläggnings-id),
//   * blocks PRODAT Z01 before render (Swedish business blocker),
//   * resolves the grid owner + manual contact channel (tenant override then
//     platform default),
//   * verifies a valid power of attorney with the correct scope,
//   * creates or reuses a manual information request (idempotent),
//   * queues a manual e-mail (worker sends it, never the UI),
//   * attaches the POA snapshot,
//   * writes audit events and sets the customer/site next action.
//
// Manual e-mail is NOT Ediel: this never creates an ediel_outbox row.

import { supabaseService } from '@/lib/supabase/service'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import {
  renderManualEmailTemplate,
  type ManualEmailTemplateKey,
} from '@/lib/email/manualGridOwnerTemplates'
import {
  resolveManualOperationsMailbox,
  resolveManualMailboxEnvironment,
  type ManualOperationsMailbox,
} from '@/lib/email/manualOperationsMailbox'
import { renderFullmaktPdfBase64 } from '@/lib/email/fullmaktPdf'
import {
  hasExternallySendablePoa,
  poaMissingExternalFields,
} from '@/lib/customers/poaReadiness'

type JsonRecord = Record<string, unknown>

export type ManualInformationChannelType =
  | 'facility_information_request'
  | 'supplier_switch_manual'
  | 'power_of_attorney'
  | 'ai_list'
  | 'escalation'

export type ManualInformationRequestStatus =
  | 'not_needed'
  | 'manual_email_queued'
  | 'waiting_manual_response'
  | 'needs_review'
  | 'blocked_missing_poa'
  | 'blocked_missing_grid_owner_contact'
  | 'blocked_missing_manual_mailbox'
  | 'blocked'

export type RequestMissingFacilityInformationInput = {
  // company_id ALWAYS comes from the authenticated context, never from a form.
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  source?: string | null
  requestType?: string
  channelType?: ManualInformationChannelType
  templateKey?: ManualEmailTemplateKey
  requiredScope?: string
}

export type RequestMissingFacilityInformationResult = {
  status: ManualInformationRequestStatus
  requestId: string | null
  caseReference: string | null
  channel: 'manual_email' | null
  emailOutboxId: string | null
  poaId: string | null
  nextAction: { code: string; message: string }
  blockers: Array<{ code: string; message: string }>
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Reads the first non-empty value across a set of schema aliases. Numbers and
// other scalar values are coerced to a trimmed string so a present DB value is
// never dropped just because the column is not a plain string.
function firstField(record: JsonRecord | null | undefined, keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function isUniqueViolation(error: unknown): boolean {
  return String((error as { code?: unknown } | null)?.code ?? '') === '23505'
}

function caseReferenceFor(requestId: string): string {
  return `GX-FIR-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

// Resolves a human customer name across schema aliases. Critically, the
// first_name + last_name join is coerced to null when empty so this never
// returns an empty string (an empty string is NOT caught by `??`).
function customerName(customer: JsonRecord | null | undefined): string | null {
  const direct = firstField(customer, ['company_name', 'full_name', 'name', 'display_name'])
  if (direct) return direct
  const joined = [
    firstField(customer, ['first_name', 'firstName', 'given_name']),
    firstField(customer, ['last_name', 'lastName', 'family_name']),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .trim()
  if (joined) return joined
  return firstField(customer, ['customer_number', 'customerNumber'])
}

// Reads every valid identity alias (person- or organisationsnummer).
function customerIdentity(customer: JsonRecord | null | undefined): string | null {
  return firstField(customer, [
    'personal_number',
    'org_number',
    'identity_number',
    'organization_number',
    'organisation_number',
    'identityNumber',
    'organizationNumber',
    'organisationNumber',
    'personalNumber',
    'orgNumber',
  ])
}

function customerNumber(customer: JsonRecord | null | undefined): string | null {
  return firstField(customer, ['customer_number', 'customerNumber', 'external_customer_id', 'externalCustomerId'])
}

async function readSite(input: { companyId: string; customerId: string; siteId: string }) {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
    .maybeSingle()
  if (error) throw error
  return (data as JsonRecord | null) ?? null
}

async function readCustomer(companyId: string, customerId: string) {
  // Select '*' so a single missing optional column (e.g. protected_identity)
  // can NEVER collapse the whole customer to null and blank out the e-mail.
  // The previous narrow projection caused production emails to render with
  // empty Kundnummer/Namn/Person-organisationsnummer fields.
  const primary = await supabaseService
    .from('customers')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (!primary.error) return (primary.data as JsonRecord | null) ?? null
  if (!missingSchema(primary.error)) throw primary.error

  // Extremely defensive fallback: if even '*' fails (impossible for a real
  // table, but keeps the orchestrator resilient), fetch the minimal identity
  // columns one more time before giving up.
  const fallback = await supabaseService
    .from('customers')
    .select('id,company_id,customer_number,full_name')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (fallback.error && !missingSchema(fallback.error)) throw fallback.error
  return (fallback.data as JsonRecord | null) ?? null
}

// Signed POA with the correct scope. Scope is matched against scope_summary
// (jsonb scopes), the scope text column and power_of_attorney_scopes rows.
async function findValidPowerOfAttorney(input: {
  companyId: string
  customerId: string
  siteId: string
  requiredScope: string
}): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .select('id,status,scope,scope_summary,site_id,customer_site_id,valid_until,fullmakt_snapshot,evidence_payload,document_id,document_path,reference,signer_name,signer_identity_number,method,accepted_at,signed_at,legal_text_version_id,source')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('status', ['signed', 'active', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(25)
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  const rows = (data ?? []) as JsonRecord[]
  const now = Date.now()
  const match = rows.find((row) => {
    const rowSite = clean(row.site_id) ?? clean(row.customer_site_id)
    const siteOk = !rowSite || rowSite === input.siteId
    if (!siteOk) return false
    const validUntil = clean(row.valid_until)
    if (validUntil && Date.parse(validUntil) < now) return false
    return scopeAllows(row, input.requiredScope)
  })
  return match ?? null
}

function scopeAllows(poa: JsonRecord, requiredScope: string): boolean {
  const scopeText = clean(poa.scope)?.toLowerCase()
  // supplier_switch implicitly covers facility_information_lookup for the switch.
  const acceptable = new Set([requiredScope, 'supplier_switch', 'all'])
  if (scopeText && acceptable.has(scopeText)) return true
  const summary = poa.scope_summary
  if (summary && typeof summary === 'object') {
    const scopes = Array.isArray((summary as JsonRecord).scopes)
      ? ((summary as JsonRecord).scopes as unknown[])
      : Object.keys(summary as JsonRecord)
    const values = scopes.map((value) => String(value).toLowerCase())
    if (values.includes(requiredScope) || values.includes('supplier_switch')) return true
    // boolean-keyed summaries: { facility_information_lookup: true }
    if ((summary as JsonRecord)[requiredScope] === true) return true
  }
  return false
}

async function findContactChannelEmail(input: {
  companyId: string
  gridOwnerId: string
  channelType: ManualInformationChannelType
}): Promise<{ email: string; source: string; contactChannelId: string | null; isVerified: boolean } | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_contact_channels')
    .select('id,email,company_id,source,is_enabled,is_verified')
    .eq('grid_owner_id', input.gridOwnerId)
    .eq('channel_type', input.channelType)
    .eq('is_enabled', true)
    .or(`company_id.is.null,company_id.eq.${input.companyId}`)
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  const rows = (data ?? []) as JsonRecord[]
  // Tenant override (company_id set) takes precedence over platform default.
  const sorted = rows
    .filter((row) => clean(row.email))
    .sort((a, b) => (a.company_id ? 0 : 1) - (b.company_id ? 0 : 1))
  const chosen = sorted[0]
  if (!chosen) return null
  return {
    email: String(chosen.email),
    source: String(chosen.source ?? 'manual_admin'),
    contactChannelId: clean(chosen.id),
    isVerified: chosen.is_verified === true,
  }
}

export type ManualRecipientResolutionMode =
  | 'real_grid_owner_contact'
  | 'safe_recipient_override'
  | 'manual_override'
  | 'missing_contact'

export type ManualRecipientResolution = {
  resolution_mode: ManualRecipientResolutionMode
  selected_to_email: string | null
  actual_grid_owner_contact_email: string | null
  contact_source_table: string | null
  contact_source_id: string | null
  contact_source: string | null
  contact_verified: boolean
  environment: 'test' | 'production'
  reason: string
  production_safe_override_warning: boolean
  externally_sendable: boolean
}

// Explicit recipient resolution: production + real operation uses the actual
// grid owner contact unless a safe-recipient override is explicitly
// configured. The chosen recipient and WHY it was chosen is always recorded on
// the outbox row and the request, so a test/staging safe recipient can never
// be mistaken for a real grid-owner send (and vice versa).
function resolveManualRecipient(contact: {
  email: string
  source: string
  contactChannelId: string | null
  isVerified: boolean
}): ManualRecipientResolution {
  const environment = resolveManualMailboxEnvironment()
  const safeRecipientOverride = clean(process.env.MANUAL_GRID_OWNER_SAFE_RECIPIENT)
  if (safeRecipientOverride) {
    return {
      resolution_mode: 'safe_recipient_override',
      selected_to_email: safeRecipientOverride,
      actual_grid_owner_contact_email: contact.email,
      contact_source_table: 'grid_owner_contact_channels',
      contact_source_id: contact.contactChannelId,
      contact_source: contact.source,
      contact_verified: contact.isVerified,
      environment,
      reason: environment === 'production'
        ? 'MANUAL_GRID_OWNER_SAFE_RECIPIENT är satt i PRODUKTION: utskicket går till intern säker adress i stället för nätägarens riktiga kontakt.'
        : 'MANUAL_GRID_OWNER_SAFE_RECIPIENT är satt: test-/staging-utskick går till intern säker adress.',
      production_safe_override_warning: environment === 'production',
      externally_sendable: false,
    }
  }
  return {
    resolution_mode: 'real_grid_owner_contact',
    selected_to_email: contact.email,
    actual_grid_owner_contact_email: contact.email,
    contact_source_table: 'grid_owner_contact_channels',
    contact_source_id: contact.contactChannelId,
    contact_source: contact.source,
    contact_verified: contact.isVerified,
    environment,
    reason: contact.isVerified
      ? 'Verifierad kontaktväg för nätägaren används.'
      : 'Nätägarens kontaktväg används men är inte markerad som verifierad.',
    production_safe_override_warning: false,
    externally_sendable: true,
  }
}

async function findOpenManualRequest(input: { companyId: string; siteId: string; requestType: string }) {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.siteId)
    .eq('request_type', input.requestType)
    .in('status', [
      'draft', 'ready_to_send', 'ready_to_send_manual_email', 'manual_email_queued',
      'manual_email_sent', 'waiting_manual_response', 'manual_response_received', 'needs_review',
      // Persisted configuration blockers are open requests too: when the gate
      // passes later (POA signed, contact added, mailbox configured) the same
      // request row must be reused and advanced instead of colliding with the
      // open-request unique index.
      'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox',
    ])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

// Mirror of the Ediel-side guard (lib/energy/gridOwnerRequests.ts): when an
// Ediel facility lookup is already open for the site, the manual pipeline must
// not open a second, competing conversation with the grid owner.
async function findOpenEdielFacilityLookup(input: { companyId: string; siteId: string }) {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,status,request_type,channel')
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.siteId)
    .eq('request_type', 'facility_lookup')
    .neq('channel', 'manual_email')
    .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return (data as JsonRecord | null) ?? null
}

type ManualEmailAttachment = {
  filename: string
  content: string
  contentType: string
  kind: string
  poa_id: string | null
}

function snapshotField(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as JsonRecord)[key]
  if (typeof value === 'object' && value !== null) {
    return snapshotField(value, key)
  }
  return clean(value)
}

// Attempts to download an uploaded/signed PDF document from storage. Returns a
// base64 string when a real PDF exists, otherwise null.
async function downloadPoaDocument(documentPath: string | null): Promise<string | null> {
  if (!documentPath) return null
  try {
    const { data, error } = await supabaseService.storage.from('customer-documents').download(documentPath)
    if (error || !data) return null
    const buffer = Buffer.from(await data.arrayBuffer())
    if (buffer.length === 0) return null
    // Only accept genuine PDF payloads for external attachment.
    if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) return null
    return buffer.toString('base64')
  } catch {
    return null
  }
}

// Builds the EXTERNAL fullmakt attachment. Never attaches raw JSON: attaches an
// uploaded/signed PDF when one exists, otherwise generates a readable PDF from
// the locked POA/legal snapshot. Emits power_of_attorney_events for audit.
async function buildPoaAttachment(
  poa: JsonRecord | null,
  caseReference: string,
  context: {
    companyId: string
    customerName: string | null
    customerIdentity: string | null
    siteAddress: string | null
    sitePostalCode: string | null
    siteCity: string | null
    tenantCompanyName: string | null
    actorUserId?: string | null
  },
): Promise<ManualEmailAttachment[]> {
  if (!poa) return []

  const fullmaktSnapshot = poa.fullmakt_snapshot ?? null
  const legalTextTitle = snapshotField(fullmaktSnapshot, 'title') ?? snapshotField(fullmaktSnapshot, 'legal_text')
  const legalTextVersion = snapshotField(fullmaktSnapshot, 'version')

  const uploaded = await downloadPoaDocument(clean(poa.document_path))
  if (uploaded) {
    return [
      {
        filename: `fullmakt-${caseReference}.pdf`,
        content: uploaded,
        contentType: 'application/pdf',
        kind: 'power_of_attorney_uploaded_pdf',
        poa_id: clean(poa.id),
      },
    ]
  }

  const pdfBase64 = renderFullmaktPdfBase64({
    caseReference,
    powerOfAttorneyId: clean(poa.id),
    reference: clean(poa.reference),
    customerName: context.customerName,
    customerIdentity: context.customerIdentity ?? clean(poa.signer_identity_number),
    siteAddress: context.siteAddress,
    sitePostalCode: context.sitePostalCode,
    siteCity: context.siteCity,
    representativeName: context.tenantCompanyName ?? 'Gridex AB',
    legalTextTitle,
    legalTextVersion,
    legalTextVersionId: clean(poa.legal_text_version_id),
    acceptedAt: clean(poa.accepted_at) ?? clean(poa.signed_at),
    signerName: clean(poa.signer_name),
    signerIdentityNumber: clean(poa.signer_identity_number) ?? context.customerIdentity,
    method: clean(poa.method),
    source: clean(poa.source),
  })

  return [
    {
      filename: `fullmakt-${caseReference}.pdf`,
      content: pdfBase64,
      contentType: 'application/pdf',
      kind: 'power_of_attorney_generated_pdf',
      poa_id: clean(poa.id),
    },
  ]
}

function poaMissingFields(poa: JsonRecord | null, customerIdentity: string | null): string[] {
  return poaMissingExternalFields(poa, { customerIdentity })
}

async function markRequestNeedsReview(input: {
  requestId: string
  lastErrorCode: string
  lastErrorMessage: string
  missingFields: string[]
  baseMetadata?: JsonRecord | null
}) {
  const now = new Date().toISOString()
  const baseMetadata =
    input.baseMetadata && typeof input.baseMetadata === 'object' ? input.baseMetadata : {}
  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'needs_review',
      last_error_code: input.lastErrorCode,
      last_error_message: input.lastErrorMessage,
      metadata: { ...baseMetadata, missing_fields: input.missingFields, blocked_reason: input.lastErrorCode },
      updated_at: now,
    })
    .eq('id', input.requestId)
    .then(() => undefined, () => undefined)
}

export async function requestMissingFacilityInformation(
  input: RequestMissingFacilityInformationInput,
): Promise<RequestMissingFacilityInformationResult> {
  const requestType = input.requestType ?? 'facility_identifier_lookup'
  const channelType = input.channelType ?? 'facility_information_request'
  const templateKey = input.templateKey ?? 'facility_information_request'
  const requiredScope = input.requiredScope ?? 'facility_information_lookup'

  const blocked = (
    status: ManualInformationRequestStatus,
    code: string,
    message: string,
  ): RequestMissingFacilityInformationResult => ({
    status,
    requestId: null,
    caseReference: null,
    channel: null,
    emailOutboxId: null,
    poaId: null,
    nextAction: { code, message },
    blockers: [{ code, message }],
  })

  // Configuration blockers (missing POA/contact/mailbox) are persisted as
  // request rows so the API/UI always receives a request_id and the blocker is
  // auditable — an ephemeral in-memory blocker leaves "waiting" UIs with
  // nothing to point at. The row is reused and advanced when the gate passes.
  const blockedPersisted = async (input2: {
    status: 'blocked_missing_poa' | 'blocked_missing_grid_owner_contact' | 'blocked_missing_manual_mailbox'
    code: string
    message: string
    gridOwnerId: string
    gridAreaCode: string | null
    poaId?: string | null
  }): Promise<RequestMissingFacilityInformationResult> => {
    const now2 = new Date().toISOString()
    let request = await findOpenManualRequest({ companyId: input.companyId, siteId: input.siteId, requestType })
    if (!request) {
      const inserted = await supabaseService
        .from('grid_owner_information_requests')
        .insert({
          company_id: input.companyId,
          customer_id: input.customerId,
          customer_site_id: input.siteId,
          grid_owner_id: input2.gridOwnerId,
          grid_area_code: input2.gridAreaCode,
          request_type: requestType,
          channel: 'manual_email',
          status: input2.status,
          requires_poa: true,
          poa_id: clean(input2.poaId),
          last_error_code: input2.code,
          last_error_message: input2.message,
          created_by: clean(input.actorUserId),
          updated_by: clean(input.actorUserId),
          metadata: {
            source: input.source ?? 'manual_information_orchestrator',
            channel_type: channelType,
            blocked_reason: input2.code,
          },
          created_at: now2,
          updated_at: now2,
        })
        .select('*')
        .maybeSingle()
      if (inserted.error) {
        if (isUniqueViolation(inserted.error)) {
          request = await findOpenManualRequest({ companyId: input.companyId, siteId: input.siteId, requestType })
        } else if (missingSchema(inserted.error)) {
          request = null
        } else {
          throw inserted.error
        }
      } else {
        request = (inserted.data as JsonRecord | null) ?? null
      }
    } else {
      // Only move pre-send/blocked rows into the (possibly different) blocked
      // status; never downgrade a queued/waiting conversation.
      await supabaseService
        .from('grid_owner_information_requests')
        .update({
          status: input2.status,
          last_error_code: input2.code,
          last_error_message: input2.message,
          updated_by: clean(input.actorUserId),
          updated_at: now2,
        })
        .eq('id', String(request.id))
        .in('status', ['draft', 'ready_to_send', 'ready_to_send_manual_email', 'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox'])
        .then(() => undefined, () => undefined)
    }
    const requestId = request ? String(request.id) : null
    let caseReference = request ? clean(request.case_reference) : null
    if (requestId && !caseReference) {
      caseReference = caseReferenceFor(requestId)
      await supabaseService
        .from('grid_owner_information_requests')
        .update({ case_reference: caseReference, updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .is('case_reference', null)
        .then(() => undefined, () => undefined)
    }
    return {
      status: input2.status,
      requestId,
      caseReference,
      channel: 'manual_email',
      emailOutboxId: null,
      poaId: clean(input2.poaId),
      nextAction: { code: input2.code, message: input2.message },
      blockers: [{ code: input2.code, message: input2.message }],
    }
  }

  const site = await readSite(input)
  if (!site) {
    return blocked('blocked', 'customer_site_missing', 'Anläggning saknas. Komplettera kundkortet innan nätägaruppgifter kan begäras.')
  }

  // facility_id present -> manual facility request is not needed.
  const facilityId = clean(site.facility_id) ?? clean(site.normalized_facility_id)
  if (facilityId) {
    return {
      status: 'not_needed',
      requestId: null,
      caseReference: null,
      channel: null,
      emailOutboxId: null,
      poaId: null,
      nextAction: { code: 'facility_identifier_present', message: 'Anläggnings-ID finns. Fortsätt med leverantörsbyte.' },
      blockers: [],
    }
  }

  const gridOwnerId = clean(site.grid_owner_id) ?? clean(site.selected_grid_owner_id)
  if (!gridOwnerId) {
    return blocked('blocked', 'grid_owner_missing', 'Nätägare saknas. Verifiera nätområde/nätägare innan uppgifter kan begäras.')
  }

  const customer = await readCustomer(input.companyId, input.customerId)
  const protectedIdentity = site.protected_identity === true || customer?.protected_identity === true

  // Power of attorney gate.
  const poa = await findValidPowerOfAttorney({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    requiredScope,
  })
  if (!poa) {
    return blockedPersisted({
      status: 'blocked_missing_poa',
      code: 'power_of_attorney_required',
      message: 'Fullmakt saknas. Skicka fullmaktsbegäran till kunden innan uppgifter kan begäras.',
      gridOwnerId,
      gridAreaCode: clean(site.grid_area_code),
    })
  }

  // Grid owner manual contact channel gate (RECIPIENT address per grid owner).
  const contact = await findContactChannelEmail({ companyId: input.companyId, gridOwnerId, channelType })
  if (!contact) {
    return blockedPersisted({
      status: 'blocked_missing_grid_owner_contact',
      code: 'grid_owner_contact_required',
      message: 'Kontaktväg till nätägaren saknas. Lägg till e-postadress innan begäran kan skickas.',
      gridOwnerId,
      gridAreaCode: clean(site.grid_area_code),
      poaId: clean(poa.id),
    })
  }

  // Manual operations mailbox gate (Gridex SENDER mailbox). This is a distinct
  // concept from grid_owner_contact_channels (recipient) and MUST NOT be the
  // Ediel mailbox. If no manual mailbox is configured we block sending; we never
  // silently fall back to ediel@gridex.se.
  const manualMailbox: ManualOperationsMailbox | null = await resolveManualOperationsMailbox({
    companyId: input.companyId,
    channelType,
  })
  if (!manualMailbox) {
    return blockedPersisted({
      status: 'blocked_missing_manual_mailbox',
      code: 'manual_mailbox_required',
      message: 'Manuell e-postbrevlåda saknas. Lägg till avsändaradress för leverantörsbyte/fullmakt i superadmin innan begäran kan skickas.',
      gridOwnerId,
      gridAreaCode: clean(site.grid_area_code),
      poaId: clean(poa.id),
    })
  }
  const senderFromEmail = manualMailbox.fromEmail
  const senderReplyTo = manualMailbox.replyToEmail ?? manualMailbox.fromEmail

  const now = new Date().toISOString()
  const requestedFields = ['facility_id', 'metering_point_id', 'grid_area_code', 'annual_consumption', 'current_supplier', 'notice_period', 'current_contract_end_date', 'metering_method', 'reporting_frequency']

  // An open Ediel facility lookup owns the grid-owner conversation for this
  // site: do not open a parallel manual request.
  const openEdielLookup = await findOpenEdielFacilityLookup({ companyId: input.companyId, siteId: input.siteId })
  if (openEdielLookup) {
    return blocked(
      'blocked',
      'ediel_facility_lookup_in_progress',
      'En Ediel-baserad anläggningsförfrågan pågår redan för anläggningen. Invänta svaret i stället för att skicka en manuell begäran.',
    )
  }

  // Create or reuse the manual information request (idempotent per open site/type).
  let request = await findOpenManualRequest({ companyId: input.companyId, siteId: input.siteId, requestType })
  if (!request) {
    const insert = {
      company_id: input.companyId,
      customer_id: input.customerId,
      customer_site_id: input.siteId,
      grid_owner_id: gridOwnerId,
      grid_area_code: clean(site.grid_area_code),
      request_type: requestType,
      channel: 'manual_email',
      status: protectedIdentity ? 'needs_review' : 'ready_to_send_manual_email',
      requested_fields: requestedFields,
      requires_poa: true,
      poa_id: clean(poa.id),
      recipient_email: contact.email,
      from_email: senderFromEmail,
      reply_to: senderReplyTo,
      created_by: clean(input.actorUserId),
      updated_by: clean(input.actorUserId),
      metadata: {
        source: input.source ?? 'manual_information_orchestrator',
        channel_type: channelType,
        contact_source: contact.source,
        protected_identity: protectedIdentity,
        manual_mailbox_id: manualMailbox.id,
        manual_mailbox_type: manualMailbox.mailboxType,
      },
      created_at: now,
      updated_at: now,
    }
    const inserted = await supabaseService
      .from('grid_owner_information_requests')
      .insert(insert)
      .select('*')
      .maybeSingle()
    if (inserted.error) {
      // Lost a concurrent race on the open-request unique index -> reuse winner.
      if (isUniqueViolation(inserted.error)) {
        request = await findOpenManualRequest({ companyId: input.companyId, siteId: input.siteId, requestType })
      } else {
        throw inserted.error
      }
    } else {
      request = (inserted.data as JsonRecord | null) ?? null
    }
  }

  if (!request) {
    return blocked('blocked', 'technical_error', 'Begäran kunde inte skapas. Försök igen.')
  }

  const requestId = String(request.id)
  let caseReference = clean(request.case_reference)
  if (!caseReference) {
    caseReference = caseReferenceFor(requestId)
    await supabaseService
      .from('grid_owner_information_requests')
      .update({ case_reference: caseReference, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('case_reference', null)
  }

  // Protected identity: always manual review, never auto-send a manual e-mail.
  if (protectedIdentity) {
    await patchSiteNextAction({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      status: 'needs_review',
      nextAction: 'Skyddad identitet. Hantera begäran manuellt.',
      actorUserId: input.actorUserId,
    })
    return {
      status: 'blocked',
      requestId,
      caseReference,
      channel: 'manual_email',
      emailOutboxId: null,
      poaId: clean(poa.id),
      nextAction: { code: 'protected_identity_manual_review', message: 'Skyddad identitet. Begäran måste hanteras manuellt.' },
      blockers: [{ code: 'protected_identity', message: 'Skyddad identitet kräver manuell granskning.' }],
    }
  }

  // Production guard: never queue an external manual grid-owner e-mail when the
  // required external customer/site fields are missing. A blank Kundnummer/Namn/
  // Person-organisationsnummer must never reach the grid owner. We block to
  // needs_review with an exact error code instead of sending garbage.
  const resolvedCustomerNumber = customerNumber(customer)
  const resolvedCustomerName = customerName(customer)
  const resolvedCustomerIdentity = customerIdentity(customer)
  const siteAddress = clean(site.street)
  const sitePostalCode = clean(site.postal_code)
  const siteCity = clean(site.city)

  const missingCustomerFields: string[] = []
  if (!resolvedCustomerNumber) missingCustomerFields.push('Kundnummer')
  if (!resolvedCustomerName) missingCustomerFields.push('Namn')
  if (!resolvedCustomerIdentity) missingCustomerFields.push('Person-/organisationsnummer')
  if (!siteAddress) missingCustomerFields.push('Gatuadress')
  if (!sitePostalCode) missingCustomerFields.push('Postnummer')
  if (!siteCity) missingCustomerFields.push('Ort')

  if (missingCustomerFields.length > 0) {
    const identityOnly = !resolvedCustomerIdentity && Boolean(resolvedCustomerNumber) && Boolean(resolvedCustomerName)
    const lastErrorCode = identityOnly ? 'missing_customer_identity' : 'missing_customer_details'
    const tenantMessage =
      'Kunduppgifter saknas för manuell nätägarbegäran. Komplettera kundnummer, namn och person-/organisationsnummer innan e-post skickas.'
    await markRequestNeedsReview({
      requestId,
      lastErrorCode,
      lastErrorMessage: tenantMessage,
      missingFields: missingCustomerFields,
      baseMetadata: (request.metadata as JsonRecord | null) ?? null,
    })
    await patchSiteNextAction({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      status: 'needs_review',
      nextAction: tenantMessage,
      actorUserId: input.actorUserId,
    })
    return {
      status: 'needs_review',
      requestId,
      caseReference,
      channel: 'manual_email',
      emailOutboxId: null,
      poaId: clean(poa.id),
      nextAction: { code: lastErrorCode, message: tenantMessage },
      // Tenant sees the single Swedish blocker; superadmin can read the exact
      // missing fields from the per-field blocker entries / request metadata.
      blockers: [
        { code: lastErrorCode, message: tenantMessage },
        ...missingCustomerFields.map((field) => ({
          code: `missing_field:${field}`,
          message: `Saknas: ${field}`,
        })),
      ],
    }
  }

  // Power-of-attorney must be externally sendable before we attach it to an
  // external e-mail. A legally accepted POA that lacks signer/evidence/identity
  // is internal-only: block to needs_review rather than mailing a weak fullmakt.
  if (!hasExternallySendablePoa(poa, { customerIdentity: resolvedCustomerIdentity })) {
    const tenantMessage =
      'Fullmaktsunderlag saknar kund- eller signeringsuppgifter. Granska fullmakten innan den skickas till nätägaren.'
    await markRequestNeedsReview({
      requestId,
      lastErrorCode: 'poa_not_externally_sendable',
      lastErrorMessage: tenantMessage,
      missingFields: poaMissingFields(poa, resolvedCustomerIdentity),
      baseMetadata: (request.metadata as JsonRecord | null) ?? null,
    })
    await patchSiteNextAction({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      status: 'needs_review',
      nextAction: tenantMessage,
      actorUserId: input.actorUserId,
    })
    return {
      status: 'needs_review',
      requestId,
      caseReference,
      channel: 'manual_email',
      emailOutboxId: null,
      poaId: clean(poa.id),
      nextAction: { code: 'poa_not_externally_sendable', message: tenantMessage },
      blockers: [
        { code: 'poa_not_externally_sendable', message: tenantMessage },
        ...poaMissingFields(poa, resolvedCustomerIdentity).map((field) => ({
          code: `missing_field:${field}`,
          message: `Saknas: ${field}`,
        })),
      ],
    }
  }

  // Queue the manual e-mail (idempotent). The worker sends it; never the UI.
  // The key is scoped to the request (type + id): retries of the same open
  // request are deduplicated, while a different request type for the same
  // site/grid owner — or a new request after the previous one completed — can
  // queue its own e-mail.
  const idempotencyKey = `manual-facility-request:${input.companyId}:${input.siteId}:${gridOwnerId}:${requestType}:${requestId}`
  const rendered = renderManualEmailTemplate(templateKey, {
    case_reference: caseReference,
    customer_number: resolvedCustomerNumber,
    customer_name: resolvedCustomerName,
    customer_identity: resolvedCustomerIdentity,
    site_address: siteAddress,
    postal_code: sitePostalCode,
    city: siteCity,
    ops_sender_name: clean(process.env.MANUAL_GRID_OWNER_SENDER_NAME) ?? 'Gridex Operations',
    tenant_company_name: clean(process.env.MANUAL_GRID_OWNER_TENANT_NAME) ?? 'Gridex',
  })
  const attachments = await buildPoaAttachment(poa, caseReference, {
    companyId: input.companyId,
    customerName: resolvedCustomerName,
    customerIdentity: resolvedCustomerIdentity,
    siteAddress,
    sitePostalCode,
    siteCity,
    tenantCompanyName: clean(process.env.MANUAL_GRID_OWNER_TENANT_NAME) ?? 'Gridex',
    actorUserId: input.actorUserId,
  })

  let emailOutboxId: string | null = null
  let alreadyQueued = false
  const recipientResolution = resolveManualRecipient(contact)
  const selectedToEmail = recipientResolution.selected_to_email ?? contact.email
  const outboxInsert: Record<string, unknown> = {
    company_id: input.companyId,
    request_id: requestId,
    to_email: selectedToEmail,
    from_email: senderFromEmail,
    reply_to: senderReplyTo,
    subject: rendered.subject,
    body_html: rendered.bodyHtml,
    body_text: rendered.bodyText,
    attachments,
    status: 'queued',
    provider: 'resend',
    idempotency_key: idempotencyKey,
    queued_at: now,
    recipient_resolution: recipientResolution,
  }
  let queued = await supabaseService
    .from('manual_email_outbox')
    .insert(outboxInsert)
    .select('id')
    .maybeSingle()
  if (queued.error && missingSchema(queued.error)) {
    // Pre-migration schema without recipient_resolution: queue anyway (the
    // resolution is still recorded on the request metadata below).
    const fallbackInsert = { ...outboxInsert }
    delete fallbackInsert.recipient_resolution
    queued = await supabaseService
      .from('manual_email_outbox')
      .insert(fallbackInsert)
      .select('id')
      .maybeSingle()
  }
  if (queued.error) {
    if (isUniqueViolation(queued.error)) {
      alreadyQueued = true
      const existing = await supabaseService
        .from('manual_email_outbox')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      emailOutboxId = clean(existing.data?.id)
    } else {
      throw queued.error
    }
  } else {
    emailOutboxId = clean(queued.data?.id)
  }

  // Advance the request to manual_email_queued (idempotent; already-waiting
  // conversations keep their status). Requests parked in needs_review or a
  // persisted blocked_missing_* state advance too: all gates passed and an
  // e-mail row is now queued, so leaving the old blocker status would lie.
  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      channel: 'manual_email',
      status: 'manual_email_queued',
      recipient_email: selectedToEmail,
      from_email: senderFromEmail,
      reply_to: senderReplyTo,
      poa_id: clean(poa.id),
      last_error_code: null,
      last_error_message: null,
      template_id: `${rendered.templateKey}.${rendered.templateVersion}`,
      metadata: {
        ...((request.metadata as JsonRecord | null) ?? {}),
        recipient_resolution: recipientResolution,
      },
      updated_by: clean(input.actorUserId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .in('status', [
      'draft', 'ready_to_send', 'ready_to_send_manual_email', 'needs_review',
      'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox',
    ])

  // Audit: POA events (only on a fresh queue). A generated PDF records
  // pdf_generated before attached_to_email; an uploaded PDF only records
  // attached_to_email.
  if (!alreadyQueued && clean(poa.id)) {
    const attachmentKind = attachments[0]?.kind ?? null
    if (attachmentKind === 'power_of_attorney_generated_pdf') {
      await supabaseService.from('power_of_attorney_events').insert({
        company_id: input.companyId,
        power_of_attorney_id: poa.id,
        event_type: 'pdf_generated',
        payload: { case_reference: caseReference, request_id: requestId, kind: 'generated_pdf' },
        created_by: clean(input.actorUserId),
      }).then(() => undefined, () => undefined)
    }
    await supabaseService.from('power_of_attorney_events').insert({
      company_id: input.companyId,
      power_of_attorney_id: poa.id,
      event_type: 'attached_to_email',
      payload: {
        case_reference: caseReference,
        request_id: requestId,
        channel: 'manual_email',
        to_email: contact.email,
        attachment_kind: attachmentKind,
      },
      created_by: clean(input.actorUserId),
    }).then(() => undefined, () => undefined)
  }

  const nextAction = {
    code: 'facility_identifier_requested',
    message: 'Anläggnings-ID saknas. Uppgifter har begärts från nätägaren via e-post.',
  }

  // Truthful status: at this point the e-mail is QUEUED, not sent. The manual
  // e-mail worker advances site/customer to waiting_manual_response when the
  // provider confirms the send (advanceLinkedRequest).
  await patchSiteNextAction({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    status: 'manual_email_queued',
    nextAction: 'Begäran är skapad och e-post skickas strax till nätägaren.',
    actorUserId: input.actorUserId,
  })

  await emitCustomerOperationEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.siteId,
    actorUserId: input.actorUserId ?? null,
    eventType: 'manual_facility_request.queued',
    title: 'Begäran köad för utskick',
    message: 'Anläggningsuppgifter begärs från nätägaren via e-post. Utskicket sker strax.',
    status: 'queued',
    severity: 'info',
    source: input.source ?? 'manual_information_orchestrator',
    payload: {
      request_id: requestId,
      case_reference: caseReference,
      channel: 'manual_email',
      to_email: selectedToEmail,
      email_outbox_id: emailOutboxId,
      poa_id: clean(poa.id),
      already_queued: alreadyQueued,
      recipient_resolution: recipientResolution,
    },
    idempotencyKey: `manual_facility_request.queued:${input.companyId}:${input.siteId}:${idempotencyKey}`,
  }).catch(() => undefined)

  return {
    status: 'manual_email_queued',
    requestId,
    caseReference,
    channel: 'manual_email',
    emailOutboxId,
    poaId: clean(poa.id),
    nextAction,
    // A production safe-recipient override is a visible warning, never silent:
    // the mail did NOT go to the real grid owner.
    blockers: recipientResolution.production_safe_override_warning
      ? [{
          code: 'production_safe_recipient_override',
          message: 'VARNING: Produktionsutskicket gick till intern säker adress (MANUAL_GRID_OWNER_SAFE_RECIPIENT), inte till nätägarens riktiga kontakt.',
        }]
      : [],
  }
}

async function patchSiteNextAction(input: {
  companyId: string
  customerId: string
  siteId: string
  status: string
  nextAction: string
  actorUserId?: string | null
}) {
  const now = new Date().toISOString()
  const results = await Promise.all([
    supabaseService
      .from('customer_sites')
      .update({ facility_data_status: input.status, next_action: input.nextAction, updated_at: now, updated_by: clean(input.actorUserId) })
      .eq('company_id', input.companyId)
      .eq('id', input.siteId),
    supabaseService
      .from('customers')
      .update({ next_action: input.nextAction, updated_at: now })
      .eq('company_id', input.companyId)
      .eq('id', input.customerId),
  ])
  for (const result of results) {
    if (result.error && !missingSchema(result.error)) throw result.error
  }
}
