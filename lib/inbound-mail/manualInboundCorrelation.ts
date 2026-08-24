import { supabaseService } from '@/lib/supabase/service'
import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'

type JsonRecord = Record<string, unknown>

const OPEN_REQUEST_STATUSES = [
  'manual_email_queued',
  'manual_email_sent',
  'waiting_manual_response',
  'manual_response_received',
  'needs_review',
  'ready_to_send_manual_email',
]

export type ManualInboundCorrelationEmail = {
  mailbox?: string | null
  mailboxCompanyId?: string | null
  fromEmail?: string | null
  toEmail?: string | null
  threadId?: string | null
  inReplyTo?: string | null
  references?: string[] | null
}

export type ManualInboundIntent = {
  intent: string
  businessProcess: string
  confidence: number
}

export type ManualInboundCorrelationResult = {
  resolutionStatus: 'matched' | 'ambiguous' | 'unmatched' | 'ignored'
  companyId: string | null
  request: JsonRecord | null
  requestId: string | null
  gridOwnerId: string | null
  customerId: string | null
  customerSiteId: string | null
  meteringPointId: string | null
  tenantResolutionMethod: string | null
  entityResolutionMethod: string | null
  senderCredible: boolean
  intent: string
  businessProcess: string
  intentConfidence: number
  evidence: JsonRecord
}

type CompanyEvidence = {
  source: string
  companyId: string
  strength: number
  value?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null
}

function normalizeMessageId(value: unknown): string | null {
  const raw = clean(value)
  if (!raw) return null
  return raw.replace(/^<|>$/g, '').trim().toLowerCase() || null
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function messageReferenceCandidates(email: ManualInboundCorrelationEmail): string[] {
  const raw = [clean(email.inReplyTo), clean(email.threadId), ...(email.references ?? []).map(clean)]
    .filter((value): value is string => Boolean(value))
    .slice(0, 20)
  const normalized = raw.map(normalizeMessageId).filter((value): value is string => Boolean(value))
  return unique([...raw, ...normalized]).slice(0, 40)
}

function extractCustomerNumber(text: string): string | null {
  const match = String(text ?? '').match(/\b(?:kundnummer|kundnr|customer\s*(?:number|no))\s*[:#-]?\s*([A-Z0-9-]{4,32})\b/i)
  return match?.[1]?.trim().toUpperCase() ?? null
}

function requestIntent(requestType: string | null): ManualInboundIntent | null {
  switch (requestType) {
    case 'facility_identifier_lookup':
    case 'facility_lookup':
    case 'metering_point_lookup':
    case 'grid_area_confirmation':
    case 'grid_contract_information':
      return { intent: 'facility_information_response', businessProcess: 'facility_information', confidence: 1 }
    case 'supplier_switch_manual':
      return { intent: 'supplier_switch_response', businessProcess: 'supplier_switch', confidence: 1 }
    case 'metering_values_request':
      return { intent: 'metering_values', businessProcess: 'metering', confidence: 1 }
    case 'ai_list_request':
      return { intent: 'grid_owner_information_response', businessProcess: 'grid_owner_information', confidence: 1 }
    default:
      return null
  }
}

export function classifyManualInboundIntent(text: string, requestType?: string | null): ManualInboundIntent {
  const fromRequest = requestIntent(clean(requestType))
  if (fromRequest) return fromRequest

  const value = String(text ?? '').toLowerCase()
  if (/fullmakt|power\s+of\s+attorney/.test(value)) {
    return { intent: 'power_of_attorney_question', businessProcess: 'power_of_attorney', confidence: 0.9 }
  }
  if (/leverant[oö]rsbyte|supplier\s+switch/.test(value)) {
    if (/avvis|nekad|nekas|reject/.test(value)) {
      return { intent: 'supplier_switch_rejection', businessProcess: 'supplier_switch', confidence: 0.94 }
    }
    if (/godk[aä]nd|accepterad|accepted|ok\b/.test(value)) {
      return { intent: 'supplier_switch_acceptance', businessProcess: 'supplier_switch', confidence: 0.94 }
    }
    return { intent: 'supplier_switch_question', businessProcess: 'supplier_switch', confidence: 0.82 }
  }
  if (/utflytt|flyttat\s+ut|flyttar\s+ut|move[- ]?out/.test(value)) {
    return { intent: 'move_out_notice', businessProcess: 'move_out', confidence: 0.9 }
  }
  if (/m[aä]tv[aä]rd|metering\s+value|m[aä]tpunkt|anl[aä]ggnings[- ]?id|gsrn/.test(value)) {
    return { intent: 'metering_information', businessProcess: 'metering', confidence: 0.82 }
  }
  if (/faktura|invoice/.test(value)) {
    return { intent: 'invoice_question', businessProcess: 'billing', confidence: 0.84 }
  }
  if (/klagom[aå]l|complaint|reklamation/.test(value)) {
    return { intent: 'complaint', businessProcess: 'customer_service', confidence: 0.86 }
  }
  if (value.includes('?')) {
    return { intent: 'general_grid_owner_question', businessProcess: 'grid_owner_communication', confidence: 0.62 }
  }
  return { intent: 'unknown', businessProcess: 'unknown', confidence: 0.3 }
}

async function findRequestByCaseReference(caseReference: string): Promise<{ request: JsonRecord | null; ambiguous: boolean }> {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('case_reference', caseReference)
    .in('status', OPEN_REQUEST_STATUSES)
    .limit(3)
  if (error) throw error
  const rows = (data ?? []) as JsonRecord[]
  return { request: rows.length === 1 ? rows[0] : null, ambiguous: rows.length > 1 }
}

async function readRequest(companyId: string, requestId: string): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  return (data as JsonRecord | null) ?? null
}

async function findResendProviderIdsByRfcMessageId(references: string[]): Promise<string[]> {
  if (!references.length) return []

  // Resend's API email_id (stored in manual_email_outbox.provider_message_id)
  // is not the SMTP/RFC Message-ID carried by In-Reply-To/References. Verified
  // Resend webhook events store both values, so bridge RFC Message-ID -> email_id
  // here before resolving the outbox/request. Keep the direct provider-id path
  // below for legacy/other providers.
  const { data, error } = await supabaseService
    .from('communication_log_events')
    .select('provider_message_id,event_payload')
    .eq('provider', 'resend')
    .in('event_payload->data->>message_id', references)
    .limit(50)
  if (error) throw error

  return unique(
    ((data ?? []) as JsonRecord[])
      .map((row) => clean(row.provider_message_id))
      .filter((value): value is string => Boolean(value)),
  )
}

async function findRequestByOutboundReferences(references: string[]): Promise<{
  request: JsonRecord | null
  ambiguous: boolean
  outboxIds: string[]
  matchMethods: string[]
}> {
  if (!references.length) return { request: null, ambiguous: false, outboxIds: [], matchMethods: [] }

  const directResult = await supabaseService
    .from('manual_email_outbox')
    .select('id,company_id,request_id,provider_message_id')
    .in('provider_message_id', references)
    .limit(10)
  if (directResult.error) throw directResult.error

  const rowsById = new Map<string, JsonRecord>()
  for (const row of (directResult.data ?? []) as JsonRecord[]) {
    const id = clean(row.id)
    if (id) rowsById.set(id, row)
  }
  const matchMethods: string[] = rowsById.size ? ['provider_message_id'] : []

  const resendProviderIds = await findResendProviderIdsByRfcMessageId(references)
  if (resendProviderIds.length) {
    const resendResult = await supabaseService
      .from('manual_email_outbox')
      .select('id,company_id,request_id,provider_message_id')
      .in('provider_message_id', resendProviderIds)
      .limit(10)
    if (resendResult.error) throw resendResult.error
    for (const row of (resendResult.data ?? []) as JsonRecord[]) {
      const id = clean(row.id)
      if (id) rowsById.set(id, row)
    }
    if ((resendResult.data ?? []).length) matchMethods.push('resend_rfc_message_id')
  }

  const rows = Array.from(rowsById.values())
  const requestKeys = unique(rows.flatMap((row) => {
    const companyId = clean(row.company_id)
    const requestId = clean(row.request_id)
    return companyId && requestId ? [`${companyId}:${requestId}`] : []
  }))
  if (requestKeys.length !== 1) {
    return {
      request: null,
      ambiguous: requestKeys.length > 1,
      outboxIds: rows.map((row) => clean(row.id)).filter((value): value is string => Boolean(value)),
      matchMethods: unique(matchMethods),
    }
  }
  const [companyId, requestId] = requestKeys[0].split(':')
  return {
    request: await readRequest(companyId, requestId),
    ambiguous: false,
    outboxIds: rows.map((row) => clean(row.id)).filter((value): value is string => Boolean(value)),
    matchMethods: unique(matchMethods),
  }
}

async function findVerifiedSenderContacts(fromEmail: string | null): Promise<JsonRecord[]> {
  const from = normalizeEmail(fromEmail)
  if (!from) return []
  const { data, error } = await supabaseService
    .from('grid_owner_contact_channels')
    .select('grid_owner_id,company_id,email,channel_type,is_verified,is_enabled')
    .eq('is_enabled', true)
    .eq('is_verified', true)
    .ilike('email', from)
    .limit(50)
  if (error) throw error
  return (data ?? []) as JsonRecord[]
}

async function findSitesByFacility(facilityId: string | null): Promise<JsonRecord[]> {
  if (!facilityId || !/^\d{18}$/.test(facilityId)) return []
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,grid_owner_id,facility_id,normalized_facility_id,status')
    .or(`facility_id.eq.${facilityId},normalized_facility_id.eq.${facilityId}`)
    .limit(20)
  if (error) throw error
  return (data ?? []) as JsonRecord[]
}

async function findMeteringPoints(input: { meteringPointId: string | null; facilityId: string | null }): Promise<JsonRecord[]> {
  const filters: string[] = []
  if (input.meteringPointId && /^\d{18}$/.test(input.meteringPointId)) filters.push(`meter_point_id.eq.${input.meteringPointId}`)
  if (input.facilityId && /^\d{18}$/.test(input.facilityId)) filters.push(`site_facility_id.eq.${input.facilityId}`)
  if (!filters.length) return []
  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id,company_id,customer_id,site_id,grid_owner_id,meter_point_id,site_facility_id,status')
    .or(filters.join(','))
    .limit(20)
  if (error) throw error
  return (data ?? []) as JsonRecord[]
}

async function findCustomersByNumber(customerNumber: string | null): Promise<JsonRecord[]> {
  if (!customerNumber) return []
  const { data, error } = await supabaseService
    .from('customers')
    .select('id,company_id,customer_number,status')
    .ilike('customer_number', customerNumber)
    .limit(20)
  if (error) throw error
  return (data ?? []) as JsonRecord[]
}

function uniqueCompanyId(rows: JsonRecord[]): string | null {
  const ids = unique(rows.map((row) => clean(row.company_id)).filter((value): value is string => Boolean(value)))
  return ids.length === 1 ? ids[0] : null
}

function addCompanyEvidence(target: CompanyEvidence[], source: string, companyId: string | null, strength: number, value?: string | null) {
  if (!companyId) return
  target.push({ source, companyId, strength, value })
}

function requestTypesForIntent(intent: string): string[] | null {
  if (intent === 'facility_information_response' || intent === 'metering_information') {
    return ['facility_identifier_lookup', 'facility_lookup', 'metering_point_lookup', 'grid_area_confirmation', 'grid_contract_information']
  }
  if (intent.startsWith('supplier_switch_')) return ['supplier_switch_manual']
  if (intent === 'metering_values') return ['metering_values_request']
  return null
}

async function findOpenRequestForEntity(input: {
  companyId: string
  customerId: string | null
  siteId: string | null
  gridOwnerId: string | null
  intent: string
}): Promise<{ request: JsonRecord | null; candidateIds: string[] }> {
  if (!input.customerId && !input.siteId) return { request: null, candidateIds: [] }
  let query = supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .in('status', OPEN_REQUEST_STATUSES)
    .order('created_at', { ascending: false })
    .limit(5)
  if (input.siteId) query = query.eq('customer_site_id', input.siteId)
  else if (input.customerId) query = query.eq('customer_id', input.customerId)
  if (input.gridOwnerId) query = query.eq('grid_owner_id', input.gridOwnerId)
  const requestTypes = requestTypesForIntent(input.intent)
  if (requestTypes?.length) query = query.in('request_type', requestTypes)
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as JsonRecord[]
  return {
    request: rows.length === 1 ? rows[0] : null,
    candidateIds: rows.map((row) => clean(row.id)).filter((value): value is string => Boolean(value)),
  }
}

function senderIsCredible(input: {
  fromEmail: string | null
  companyId: string | null
  gridOwnerId: string | null
  request: JsonRecord | null
  contacts: JsonRecord[]
}): boolean {
  const from = normalizeEmail(input.fromEmail)
  if (!from || !input.companyId || !input.gridOwnerId) return false
  if (normalizeEmail(input.request?.recipient_email) === from) return true
  return input.contacts.some((row) => {
    const contactCompanyId = clean(row.company_id)
    return normalizeEmail(row.email) === from
      && clean(row.grid_owner_id) === input.gridOwnerId
      && (contactCompanyId === null || contactCompanyId === input.companyId)
  })
}

export async function resolveManualInboundCorrelation(input: {
  email: ManualInboundCorrelationEmail
  caseReference: string | null
  normalizedText: string
  extracted: ManualFacilityExtractedPayload
}): Promise<ManualInboundCorrelationResult> {
  const evidence: JsonRecord = {}
  const companyEvidence: CompanyEvidence[] = []
  let request: JsonRecord | null = null
  let hardAmbiguous = false

  if (input.caseReference) {
    const caseMatch = await findRequestByCaseReference(input.caseReference)
    request = caseMatch.request
    hardAmbiguous = hardAmbiguous || caseMatch.ambiguous
    evidence.case_reference = input.caseReference
    evidence.case_reference_matched = Boolean(caseMatch.request)
    addCompanyEvidence(companyEvidence, 'request_case_reference', clean(caseMatch.request?.company_id), 100, input.caseReference)
  }

  const references = messageReferenceCandidates(input.email)
  if (!request && references.length) {
    const replyMatch = await findRequestByOutboundReferences(references)
    request = replyMatch.request
    hardAmbiguous = hardAmbiguous || replyMatch.ambiguous
    evidence.reply_reference_candidates = references
    evidence.reply_reference_outbox_ids = replyMatch.outboxIds
    evidence.reply_reference_match_methods = replyMatch.matchMethods
    evidence.reply_reference_matched = Boolean(replyMatch.request)
    addCompanyEvidence(companyEvidence, 'request_reply_reference', clean(replyMatch.request?.company_id), 95, references[0] ?? null)
  }

  const mailboxCompanyId = clean(input.email.mailboxCompanyId)
  if (mailboxCompanyId) addCompanyEvidence(companyEvidence, 'tenant_mailbox', mailboxCompanyId, 90, clean(input.email.mailbox))

  const senderContacts = await findVerifiedSenderContacts(clean(input.email.fromEmail))
  const senderTenantIds = unique(senderContacts.map((row) => clean(row.company_id)).filter((value): value is string => Boolean(value)))
  const senderGridOwnerIds = unique(senderContacts.map((row) => clean(row.grid_owner_id)).filter((value): value is string => Boolean(value)))
  evidence.verified_sender_grid_owner_ids = senderGridOwnerIds
  evidence.verified_sender_tenant_ids = senderTenantIds

  const facilityId = clean(input.extracted.facility_id)?.replace(/\s/g, '') ?? null
  const meteringPointIdValue = clean(input.extracted.metering_point_id)?.replace(/\s/g, '') ?? null
  const customerNumber = extractCustomerNumber(input.normalizedText)
  const [sites, meteringPoints, customers] = await Promise.all([
    findSitesByFacility(facilityId),
    findMeteringPoints({ meteringPointId: meteringPointIdValue, facilityId }),
    findCustomersByNumber(customerNumber),
  ])

  evidence.facility_id = facilityId
  evidence.metering_point_value = meteringPointIdValue
  evidence.customer_number = customerNumber
  evidence.site_match_count = sites.length
  evidence.metering_point_match_count = meteringPoints.length
  evidence.customer_number_match_count = customers.length

  addCompanyEvidence(companyEvidence, 'unique_facility', uniqueCompanyId(sites), 80, facilityId)
  addCompanyEvidence(companyEvidence, 'unique_metering_point', uniqueCompanyId(meteringPoints), 80, meteringPointIdValue ?? facilityId)
  addCompanyEvidence(companyEvidence, 'unique_customer_number', uniqueCompanyId(customers), 75, customerNumber)
  if (!companyEvidence.length && senderTenantIds.length === 1) {
    addCompanyEvidence(companyEvidence, 'verified_sender_override', senderTenantIds[0], 60, normalizeEmail(input.email.fromEmail))
  }

  const strongCompanyEvidence = companyEvidence.filter((row) => row.strength >= 75)
  const companyCandidates = unique((strongCompanyEvidence.length ? strongCompanyEvidence : companyEvidence).map((row) => row.companyId))
  if (companyCandidates.length > 1) hardAmbiguous = true
  const companyId = companyCandidates.length === 1 ? companyCandidates[0] : null
  evidence.tenant_evidence = companyEvidence
  evidence.tenant_candidate_ids = companyCandidates

  const tenantResolutionMethod = companyId
    ? [...companyEvidence].sort((a, b) => b.strength - a.strength).find((row) => row.companyId === companyId)?.source ?? null
    : null

  let companySites = companyId ? sites.filter((row) => clean(row.company_id) === companyId) : []
  const companyMetering = companyId ? meteringPoints.filter((row) => clean(row.company_id) === companyId) : []
  const companyCustomers = companyId ? customers.filter((row) => clean(row.company_id) === companyId) : []

  const uniqueSiteIds = unique([
    ...companySites.map((row) => clean(row.id)),
    ...companyMetering.map((row) => clean(row.site_id)),
  ].filter((value): value is string => Boolean(value)))
  if (uniqueSiteIds.length > 1) hardAmbiguous = true
  const customerSiteId = uniqueSiteIds.length === 1 ? uniqueSiteIds[0] : clean(request?.customer_site_id)

  if (companyId && customerSiteId && companySites.every((row) => clean(row.id) !== customerSiteId)) {
    const { data, error } = await supabaseService
      .from('customer_sites')
      .select('id,company_id,customer_id,grid_owner_id,facility_id,status')
      .eq('company_id', companyId)
      .eq('id', customerSiteId)
      .maybeSingle()
    if (error) throw error
    if (data) companySites = [...companySites, data as JsonRecord]
  }

  const uniqueMeterIds = unique(companyMetering.map((row) => clean(row.id)).filter((value): value is string => Boolean(value)))
  if (uniqueMeterIds.length > 1 && meteringPointIdValue) hardAmbiguous = true
  const meteringPointId = uniqueMeterIds.length === 1 ? uniqueMeterIds[0] : null

  const customerIds = unique([
    clean(request?.customer_id),
    ...companySites.filter((row) => !customerSiteId || clean(row.id) === customerSiteId).map((row) => clean(row.customer_id)),
    ...companyMetering.filter((row) => !customerSiteId || clean(row.site_id) === customerSiteId).map((row) => clean(row.customer_id)),
    ...companyCustomers.map((row) => clean(row.id)),
  ].filter((value): value is string => Boolean(value)))
  if (customerIds.length > 1) hardAmbiguous = true
  const customerId = customerIds.length === 1 ? customerIds[0] : null

  const siteGridOwnerIds = unique([
    ...companySites.filter((row) => !customerSiteId || clean(row.id) === customerSiteId).map((row) => clean(row.grid_owner_id)),
    ...companyMetering.filter((row) => !customerSiteId || clean(row.site_id) === customerSiteId).map((row) => clean(row.grid_owner_id)),
  ].filter((value): value is string => Boolean(value)))
  const requestGridOwnerId = clean(request?.grid_owner_id)
  let gridOwnerId = requestGridOwnerId ?? (siteGridOwnerIds.length === 1 ? siteGridOwnerIds[0] : null)
  if (!gridOwnerId && senderGridOwnerIds.length === 1) gridOwnerId = senderGridOwnerIds[0]
  if (requestGridOwnerId && siteGridOwnerIds.length === 1 && requestGridOwnerId !== siteGridOwnerIds[0]) hardAmbiguous = true
  if (gridOwnerId && senderGridOwnerIds.length > 0 && !senderGridOwnerIds.includes(gridOwnerId)) {
    evidence.sender_grid_owner_mismatch = true
  }

  let intent = classifyManualInboundIntent(input.normalizedText, clean(request?.request_type))

  if (!request && companyId && !hardAmbiguous) {
    const requestMatch = await findOpenRequestForEntity({
      companyId,
      customerId,
      siteId: customerSiteId,
      gridOwnerId,
      intent: intent.intent,
    })
    evidence.entity_request_candidate_ids = requestMatch.candidateIds
    if (requestMatch.request) {
      request = requestMatch.request
      gridOwnerId = clean(request.grid_owner_id) ?? gridOwnerId
      intent = classifyManualInboundIntent(input.normalizedText, clean(request.request_type))
    }
  }

  const senderCredible = !evidence.sender_grid_owner_mismatch && senderIsCredible({
    fromEmail: clean(input.email.fromEmail),
    companyId,
    gridOwnerId,
    request,
    contacts: senderContacts,
  })

  const requestId = clean(request?.id)
  const resolvedCustomerId = clean(request?.customer_id) ?? customerId
  const resolvedSiteId = clean(request?.customer_site_id) ?? customerSiteId

  const entityMethods: string[] = []
  if (requestId) entityMethods.push('request')
  if (resolvedSiteId && facilityId) entityMethods.push('facility_id')
  if (meteringPointId) entityMethods.push('metering_point_id')
  if (resolvedCustomerId && customerNumber) entityMethods.push('customer_number')
  const entityResolutionMethod = entityMethods.length ? unique(entityMethods).join('+') : null

  evidence.sender_credible = senderCredible
  evidence.request_id = requestId
  evidence.customer_id = resolvedCustomerId
  evidence.customer_site_id = resolvedSiteId
  evidence.metering_point_id = meteringPointId
  evidence.grid_owner_id = gridOwnerId
  evidence.hard_ambiguous = hardAmbiguous

  let resolutionStatus: ManualInboundCorrelationResult['resolutionStatus']
  if (hardAmbiguous) resolutionStatus = 'ambiguous'
  else if (!companyId || (!requestId && !resolvedCustomerId && !resolvedSiteId && !meteringPointId)) resolutionStatus = 'unmatched'
  else if (!senderCredible) resolutionStatus = 'ignored'
  else resolutionStatus = 'matched'

  return {
    resolutionStatus,
    companyId,
    request,
    requestId,
    gridOwnerId,
    customerId: resolvedCustomerId,
    customerSiteId: resolvedSiteId,
    meteringPointId,
    tenantResolutionMethod,
    entityResolutionMethod,
    senderCredible,
    intent: intent.intent,
    businessProcess: intent.businessProcess,
    intentConfidence: intent.confidence,
    evidence,
  }
}