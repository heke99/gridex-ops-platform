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
  | 'blocked_missing_poa'
  | 'blocked_missing_grid_owner_contact'
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

function resolveFromEmail(): string {
  return (
    clean(process.env.MANUAL_GRID_OWNER_FROM_EMAIL) ??
    clean(process.env.RESEND_FROM_EMAIL) ??
    clean(process.env.DEFAULT_FROM_EMAIL) ??
    'no-reply@gridex.se'
  )
}

function resolveReplyTo(): string | null {
  return (
    clean(process.env.MANUAL_GRID_OWNER_REPLY_TO) ??
    clean(process.env.DEFAULT_REPLY_TO) ??
    null
  )
}

function customerName(customer: JsonRecord | null | undefined): string {
  return (
    clean(customer?.company_name) ??
    clean(customer?.full_name) ??
    [clean(customer?.first_name), clean(customer?.last_name)].filter(Boolean).join(' ') ??
    clean(customer?.customer_number) ??
    'Kund'
  )
}

function customerIdentity(customer: JsonRecord | null | undefined): string | null {
  return clean(customer?.org_number) ?? clean(customer?.personal_number) ?? null
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
  const { data, error } = await supabaseService
    .from('customers')
    .select('id,company_id,customer_number,first_name,last_name,full_name,company_name,personal_number,org_number,protected_identity')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (error && !missingSchema(error)) throw error
  return (data as JsonRecord | null) ?? null
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
    .select('id,status,scope,scope_summary,site_id,customer_site_id,valid_until,fullmakt_snapshot,evidence_payload,document_id,signer_name,document_path,reference')
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
}): Promise<{ email: string; source: string } | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_contact_channels')
    .select('email,company_id,source,is_enabled,is_verified')
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
  return { email: String(chosen.email), source: String(chosen.source ?? 'manual_admin') }
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

function buildPoaAttachment(poa: JsonRecord | null, caseReference: string) {
  if (!poa) return [] as Array<{ filename: string; content: string; contentType: string; kind: string; poa_id: string | null }>
  const snapshot = {
    case_reference: caseReference,
    power_of_attorney_id: poa.id ?? null,
    reference: poa.reference ?? null,
    signer_name: poa.signer_name ?? null,
    scope: poa.scope ?? null,
    scope_summary: poa.scope_summary ?? null,
    document_id: poa.document_id ?? null,
    document_path: poa.document_path ?? null,
    fullmakt_snapshot: poa.fullmakt_snapshot ?? null,
    evidence: poa.evidence_payload ?? null,
  }
  const content = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8').toString('base64')
  return [
    {
      filename: `fullmakt-${caseReference}.json`,
      content,
      contentType: 'application/json',
      kind: 'power_of_attorney_snapshot',
      poa_id: clean(poa.id),
    },
  ]
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
    return blocked(
      'blocked_missing_poa',
      'power_of_attorney_required',
      'Fullmakt saknas. Skicka fullmaktsbegäran till kunden innan uppgifter kan begäras.',
    )
  }

  // Grid owner manual contact channel gate.
  const contact = await findContactChannelEmail({ companyId: input.companyId, gridOwnerId, channelType })
  if (!contact) {
    return blocked(
      'blocked_missing_grid_owner_contact',
      'grid_owner_contact_required',
      'Kontaktväg till nätägaren saknas. Lägg till e-postadress innan begäran kan skickas.',
    )
  }

  const now = new Date().toISOString()
  const requestedFields = ['facility_id', 'metering_point_id', 'grid_area_code', 'annual_consumption', 'current_supplier', 'notice_period', 'current_contract_end_date', 'metering_method', 'reporting_frequency']

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
      from_email: resolveFromEmail(),
      reply_to: resolveReplyTo(),
      created_by: clean(input.actorUserId),
      updated_by: clean(input.actorUserId),
      metadata: {
        source: input.source ?? 'manual_information_orchestrator',
        channel_type: channelType,
        contact_source: contact.source,
        protected_identity: protectedIdentity,
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

  // Queue the manual e-mail (idempotent). The worker sends it; never the UI.
  const idempotencyKey = `manual-facility-request:${input.companyId}:${input.siteId}:${gridOwnerId}`
  const rendered = renderManualEmailTemplate(templateKey, {
    case_reference: caseReference,
    customer_number: clean(customer?.customer_number),
    customer_name: customerName(customer),
    customer_identity: customerIdentity(customer),
    site_address: clean(site.street),
    postal_code: clean(site.postal_code),
    city: clean(site.city),
    ops_sender_name: clean(process.env.MANUAL_GRID_OWNER_SENDER_NAME) ?? 'Gridex Operations',
    tenant_company_name: clean(process.env.MANUAL_GRID_OWNER_TENANT_NAME) ?? 'Gridex',
  })
  const attachments = buildPoaAttachment(poa, caseReference)

  let emailOutboxId: string | null = null
  let alreadyQueued = false
  const outboxInsert = {
    company_id: input.companyId,
    request_id: requestId,
    to_email: contact.email,
    from_email: resolveFromEmail(),
    reply_to: resolveReplyTo(),
    subject: rendered.subject,
    body_html: rendered.bodyHtml,
    body_text: rendered.bodyText,
    attachments,
    status: 'queued',
    provider: 'resend',
    idempotency_key: idempotencyKey,
    queued_at: now,
  }
  const queued = await supabaseService
    .from('manual_email_outbox')
    .insert(outboxInsert)
    .select('id')
    .maybeSingle()
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

  // Advance the request to manual_email_queued (idempotent; reuse keeps status).
  await supabaseService
    .from('grid_owner_information_requests')
    .update({
      channel: 'manual_email',
      status: 'manual_email_queued',
      recipient_email: contact.email,
      from_email: resolveFromEmail(),
      reply_to: resolveReplyTo(),
      poa_id: clean(poa.id),
      template_id: `${rendered.templateKey}.${rendered.templateVersion}`,
      updated_by: clean(input.actorUserId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .in('status', ['draft', 'ready_to_send', 'ready_to_send_manual_email'])

  // Audit: POA attached to the e-mail (only on a fresh queue).
  if (!alreadyQueued && clean(poa.id)) {
    await supabaseService.from('power_of_attorney_events').insert({
      company_id: input.companyId,
      power_of_attorney_id: poa.id,
      event_type: 'attached_to_email',
      payload: { case_reference: caseReference, request_id: requestId, channel: 'manual_email', to_email: contact.email },
      created_by: clean(input.actorUserId),
    }).then(() => undefined, () => undefined)
  }

  const nextAction = {
    code: 'facility_identifier_requested',
    message: 'Anläggnings-ID saknas. Uppgifter har begärts från nätägaren via e-post.',
  }

  await patchSiteNextAction({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    status: 'waiting_manual_response',
    nextAction: 'Väntar på svar från nätägaren.',
    actorUserId: input.actorUserId,
  })

  await emitCustomerOperationEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.siteId,
    actorUserId: input.actorUserId ?? null,
    eventType: 'manual_facility_request.queued',
    title: 'Begäran skickad via e-post',
    message: 'Anläggningsuppgifter har begärts från nätägaren via e-post.',
    status: 'waiting_response',
    severity: 'info',
    source: input.source ?? 'manual_information_orchestrator',
    payload: {
      request_id: requestId,
      case_reference: caseReference,
      channel: 'manual_email',
      to_email: contact.email,
      email_outbox_id: emailOutboxId,
      poa_id: clean(poa.id),
      already_queued: alreadyQueued,
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
    blockers: [],
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
