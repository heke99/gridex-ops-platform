import { parseProdatMessage, parsedProdatObjects } from '@/lib/ediel/prodat/parser'
import { prodatRegisterFieldValue } from '@/lib/ediel/prodat/prodatRegisterFields'
import { validateProdatRegisterPayload } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import { prodatDateState, prodatDateValue } from '@/lib/ediel/prodat/prodatDateFields'
import { prodatDateToIsoDate } from '@/lib/ediel/prodat/render/dates'
import { readProdatParty } from '@/lib/ediel/prodat/prodatPartyFields'
import { prodatReferenceValue } from '@/lib/ediel/prodat/prodatReferenceFields'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import { parseUna } from '@/lib/ediel/core/una'
// lib/ediel/inboundCases.ts

import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent, linkEdielMessage } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { describeProdatCaseType, edielCodeLabel } from '@/lib/ediel/codeLabels'
import { canonicalIdempotencyKey, onboardCustomerGraph } from '@/lib/customers/canonicalOnboarding'
import { createTenantContext } from '@/lib/tenant/context'

type JsonRecord = Record<string, unknown>

export type EdielInboundCaseStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed'

export type EdielInboundCaseActionMode =
  | 'create_new_customer'
  | 'update_existing_customer'
  | 'link_existing_only'

export type EdielInboundCaseRow = {
  id: string
  company_id: string | null
  ediel_message_id: string
  case_type: string
  message_family: string
  message_code: string
  transaction_type: string | null
  status: EdielInboundCaseStatus
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  match_confidence: number | null
  parsed_customer: JsonRecord
  parsed_site: JsonRecord
  parsed_metering_point: JsonRecord
  parsed_contract: JsonRecord
  parsed_production: JsonRecord
  proposed_action: JsonRecord
  review_decision: JsonRecord | null
  reviewed_by: string | null
  reviewed_at: string | null
  applied_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

type ParsedInboundProdat = {
  caseType: string
  transactionType: string | null
  customer: JsonRecord
  site: JsonRecord
  meteringPoint: JsonRecord
  contract: JsonRecord
  production: JsonRecord
  proposedAction: JsonRecord
}

function trimOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeUpper(value: unknown): string | null {
  const trimmed = trimOrNull(value)
  return trimmed ? trimmed.toUpperCase() : null
}

function normalizeDigits(value: unknown): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  return digits || trimmed
}

function edifactDateToIsoDate(value: unknown): string | null {
  return prodatDateToIsoDate(typeof value === 'string' ? value : null)
}
function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function valueFromParsed(payload: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = trimOrNull(payload[key])
    if (value) return value
  }
  return null
}

function buildInternalNotes(parsed: ParsedInboundProdat): string {
  const rows = [
    'Skapad via Ediel inbound staging efter admin-godkännande.',
    `Case: ${parsed.caseType}`,
    parsed.production.productCode
      ? `Produkt: ${edielCodeLabel('product_code', String(parsed.production.productCode))}`
      : null,
    parsed.production.referenceToMeteringPoint
      ? `Referens till mätpunkt: ${String(parsed.production.referenceToMeteringPoint)}`
      : null,
    parsed.meteringPoint.meteringMethod
      ? `Mätmetod: ${edielCodeLabel('metering_method', String(parsed.meteringPoint.meteringMethod))}`
      : null,
    parsed.meteringPoint.settlementMethod
      ? `Avräkningsmetod: ${edielCodeLabel('settlement_method', String(parsed.meteringPoint.settlementMethod))}`
      : null,
  ].filter(Boolean)

  return rows.join('\n')
}

export function parseInboundProdatBusinessData(message: EdielMessageRow): ParsedInboundProdat {
  const payload = message.parsed_payload ?? {}
  const source = parseProdatMessage(message)
  const objects = parsedProdatObjects(source)
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const hasWireSource = Boolean(message.raw_payload?.trim())
  const sourceSegments = facts.lineItems[0]?.effectiveSegments ?? []
  // Persisted legacy projections must not override or fill absent wire fields.
  // Retain their fallback only when this record has no EDIFACT source at all.
  const characteristic = (field: string, ...fallbackKeys: string[]): string | null => hasWireSource
    ? prodatCharacteristicValue(field, sourceSegments, parseUna(message.raw_payload))
    : valueFromParsed(payload, ...fallbackKeys)
  const reference = (field: string, ...fallbackKeys: string[]): string | null => hasWireSource
    ? prodatReferenceValue(field, sourceSegments, parseUna(message.raw_payload))
    : valueFromParsed(payload, ...fallbackKeys)
  const una = parseUna(message.raw_payload)
  const ud = readProdatParty('UD', sourceSegments, una)
  const it = readProdatParty('IT', sourceSegments, una)
  const balanceResponsible = readProdatParty('Z02', sourceSegments, una)
  const partyValue = (value: string | null, ...fallbackKeys: string[]): string | null => hasWireSource
    ? value : valueFromParsed(payload, ...fallbackKeys)
  const messageCode = hasWireSource ? facts.messageCode ?? '' : String(message.message_code)
  const meterPointId = hasWireSource ? source.lineItems[0]?.meteringPointId ?? null
    : valueFromParsed(payload, 'meterPointId', 'meteringPointId', 'installationId', 'facilityId')
  const contractStart = hasWireSource ? prodatDateValue('210', sourceSegments, una)
    : valueFromParsed(payload, 'contractStartDate', 'contract_start_date', 'startDate')
  const transactionType =
    characteristic('223', 'reasonForTransaction', 'reason_for_transaction', 'transactionType')
  const meteringMethod =
    characteristic('217', 'meteringMethod', 'metering_method')
  const productCode =
    characteristic('242', 'productCode', 'product_code')
  const settlementMethod =
    characteristic('254', 'settlementMethod', 'settlement_method')
  const installationStatus =
    characteristic('306', 'installationStatus', 'installation_status')
  const annualEnergy =
    numberOrNull(hasWireSource ? source.lineItems[0]?.annualConsumption : valueFromParsed(payload, 'annualEnergy', 'estimatedAnnualEnergy', 'annual_consumption_kwh'))
  const referenceToMeteringPoint =
    reference('319', 'referenceToMeteringPoint', 'reference_to_metering_point')

  const customerId = partyValue(ud.id, 'customerId', 'endUserId')
  const customerIdQualifier =
    partyValue(ud.idQualifier, 'customerIdCodeListQualifier', 'end_user_id_code_list_qualifier')
  const customerName = partyValue(ud.name, 'customerName', 'endUserName')

  const isBusiness = customerIdQualifier === 'SE1'
  const isPerson = customerIdQualifier === 'SE2'
  // Keep unrecognised/distributor IDs as evidence, not invented national IDs.
  const nationalId = (!hasWireSource || ud.identityValid) && customerId && /^[0-9]+(?:[-+][0-9]+)?$/.test(customerId) ? normalizeDigits(customerId) : null
  const customer = {
    customerId,
    customerIdQualifier,
    customerIdLabel: edielCodeLabel('customer_id_qualifier', customerIdQualifier),
    customerType: isBusiness ? 'business' : isPerson ? 'private' : null,
    personalNumber: isPerson ? nationalId : null,
    orgNumber: isBusiness ? nationalId : null,
    birthDate: hasWireSource ? prodatDateValue('249', sourceSegments, una) : valueFromParsed(payload, 'birthDate'),
    fullName: customerName,
    companyName: isBusiness ? customerName : null,
    firstName: !isBusiness ? customerName?.split(' ')[0] ?? null : null,
    lastName: !isBusiness ? customerName?.split(' ').slice(1).join(' ') || null : null,
    address: partyValue(ud.address, 'customerAddress'),
    postalCode: partyValue(ud.postalCode, 'customerPostalCode'),
    city: partyValue(ud.city, 'customerCity'),
    country: partyValue(ud.country, 'customerCountry'),
  }

  const site = {
    facilityId: meterPointId,
    siteName: meterPointId ? `Ediel ${meterPointId}` : 'Ediel inbound-anläggning',
    siteType: messageCode === 'Z04' && productCode === 'L641Q' ? 'production' : 'consumption',
    street: partyValue(it.address, 'siteAddress', 'facilityAddress', 'installationAddress'),
    postalCode: partyValue(it.postalCode, 'sitePostalCode', 'facilityPostalCode'),
    city: partyValue(it.city, 'siteCity', 'facilityCity'),
    country: partyValue(it.country, 'siteCountry', 'facilityCountry'),
    gridAreaCode: reference('260', 'gridAreaCode', 'networkAreaId'),
    annualEnergyKwh: annualEnergy,
    validityStartDate: hasWireSource ? prodatDateValue('216', sourceSegments, una) : valueFromParsed(payload, 'validityStartDate'),
    contractStartDate: contractStart,
  }

  const meteringPoint = {
    meterPointId,
    identityAgency: source.lineItems[0]?.identityAgency ?? null,
    registers: objects[0]?.registers ?? [],
    observationLength: hasWireSource ? prodatDateValue('508', sourceSegments, una) : valueFromParsed(payload, 'observationLength'),
    observationLengthFormat: hasWireSource ? prodatDateState('508', sourceSegments, una).format : valueFromParsed(payload, 'observationLengthFormat'),
    firstMeterReadingDate: hasWireSource ? prodatDateValue('212', sourceSegments, una) : valueFromParsed(payload, 'firstMeterReadingDate'),
    referenceToMeteringPoint,
    meteringMethod,
    meteringMethodLabel: edielCodeLabel('metering_method', meteringMethod),
    meterNumber: reference('224', 'meterNumber'),
    meterConstant: numberOrNull(hasWireSource ? prodatRegisterFieldValue('214',sourceSegments,una) : valueFromParsed(payload,'meterConstant')),
    meterDigits: numberOrNull(hasWireSource ? prodatRegisterFieldValue('218',sourceSegments,una) : valueFromParsed(payload,'meterDigits')),
    meterInterval: hasWireSource ? prodatRegisterFieldValue('259',sourceSegments,una) : valueFromParsed(payload,'meterInterval'),
    resolution: numberOrNull(valueFromParsed(payload, 'resolution')),
    readingFrequency: characteristic('222', 'readingFrequency'),
    measurementType: messageCode === 'Z04' && productCode === 'L641Q' ? 'production' : 'consumption',
  }

  const contract = {
    startDate: contractStart,
    agreementReference: reference('261', 'agreementReference'),
    balanceResponsibleId: partyValue(balanceResponsible.id, 'balanceResponsibleId'),
    gridAreaCode: reference('260', 'gridAreaCode', 'networkAreaId'),
  }

  const production = {
    isMicroProduction: messageCode === 'Z04' && productCode === 'L641Q',
    productCode,
    productCodeLabel: edielCodeLabel('product_code', productCode),
    settlementMethod,
    settlementMethodLabel: edielCodeLabel('settlement_method', settlementMethod),
    installationStatus,
    installationStatusLabel: edielCodeLabel('installation_status', installationStatus),
    referenceToMeteringPoint,
  }

  const caseType = describeProdatCaseType({
    messageCode,
    reasonForTransaction: transactionType,
    productCode,
    meteringMethod,
  })

  return {
    caseType,
    transactionType,
    customer,
    site,
    meteringPoint,
    contract,
    production,
    proposedAction: {
      objects,
      objectCount: objects.length,
      action: 'pending_admin_review',
      summary: 'Admin ska granska och godkänna innan kund/anläggning/mätpunkt skapas eller uppdateras.',
      labels: {
        messageCode: edielCodeLabel('prodat_code', messageCode),
        reasonForTransaction: edielCodeLabel('reason_for_transaction', transactionType),
        meteringMethod: edielCodeLabel('metering_method', meteringMethod),
        customerIdQualifier: edielCodeLabel('customer_id_qualifier', customerIdQualifier),
        productCode: edielCodeLabel('product_code', productCode),
        settlementMethod: edielCodeLabel('settlement_method', settlementMethod),
      },
    },
  }
}

async function maybeFindExistingCustomer(parsed: ParsedInboundProdat, companyId?: string | null): Promise<{
  customerId: string | null
  siteId: string | null
  meteringPointId: string | null
  confidence: number
}> {
  let customerId: string | null = null
  let siteId: string | null = null
  let meteringPointId: string | null = null
  let confidence = 0
  const orgNumber = trimOrNull(parsed.customer.orgNumber)
  const personalNumber = trimOrNull(parsed.customer.personalNumber)
  const meterPointId = trimOrNull(parsed.meteringPoint.meterPointId)

  if (meterPointId) {
    let meteringPointQuery = supabaseService
      .from('metering_points')
      .select('id,site_id,meter_point_id,ediel_reference')
      .or(`meter_point_id.eq.${meterPointId},ediel_reference.eq.${meterPointId},site_facility_id.eq.${meterPointId}`)

    if (companyId) {
      meteringPointQuery = meteringPointQuery.eq('company_id', companyId)
    }

    const { data, error } = await meteringPointQuery
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (data) {
      meteringPointId = (data as { id: string }).id
      siteId = (data as { site_id?: string | null }).site_id ?? null
      confidence = 95
    }
  }

  if (siteId) {
    let siteQuery = supabaseService
      .from('customer_sites')
      .select('id,customer_id')
      .eq('id', siteId)

    if (companyId) {
      siteQuery = siteQuery.eq('company_id', companyId)
    }

    const { data, error } = await siteQuery.maybeSingle()
    if (error) throw error
    customerId = (data as { customer_id?: string | null } | null)?.customer_id ?? null
  }

  if (!customerId && orgNumber) {
    let customerByOrgQuery = supabaseService
      .from('customers')
      .select('id')
      .eq('org_number', orgNumber)

    if (companyId) {
      customerByOrgQuery = customerByOrgQuery.eq('company_id', companyId)
    }

    const { data, error } = await customerByOrgQuery
      .limit(1)
      .maybeSingle()
    if (error) throw error
    customerId = (data as { id?: string } | null)?.id ?? null
    if (customerId) confidence = Math.max(confidence, 80)
  }

  if (!customerId && personalNumber) {
    let customerByPersonQuery = supabaseService
      .from('customers')
      .select('id')
      .eq('personal_number', personalNumber)

    if (companyId) {
      customerByPersonQuery = customerByPersonQuery.eq('company_id', companyId)
    }

    const { data, error } = await customerByPersonQuery
      .limit(1)
      .maybeSingle()
    if (error) throw error
    customerId = (data as { id?: string } | null)?.id ?? null
    if (customerId) confidence = Math.max(confidence, 80)
  }

  return { customerId, siteId, meteringPointId, confidence }
}

function isMissingTableError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      ((error as { code?: string }).code === '42P01' ||
        (error as { message?: string }).message?.includes('ediel_inbound_cases'))
  )
}

export async function createOrUpdateInboundProdatCase(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<EdielInboundCaseRow | null> {
  const source = parseEdifactMessageFacts(params.message.raw_payload)
  const registerIssues = validateProdatRegisterPayload({code:source.messageCode ?? '',rawSegments:source.rawSegments,una:parseUna(params.message.raw_payload)})
  if (registerIssues.some(issue => issue.blocking)) throw new Error('PRODAT_REGISTER_STRUCTURE_INVALID: ' + registerIssues.map(issue=>issue.description).join(' | '))
  const parsed = parseInboundProdatBusinessData(params.message)
  const companyId = params.message.company_id ?? null
  const match = Number(parsed.proposedAction.objectCount) > 1 ? {customerId:null,siteId:null,meteringPointId:null,confidence:0}
    : await maybeFindExistingCustomer(parsed, companyId)

  const payload = {
    company_id: companyId,
    ediel_message_id: params.message.id,
    case_type: parsed.caseType,
    message_family: params.message.message_family,
    message_code: String(params.message.message_code),
    transaction_type: parsed.transactionType,
    status: 'pending_review',
    customer_id: match.customerId,
    site_id: match.siteId,
    metering_point_id: match.meteringPointId,
    match_confidence: match.confidence,
    parsed_customer: parsed.customer,
    parsed_site: parsed.site,
    parsed_metering_point: parsed.meteringPoint,
    parsed_contract: parsed.contract,
    parsed_production: parsed.production,
    proposed_action: parsed.proposedAction,
    updated_by: params.actorUserId,
  }

  const { data: existing, error: existingError } = await supabaseService
    .from('ediel_inbound_cases')
    .select('*')
    .eq('ediel_message_id', params.message.id)
    .maybeSingle()

  if (existingError) {
    if (isMissingTableError(existingError)) {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.message.id,
        eventType: 'manual_note',
        eventStatus: 'warning',
        message: 'Inbound case kunde inte skapas eftersom tabellen ediel_inbound_cases saknas. Kör SQL-filen som följde med filpasset.',
        payload: { missingTable: 'ediel_inbound_cases', parsedInbound: parsed },
      })
      return null
    }
    throw existingError
  }

  if (existing) {
    const { data, error } = await supabaseService
      .from('ediel_inbound_cases')
      .update(payload)
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single()
    if (error) throw error
    return data as EdielInboundCaseRow
  }

  const { data, error } = await supabaseService
    .from('ediel_inbound_cases')
    .insert({
      ...payload,
      created_by: params.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: 'Inbound PRODAT-case skapat för admin-godkännande innan masterdata ändras.',
    payload: {
      inboundCaseId: (data as { id: string }).id,
      caseType: parsed.caseType,
      match,
      parsedCustomer: parsed.customer,
      parsedSite: parsed.site,
      parsedMeteringPoint: parsed.meteringPoint,
      parsedProduction: parsed.production,
    },
  })

  return data as EdielInboundCaseRow
}

export async function listEdielInboundCases(options: {
  status?: EdielInboundCaseStatus | 'all'
  limit?: number
} = {}): Promise<EdielInboundCaseRow[]> {
  let query = supabaseService
    .from('ediel_inbound_cases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 30)

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status)
  }

  const { data, error } = await query
  if (error) {
    if (isMissingTableError(error)) return []
    throw error
  }
  return (data ?? []) as EdielInboundCaseRow[]
}

export async function getEdielInboundCaseById(caseId: string): Promise<EdielInboundCaseRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_inbound_cases')
    .select('*')
    .eq('id', caseId)
    .maybeSingle()

  if (error) throw error
  return (data as EdielInboundCaseRow | null) ?? null
}

async function getGridOwnerIdByGridArea(companyId: string, gridAreaCode: string | null): Promise<string | null> {
  if (!gridAreaCode) return null
  const { data, error } = await supabaseService
    .from('grid_owners')
    .select('id,owner_code')
    .eq('company_id', companyId)
    .or(`owner_code.eq.${gridAreaCode},name.ilike.${gridAreaCode}`)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as { id?: string } | null)?.id ?? null
}

async function insertAuditLog(params: {
  actorUserId: string
  companyId?: string | null
  entityType: string
  entityId: string
  action: string
  newValues?: JsonRecord
  metadata?: JsonRecord
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    company_id: params.companyId ?? null,
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })
  if (error) throw error
}

export async function approveEdielInboundCase(params: {
  actorUserId: string
  caseId: string
  mode?: EdielInboundCaseActionMode
  selectedCustomerId?: string | null
  selectedSiteId?: string | null
  selectedMeteringPointId?: string | null
  note?: string | null
}): Promise<EdielInboundCaseRow> {
  const inboundCase = await getEdielInboundCaseById(params.caseId)
  if (!inboundCase) throw new Error('Inbound-caset hittades inte.')
  if (!['pending_review', 'failed'].includes(inboundCase.status)) {
    throw new Error(`Inbound-caset har status ${inboundCase.status} och kan inte godkännas.`)
  }
  if (!inboundCase.company_id) {
    throw new Error('Inbound-caset saknar company_id och kan inte appliceras säkert i SaaS-läge.')
  }

  if (Array.isArray(inboundCase.proposed_action.objects) && inboundCase.proposed_action.objects.length > 1) {
    throw new Error('PRODAT_MULTIPLE_OBJECTS_REQUIRE_OBJECT_SCOPED_APPLICATION: Alla objekt finns i staging; ett enskilt kundgrafanrop får inte markera hela meddelandet som applicerat.')
  }

  try {
    const mode = params.mode ?? (inboundCase.customer_id ? 'update_existing_customer' : 'create_new_customer')
    const selectedCustomerId = trimOrNull(params.selectedCustomerId) ?? inboundCase.customer_id
    if (mode === 'link_existing_only' && !selectedCustomerId) {
      throw new Error('Välj en befintlig kund. Link existing only får aldrig skapa en ny kund.')
    }

    const parsedCustomer = inboundCase.parsed_customer
    const parsedSite = inboundCase.parsed_site
    const parsedMeter = inboundCase.parsed_metering_point
    const production = inboundCase.parsed_production
    const customerType = trimOrNull(parsedCustomer.customerType) === 'business' ? 'business' : 'private'
    const fullName = trimOrNull(parsedCustomer.fullName) ?? trimOrNull(parsedCustomer.companyName) ?? 'Ediel inbound-kund'
    const meterPointId = trimOrNull(parsedMeter.meterPointId) ?? trimOrNull(parsedMeter.referenceToMeteringPoint)
    if (!meterPointId) throw new Error('Mätpunkt/anläggnings-id saknas i inbound-caset.')
    const gridOwnerId = await getGridOwnerIdByGridArea(inboundCase.company_id, trimOrNull(parsedSite.gridAreaCode))
    const siteType = production.isMicroProduction === true ? 'production' : trimOrNull(parsedSite.siteType) ?? 'consumption'

    const tenantContext = createTenantContext({
      companyId: inboundCase.company_id,
      actorType: 'user',
      actorId: params.actorUserId,
      permissions: ['ediel.inbound.apply'],
      sourceChannel: 'ediel_inbound',
    })

    const result = await onboardCustomerGraph({
      company_id: inboundCase.company_id,
      actor_user_id: params.actorUserId,
      channel: 'ediel_inbound',
      idempotency_key: canonicalIdempotencyKey({
        channel: 'ediel_inbound',
        companyId: inboundCase.company_id,
        sourceId: inboundCase.id,
      }),
      matching_policy: mode === 'create_new_customer' ? 'create_separate' : 'link_selected',
      existing_customer_id: mode === 'create_new_customer' ? null : selectedCustomerId,
      existing_site_id: trimOrNull(params.selectedSiteId) ?? inboundCase.site_id,
      existing_metering_point_id: trimOrNull(params.selectedMeteringPointId) ?? inboundCase.metering_point_id,
      update_existing: mode !== 'create_new_customer',
      customer: {
        customer_type: customerType,
        status: 'draft',
        first_name: customerType === 'private' ? trimOrNull(parsedCustomer.firstName) : null,
        last_name: customerType === 'private' ? trimOrNull(parsedCustomer.lastName) : null,
        full_name: fullName,
        company_name: customerType === 'business' ? fullName : null,
        personal_number: customerType === 'private' ? trimOrNull(parsedCustomer.personalNumber) : null,
        org_number: customerType === 'business' ? trimOrNull(parsedCustomer.orgNumber) : null,
        source: 'ediel_inbound',
        metadata: {
          inboundCaseId: inboundCase.id,
          edielMessageId: inboundCase.ediel_message_id,
          caseType: inboundCase.case_type,
        },
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      },
      site: {
        site_name: trimOrNull(parsedSite.siteName) ?? trimOrNull(parsedSite.facilityId) ?? 'Ediel inbound-anläggning',
        facility_id: trimOrNull(parsedSite.facilityId),
        site_type: siteType,
        status: 'draft',
        grid_owner_id: gridOwnerId,
        move_in_date: edifactDateToIsoDate(parsedSite.contractStartDate),
        annual_consumption_kwh: numberOrNull(parsedSite.annualEnergyKwh),
        street: trimOrNull(parsedSite.street),
        postal_code: trimOrNull(parsedSite.postalCode),
        city: trimOrNull(parsedSite.city),
        country: normalizeUpper(parsedSite.country) ?? 'SE',
        internal_notes: buildInternalNotes({
          caseType: inboundCase.case_type,
          transactionType: inboundCase.transaction_type,
          customer: inboundCase.parsed_customer,
          site: inboundCase.parsed_site,
          meteringPoint: inboundCase.parsed_metering_point,
          contract: inboundCase.parsed_contract,
          production: inboundCase.parsed_production,
          proposedAction: inboundCase.proposed_action,
        }),
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      },
      metering_point: {
        meter_point_id: meterPointId,
        metering_point_id: meterPointId,
        site_facility_id: trimOrNull(parsedSite.facilityId) ?? meterPointId,
        ediel_reference: trimOrNull(parsedMeter.referenceToMeteringPoint),
        status: 'draft',
        measurement_type: production.isMicroProduction === true
          ? 'production'
          : trimOrNull(parsedMeter.measurementType) ?? 'consumption',
        reading_frequency: trimOrNull(parsedMeter.readingFrequency) === 'D'
          ? 'daily'
          : trimOrNull(parsedMeter.readingFrequency) === 'M'
            ? 'monthly'
            : 'hourly',
        grid_owner_id: gridOwnerId,
        start_date: edifactDateToIsoDate(inboundCase.parsed_contract.startDate),
        is_settlement_relevant: true,
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      },
      application: {
        source_record_type: 'ediel_inbound_case',
        source_record_id: inboundCase.id,
        status: 'committed',
        payload_snapshot: {
          edielMessageId: inboundCase.ediel_message_id,
          caseType: inboundCase.case_type,
          transactionType: inboundCase.transaction_type,
          prodatObjects: inboundCase.proposed_action.objects ?? [],
          prodatRegisters: parsedMeter.registers ?? [],
          mode,
        },
      },
    }, tenantContext)

    if (!result.ok) {
      throw new Error(`Tvetydig kundmatchning blockerade Ediel-caset. Referens: ${result.correlation_id}.`)
    }

    const reviewDecision = {
      mode,
      note: trimOrNull(params.note),
      appliedCustomerId: result.customer_id,
      appliedSiteId: result.site_id,
      appliedMeteringPointId: result.metering_point_id,
      onboardingOperationId: result.operation_id,
      correlationId: result.correlation_id,
    }

    const { data, error } = await supabaseService
      .from('ediel_inbound_cases')
      .update({
        status: 'applied',
        customer_id: result.customer_id,
        site_id: result.site_id,
        metering_point_id: result.metering_point_id,
        review_decision: reviewDecision,
        reviewed_by: params.actorUserId,
        reviewed_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
        failure_reason: null,
        updated_by: params.actorUserId,
      })
      .eq('id', inboundCase.id)
      .eq('company_id', inboundCase.company_id)
      .select('*')
      .single()
    if (error) throw error

    await linkEdielMessage({
      actorUserId: params.actorUserId,
      edielMessageId: inboundCase.ediel_message_id,
      customerId: result.customer_id,
      siteId: result.site_id,
      meteringPointId: result.metering_point_id,
      gridOwnerId,
      switchRequestId: null,
      relatedMessageId: null,
    })

    await insertAuditLog({
      actorUserId: params.actorUserId,
      companyId: inboundCase.company_id,
      entityType: 'ediel_inbound_case',
      entityId: inboundCase.id,
      action: 'ediel_inbound_case_applied',
      newValues: reviewDecision,
      metadata: {
        edielMessageId: inboundCase.ediel_message_id,
        caseType: inboundCase.case_type,
        onboardingOperationId: result.operation_id,
        correlationId: result.correlation_id,
      },
    })

    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: inboundCase.ediel_message_id,
      eventType: 'validated',
      eventStatus: 'success',
      message: 'Inbound PRODAT-case godkänt och applicerat genom kanonisk kundtransaktion.',
      payload: reviewDecision,
    })

    return data as EdielInboundCaseRow
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : 'Okänt fel vid applicering.'
    const { error: updateError } = await supabaseService
      .from('ediel_inbound_cases')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        updated_by: params.actorUserId,
      })
      .eq('id', inboundCase.id)
      .eq('company_id', inboundCase.company_id)
    if (updateError) throw updateError
    throw error
  }
}

export async function rejectEdielInboundCase(params: {
  actorUserId: string
  caseId: string
  note?: string | null
}): Promise<EdielInboundCaseRow> {
  const { data, error } = await supabaseService
    .from('ediel_inbound_cases')
    .update({
      status: 'rejected',
      review_decision: {
        note: trimOrNull(params.note),
        decision: 'rejected',
      },
      reviewed_by: params.actorUserId,
      reviewed_at: new Date().toISOString(),
      updated_by: params.actorUserId,
    })
    .eq('id', params.caseId)
    .select('*')
    .single()

  if (error) throw error
  return data as EdielInboundCaseRow
}
