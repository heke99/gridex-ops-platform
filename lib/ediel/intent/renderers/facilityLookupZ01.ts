// lib/ediel/intent/renderers/facilityLookupZ01.ts
//
// Sanctioned PRODAT Z01 renderer for facility lookup. This is the ONLY place that
// turns a facility-lookup intent into EDIFACT; customer-operation modules must not
// call renderProdat26A/buildEdifactEnvelope directly.
//
// No-placeholder rule (Batch 2): when the facility/metering point identifier is
// genuinely unknown (the whole point of a facility lookup), the object identifier
// is OMITTED and the absence is modelled explicitly in payload/validation_result.
// A Z01 customer-identity request is address-keyed and its rulebook profile does
// not require LIN, so this is a documented allowed-missing case — never 'UNKNOWN'.

import { getCustomerExportContext, requireContextCompanyId } from '@/lib/cis/db-shared'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { renderProdat26A } from '@/lib/ediel/prodatEngine'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveApplicationReferenceForProcess } from '@/lib/ediel/intent/applicationReferencePolicy'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'

type JsonRecord = Record<string, unknown>

// Derived from the single rule source so facility lookup is deterministically DDQ
// (never inherits a DGI route-profile default).
export const FACILITY_LOOKUP_APPLICATION_REFERENCE =
  resolveApplicationReferenceForProcess('facility_lookup')

// Z01 customer-identity request may be address-keyed; LIN/object-id is not a
// required signal for Z01, so a missing facility/metering identifier is a
// documented allowed-missing case (modelled, never a placeholder string).
export const Z01_FACILITY_LOOKUP_ALLOWS_MISSING_IDENTIFIER = true

export type FacilityLookupZ01RenderRequest = {
  id: string
  customer_id: string | null
  customer_site_id: string | null
  grid_owner_id: string | null
  grid_area_code: string | null
  price_area: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sanitize(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n'+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function date102(value?: string | null): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(0, 8) : null
}

function compactReference(value: string | null | undefined, fallbackPrefix: string, maxLength: number): string {
  const cleaned = sanitize(value).toUpperCase().replace(/[^A-Z0-9_.\/-]/g, '')
  if (cleaned) return cleaned.slice(0, maxLength)
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 12)
  return `${fallbackPrefix}${stamp}`.slice(0, maxLength)
}

function customerName(customer: JsonRecord | null | undefined): string {
  const name = sanitize(
    customer?.company_name ??
      customer?.full_name ??
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ??
      customer?.customer_number ??
      'Kund',
  )
  return name || 'Kund'
}

function customerIdentifier(customer: JsonRecord | null | undefined): { id: string | null; qualifier: string | null } {
  const id = sanitize(customer?.personal_number ?? customer?.org_number ?? customer?.customer_number ?? '')
  if (!id) return { id: null, qualifier: null }
  return {
    id,
    qualifier: customer?.org_number ? '1' : id.length === 10 ? 'SE1' : 'SE2',
  }
}

export type FacilityLookupZ01Draft = {
  draft: CreateEdielMessageInput
  externalReference: string
  resolvedFacilityIdentifier: string | null
  allowedMissing: string[]
}

export async function buildFacilityLookupZ01Draft(input: {
  actorUserId: string
  request: FacilityLookupZ01RenderRequest
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  outboundRequestId: string
  operationId: string
  intentId: string
  gridOwner: JsonRecord | null
}): Promise<FacilityLookupZ01Draft> {
  if (!input.request.customer_id || !input.request.customer_site_id) {
    throw new Error('facility_lookup_missing_customer_or_site')
  }

  const context = await getCustomerExportContext({
    customerId: input.request.customer_id,
    siteId: input.request.customer_site_id,
    meteringPointId: null,
  })
  const companyId = requireContextCompanyId(context, 'Bygg facility lookup PRODAT Z01')
  const customer = (context.customer ?? null) as unknown as JsonRecord | null
  const site = (context.site ?? null) as unknown as JsonRecord | null
  const identity = customerIdentifier(customer)
  const externalReference = compactReference(`FLZ01-${input.request.id.slice(0, 8)}`, 'FLZ01', 20)
  const transactionReference = compactReference(`FL-${input.request.id.slice(0, 12)}`, 'FL', 25)
  const canonicalProfile = getCanonicalProdatProfile('Z01')
  if (!canonicalProfile) throw new Error('facility_lookup_z01_canonical_profile_missing')
  const messageVersion = await resolveCanonicalOutboundVersion({
    family: 'PRODAT',
    code: 'Z01',
    standard: 'edifact',
    routeDefaultMessageVersion: input.routeContext.defaultMessageVersion ?? null,
    environment: input.routeContext.environment,
  })
  if (!messageVersion) throw new Error('facility_lookup_z01_canonical_version_missing')

  // Use a real identifier when the site already has one; otherwise this is the
  // documented allowed-missing facility lookup (no fabricated id).
  const resolvedFacilityIdentifier =
    clean(site?.normalized_facility_id) ?? clean(site?.facility_id) ?? null
  const allowedMissing = resolvedFacilityIdentifier ? [] : ['facility_id', 'metering_point_id']

  const rendered = renderProdat26A({
    context: {
      code: 'Z01',
      bgmReference: externalReference,
      transactionReference,
      senderEdielId: input.routeContext.senderEdielId,
      receiverEdielId: input.routeContext.receiverEdielId,
      customerName: customerName(customer),
      customerId: identity.id,
      customerIdCodeListQualifier: identity.qualifier,
      // Empty id => generic builder omits LIN object identifier (no 'UNKNOWN').
      meterPointId: resolvedFacilityIdentifier ?? '',
      gridAreaId: clean(input.request.grid_area_code) ?? clean(site?.grid_area_code) ?? clean(input.gridOwner?.owner_code),
      startDate: date102(clean(site?.move_in_date)) ?? new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      customerAddress: clean(site?.street),
      customerPostalCode: clean(site?.postal_code),
      customerCity: clean(site?.city),
      customerCountry: clean(site?.country) ?? 'SE',
      siteAddress: clean(site?.street),
      sitePostalCode: clean(site?.postal_code),
      siteCity: clean(site?.city),
      siteCountry: clean(site?.country) ?? 'SE',
      reasonForTransaction: 'Z22',
      powerOfAttorneyReference: externalReference,
    },
  })

  const envelope = buildEdifactEnvelope({
    senderEdielId: input.routeContext.senderEdielId,
    senderSubAddress: input.routeContext.senderSubAddress,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverSubAddress: input.routeContext.receiverMessageSubAddress ?? input.routeContext.receiverSubAddress,
    applicationReference: FACILITY_LOOKUP_APPLICATION_REFERENCE,
    testFlag: input.routeContext.environment === 'production' ? 0 : 1,
    messageTypeToken: `PRODAT:D:${canonicalProfile.edifactDirectory.slice(1)}:UN:${canonicalProfile.associationAssignedCode}`,
    segments: rendered.segments,
  })
  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z01' })

  const draft: CreateEdielMessageInput = {
    actorUserId: input.actorUserId,
    companyId,
    intentId: input.intentId,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode: 'Z01',
    messageVersion,
    processType: 'facility_lookup_request',
    environment: input.routeContext.environment,
    testFlag: input.routeContext.environment === 'production' ? 0 : 1,
    status: 'draft',
    transportType: 'smtp',
    mailbox: input.routeContext.mailbox,
    senderEdielId: input.routeContext.senderEdielId,
    senderName: input.routeContext.senderName,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverName: input.routeContext.receiverName,
    senderSubAddress: input.routeContext.senderSubAddress,
    receiverSubAddress: input.routeContext.receiverMessageSubAddress ?? input.routeContext.receiverSubAddress,
    receiverEmail: input.routeContext.receiverEmail,
    subject: `PRODAT Z01 facility lookup ${externalReference}`,
    fileName: inferEdielFileName({ family: 'PRODAT', code: 'Z01', direction: 'outbound', extension: 'edi' }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    externalReference,
    transactionReference,
    applicationReference: FACILITY_LOOKUP_APPLICATION_REFERENCE,
    communicationRouteId: input.routeContext.route.id,
    outboundRequestId: input.outboundRequestId,
    customerId: input.request.customer_id,
    siteId: input.request.customer_site_id,
    meteringPointId: null,
    gridOwnerId: input.request.grid_owner_id,
    rawPayload: envelope.raw,
    parsedPayload: {
      draftType: 'facility_lookup_prodat_z01_outbound',
      processLabel: 'facility_lookup_request',
      grid_owner_information_request_id: input.request.id,
      intent_id: input.intentId,
      operation_id: input.operationId,
      lookupMode: resolvedFacilityIdentifier
        ? 'customer_site_with_facility_identifier'
        : 'customer_site_address_without_facility_identifier',
      resolvedFacilityIdentifier,
      allowedMissing,
      requestedFields: ['facility_id', 'metering_point_id', 'grid_area_code', 'price_area'],
      expectedResponse: 'CONTRL/APERAK och därefter PRODAT Z02 eller negativ APERAK',
      gridOwnerId: input.request.grid_owner_id,
      gridAreaCode: input.request.grid_area_code,
      priceArea: input.request.price_area,
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
    },
    validationReport: {
      status: 'warning',
      checkedAt: new Date().toISOString(),
      facilityLookupDispatch: true,
      objectIdentifierMissing: !resolvedFacilityIdentifier,
      allowedMissing,
      reason: resolvedFacilityIdentifier
        ? 'Facility lookup med känd anläggningsidentifierare.'
        : 'Facility/metering identifier saknas och begärs från nätägaren (dokumenterad allowed-missing för Z01).',
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
      engineIssues: rendered.issues,
      payloadPreflight: envelope.payloadPreflight,
    },
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    ackDueAt: computeOutboundAckDueAt({
      requiresContrl: ack.requiresContrl,
      requiresAperak: ack.requiresAperak,
      contrlStatus: ack.contrlStatus,
      aperakStatus: ack.aperakStatus,
      utiltsErrStatus: ack.utiltsErrStatus,
    }),
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
  }

  return { draft, externalReference, resolvedFacilityIdentifier, allowedMissing }
}
