import {rememberCustomerMasterdataDraft} from '@/lib/ediel/prodat/customerMasterdataDraft'
import {createCustomerMasterdataAddressFacts} from '@/lib/ediel/prodat/customerMasterdataAuthority'
// lib/ediel/intent/renderers/facilityLookupZ01.ts
//
// Sanctioned PRODAT Z01 renderer for facility lookup. This is the ONLY place that
// turns a facility-lookup intent into EDIFACT; customer-operation modules must not
// call renderProdat26A/buildEdifactEnvelope directly.
//
// P26.A requires a real object identity and a mandatory LIN for Z01.
// An unresolved facility stays held; no synthetic identity is constructed.

import { resolveSwedishProdatEndUserExport, prodatAddressFactsFromExportContext } from '@/lib/ediel/prodat/customerIdentity'
import { getCustomerExportContext, requireContextCompanyId } from '@/lib/cis/db-shared'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { renderProdat26A } from '@/lib/ediel/prodatEngine'
import { inferEdielFileName } from '@/lib/ediel/classify'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveApplicationReferenceForProcess } from '@/lib/ediel/intent/applicationReferencePolicy'
import { canonicalProdatProfileForMessage } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'

type JsonRecord = Record<string, unknown>

// Derived from the single rule source so facility lookup is deterministically DDQ
// (never inherits a DGI route-profile default).
export const FACILITY_LOOKUP_APPLICATION_REFERENCE =
  resolveApplicationReferenceForProcess('facility_lookup')

// This code cannot authorize an address-only national Z01 profile.
export const Z01_FACILITY_LOOKUP_ALLOWS_MISSING_IDENTIFIER = false

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

export type FacilityLookupZ01Draft = {
  draft: CreateEdielMessageInput
  externalReference: string
  resolvedFacilityIdentifier: string | null
  allowedMissing: string[]
}

export async function buildFacilityLookupZ01Draft(input: {
  companyId: string
  actorUserId: string
  request: FacilityLookupZ01RenderRequest
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  outboundRequestId: string
  operationId: string
  intentId: string
  gridOwner: JsonRecord | null
}): Promise<FacilityLookupZ01Draft> {
  if (!clean(input.companyId)) throw new Error('facility_lookup_company_required')
  if (!input.request.customer_id || !input.request.customer_site_id) {
    throw new Error('facility_lookup_missing_customer_or_site')
  }

  const context = await getCustomerExportContext({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    environment: input.routeContext.environment,
    requireCustomerMasterdata: true,
    customerId: input.request.customer_id,
    siteId: input.request.customer_site_id,
    meteringPointId: null,
  })
  const companyId = requireContextCompanyId(context, 'Bygg facility lookup PRODAT Z01')
  if (companyId !== input.companyId) throw new Error('facility_lookup_tenant_mismatch')
  const customer = (context.customer ?? null) as unknown as JsonRecord | null
  const site = (context.site ?? null) as unknown as JsonRecord | null
  const endUser = resolveSwedishProdatEndUserExport({customer, customerLifeEvent: context.customerLifeEvent, customerMasterdata: context.customerMasterdata})
  const identity = endUser.identity
  if (!identity.id || !identity.qualifier || !identity.name) throw new Error('facility_lookup_verified_customer_identity_required')
  const externalReference = compactReference(`FLZ01-${input.request.id.slice(0, 8)}`, 'FLZ01', 20)
  const transactionReference = compactReference(`FL-${input.request.id.slice(0, 12)}`, 'FL', 25)
  const canonicalProfile = canonicalProdatProfileForMessage('Z01')
  if (!canonicalProfile) throw new Error('facility_lookup_z01_canonical_profile_missing')
  const messageVersion = await resolveCanonicalOutboundVersion({
    family: 'PRODAT',
    code: 'Z01',
    standard: 'edifact',
    routeDefaultMessageVersion: input.routeContext.defaultMessageVersion ?? null,
    environment: input.routeContext.environment,
  })
  if (!messageVersion) throw new Error('facility_lookup_z01_canonical_version_missing')

  // The source-owned site identifier must satisfy the national GSNR profile.
  const resolvedFacilityIdentifier =
    clean(site?.normalized_facility_id) ?? clean(site?.facility_id) ?? null
  if(!resolvedFacilityIdentifier || !/^\d{18}$/.test(resolvedFacilityIdentifier))throw new Error('facility_lookup_verified_object_identity_required')
  const allowedMissing: string[] = []
  const addressLines=endUser.addressLines
  const addressObjects=context.customerMasterdata?createCustomerMasterdataAddressFacts({projection:context.customerMasterdata,meteringPointId:resolvedFacilityIdentifier,identityAgency:'9'}):prodatAddressFactsFromExportContext({companyId,reference:`customer-export-context:${input.request.customer_id}/${input.request.customer_site_id}`,
    meterPointId:resolvedFacilityIdentifier,identityAgency:'9',customer:identity,addressLines})

  const rendered = renderProdat26A({
    context: {
      code: 'Z01',
      bgmReference: externalReference,
      transactionReference,
      senderEdielId: input.routeContext.senderEdielId,
      receiverEdielId: input.routeContext.receiverEdielId,
      customerName: identity.name,
      customerNameLines: endUser.nameLines,
      customerId: identity.id,
      customerIdCodeListQualifier: identity.qualifier,
      meterPointId: resolvedFacilityIdentifier,
      gridAreaId: clean(input.request.grid_area_code) ?? clean(site?.grid_area_code) ?? clean(input.gridOwner?.owner_code),
      startDate: date102(clean(site?.move_in_date)) ?? new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      customerAddressLines: addressLines,
      customerPostalCode: endUser.postalCode,
      customerCity: endUser.city,
      customerCountry: endUser.country,
      siteAddress: clean(site?.street),
      sitePostalCode: clean(site?.postal_code),
      siteCity: clean(site?.city),
      siteCountry: clean(site?.country) ?? 'SE',
      reasonForTransaction: 'Z22',
      powerOfAttorneyReference: externalReference,
      dependentConditionFacts:{endUserAddressAvailable:addressObjects[0].availability==='available',endUserAddressObjects:addressObjects,byCell:{'Z01:233':true,'Z01:234':Boolean(clean(site?.street))}},
    },
  })

  const ack = deriveEdielAckDefaults({ family: 'PRODAT', code: 'Z01' })

  const envelope = buildEdifactEnvelope({
    acknowledgementRequest: ack.requiresContrl,
    senderEdielId: input.routeContext.senderEdielId,
    senderSubAddress: input.routeContext.senderSubAddress,
    receiverEdielId: input.routeContext.receiverEdielId,
    receiverSubAddress: input.routeContext.receiverMessageSubAddress ?? input.routeContext.receiverSubAddress,
    applicationReference: FACILITY_LOOKUP_APPLICATION_REFERENCE,
    testFlag: input.routeContext.environment === 'production' ? 0 : 1,
    messageTypeToken: `PRODAT:D:${canonicalProfile.edifactDirectory.slice(1)}:UN:${canonicalProfile.associationAssignedCode}`,
    segments: rendered.segments,
    companyId,customerMasterdataProjection:context.customerMasterdata??undefined,
    parsedPayload:{prodatEngine:rendered.diagnostics},
  })

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
      customerMasterdataSourceContextId: endUser.sourceContextId,
      draftType: 'facility_lookup_prodat_z01_outbound',
      processLabel: 'facility_lookup_request',
      grid_owner_information_request_id: input.request.id,
      intent_id: input.intentId,
      operation_id: input.operationId,
      lookupMode: 'customer_site_with_facility_identifier',
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
      status: rendered.issues.some(issue => issue.severity === 'error') ? 'blocked' : 'warning',
      checkedAt: new Date().toISOString(),
      facilityLookupDispatch: true,
      objectIdentifierMissing: false,
      allowedMissing,
      reason: 'Facility lookup med känd anläggningsidentifierare.',
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

  rememberCustomerMasterdataDraft(draft,context.customerMasterdata)
  return { draft, externalReference, resolvedFacilityIdentifier, allowedMissing }
}
