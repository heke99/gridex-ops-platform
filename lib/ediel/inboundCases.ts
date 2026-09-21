import { createHash } from 'node:crypto'
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
import { tenantDb } from '@/lib/supabase/tenantDb'
import { createEdielMessageEvent, linkEdielMessage } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { describeProdatCaseType, edielCodeLabel } from '@/lib/ediel/codeLabels'
import { canonicalIdempotencyKey, onboardCustomerGraph, type CanonicalOnboardingCommand, type CanonicalOnboardingSuccess } from '@/lib/customers/canonicalOnboarding'
import { createTenantContext } from '@/lib/tenant/context'

type JsonRecord = Record<string, unknown>
type ScopedSelect = ReturnType<ReturnType<typeof supabaseService.from>['select']>
type ScopedUpdate = ReturnType<ReturnType<typeof supabaseService.from>['update']>

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

export type ParsedInboundProdat = {
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

export function parseInboundProdatBusinessData(message: EdielMessageRow, object?: {meteringPointId:string;identityAgency:string}): ParsedInboundProdat {
  const payload = message.parsed_payload ?? {}
  const source = parseProdatMessage(message)
  const allObjects = parsedProdatObjects(source)
  const objects = object ? allObjects.filter(row => row.meteringPointId === object.meteringPointId && row.identityAgency === object.identityAgency) : allObjects
  if (object && (objects.length !== 1 || !objects[0].validRegisterChain || !message.raw_payload?.trim())) {
    throw new Error('PRODAT_OBJECT_SELECTION_INVALID')
  }
  const selectedLine = object ? objects[0].registers[0] : source.lineItems[0]
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const hasWireSource = Boolean(message.raw_payload?.trim())
  const sourceSegments = facts.lineItems[selectedLine?.sourceOrder ?? 0]?.effectiveSegments ?? []
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
  const meterPointId = hasWireSource ? selectedLine?.meteringPointId ?? null
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
    numberOrNull(hasWireSource ? selectedLine?.annualConsumption : valueFromParsed(payload, 'annualEnergy', 'estimatedAnnualEnergy', 'annual_consumption_kwh'))
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
    identityAgency: selectedLine?.identityAgency ?? null,
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
  // Unresolved messages may be staged, but must never search tenant masterdata.
  if (!companyId) return { customerId: null, siteId: null, meteringPointId: null, confidence: 0 }

  let customerId: string | null = null
  let siteId: string | null = null
  let meteringPointId: string | null = null
  let confidence = 0
  const orgNumber = trimOrNull(parsed.customer.orgNumber)
  const personalNumber = trimOrNull(parsed.customer.personalNumber)
  const meterPointId = trimOrNull(parsed.meteringPoint.meterPointId)

  if (meterPointId) {
    const meteringPointQuery = supabaseService
      .from('metering_points')
      .select('id,site_id,meter_point_id,ediel_reference')
      .or(`meter_point_id.eq.${meterPointId},ediel_reference.eq.${meterPointId},site_facility_id.eq.${meterPointId}`)
      .eq('company_id', companyId)

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
    const siteQuery = supabaseService
      .from('customer_sites')
      .select('id,customer_id')
      .eq('id', siteId)
      .eq('company_id', companyId)

    const { data, error } = await siteQuery.maybeSingle()
    if (error) throw error
    customerId = (data as { customer_id?: string | null } | null)?.customer_id ?? null
  }

  if (!customerId && orgNumber) {
    const customerByOrgQuery = supabaseService
      .from('customers')
      .select('id')
      .eq('org_number', orgNumber)
      .eq('company_id', companyId)

    const { data, error } = await customerByOrgQuery
      .limit(1)
      .maybeSingle()
    if (error) throw error
    customerId = (data as { id?: string } | null)?.id ?? null
    if (customerId) confidence = Math.max(confidence, 80)
  }

  if (!customerId && personalNumber) {
    const customerByPersonQuery = supabaseService
      .from('customers')
      .select('id')
      .eq('personal_number', personalNumber)
      .eq('company_id', companyId)

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
  const companyId = trimOrNull(params.message.company_id)
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
    const saved = existing as EdielInboundCaseRow
    if (saved.company_id !== companyId) throw new Error('TENANT_CONTEXT_MISMATCH')
    if (saved.review_decision?.objectApplication || ['applied','approved','rejected'].includes(saved.status)) return saved
    const update = supabaseService
      .from('ediel_inbound_cases')
      .update(payload)
      .eq('id', saved.id)
    // Unresolved tenant identity remains null; never broaden to every tenant.
    const scopedUpdate = companyId === null ? update.is('company_id', null) : update.eq('company_id', companyId)
    const { data, error } = await scopedUpdate
      .eq('updated_at', saved.updated_at)
      .eq('status', saved.status)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('PRODAT_INBOUND_CASE_CHANGED')
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

/** Load a review only after the caller has authorized the source message. */
export async function getEdielInboundCaseForMessage(companyId: string, messageId: string): Promise<EdielInboundCaseRow | null> {
  const { data, error } = await (tenantDb(companyId).from('ediel_inbound_cases').select('*') as ScopedSelect)
    .eq('ediel_message_id', messageId).maybeSingle()
  if (error) throw error
  return (data as EdielInboundCaseRow | null) ?? null
}

async function getGridOwnerIdByGridArea(companyId: string, gridAreaCode: string | null): Promise<string | null> {
  if (!gridAreaCode) return null
  const { data, error } = await supabaseService
    .from('grid_owners')
    .select('id,owner_code')
    .eq('company_id', companyId)
    .eq('owner_code', gridAreaCode)
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
function inboundCustomerCommand(params: {
  inboundCase: EdielInboundCaseRow; actorUserId:string; mode:EdielInboundCaseActionMode;
  selectedCustomerId:string|null; selectedSiteId?:string|null; selectedMeteringPointId?:string|null;
  gridOwnerId:string|null; sourceId?:string;
}): CanonicalOnboardingCommand {
  const {inboundCase,mode,selectedCustomerId,gridOwnerId}=params
  if (!inboundCase.company_id) throw new Error('TENANT_CONTEXT_REQUIRED')
    const parsedCustomer = inboundCase.parsed_customer
    const parsedSite = inboundCase.parsed_site
    const parsedMeter = inboundCase.parsed_metering_point
    const production = inboundCase.parsed_production
    const customerType = trimOrNull(parsedCustomer.customerType) === 'business' ? 'business' : 'private'
    const fullName = trimOrNull(parsedCustomer.fullName) ?? trimOrNull(parsedCustomer.companyName) ?? 'Ediel inbound-kund'
    const meterPointId = trimOrNull(parsedMeter.meterPointId) ?? trimOrNull(parsedMeter.referenceToMeteringPoint)
    if (!meterPointId) throw new Error('Mätpunkt/anläggnings-id saknas i inbound-caset.')
    const siteType = production.isMicroProduction === true ? 'production' : trimOrNull(parsedSite.siteType) ?? 'consumption'

    const command:CanonicalOnboardingCommand = {
      company_id: inboundCase.company_id,
      actor_user_id: params.actorUserId,
      channel: 'ediel_inbound',
      idempotency_key: canonicalIdempotencyKey({
        channel: 'ediel_inbound',
        companyId: inboundCase.company_id,
        sourceId: params.sourceId ?? inboundCase.id,
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
        source_record_id: params.sourceId ?? inboundCase.id,
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
    }
    if (!params.sourceId || mode==='create_new_customer') return command
    // Selected graph IDs are checked against the exact source object before any
    // RPC. The existing RPC updates selected site/meter rows even when its
    // update_existing flag is false, so link-only carries identity fields only.
    if (mode==='link_existing_only') return {...command,update_existing:false,customer:{},
      site:{facility_id:meterPointId},metering_point:{meter_point_id:meterPointId}}
    const withoutNulls=(value:Record<string,unknown>):Record<string,unknown>=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null && v!==undefined))
    const customer=withoutNulls(command.customer), site=withoutNulls(command.site ?? {}), meter=withoutNulls(command.metering_point ?? {})
    for(const record of [customer,site,meter]) for(const key of ['status','created_by']) delete record[key]
    delete customer.metadata;delete customer.source
    if (!trimOrNull(parsedCustomer.customerType)) delete customer.customer_type
    if (!trimOrNull(parsedCustomer.fullName) && !trimOrNull(parsedCustomer.companyName)) {delete customer.full_name;delete customer.company_name}
    for(const key of ['site_name','site_type','internal_notes']) delete site[key]
    if (!trimOrNull(parsedSite.country)) delete site.country
    delete meter.measurement_type;delete meter.is_settlement_relevant
    if (!['D','M'].includes(trimOrNull(parsedMeter.readingFrequency) ?? '')) delete meter.reading_frequency
    return {...command,customer,site,metering_point:meter}

}

export async function approveEdielInboundCase(params: {
  companyId?: string
  objectDecisions?: readonly EdielInboundObjectDecision[]
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
  if (params.companyId && params.companyId !== inboundCase.company_id) throw new Error('TENANT_CONTEXT_MISMATCH')
  if (inboundCase.review_decision?.objectApplication || (Array.isArray(inboundCase.proposed_action.objects) && inboundCase.proposed_action.objects.length > 1)) {
    if (!params.objectDecisions) throw new Error('PRODAT_MULTIPLE_OBJECTS_REQUIRE_OBJECT_SCOPED_APPLICATION')
    if (!params.companyId || params.companyId !== inboundCase.company_id) throw new Error('TENANT_CONTEXT_REQUIRED')
    if (params.mode || params.selectedCustomerId || params.selectedSiteId || params.selectedMeteringPointId) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
    return applyInboundObjects({...params,companyId:params.companyId,inboundCase,objectDecisions:params.objectDecisions})
  }
  if (!['pending_review', 'failed'].includes(inboundCase.status)) {
    throw new Error(`Inbound-caset har status ${inboundCase.status} och kan inte godkännas.`)
  }
  if (!inboundCase.company_id) {
    throw new Error('Inbound-caset saknar company_id och kan inte appliceras säkert i SaaS-läge.')
  }

  try {
    const mode = params.mode ?? (inboundCase.customer_id ? 'update_existing_customer' : 'create_new_customer')
    const selectedCustomerId = trimOrNull(params.selectedCustomerId) ?? inboundCase.customer_id
    if (mode === 'link_existing_only' && !selectedCustomerId) {
      throw new Error('Välj en befintlig kund. Link existing only får aldrig skapa en ny kund.')
    }

    const gridOwnerId = await getGridOwnerIdByGridArea(inboundCase.company_id, trimOrNull(inboundCase.parsed_site.gridAreaCode))
    const tenantContext = createTenantContext({
      companyId: inboundCase.company_id,
      actorType: 'user',
      actorId: params.actorUserId,
      permissions: ['ediel.inbound.apply'],
      sourceChannel: 'ediel_inbound',
    })

    const result = await onboardCustomerGraph(inboundCustomerCommand({
      ...params,inboundCase,mode,selectedCustomerId,gridOwnerId,
    }),tenantContext)

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
  companyId?: string
  note?: string | null
}): Promise<EdielInboundCaseRow> {
  const existing = await getEdielInboundCaseById(params.caseId)
  if (!existing) throw new Error('Inbound-caset hittades inte.')
  if (params.companyId && params.companyId !== existing.company_id) throw new Error('TENANT_CONTEXT_MISMATCH')
  if (existing.review_decision?.objectApplication) throw new Error('PRODAT_OBJECT_APPLICATION_IN_PROGRESS')
  if (!['pending_review','failed'].includes(existing.status)) throw new Error('PRODAT_INBOUND_CASE_CHANGED')
  let update = supabaseService
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
    .eq('updated_at', existing.updated_at)
    .eq('status', existing.status)
  update = existing.company_id === null
    ? update.is('company_id', null)
    : update.eq('company_id', existing.company_id)
  const { data, error } = await update
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('PRODAT_INBOUND_CASE_CHANGED')
  return data as EdielInboundCaseRow
}

export type EdielInboundObjectDecision = {
  meteringPointId: string
  identityAgency: string
  mode: EdielInboundCaseActionMode
  selectedCustomerId?: string | null
  selectedSiteId?: string | null
  selectedMeteringPointId?: string | null
}

type ObjectReceipt = { key:string; result:CanonicalOnboardingSuccess }
type ObjectApplication = {
  version:1; revision:number; fingerprint:string; sourceHash:string; originalActorId:string
  decisions:EdielInboundObjectDecision[]; commands:CanonicalOnboardingCommand[]
  commandHash:string; receipts:ObjectReceipt[]
}
const objectKey = (object:Pick<EdielInboundObjectDecision,'meteringPointId'|'identityAgency'>):string => JSON.stringify([object.meteringPointId,object.identityAgency])
function stableObjectJson(value:unknown):string {
  const sort=(item:unknown):unknown=>Array.isArray(item) ? item.map(sort) : item && typeof item==='object'
    ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0).map(([key,entry])=>[key,sort(entry)])) : item
  // Match JSON transport semantics, including omission of undefined properties.
  // JSONB does not preserve object key order; array order remains meaningful.
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))))
}
const digestObject = (value:unknown):string => createHash('sha256').update(stableObjectJson(value)).digest('hex')

/** Existing JSON staging envelope holds an immutable decision/command plan and
 * per-object canonical-RPC receipts. Each graph transaction remains atomic;
 * the entire message is explicitly resumable, NOT an all-or-nothing DB batch.
 * Compare-and-set writes prevent lost receipts or changed choices on retries.
 */
function objectApplication(row:EdielInboundCaseRow):ObjectApplication|null {
  const value=row.review_decision?.objectApplication
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_INVALID')
  const plan=value as ObjectApplication
  if (plan.version !== 1 || !Number.isSafeInteger(plan.revision) || plan.revision<1 || !Array.isArray(plan.decisions) || !Array.isArray(plan.commands) || !Array.isArray(plan.receipts) ||
    plan.decisions.length !== plan.commands.length || !plan.decisions.length || digestObject(plan.commands) !== plan.commandHash ||
    typeof plan.originalActorId !== 'string' || !plan.originalActorId) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_INVALID')
  const keys=new Set(plan.decisions.map(objectKey))
  if (keys.size !== plan.decisions.length || new Set(plan.receipts.map(receipt=>receipt.key)).size !== plan.receipts.length ||
    plan.receipts.some(receipt=>!keys.has(receipt.key) || !receipt.result?.ok || !receipt.result.operation_id || !receipt.result.customer_id || !receipt.result.site_id || !receipt.result.metering_point_id || !receipt.result.application_id)) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_INVALID')
  for (const command of plan.commands) {
    if (command.company_id !== row.company_id || command.channel !== 'ediel_inbound' || !command.idempotency_key) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_INVALID')
  }
  return plan
}

async function compareAndSetObjectCase(row:EdielInboundCaseRow, patch:JsonRecord):Promise<EdielInboundCaseRow|null> {
  const plan=objectApplication(row)
  let query=(tenantDb(row.company_id).from('ediel_inbound_cases').update(patch) as ScopedUpdate)
    .eq('id',row.id).eq('updated_at',row.updated_at).eq('status',row.status)
  // A small explicit revision prevents lost updates even if timestamps collide;
  // do not place a whole command/receipt JSON document in a URL filter.
  query=plan ? query.eq('review_decision->objectApplication->>fingerprint',plan.fingerprint)
    .eq('review_decision->objectApplication->>revision',String(plan.revision))
    : query.is('review_decision->objectApplication',null)
  const {data,error}=await query.select('*').maybeSingle()
  if (error) throw error
  return data as EdielInboundCaseRow|null
}

async function readObjectCase(caseId:string,companyId:string):Promise<EdielInboundCaseRow> {
  const {data,error}=await (tenantDb(companyId).from('ediel_inbound_cases').select('*') as ScopedSelect).eq('id',caseId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('PRODAT_OBJECT_APPLICATION_CASE_MISSING')
  return data as EdielInboundCaseRow
}

async function mutateObjectPlan(input:{caseId:string;companyId:string;fingerprint:string;actorUserId:string}, change:(row:EdielInboundCaseRow,plan:ObjectApplication)=>JsonRecord):Promise<EdielInboundCaseRow> {
  for(let attempt=0;attempt<8;attempt++) {
    const row=await readObjectCase(input.caseId,input.companyId)
    const plan=objectApplication(row)
    if (!plan || plan.fingerprint !== input.fingerprint) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH')
    if (row.status === 'applied') {
      if (plan.receipts.length !== plan.commands.length) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_INVALID')
      return row
    }
    if (!['approved','failed'].includes(row.status)) throw new Error('PRODAT_OBJECT_APPLICATION_CASE_CHANGED')
    const patch=change(row,plan)
    const review=(patch.review_decision ?? row.review_decision) as JsonRecord
    const next=(review.objectApplication ?? plan) as ObjectApplication
    const saved=await compareAndSetObjectCase(row,{...patch,review_decision:{...review,objectApplication:{...next,revision:plan.revision+1}},updated_by:input.actorUserId})
    if (saved) return saved
  }
  throw new Error('PRODAT_OBJECT_APPLICATION_CONCURRENT_UPDATE')
}

/** Selection must name the same source object, not merely some graph owned by
 * the customer. The existing RPC remains the transactional tenant authority. */
async function validateSelectedObjectGraphs(companyId: string, decisions: readonly EdielInboundObjectDecision[]): Promise<void> {
  const sites = new Set<string>(), meters = new Set<string>()
  for (const decision of decisions) {
    for (const [id, seen] of [[decision.selectedSiteId, sites], [decision.selectedMeteringPointId, meters]] as const) {
      if (id && seen.has(id)) throw new Error('PRODAT_OBJECT_GRAPH_SELECTION_INVALID')
      if (id) seen.add(id)
    }
    if (decision.selectedCustomerId) {
      const { data, error } = await (tenantDb(companyId).from('customers').select('id') as ScopedSelect)
        .eq('id', decision.selectedCustomerId).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('PRODAT_OBJECT_GRAPH_SELECTION_INVALID')
    }
    if (decision.selectedSiteId) {
      const { data, error } = await (tenantDb(companyId).from('customer_sites').select('id') as ScopedSelect)
        .eq('id', decision.selectedSiteId).eq('customer_id', decision.selectedCustomerId)
        .eq('facility_id', decision.meteringPointId).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('PRODAT_OBJECT_GRAPH_SELECTION_INVALID')
    }
    if (decision.selectedMeteringPointId) {
      let query = (tenantDb(companyId).from('metering_points').select('id') as ScopedSelect)
        .eq('id', decision.selectedMeteringPointId).eq('customer_id', decision.selectedCustomerId)
        .eq('meter_point_id', decision.meteringPointId)
      if (decision.selectedSiteId) query = query.eq('site_id', decision.selectedSiteId)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      if (!data) throw new Error('PRODAT_OBJECT_GRAPH_SELECTION_INVALID')
    }
  }
}

async function applyInboundObjects(params:{actorUserId:string;caseId:string;companyId:string;inboundCase:EdielInboundCaseRow;objectDecisions:readonly EdielInboundObjectDecision[];note?:string|null}):Promise<EdielInboundCaseRow> {
  const {data,error}=await (tenantDb(params.companyId).from('ediel_messages').select('*') as ScopedSelect)
    .eq('id',params.inboundCase.ediel_message_id).maybeSingle()
  if (error) throw error
  const message=data as EdielMessageRow|null
  if (!message?.raw_payload || message.direction !== 'inbound' || message.message_family !== 'PRODAT') throw new Error('PRODAT_OBJECT_APPLICATION_SOURCE_REQUIRED')
  const facts=parseEdifactMessageFacts(message.raw_payload)
  if (validateProdatRegisterPayload({code:facts.messageCode ?? '',rawSegments:facts.rawSegments,una:parseUna(message.raw_payload)}).some(issue=>issue.blocking)) throw new Error('PRODAT_OBJECT_SELECTION_INVALID')
  const parsed=parseProdatMessage(message)
  const objects=parsedProdatObjects(parsed)
  if (objects.length < 2 || objects.some(object=>!object.meteringPointId || !object.identityAgency || !object.validRegisterChain)) throw new Error('PRODAT_OBJECT_SELECTION_INVALID')
  // The current customer graph stores one facility_id namespace. Never collapse
  // equal IDs from different agencies into that same masterdata identity.
  if (new Set(objects.map(object=>object.meteringPointId)).size !== objects.length) throw new Error('PRODAT_OBJECT_APPLICATION_NAMESPACE_UNSUPPORTED')
  // The existing canonical RPC uppercases and removes non-ASCII-alphanumerics.
  // Preserve every wire identity in staging, but never let that RPC silently
  // rewrite a local ID. Exact namespaced masterdata needs separate DB qualification.
  if (objects.some(object=>!object.meteringPointId || !/^[A-Z0-9]+$/.test(object.meteringPointId))) throw new Error('PRODAT_OBJECT_APPLICATION_IDENTITY_SCHEMA_REQUIRED')
  if (!Array.isArray(params.objectDecisions) || params.objectDecisions.length !== objects.length) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
  const decisions=objects.map(object=>{
    const matching=params.objectDecisions.filter(decision=>decision && decision.meteringPointId===object.meteringPointId && decision.identityAgency===object.identityAgency)
    if (matching.length !== 1) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
    const decision=matching[0]
    if (!['create_new_customer','update_existing_customer','link_existing_only'].includes(decision.mode)) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
    const result:EdielInboundObjectDecision={meteringPointId:object.meteringPointId!,identityAgency:object.identityAgency!,mode:decision.mode,
      selectedCustomerId:trimOrNull(decision.selectedCustomerId),selectedSiteId:trimOrNull(decision.selectedSiteId),selectedMeteringPointId:trimOrNull(decision.selectedMeteringPointId)}
    if (result.mode!=='create_new_customer' && !result.selectedCustomerId) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
    if (result.mode==='create_new_customer' && (result.selectedCustomerId || result.selectedSiteId || result.selectedMeteringPointId)) throw new Error('PRODAT_OBJECT_DECISION_REQUIRED')
    for (const id of [result.selectedCustomerId,result.selectedSiteId,result.selectedMeteringPointId]) {
      if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('PRODAT_OBJECT_SELECTION_ID_INVALID')
    }
    return result
  })
  const sourceHash=createHash('sha256').update(message.raw_payload).digest('hex')
  const fingerprint=digestObject([params.companyId,params.caseId,message.id,sourceHash,decisions])
  let current=params.inboundCase
  let plan=objectApplication(current)
  if (plan && plan.originalActorId!==params.actorUserId) throw new Error('PRODAT_OBJECT_APPLICATION_ACTOR_MISMATCH')
  if (plan && (plan.fingerprint !== fingerprint || plan.sourceHash!==sourceHash || stableObjectJson(plan.decisions)!==stableObjectJson(decisions))) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH')
  for (const decision of decisions) {
    if (decision.selectedMeteringPointId && !decision.selectedSiteId) throw new Error('PRODAT_OBJECT_GRAPH_SELECTION_INVALID')
    if (decision.mode==='link_existing_only' && (!decision.selectedSiteId || !decision.selectedMeteringPointId)) throw new Error('PRODAT_OBJECT_GRAPH_SELECTION_INVALID')
  }
    await validateSelectedObjectGraphs(params.companyId, decisions)
    const commands:CanonicalOnboardingCommand[]=[]
    for (const decision of decisions) {
      const projection=parseInboundProdatBusinessData(message,decision)
      const scopedCase:EdielInboundCaseRow={...current,customer_id:null,site_id:null,metering_point_id:null,
        case_type:projection.caseType,transaction_type:projection.transactionType,parsed_customer:projection.customer,parsed_site:projection.site,
        parsed_metering_point:projection.meteringPoint,parsed_contract:projection.contract,parsed_production:projection.production,proposed_action:projection.proposedAction}
      const gridOwnerId=await getGridOwnerIdByGridArea(params.companyId,trimOrNull(projection.site.gridAreaCode))
      // Object identity, not register index or array position, owns replay and
      // application identity. Changing a later decision cannot create a new key.
      const sourceId=`${current.id}:object:${digestObject([decision.meteringPointId,decision.identityAgency])}`
      commands.push(inboundCustomerCommand({...decision,inboundCase:scopedCase,actorUserId:plan?.originalActorId ?? params.actorUserId,
        selectedCustomerId:decision.selectedCustomerId ?? null,gridOwnerId,sourceId}))
    }
  // Checksums detect accidental drift, not authority. Rebuild the only allowed
  // command shape from the wire and choices, even when stored commands are present.
  if (plan && (plan.originalActorId !== current.reviewed_by || digestObject(commands) !== plan.commandHash)) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH')
  if (!plan) {
    if (!['pending_review','failed'].includes(current.status)) throw new Error('PRODAT_OBJECT_APPLICATION_CASE_CHANGED')
    plan={version:1,revision:1,fingerprint,sourceHash,originalActorId:params.actorUserId,decisions,commands,commandHash:digestObject(commands),receipts:[]}
    const saved=await compareAndSetObjectCase(current,{status:'approved',review_decision:{objectApplication:plan,note:trimOrNull(params.note)},
      reviewed_by:params.actorUserId,reviewed_at:new Date().toISOString(),failure_reason:null,updated_by:params.actorUserId})
    current=saved ?? await readObjectCase(params.caseId,params.companyId)
    plan=objectApplication(current)
    if (!plan || plan.fingerprint !== fingerprint) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH')
  }
  const mutation={caseId:params.caseId,companyId:params.companyId,fingerprint,actorUserId:params.actorUserId}
  try {
    for (const [index,command] of commands.entries()) {
      current=await readObjectCase(params.caseId,params.companyId)
      const latest=objectApplication(current)
      if (!latest || latest.fingerprint !== fingerprint) throw new Error('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH')
      const key=objectKey(plan.decisions[index])
      if (latest.receipts.some(receipt=>receipt.key===key)) continue
      if (!['approved','failed'].includes(current.status)) throw new Error('PRODAT_OBJECT_APPLICATION_CASE_CHANGED')
      const context=createTenantContext({companyId:params.companyId,actorType:'user',actorId:params.actorUserId,permissions:['ediel.inbound.apply'],sourceChannel:'ediel_inbound'})
      const result=await onboardCustomerGraph(command,context)
      if (!result.ok) throw new Error(`PRODAT_OBJECT_APPLICATION_MATCH_UNRESOLVED: ${result.correlation_id}`)
      if ([result.operation_id,result.customer_id,result.site_id,result.metering_point_id,result.application_id].some(value=>!trimOrNull(value))) throw new Error('PRODAT_OBJECT_APPLICATION_RECEIPT_INVALID')
      current=await mutateObjectPlan(mutation,(row,record)=>{
        const previous=record.receipts.find(receipt=>receipt.key===key)
        if (previous && (previous.result.operation_id!==result.operation_id || previous.result.customer_id!==result.customer_id || previous.result.site_id!==result.site_id || previous.result.metering_point_id!==result.metering_point_id)) throw new Error('PRODAT_OBJECT_APPLICATION_RECEIPT_MISMATCH')
        return {status:'approved',failure_reason:null,review_decision:{...row.review_decision,objectApplication:{...record,receipts:previous ? record.receipts : [...record.receipts,{key,result}]}}}
      })
    }
    current=await readObjectCase(params.caseId,params.companyId)
    const completed=objectApplication(current)
    if (!completed || completed.fingerprint!==fingerprint || completed.receipts.length!==completed.commands.length) throw new Error('PRODAT_OBJECT_APPLICATION_INCOMPLETE')
    if (current.status==='applied') return current
    const results={objectCount:completed.commands.length,receipts:completed.receipts,fingerprint,sourceHash}
    // Audit/event failure keeps the durable per-object receipts and allows
    // retry. No singleton message link misattributes B's data to customer A.
    await insertAuditLog({actorUserId:params.actorUserId,companyId:params.companyId,entityType:'ediel_inbound_case',entityId:params.caseId,
      action:'ediel_inbound_objects_applied',newValues:results,metadata:{edielMessageId:message.id,fingerprint}})
    await createEdielMessageEvent({actorUserId:params.actorUserId,edielMessageId:message.id,eventType:'validated',eventStatus:'success',
      message:'Samtliga PRODAT-objekt har egna kanoniska kundtransaktioner och sparade kvitton.',payload:results})
    return await mutateObjectPlan(mutation,()=>({status:'applied',customer_id:null,site_id:null,metering_point_id:null,
      failure_reason:null,applied_at:new Date().toISOString()}))
  } catch (error) {
    const reason=error instanceof Error ? error.message : 'PRODAT_OBJECT_APPLICATION_FAILED'
    const row=await mutateObjectPlan(mutation,()=>({status:'failed',failure_reason:reason}))
    if (row.status==='applied') return row // An identical concurrent retry finished.
    throw error
  }
}