import {qualifyBilateralProdatSwitchPreparation,bilateralProdatSwitchPreparationQualified,type QualifiedBilateralProdatSwitchPreparation} from '@/lib/ediel/production/bilateralProdatSwitchPreparation'
import {rememberCustomerMasterdataDraft} from '@/lib/ediel/prodat/customerMasterdataDraft'
import {canonicalProdatSubtypeAlias} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {resolveProdatEndUserGroupRequirement} from '@/lib/ediel/prodat/prodatParentApplicability'
import {createCustomerMasterdataAddressFacts} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import {readContractRequestedMethodSource,assertContractRequestedMethodSelection,type ContractRequestedMethodBasis} from '@/lib/ediel/production/contractRequestedMethodSource'
import {prepareQualifiedBrpSource,type BrpFieldBasis} from '@/lib/ediel/production/brpFieldSource'
import { prodatDateToIsoDate,prodatDate203,prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { parseProdatMessage as parseSourceProdat } from '@/lib/ediel/prodat/parser'
import { prodatReferenceByQualifier } from '@/lib/ediel/prodat/prodatReferenceFields'
import { prodatDocumentValue } from '@/lib/ediel/prodat/prodatDocumentFields'
import { segmentComposite, tokenizeEdifact, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
// lib/ediel/prodat.ts

import type {
  CreateEdielMessageInput,
  EdielEnvironment,
  EdielKnownMessageCode,
  EdielMessageFamily,
} from '@/lib/ediel/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'
import {buildEdielInterchangeReference,buildEdielTransactionReference} from '@/lib/ediel/core/referenceRegistry'
import { buildCanonicalOutboundReferences } from '@/lib/ediel/core/referenceRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { renderProdat, renderProdat26A } from '@/lib/ediel/prodatEngine'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import { getCustomerExportContext, requireContextCompanyId, type CustomerExportContext } from '@/lib/cis/db-shared'
import { resolveSwedishProdatEndUserExport, prodatAddressFactsFromExportContext } from '@/lib/ediel/prodat/customerIdentity'
import { isProdatCodeSendable } from '@/lib/ediel/prodat/prodatMessageSupportRegistry'
import {
  PRODAT_CANONICAL_PROFILES,
  getCanonicalProdatProfile,
} from '@/lib/ediel/rulebook/prodatRulebook'

export type ProdatSwitchCode = 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z09' | 'Z10' | 'Z13' | 'Z14' | 'Z15' | 'Z18'

export type ParsedProdatMessage = {
  messageFamily: Extract<EdielMessageFamily, 'PRODAT'>
  messageCode: ProdatSwitchCode | EdielKnownMessageCode | null
  messageVersion: string | null
  transactionReference: string | null
  externalReference: string | null
  applicationReference: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  senderSubAddress: string | null
  receiverSubAddress: string | null
  rawSegments: string[]
  parsedPayload: Record<string, unknown>
}

export type ProdatSwitchValidationSeverity = 'error' | 'warning'

export type ProdatSwitchValidationIssue = {
  severity: ProdatSwitchValidationSeverity
  code: string
  title: string
  description: string
}

export type ProdatSwitchValidationResult = {
  isReady: boolean
  code: ProdatSwitchCode
  issues: ProdatSwitchValidationIssue[]
}

export type ProdatSwitchWireReferences=Readonly<{documentReference:string;transactionReference:string;interchangeReference:string;messageReference:string}>
export function allocateProdatSwitchWireReferences(code:ProdatSwitchCode,contextId:string,senderEdielId:string,receiverEdielId:string):ProdatSwitchWireReferences{
 return Object.freeze({documentReference:buildEdielTransactionReference({family:'PRODAT',code,relatedMessageId:contextId}),transactionReference:buildEdielTransactionReference({family:'PRODAT',code:'LI',relatedMessageId:contextId}),interchangeReference:buildEdielInterchangeReference({senderEdielId,receiverEdielId}),messageReference:'1'})
}

type BaseSwitchOutboundInput = {
  contractId?: string | null
  wireReferences?: ProdatSwitchWireReferences
  actorUserId?: string | null
  senderEdielId: string
  senderName?: string | null
  receiverEdielId: string
  receiverName?: string | null
  receiverEmail?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
  subject?: string | null
  applicationReference?: string | null
  externalReference?: string | null
  transactionReference?: string | null
  correlationReference?: string | null
  routeDefaultMessageVersion?: string | null
  environment?: EdielEnvironment | null
}

const PRODAT_SWITCH_CODE_SET = new Set<string>(
  PRODAT_CANONICAL_PROFILES
    .filter((profile) =>
      ['supplier_switch', 'masterdata', 'metering', 'metering_access'].includes(profile.processGroup)
    )
    .map((profile) => profile.messageCode)
)

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/[\r\n'+]/g, ' ').replace(/\s+/g, ' ').trim()
}

function pushIssue(
  issues: ProdatSwitchValidationIssue[],
  issue: ProdatSwitchValidationIssue
) {
  issues.push(issue)
}

function extractReference(rawPayload: string, qualifier: string): string | null {
  const tokenized = tokenizeEdifact(rawPayload)
  return prodatReferenceByQualifier(qualifier, tokenized.segments, tokenized.una)
}

/** Preserve this legacy date-only projection while reading the exact DTM value
 * component with the declared syntax. Full DTM business semantics are separate. */
function extractDateFromDtm(segment: EdifactTokenizedSegment | null | undefined, una: EdifactServiceStringAdvice): string | null {
  const parts = segmentComposite(segment, 1, una)
  const raw = parts[1] ?? ''
  if (parts.length !== 3 || !((parts[2] === '102' && /^\d{8}$/.test(raw)) || (parts[2] === '203' && /^\d{12}$/.test(raw)))) return null
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  const parsed = new Date(`${date}T00:00:00Z`)
  if (raw.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null
  if (parts[2] === '203' && (Number(raw.slice(8, 10)) > 23 || Number(raw.slice(10, 12)) > 59)) return null
  return date
}

function inferMeterPointIdentifier(meteringPoint: MeteringPointRow): string {
  return String(meteringPoint.ediel_reference || meteringPoint.meter_point_id || '').trim()
}


function prodatCodeLabel(code: ProdatSwitchCode): string {
  if (code === 'Z03') return 'Leverantörsbyte / leveransstart'
  if (code === 'Z04') return 'Nätägarens bekräftelse på leveransförändring'
  if (code === 'Z05') return 'Information till tidigare leverantör om leveransförändring'
  if (code === 'Z06') return 'Nätägarens kund-/anläggningsuppdatering'
  if (code === 'Z09') return 'Leverantörens kund-/anläggningsuppdatering'
  if (code === 'Z10') return 'Mätaruppgifter från nätägaren'
  if (code === 'Z13') return 'Begäran om mätvärdesåtkomst'
  if (code === 'Z14') return 'Nätägarens svar på mätvärdesåtkomst'
  if (code === 'Z15') return 'Nätägarens ändring av mätvärdesrapportering'
  return 'Begäran om att avsluta mätvärdesrapportering'
}

function deriveProcessLabel(code: ProdatSwitchCode): string {
  if (code === 'Z03') return 'supplier_switch_request'
  if (code === 'Z04') return 'supplier_switch_confirmation'
  if (code === 'Z05') return 'supply_change_information'
  if (code === 'Z06') return 'grid_owner_masterdata_update'
  if (code === 'Z09') return 'supplier_masterdata_update'
  if (code === 'Z10') return 'meter_masterdata_update'
  if (code === 'Z13') return 'metering_access_request'
  if (code === 'Z14') return 'metering_access_decision'
  if (code === 'Z15') return 'metering_access_state_change'
  return 'metering_access_end_request'
}

function isResponseCode(code: ProdatSwitchCode): boolean {
  return code === 'Z04' || code === 'Z14'
}

function preferredReferencePrefix(code: ProdatSwitchCode): string {
  if (code === 'Z03') return 'SWITCH'
  if (code === 'Z04') return 'SWITCH-CONF'
  if (code === 'Z05') return 'SUPPLY-INFO'
  if (code === 'Z06') return 'GRID-MASTERDATA'
  if (code === 'Z09') return 'SUPPLIER-MASTERDATA'
  if (code === 'Z10') return 'METER-MASTERDATA'
  if (code === 'Z13') return 'METERING-ACCESS'
  if (code === 'Z14') return 'METERING-ACCESS-DECISION'
  if (code === 'Z15') return 'METERING-ACCESS-STATE'
  return 'METERING-ACCESS-END-REQ'
}

function statusSegmentForCode(code: ProdatSwitchCode): string | null {
  if (code === 'Z04' || code === 'Z06' || code === 'Z10' || code === 'Z14') return 'STS+7++29::260'
  if (code === 'Z15') return 'STS+7++A75::260'
  if (code === 'Z05') return 'STS+7++Z05::260'
  if (code === 'Z09') return 'STS+7++Z09::260'
  return null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function portalSnapshot(switchRequest: SupplierSwitchRequestRow): Record<string, unknown> | null {
  const snapshot = objectValue(switchRequest.validation_snapshot)
  const portalData = objectValue(snapshot?.portalData)

  if (!snapshot && !portalData) return null

  // Existing TGT switch requests can have testSuite/roleCode/testCaseCode at
  // validation_snapshot root while the actual Ediel field values sit under
  // validation_snapshot.portalData. Merge both layers so old reusable requests
  // still get the correct test-case override when PRODAT is generated.
  return {
    ...(snapshot ?? {}),
    ...(portalData ?? {}),
    portalData: portalData ?? null,
  }
}

function portalString(portalData: Record<string, unknown> | null, key: string): string | null {
  const value = portalData?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? sanitize(value) : null
}

function portalPartyText(portalData: Record<string, unknown> | null, key: string): string | null {
  const value = portalData?.[key]
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('prodat_party_snapshot_invalid')
  return value.trim()
}

function portalObject(portalData: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  return objectValue(portalData?.[key])
}

function resolveProdatMeteringMethod(portalData: Record<string, unknown> | null): string | null {
  // Testdata/formulärdata ska vara källan. Bara explicit override får vinna.
  // Tidigare låg en hårdkodad fallback till Z03 för 1.2.1/1.2.2 här. Den gjorde
  // att Z03LK testkund 20 skickade CAV+Z03 trots att portalen krävde Z04.
  const override = portalString(portalObject(portalData, 'testCaseOverrides'), 'meteringMethod')
  return override ?? portalString(portalData, 'meteringMethod')
}

function portalNumberString(portalData: Record<string, unknown> | null, key: string): string | null {
  const value = portalData?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim().length > 0) return sanitize(value).replace(/[^0-9.]/g, '') || null
  return null
}

function portalRegisters(portalData: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const registers = portalData?.registers
  return Array.isArray(registers)
    ? registers.filter((register): register is Record<string, unknown> => Boolean(register && typeof register === 'object' && !Array.isArray(register)))
    : []
}

function portalBillingRecipient(portalData: Record<string, unknown> | null): Record<string, unknown> | null {
  return objectValue(portalData?.billingRecipient)
}

function portalDate102(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(0, 8) : null
}

function nowDate203(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${y}${m}${d}${hh}${mm}`
}

function safeProdatReferenceToken(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = sanitize(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return cleaned ? cleaned.slice(0, maxLength) : null
}

function prodatShortTimestamp(): string {
  return nowDate203().slice(2)
}

function prodatRandomToken(length = 3): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function buildProdatDocumentReference(code: ProdatSwitchCode, contextId: string | null | undefined): string {
  const context = safeProdatReferenceToken(contextId, 4)
  // BGM/1004 must stay short. Ediel's examples use compact document numbers, not long UUID/TGT labels.
  return `${code}${prodatShortTimestamp()}${context ?? ''}${prodatRandomToken(3)}`.slice(0, 20)
}

function buildProdatCaseReference(code: ProdatSwitchCode, contextId: string | null | undefined): string {
  const context = safeProdatReferenceToken(contextId, 6)
  // RFF+LI is the business case reference. Keep it compact so it cannot become the next validator error.
  return `LI${code}${prodatShortTimestamp()}${context ?? ''}${prodatRandomToken(3)}`.slice(0, 25)
}

function date203AtStartOfDay(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 8 ? `${digits.slice(0, 8)}0000` : null
}


function normalizeProdatReasonForTransaction(value: string | null): string {
  const normalized = sanitize(value).toUpperCase()
  if (normalized === 'LK' || normalized === 'Z23') return 'Z23'
  if (normalized === 'L' || normalized === 'Z22') return 'Z22'
  if (normalized === 'F' || normalized === 'Z06F' || normalized === 'Z09F' || normalized === 'E64') return 'E64'
  if (normalized === 'G' || normalized === 'Z06G' || normalized === 'Z09G' || normalized === 'E32') return 'E32'
  if (normalized === 'D' || normalized === 'Z09D' || normalized === 'Z70') return 'Z70'
  return normalized || 'Z22'
}




export function isProdatSwitchCode(value: string | null | undefined): value is ProdatSwitchCode {
  return Boolean(value && PRODAT_SWITCH_CODE_SET.has(value))
}

export function validateProdatSwitchContext(params: {
  code: ProdatSwitchCode
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
}): ProdatSwitchValidationResult {
  const issues: ProdatSwitchValidationIssue[] = []
  const isMoveCode = params.code === 'Z05' || params.code === 'Z06'
  const isSwitchCode = params.code === 'Z03' || params.code === 'Z04'
  const isAccessCode = params.code === 'Z13' || params.code === 'Z14' || params.code === 'Z15' || params.code === 'Z18'

  if (!sanitize(params.senderEdielId)) {
    pushIssue(issues, {
      severity: 'error',
      code: 'sender_ediel_id_missing',
      title: 'Avsändarens Ediel-id saknas',
      description: 'Route/actor profile måste ha ett avsändar-id innan PRODAT kan skickas.',
    })
  }

  if (!sanitize(params.receiverEdielId)) {
    pushIssue(issues, {
      severity: 'error',
      code: 'receiver_ediel_id_missing',
      title: 'Mottagarens Ediel-id saknas',
      description: 'Nätägaren eller vald route måste ha ett mottagar-id innan PRODAT kan skickas.',
    })
  }

  if (!inferMeterPointIdentifier(params.meteringPoint)) {
    pushIssue(issues, {
      severity: 'error',
      code: 'meter_point_id_missing',
      title: 'Mätpunkt/anläggnings-id saknas',
      description: 'Meddelandet behöver ett identifierbart LOC+172-värde från mätpunkt eller Ediel-referens.',
    })
  }

  if (!params.switchRequest.requested_start_date && !params.site.move_in_date) {
    pushIssue(issues, {
      severity: isResponseCode(params.code) ? 'warning' : 'error',
      code: 'start_date_missing',
      title: 'Startdatum saknas',
      description: 'Switch-/flyttdatum saknas. Lägg in requested_start_date eller move_in_date innan outbound skickas.',
    })
  }

  if (!params.switchRequest.grid_owner_id && !params.site.grid_owner_id && !params.meteringPoint.grid_owner_id) {
    pushIssue(issues, {
      severity: 'error',
      code: 'grid_owner_missing',
      title: 'Nätägare saknas',
      description: 'Switchärendet, anläggningen eller mätpunkten måste vara kopplad till en nätägare.',
    })
  }

  if (!params.gridOwner?.ediel_id && !params.gridOwner?.owner_code) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'grid_owner_ediel_identity_missing',
      title: 'Nätägarens Ediel-identitet saknas eller är svag',
      description: 'Systemet kan bygga draft, men route/adressering bör kompletteras innan riktig drift.',
    })
  }

  if (isSwitchCode && !sanitize(params.switchRequest.current_supplier_name ?? params.site.current_supplier_name)) {
    pushIssue(issues, {
      severity: 'warning',
      code: 'current_supplier_missing',
      title: 'Nuvarande leverantör saknas',
      description: 'Nuvarande leverantör saknas i switchärendet/anläggningen. Det kan kräva manuell komplettering.',
    })
  }

  if (isMoveCode && params.switchRequest.request_type !== 'move_in') {
    pushIssue(issues, {
      severity: 'warning',
      code: 'message_code_request_type_mismatch',
      title: 'PRODAT-kod matchar inte request_type',
      description: `Kod ${params.code} används normalt för flytt/övertagande, men ärendet är ${params.switchRequest.request_type}.`,
    })
  }

  if ((params.code === 'Z03' || params.code === 'Z04') && params.switchRequest.request_type === 'move_in') {
    pushIssue(issues, {
      severity: 'warning',
      code: 'message_code_request_type_mismatch',
      title: 'PRODAT-kod matchar inte request_type',
      description: `Kod ${params.code} används för leverantörsbyte, men ärendet är markerat som inflytt.`,
    })
  }

  if (!params.switchRequest.power_of_attorney_id && !params.switchRequest.authorization_document_id) {
    pushIssue(issues, {
      severity: isResponseCode(params.code) ? 'warning' : 'error',
      code: 'authorization_missing',
      title: 'Fullmakt/behörighetsdokument saknas',
      description: 'Koppla fullmakt eller komplett avtal innan meddelandet skickas i drift.',
    })
  }

  return {
    isReady: !issues.some((issue) => issue.severity === 'error'),
    code: params.code,
    issues,
  }
}

function validationErrorMessage(result: ProdatSwitchValidationResult): string {
  const errors = result.issues.filter((issue) => issue.severity === 'error')
  if (errors.length === 0) return ''

  return [
    `PRODAT ${result.code} kan inte byggas säkert ännu.`,
    ...errors.map((issue) => `- ${issue.title}: ${issue.description}`),
  ].join('\n')
}

function renderProdatSegments(params: {
  sourceContext: CustomerExportContext
  requestedMethodSource: ContractRequestedMethodBasis | null
  brpSource: BrpFieldBasis | null
  sourceStartDate: string | null
  bilateralPreparation:QualifiedBilateralProdatSwitchPreparation|null
  actorUserId:string
  environment:EdielEnvironment
  selectedVersion: string
  applicationReference: string
  code: ProdatSwitchCode
  bgmReference: string
  transactionReference: string
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
  senderEdielId: string
  receiverEdielId: string
}): {
  segments: string[]
  diagnostics: Record<string, unknown>
  issues: ProdatSwitchValidationIssue[]
  ackExpectation?: ReturnType<typeof renderProdat26A>['ackExpectation']
} {
  const savedPortalData = portalSnapshot(params.switchRequest)
  const sourceContext=params.sourceContext
  const companyId=requireContextCompanyId(sourceContext,'Bygg PRODAT från vald kund/anläggning')
  const endUser=resolveSwedishProdatEndUserExport({customer:sourceContext.customer as unknown as Record<string,unknown>|null,customerLifeEvent:sourceContext.customerLifeEvent,customerMasterdata:sourceContext.customerMasterdata})
  const customer=endUser.identity
  const endUserParentRequirement=resolveProdatEndUserGroupRequirement(params.code,canonicalProdatSubtypeAlias(portalString(savedPortalData,'reasonForTransaction'),params.code))
  if(endUserParentRequirement!=='forbidden'&&(!customer.id||!customer.qualifier||!customer.name))throw new Error('prodat_customer_legal_identity_required')
  const meterPointId=params.requestedMethodSource?.pointId??inferMeterPointIdentifier(sourceContext.meteringPoint!)
  if(!/^\d{18}$/.test(meterPointId))throw new Error('prodat_source_object_identity_required')
  const {addressLines,postalCode,city,country}=endUser
  const endUserAddressObjects=endUserParentRequirement==='forbidden'?[]:sourceContext.customerMasterdata?createCustomerMasterdataAddressFacts({projection:sourceContext.customerMasterdata,meteringPointId:meterPointId,identityAgency:params.requestedMethodSource?.identityAgency??'9'}):prodatAddressFactsFromExportContext({companyId,reference:`customer-export-context:${params.switchRequest.customer_id}/${params.switchRequest.site_id}/${params.switchRequest.metering_point_id}`,meterPointId,identityAgency:params.requestedMethodSource?.identityAgency??'9',customer,addressLines})
  // A saved protocol preview cannot replace the selected server-owned legal
  // customer, object, address or its dependent-condition source.
  const portalData={...(savedPortalData??{}),customerId:customer.id,customerIdCodeListQualifier:customer.qualifier,customerIdAgency:'260',customerName:customer.name,customerNameLines:endUser.nameLines,
    customerAddress:addressLines[0],customerAddressLines:addressLines,customerPostalCode:postalCode,customerCity:city,customerCountry:country,
    facilityId:meterPointId,facilityIdAgency:'9',siteAddress:sourceContext.site?.street??null,sitePostalCode:sourceContext.site?.postal_code??null,siteCity:sourceContext.site?.city??null,siteCountry:sourceContext.site?.country??null,
    dependentConditionFacts:{...(objectValue(savedPortalData?.dependentConditionFacts)??{}),endUserAddressObjects},
    ...(params.requestedMethodSource?{meteringMethod:params.requestedMethodSource.requestedMethod,balanceResponsibleId:params.brpSource?.brpEdielId??null,agreementStartDateTime:params.sourceStartDate,testCaseOverrides:{...(objectValue(savedPortalData?.testCaseOverrides)??{}),meteringMethod:undefined,balanceResponsibleId:undefined,agreementStartDateTime:undefined}}:{})}
  const customerName=customer.name
  const gridAreaId=sourceContext.meteringPoint?.grid_area_code??sourceContext.site?.grid_area_code??null
  const startDate =
    portalPartyText(portalData, 'agreementStartDateTime') ??
    params.switchRequest.requested_start_date ??
    params.site.move_in_date

  const switchSubtype=params.switchRequest as SupplierSwitchRequestRow&{prodat_variant?:string|null;prodat_reason?:string|null}
  const isH=params.code==='Z03'&&(switchSubtype.prodat_variant==='H'||switchSubtype.prodat_reason==='Z25')
  const bilateralQualified=isH&&switchSubtype.prodat_variant==='H'&&switchSubtype.prodat_reason==='Z25'&&bilateralProdatSwitchPreparationQualified(params.bilateralPreparation,{companyId,actorUserId:params.actorUserId,environment:params.environment,switchId:params.switchRequest.id,pointId:params.meteringPoint.id,customerId:params.switchRequest.customer_id,siteId:params.site.id,contractId:params.switchRequest.customer_contract_id??params.switchRequest.contract_id??'',requestedStartDate:params.switchRequest.requested_start_date??'',senderEdielId:params.senderEdielId,receiverEdielId:params.receiverEdielId})
  if(isH&&!bilateralQualified)throw Error('prodat_switch_current_bilateral_render_source_required')
  const rendered = renderProdat({
    code:params.code,mode:'production',actor:{senderEdielId:params.senderEdielId,receiverEdielId:params.receiverEdielId},
    route:{applicationReference:params.applicationReference},version:{selectedVersion:params.selectedVersion,messageTypeToken:`PRODAT:D:97A:UN:${params.selectedVersion}`,acceptedVersions:[params.selectedVersion]},
    portalSnapshot: portalData,
    context: {
      code: params.code,
      bgmReference: params.bgmReference,
      transactionReference: params.transactionReference || params.bgmReference,
      senderEdielId: params.senderEdielId,
      receiverEdielId: params.receiverEdielId,
      legalSenderId: params.requestedMethodSource?.legalSenderId,
      legalReceiverId: params.requestedMethodSource?.legalReceiverId,
      customerName,
      customerId: portalPartyText(portalData, 'customerId'),
      customerIdCodeListQualifier: portalPartyText(portalData, 'customerIdCodeListQualifier'),
      meterPointId,
      meterPointIdAgency: params.requestedMethodSource?.identityAgency??'9',
      gridAreaId,
      startDate,
      // Z05 closes the supplier contract at the requested switch boundary.
      contractEndDate: portalPartyText(portalData, 'agreementEndDateTime') ?? (params.code === 'Z05' ? startDate : null),
      customerAddress: addressLines[0],
      customerPostalCode: postalCode,
      customerCity: city,
      customerCountry:country,
      siteAddress: portalPartyText(portalData, 'siteAddress') ?? params.site.street?.trim() ?? null,
      sitePostalCode: portalPartyText(portalData, 'sitePostalCode') ?? params.site.postal_code?.trim() ?? null,
      siteCity: portalPartyText(portalData, 'siteCity') ?? params.site.city?.trim() ?? null,
      siteCountry:sourceContext.site?.country??null,
      reasonForTransaction: isH?'Z25':portalString(portalData, 'reasonForTransaction'),
      bilateralCapabilityVerified:bilateralQualified?true:undefined,
      meteringMethod: params.code==='Z03'?params.requestedMethodSource?.requestedMethod??null:resolveProdatMeteringMethod(portalData),
      permissionStatus: portalString(portalData, 'permissionStatus'),
      permissionPurpose: portalString(portalData, 'permissionPurpose'),
      permissionEndReason: portalString(portalData, 'permissionEndReason'),
      permissionId: portalString(portalData, 'permissionId'),
      permissionTimestamp: portalPartyText(portalData, 'permissionTimestamp'),
      permissionEndDate: portalPartyText(portalData, 'permissionEndDate'),
      energyProductId: portalString(portalData, 'energyProductId'),
      powerOfAttorneyReference: portalString(portalData, 'powerOfAttorneyReference'),
      balanceResponsibleId: portalPartyText(portalData, 'balanceResponsibleId'),
    },
  })

  return {
    segments: rendered.segments,
    diagnostics: rendered.diagnostics,
    issues: rendered.issues.map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      title: issue.title,
      description: issue.description,
    })),
    ackExpectation: rendered.ackExpectation,
  }
}

function buildValidationReport(result: ProdatSwitchValidationResult): Record<string, unknown> {
  return {
    isReady: result.isReady,
    code: result.code,
    errors: result.issues.filter((issue) => issue.severity === 'error'),
    warnings: result.issues.filter((issue) => issue.severity === 'warning'),
    checkedAt: new Date().toISOString(),
  }
}

function buildProdatSwitchOutboundDraft(
  input: BaseSwitchOutboundInput,
  code: ProdatSwitchCode
): Promise<CreateEdielMessageInput> {
  return (async () => {
    if (!isProdatCodeSendable(code)) {
      throw new Error(`prodat_outbound_direction_not_allowed:${code}`)
    }

    const canonicalProfile = getCanonicalProdatProfile(code)
    if (!canonicalProfile) {
      throw new Error(`prodat_canonical_profile_missing:${code}`)
    }

    const validation = validateProdatSwitchContext({
      code,
      switchRequest: input.switchRequest,
      site: input.site,
      meteringPoint: input.meteringPoint,
      gridOwner: input.gridOwner ?? null,
      senderEdielId: input.senderEdielId,
      receiverEdielId: input.receiverEdielId,
    })

    if (!validation.isReady) {
      throw new Error(validationErrorMessage(validation))
    }

    if(!input.switchRequest.company_id||!input.switchRequest.site_id||!input.switchRequest.metering_point_id)throw new Error('prodat_selected_tenant_object_context_required')
    if(!input.actorUserId)throw new Error('ediel_tenant_actor_required')
    await assertEdielTenantActor({companyId:input.switchRequest.company_id,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
    const sourceStartAt=code==='Z03'?prodatMarketMinuteToUtc(prodatDate203(input.switchRequest.requested_start_date)):null
    if(code==='Z03'&&!sourceStartAt)throw new Error('prodat_new_agreement_source_start_required')
    const environment = input.environment ?? 'test'
    const endUserParentRequirement=resolveProdatEndUserGroupRequirement(code,canonicalProdatSubtypeAlias(portalString(portalSnapshot(input.switchRequest),'reasonForTransaction'),code))
    const requireCustomerMasterdata=code==='Z03'||endUserParentRequirement==='required'
    const sourceContext=await getCustomerExportContext({companyId:input.switchRequest.company_id,customerId:input.switchRequest.customer_id,siteId:input.switchRequest.site_id,meteringPointId:input.switchRequest.metering_point_id,actorUserId:input.actorUserId,environment,requireCustomerMasterdata,...(sourceStartAt?{asOf:sourceStartAt}:{})})
    const sourceCompanyId=requireContextCompanyId(sourceContext,'Bygg PRODAT från vald kund/anläggning')
    if(sourceCompanyId!==input.switchRequest.company_id||sourceContext.customer?.id!==input.switchRequest.customer_id||sourceContext.site?.id!==input.switchRequest.site_id||sourceContext.site.customer_id!==input.switchRequest.customer_id
      ||sourceContext.meteringPoint?.id!==input.switchRequest.metering_point_id||sourceContext.meteringPoint.customer_id!==input.switchRequest.customer_id||(sourceContext.meteringPoint.customer_site_id??sourceContext.meteringPoint.site_id)!==input.switchRequest.site_id
      ||input.site.id!==sourceContext.site.id||input.meteringPoint.id!==sourceContext.meteringPoint.id)throw new Error('prodat_selected_customer_site_point_scope_mismatch')

    let requestedMethodSource:ContractRequestedMethodBasis|null=null
    let brpSource:BrpFieldBasis|null=null,sourceStartDate:string|null=null
    if(code==='Z03'){
      const storedContractId=input.switchRequest.customer_contract_id??input.switchRequest.contract_id
      const contractId=input.contractId??storedContractId
      if(!contractId||(input.switchRequest.contract_id&&input.switchRequest.contract_id!==contractId)||(input.switchRequest.customer_contract_id&&input.switchRequest.customer_contract_id!==contractId))throw new Error('prodat_new_signed_contract_selector_required')
      const basis=await readContractRequestedMethodSource({companyId:sourceCompanyId,contractId,actorUserId:input.actorUserId,environment})
      if(basis.status==='held')throw new Error(`prodat_new_agreement_requested_method_held:${basis.missing.join(',')}`)
      assertContractRequestedMethodSelection(basis,{companyId:sourceCompanyId,contractId,customerId:input.switchRequest.customer_id,siteId:sourceContext.site.id,meteringPointId:sourceContext.meteringPoint.id,environment})
      requestedMethodSource=basis
      sourceStartDate=input.switchRequest.requested_start_date
      const at=sourceStartAt
      if(!sourceStartDate||!at)throw new Error('prodat_new_agreement_source_start_required')
      const brp=await prepareQualifiedBrpSource({companyId:sourceCompanyId,contractId,actorUserId:input.actorUserId,environment,customerId:input.switchRequest.customer_id,siteId:sourceContext.site.id,meteringPointId:sourceContext.meteringPoint.id,at,supplyPeriodId:null})
      if(brp.status==='held')throw new Error(`prodat_new_agreement_brp_held:${brp.missing.join(',')}`)
      if(brp.pointId!==basis.pointId||brp.identityAgency!==basis.identityAgency||brp.legalActorId!==basis.legalActorId||brp.legalSenderId!==basis.legalSenderId||brp.legalReceiverId!==basis.legalReceiverId)throw new Error('prodat_new_agreement_brp_source_scope_mismatch')
      brpSource=brp
    }

    const refs = buildCanonicalOutboundReferences({
      family: 'PRODAT',
      code,
      relatedMessageId: input.switchRequest.id,
      preferredExternalReference: input.externalReference ?? null,
      preferredTransactionReference: input.transactionReference ?? null,
      correlationReference: input.correlationReference ?? null,
    })

    const externalReference = input.wireReferences?.documentReference ?? buildProdatDocumentReference(
      code,
      refs.externalReference ?? input.switchRequest.external_reference ?? input.switchRequest.id
    )
    const transactionReference = input.wireReferences?.transactionReference ?? buildProdatCaseReference(
      code,
      refs.transactionReference ?? input.transactionReference ?? input.switchRequest.id
    )

    const testFlag = environment === 'production' ? 0 : 1
    const messageVersion = await resolveCanonicalOutboundVersion({
      family: 'PRODAT',
      code,
      standard: 'edifact',
      routeDefaultMessageVersion: input.routeDefaultMessageVersion ?? null,
      environment,
    })
    if (!messageVersion) {
      throw new Error(`prodat_canonical_version_missing:${code}`)
    }

    // A route-decided sub-address (including a confirmed absent one, null) is
    // authoritative and recorded on the intent; only an unrouted caller gets
    // the legacy PRODAT default.
    const senderSubAddress = input.senderSubAddress === undefined ? 'PRODAT' : input.senderSubAddress
    const receiverSubAddress = input.receiverSubAddress === undefined ? 'PRODAT' : input.receiverSubAddress

    const applicationReference =
      input.applicationReference ??
      buildDefaultApplicationReference({
        actorSubAddress: senderSubAddress ?? 'PRODAT',
        process: 'PRODAT',
      })

    const switchSubtype=input.switchRequest as SupplierSwitchRequestRow&{prodat_variant?:string|null;prodat_reason?:string|null}
    const bilateralPreparation=code==='Z03'&&(switchSubtype.prodat_variant==='H'||switchSubtype.prodat_reason==='Z25')?await qualifyBilateralProdatSwitchPreparation({companyId:sourceCompanyId,switchId:input.switchRequest.id,actorUserId:input.actorUserId,environment}):null
    const prodatRendered = renderProdatSegments({
      bilateralPreparation,actorUserId:input.actorUserId,environment,sourceContext,requestedMethodSource,brpSource,sourceStartDate,selectedVersion:messageVersion,applicationReference,
      code,
      bgmReference: externalReference,
      transactionReference,
      switchRequest: input.switchRequest,
      site: input.site,
      meteringPoint: input.meteringPoint,
      gridOwner: input.gridOwner ?? null,
      senderEdielId: input.senderEdielId,
      receiverEdielId: input.receiverEdielId,
    })

    const ack = deriveEdielAckDefaults({
      family: 'PRODAT',
      code,
    })

    const envelope = buildEdifactEnvelope({
      ...(input.wireReferences?{interchangeReference:input.wireReferences.interchangeReference,messageReference:input.wireReferences.messageReference}:{}),
      acknowledgementRequest: ack.requiresContrl,
      senderEdielId: input.senderEdielId,
      senderSubAddress,
      receiverEdielId: input.receiverEdielId,
      receiverSubAddress,
      applicationReference,
      testFlag,
      messageTypeToken: `PRODAT:D:${canonicalProfile.edifactDirectory.slice(1)}:UN:${canonicalProfile.associationAssignedCode}`,
      segments: prodatRendered.segments,
      companyId: input.switchRequest.company_id,
      customerMasterdataProjection:sourceContext.customerMasterdata??undefined,
      parsedPayload: {prodatEngine: prodatRendered.diagnostics},
    })


    const parsedPayload: Record<string, unknown> = {
      customerMasterdataSourceContextId: sourceContext.customerMasterdata?.sourceContextId ?? null,
      draftType: 'prodat_switch_outbound',
      processLabel: deriveProcessLabel(code),
      prodatCode: code,
      prodatLabel: prodatCodeLabel(code),
      isResponseMessage: isResponseCode(code),
      switchRequestId: input.switchRequest.id,
      switchRequestType: input.switchRequest.request_type,
      switchRequestStatus: input.switchRequest.status,
      requestedStartDate: input.switchRequest.requested_start_date,
      currentSupplierName:
        input.switchRequest.current_supplier_name ?? input.site.current_supplier_name ?? null,
      incomingSupplierName: input.switchRequest.incoming_supplier_name ?? null,
      incomingSupplierOrgNumber: input.switchRequest.incoming_supplier_org_number ?? null,
      currentSupplierOrgNumber:
        input.switchRequest.current_supplier_org_number ??
        input.site.current_supplier_org_number ??
        null,
      siteType: input.site.site_type ?? null,
      facilityId: input.site.facility_id ?? null,
      meterPointId: input.meteringPoint.meter_point_id ?? null,
      edielReference: input.meteringPoint.ediel_reference ?? null,
      gridOwnerEdielId: input.gridOwner?.ediel_id ?? null,
      gridOwnerOwnerCode: input.gridOwner?.owner_code ?? null,
      validation: buildValidationReport(validation),
      referenceDiagnostics: {
        externalReferenceLength: externalReference.length,
        transactionReferenceLength: transactionReference.length,
      },
      prodatEngine: prodatRendered.diagnostics,
      prodatAckExpectation: prodatRendered.ackExpectation ?? null,
    }

    return rememberCustomerMasterdataDraft({
      actorUserId: input.actorUserId,
      companyId:sourceCompanyId,
      direction: 'outbound',
      messageStandard: 'edifact',
      messageFamily: 'PRODAT',
      messageCode: code,
      messageVersion,
      // Persisted/validated process type is the canonical policy group; the
      // legacy label stays a display value only.
      processType: getCanonicalProdatProfile(code)?.processGroup ?? deriveProcessLabel(code),
      environment,
      testFlag,
      status: 'draft',
      transportType: 'smtp',
      mailbox: input.mailbox ?? null,
      senderEdielId: input.senderEdielId,
      senderName: input.senderName ?? null,
      receiverEdielId: input.receiverEdielId,
      receiverName: input.receiverName ?? null,
      senderSubAddress,
      receiverSubAddress,
      receiverEmail: input.receiverEmail ?? null,
      subject: input.subject ?? `PRODAT ${code} ${externalReference}`.trim(),
      fileName: inferEdielFileName({
        family: 'PRODAT',
        code,
        direction: 'outbound',
        extension: 'edi',
      }),
      mimeType: 'application/edifact',
      interchangeReference: envelope.interchangeReference,
      applicationReference,
      externalReference,
      correlationReference: refs.correlationReference ?? input.correlationReference ?? null,
      transactionReference,
      communicationRouteId: input.communicationRouteId ?? null,
      switchRequestId: input.switchRequest.id,
      customerId: input.switchRequest.customer_id,
      siteId: input.switchRequest.site_id,
      meteringPointId: input.switchRequest.metering_point_id,
      gridOwnerId: input.switchRequest.grid_owner_id,
      rawPayload: envelope.raw,
      parsedPayload,
      validationReport: {
        ...buildValidationReport(validation),
        prodatEngine: prodatRendered.diagnostics,
        prodatAckExpectation: prodatRendered.ackExpectation ?? null,
        engineIssues: prodatRendered.issues,
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
    },sourceContext.customerMasterdata)
  })()
}

export function parseInboundProdat(rawPayload: string): ParsedProdatMessage {
  const source = parseSourceProdat(rawPayload)
  const sourceLine = source.lineItems[0]
  const wire = tokenizeEdifact(rawPayload)
  const rawSegments = wire.segments.map(segment => segment.raw)
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)
  const unb = wire.segments.find(segment => segment.tag === 'UNB')
  const unh = wire.segments.find(segment => segment.tag === 'UNH')
  const start = unh ? wire.segments.indexOf(unh) : 0
  const end = wire.segments.findIndex((segment, index) => index > start && ['UNH', 'UNT', 'UNZ'].includes(segment.tag))
  const message = wire.segments.slice(start, end < 0 ? undefined : end)
  const firstLine = message.findIndex(segment => segment.tag === 'LIN')
  const nextLine = message.findIndex((segment, index) => index > firstLine && segment.tag === 'LIN')
  const header = firstLine < 0 ? message : message.slice(0, firstLine)
  const firstObject = message.slice(Math.max(firstLine, 0), nextLine < 0 ? undefined : nextLine)
  const dtm = (scope: readonly EdifactTokenizedSegment[], qualifier: string) => scope.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === qualifier)
  const dtm7 = dtm([...header, ...firstObject], '7')
  const loc48 = [...header, ...firstObject].find(segment => segment.tag === 'LOC' && segmentComposite(segment, 1, wire.una)[0] === '48')
  const sender = segmentComposite(unb, 2, wire.una), receiver = segmentComposite(unb, 3, wire.una)
  const application = segmentComposite(unb, 7, wire.una)
  const ids = { senderEdielId: sender[0]?.trim() || null, receiverEdielId: receiver[0]?.trim() || null,
    senderSubAddress: sender[2]?.trim() || null, receiverSubAddress: receiver[2]?.trim() || null }

  const bgmCode = prodatDocumentValue('202', wire.segments, wire.una) as ProdatSwitchCode | EdielKnownMessageCode | null

  const meterPointId = sourceLine?.meteringPointId ?? null
  const gridAreaId = sourceLine?.gridAreaId ?? null
  const priceAreaCode = segmentComposite(loc48, 2, wire.una)[0]?.trim() || null
  const customerName = sourceLine?.endUserName ?? null
  const messageVersion = segmentComposite(unh, 2, wire.una)[4]?.trim() || null

  return {
    messageFamily: 'PRODAT',
    messageCode: bgmCode,
    messageVersion,
    transactionReference:
      extractReference(rawPayload, 'LI') ||
      extractReference(rawPayload, 'TN') ||
      extractReference(rawPayload, 'CR') ||
      extractReference(rawPayload, 'AAS'),
    externalReference: prodatDocumentValue('203', wire.segments, wire.una),
    applicationReference: application.length === 1 ? application[0]?.trim() || null : null,
    senderEdielId: ids.senderEdielId,
    receiverEdielId: ids.receiverEdielId,
    senderSubAddress: ids.senderSubAddress,
    receiverSubAddress: ids.receiverSubAddress,
    rawSegments,
    parsedPayload: {
      lineItems: source.lineItems,
      meterPointId,
      meteringPointId: meterPointId,
      gridAreaId,
      priceAreaCode,
      customerName,
      // Legacy DTM7 remains a separate compatibility field, not contract92.
      requestedStartDate: extractDateFromDtm(dtm7, wire.una),
      createdDate: prodatDateToIsoDate(source.messageDate),
      messageDate: source.messageDate ?? null, timezoneOffset: source.timezoneOffset ?? null,
      contractStartDate: sourceLine?.contractStartDate ?? null, contractEndDate: sourceLine?.contractEndDate ?? null,
      validityStartDate: sourceLine?.validityStartDate ?? null, firstMeterReadingDate: sourceLine?.firstMeterReadingDate ?? null,
      birthDate: sourceLine?.birthDate ?? null, reportStartDate: sourceLine?.reportStartDate ?? null,
      reportEndDate: sourceLine?.reportEndDate ?? null, permissionTimestamp: sourceLine?.permissionTimestamp ?? null,
      permissionEndTimestamp: sourceLine?.permissionEndTimestamp ?? null,
      observationLength: sourceLine?.observationLength ?? null, observationLengthFormat: sourceLine?.observationLengthFormat ?? null,
      street: sourceLine?.installationAddress ?? null,
      postalCode: sourceLine?.installationPostcode ?? null,
      city: sourceLine?.installationCity ?? null,
      customerId: sourceLine?.endUserId ?? null,
      customerIdCodeListQualifier: sourceLine?.endUserIdQualifier ?? null,
      customerAddress: sourceLine?.endUserAddress ?? null,
      customerPostalCode: sourceLine?.endUserPostcode ?? null,
      customerCity: sourceLine?.endUserCity ?? null,
      customerCountry: sourceLine?.endUserCountry ?? null,
      legalSenderId: source.legalSenderId ?? null,
      legalReceiverId: source.legalReceiverId ?? null,
      invoiceeId: sourceLine?.invoiceeId ?? null,
      segmentCount: rawSegments.length,
      inferredFamily: inferred.messageFamily,
      inferredCode: inferred.messageCode,
      processLabel: bgmCode && isProdatSwitchCode(String(bgmCode)) ? deriveProcessLabel(bgmCode as ProdatSwitchCode) : null,
    },
  }
}

export async function buildProdatOutboundDraft(params: {
  actorUserId?: string | null
  switchRequestId: string
  messageCode: ProdatSwitchCode
  communicationRouteId?: string | null
}) {
  throw new Error(
    `buildProdatOutboundDraft kräver full switch/site/metering/route context. Använd buildProdat${params.messageCode}FromSwitch eller prepareAndQueueEdiel${params.messageCode}.`
  )
}

export async function buildProdatZ03FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z03')
}

export async function buildProdatZ04FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z04')
}

export async function buildProdatZ05FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z05')
}

export async function buildProdatZ06FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z06')
}

export async function buildProdatZ09FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z09')
}

export async function buildProdatZ10FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z10')
}

export async function buildProdatZ13FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z13')
}

export async function buildProdatZ14FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z14')
}

export async function buildProdatZ15FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z15')
}

export async function buildProdatZ18FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z18')
}
