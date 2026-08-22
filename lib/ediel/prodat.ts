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
import { buildCanonicalOutboundReferences } from '@/lib/ediel/core/referenceRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
import { renderProdat26A } from '@/lib/ediel/prodatEngine'
import { isProdatCodeSendable } from '@/lib/ediel/prodat/prodatMessageSupportRegistry'

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

type BaseSwitchOutboundInput = {
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

const PRODAT_CODES: readonly ProdatSwitchCode[] = ['Z03', 'Z04', 'Z05', 'Z06', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'] as const

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/[\r\n'+]/g, ' ').replace(/\s+/g, ' ').trim()
}

function pushIssue(
  issues: ProdatSwitchValidationIssue[],
  issue: ProdatSwitchValidationIssue
) {
  issues.push(issue)
}

function splitEdifactSegments(rawPayload: string): string[] {
  return rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function firstSegmentValue(segments: string[], prefix: string): string | null {
  const hit = segments.find((segment) => segment.startsWith(prefix))
  return hit ?? null
}

function extractUnbIds(unb: string | null): {
  senderEdielId: string | null
  receiverEdielId: string | null
  senderSubAddress: string | null
  receiverSubAddress: string | null
} {
  if (!unb) {
    return {
      senderEdielId: null,
      receiverEdielId: null,
      senderSubAddress: null,
      receiverSubAddress: null,
    }
  }

  const parts = unb.split('+')
  const senderRaw = parts[2] ?? ''
  const receiverRaw = parts[3] ?? ''

  const senderParts = senderRaw.split(':')
  const receiverParts = receiverRaw.split(':')

  return {
    senderEdielId: senderParts[0]?.trim() || null,
    senderSubAddress: senderParts[2]?.trim() || null,
    receiverEdielId: receiverParts[0]?.trim() || null,
    receiverSubAddress: receiverParts[2]?.trim() || null,
  }
}

function extractReference(rawPayload: string, qualifier: string): string | null {
  const regex = new RegExp(`RFF\\+${qualifier}:([A-Za-z0-9\\-_/.:]+)`, 'i')
  return rawPayload.match(regex)?.[1] ?? null
}

function extractApplicationReference(rawPayload: string): string | null {
  const unb = rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith('UNB+'))

  if (!unb) return null

  const parts = unb.split('+')
  return parts[7]?.trim() || null
}

function extractDateFromDtm(segment: string | null): string | null {
  if (!segment) return null
  const match = segment.match(/:(\d{8,12})/)
  if (!match) return null
  const raw = match[1]
  if (raw.length >= 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  return null
}

function normalizeDate(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00`
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    return trimmed
  }
  return trimmed
}

function formatDate102(value?: string | null): string | null {
  const normalized = normalizeDate(value)
  if (!normalized) return null
  return normalized.slice(0, 10).replace(/-/g, '')
}

function inferCustomerName(
  switchRequest: SupplierSwitchRequestRow,
  site: CustomerSiteRow
): string {
  return sanitize(
    site.site_name ||
      site.current_supplier_name ||
      switchRequest.current_supplier_name ||
      'Kund'
  )
}

function inferMeterPointIdentifier(meteringPoint: MeteringPointRow): string {
  return sanitize(meteringPoint.ediel_reference || meteringPoint.meter_point_id || '')
}

function inferGridArea(gridOwner?: GridOwnerRow | null): string | null {
  return sanitize(gridOwner?.owner_code || gridOwner?.ediel_id || '') || null
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

function partySegment(role: 'FR' | 'DO', edielId: string): string {
  return `NAD+${role}+${sanitize(edielId)}:160:SVK+++++++SE`
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

function normalizeEndUserIdQualifier(value: string | null, customerId: string | null): 'SE1' | 'SE2' | '1' {
  const normalized = sanitize(value).toUpperCase()
  if (normalized === 'SE1' || normalized === 'SE2' || normalized === '1') return normalized
  if (customerId && /^\d{10}$/.test(customerId)) return 'SE1'
  if (customerId && /^\d{12}$/.test(customerId)) return 'SE2'
  return 'SE2'
}

function customerNadSegment(params: {
  customerId: string | null
  customerIdCodeListQualifier: string | null
  customerName: string
  address: string | null
  city: string | null
  postalCode: string | null
  country: string | null
}): string {
  const qualifier = normalizeEndUserIdQualifier(params.customerIdCodeListQualifier, params.customerId)
  const id = params.customerId ? `${sanitize(params.customerId)}:${qualifier}:260` : ''
  const name = sanitize(params.customerName) || 'KUND'
  const address = sanitize(params.address)
  const city = sanitize(params.city)
  const postalCode = sanitize(params.postalCode)
  const country = sanitize(params.country) || 'SE'
  return `NAD+UD+${id}++${name}+${address}+${city}++${postalCode}+${country}`
}

function installationNadSegment(params: {
  meterPointId: string
  address: string | null
  city: string | null
  postalCode: string | null
  country: string | null
}): string {
  const address = sanitize(params.address)
  const city = sanitize(params.city)
  const postalCode = sanitize(params.postalCode)
  const country = sanitize(params.country) || 'SE'
  return `NAD+IT+${sanitize(params.meterPointId)}::9+++${address}+${city}++${postalCode}+${country}`
}


export function isProdatSwitchCode(value: string | null | undefined): value is ProdatSwitchCode {
  return Boolean(value && (PRODAT_CODES as readonly string[]).includes(value))
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
  const portalData = portalSnapshot(params.switchRequest)
  const customerName = portalString(portalData, 'customerName') ?? inferCustomerName(params.switchRequest, params.site)
  // No-placeholder: never fabricate 'UNKNOWN'. An empty id makes the generic
  // builder omit the LIN object identifier; codes that require LIN (e.g. Z03) are
  // then blocked by validation instead of silently sending a fake identifier.
  const meterPointId = portalString(portalData, 'facilityId') ?? (inferMeterPointIdentifier(params.meteringPoint) || '')
  const gridAreaId = portalString(portalData, 'gridAreaId') ?? inferGridArea(params.gridOwner)
  const startDate =
    portalDate102(portalString(portalData, 'agreementStartDateTime')) ||
    formatDate102(params.switchRequest.requested_start_date) ||
    formatDate102(params.site.move_in_date)

  const rendered = renderProdat26A({
    portalSnapshot: portalData,
    context: {
      code: params.code,
      bgmReference: params.bgmReference,
      transactionReference: params.transactionReference || params.bgmReference,
      senderEdielId: params.senderEdielId,
      receiverEdielId: params.receiverEdielId,
      customerName,
      customerId: portalString(portalData, 'customerId'),
      customerIdCodeListQualifier: portalString(portalData, 'customerIdCodeListQualifier'),
      meterPointId,
      gridAreaId,
      startDate,
      customerAddress: portalString(portalData, 'customerAddress') ?? sanitize(params.site.street),
      customerPostalCode: portalString(portalData, 'customerPostalCode') ?? sanitize(params.site.postal_code),
      customerCity: portalString(portalData, 'customerCity') ?? sanitize(params.site.city),
      customerCountry: portalString(portalData, 'customerCountry') ?? 'SE',
      siteAddress: portalString(portalData, 'siteAddress') ?? sanitize(params.site.street),
      sitePostalCode: portalString(portalData, 'sitePostalCode') ?? sanitize(params.site.postal_code),
      siteCity: portalString(portalData, 'siteCity') ?? sanitize(params.site.city),
      siteCountry: portalString(portalData, 'siteCountry') ?? 'SE',
      reasonForTransaction: portalString(portalData, 'reasonForTransaction'),
      meteringMethod: resolveProdatMeteringMethod(portalData),
      permissionStatus: portalString(portalData, 'permissionStatus'),
      permissionPurpose: portalString(portalData, 'permissionPurpose'),
      permissionEndReason: portalString(portalData, 'permissionEndReason'),
      permissionId: portalString(portalData, 'permissionId'),
      permissionTimestamp: portalString(portalData, 'permissionTimestamp'),
      permissionEndDate:
        portalString(portalData, 'permissionEndDate') ??
        portalString(portalData, 'agreementEndDateTime'),
      energyProductId: portalString(portalData, 'energyProductId'),
      powerOfAttorneyReference: portalString(portalData, 'powerOfAttorneyReference'),
      balanceResponsibleId: portalString(portalData, 'balanceResponsibleId'),
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

    const refs = buildCanonicalOutboundReferences({
      family: 'PRODAT',
      code,
      relatedMessageId: input.switchRequest.id,
      preferredExternalReference: input.externalReference ?? null,
      preferredTransactionReference: input.transactionReference ?? null,
      correlationReference: input.correlationReference ?? null,
    })

    const externalReference = buildProdatDocumentReference(
      code,
      refs.externalReference ?? input.switchRequest.external_reference ?? input.switchRequest.id
    )
    const transactionReference = buildProdatCaseReference(
      code,
      refs.transactionReference ?? input.transactionReference ?? input.switchRequest.id
    )

    const environment = input.environment ?? 'test'
    const testFlag = environment === 'production' ? 0 : 1
    const messageVersion =
      (await resolveCanonicalOutboundVersion({
        family: 'PRODAT',
        code,
        fallback: '26A',
        standard: 'edifact',
        routeDefaultMessageVersion: input.routeDefaultMessageVersion ?? null,
        environment,
      })) ?? '26A'

    const senderSubAddress = input.senderSubAddress ?? 'PRODAT'
    const receiverSubAddress = input.receiverSubAddress ?? 'PRODAT'

    const applicationReference =
      input.applicationReference ??
      buildDefaultApplicationReference({
        actorSubAddress: senderSubAddress,
        process: 'PRODAT',
      })

    const prodatRendered = renderProdatSegments({
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

    const envelope = buildEdifactEnvelope({
      senderEdielId: input.senderEdielId,
      senderSubAddress,
      receiverEdielId: input.receiverEdielId,
      receiverSubAddress,
      applicationReference,
      testFlag,
      messageTypeToken: `PRODAT:D:97A:UN:${messageVersion === '26A' ? 'E2SE6A' : messageVersion}`,
      segments: prodatRendered.segments,
    })

    const ack = deriveEdielAckDefaults({
      family: 'PRODAT',
      code,
    })

    const parsedPayload: Record<string, unknown> = {
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

    return {
      actorUserId: input.actorUserId ?? 'system',
      direction: 'outbound',
      messageStandard: 'edifact',
      messageFamily: 'PRODAT',
      messageCode: code,
      messageVersion,
      processType: deriveProcessLabel(code),
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
    }
  })()
}

export function parseInboundProdat(rawPayload: string): ParsedProdatMessage {
  const rawSegments = splitEdifactSegments(rawPayload)
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)
  const unb = firstSegmentValue(rawSegments, 'UNB+')
  const bgm = firstSegmentValue(rawSegments, 'BGM+')
  const unh = firstSegmentValue(rawSegments, 'UNH+')
  const dtm7 = firstSegmentValue(rawSegments, 'DTM+7')
  const dtm137 = firstSegmentValue(rawSegments, 'DTM+137')
  const loc172 = firstSegmentValue(rawSegments, 'LOC+172')
  const loc239 = firstSegmentValue(rawSegments, 'LOC+239')
  const loc48 = firstSegmentValue(rawSegments, 'LOC+48')
  const nadBy = firstSegmentValue(rawSegments, 'NAD+BY')
  const adr = firstSegmentValue(rawSegments, 'ADR+')
  const ids = extractUnbIds(unb)

  const bgmParts = bgm?.split('+') ?? []
  const bgmCode = (bgmParts[1]?.split(':')[0]?.trim() ||
    inferred.messageCode ||
    null) as ProdatSwitchCode | EdielKnownMessageCode | null

  const meterPointId = loc172?.split('+')[2]?.split(':')[0]?.trim() || null
  const gridAreaId = loc239?.split('+')[2]?.split(':')[0]?.trim() || null
  const priceAreaCode = loc48?.split('+')[2]?.split(':')[0]?.trim() || null
  const customerName = nadBy?.split('+++')[1]?.trim() || null
  const adrParts = adr?.split('+') ?? []
  const messageVersion = unh?.split('+')[2]?.split(':')?.[4]?.trim() ?? unh?.split('+')[2]?.trim() ?? null

  return {
    messageFamily: 'PRODAT',
    messageCode: bgmCode,
    messageVersion,
    transactionReference:
      extractReference(rawPayload, 'TN') ||
      extractReference(rawPayload, 'CR') ||
      extractReference(rawPayload, 'AAS'),
    externalReference:
      bgmParts[2]?.trim() ||
      extractReference(rawPayload, 'ON') ||
      extractReference(rawPayload, 'ACE'),
    applicationReference: extractApplicationReference(rawPayload),
    senderEdielId: ids.senderEdielId,
    receiverEdielId: ids.receiverEdielId,
    senderSubAddress: ids.senderSubAddress,
    receiverSubAddress: ids.receiverSubAddress,
    rawSegments,
    parsedPayload: {
      meterPointId,
      meteringPointId: meterPointId,
      gridAreaId,
      priceAreaCode,
      customerName,
      requestedStartDate: extractDateFromDtm(dtm7),
      createdDate: extractDateFromDtm(dtm137),
      street: adrParts[1]?.trim() || null,
      postalCode: adrParts[2]?.trim() || null,
      city: adrParts[3]?.trim() || null,
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
