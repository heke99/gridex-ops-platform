// lib/ediel/prodat/builders/profileRenderer.ts

import type {
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import {
  compactProdatReference,
  prodatCustomerNadSegment,
  prodatInstallationNadSegment,
  prodatPartySegment,
  sanitizeProdatText,
  sanitizeProdatToken,
} from '@/lib/ediel/prodat/render/segments'
import {
  prodatDate102,
  prodatDate203,
  prodatDate203AtStartOfDay,
  prodatNowDate203,
} from '@/lib/ediel/prodat/render/dates'
import { validateProdatContext } from '@/lib/ediel/prodat/render/validate'
import { deriveProdatAckExpectation } from '@/lib/ediel/prodat/registry'


function prodatCav(value: string | null | undefined, maxLength = 12): string {
  const code = sanitizeProdatToken(value ?? null, maxLength)
  return code ? `CAV+${code}` : ''
}

function prodatCavValue1(value: string | null | undefined, maxLength = 35): string {
  const code = sanitizeProdatToken(value ?? null, maxLength)
  return code ? `CAV+:::${code}` : ''
}

function prodatCavValue2(value: string | null | undefined, maxLength = 35): string {
  const code = sanitizeProdatToken(value ?? null, maxLength)
  return code ? `CAV+::::${code}` : ''
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function portalString(portalData: ProdatEnginePortalSnapshot, key: string): string | null {
  const value = portalData?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? sanitizeProdatText(value) : null
}

function portalObject(portalData: ProdatEnginePortalSnapshot, key: string): Record<string, unknown> | null {
  return objectValue(portalData?.[key])
}

function portalDate102(portalData: ProdatEnginePortalSnapshot, key: string): string | null {
  return prodatDate102(portalString(portalData, key))
}

function normalizeReasonForTransaction(value?: string | null): string | null {
  const normalized = sanitizeProdatText(value).toUpperCase()
  if (normalized === 'LK' || normalized === 'Z23') return 'Z23'
  if (normalized === 'L' || normalized === 'Z22') return 'Z22'
  if (normalized === 'F' || normalized === 'Z06F' || normalized === 'Z09F' || normalized === 'E64') return 'E64'
  if (normalized === 'G' || normalized === 'Z06G' || normalized === 'Z09G' || normalized === 'E32') return 'E32'
  if (normalized === 'D' || normalized === 'Z09D' || normalized === 'Z70') return 'Z70'
  return normalized || null
}

function isPermissionMessageCode(code: string): boolean {
  return code === 'Z13' || code === 'Z14' || code === 'Z15' || code === 'Z18'
}

function isHistoricalPermissionReason(value?: string | null): boolean {
  const normalized = sanitizeProdatToken(value ?? null, 12)
  return normalized === 'S18' || normalized === 'VH' || normalized === 'Z13VH' || normalized === 'Z14VH'
}

function resolvePermissionReasonForCode(explicitValue?: string | null): string | null {
  const normalized = sanitizeProdatToken(explicitValue ?? null, 12)
  if (normalized === 'VH' || normalized === 'Z13VH' || normalized === 'Z14VH') return 'S18'
  if (normalized === 'V' || normalized === 'Z13V' || normalized === 'Z14V' || normalized === 'Z18V') return 'S17'
  return normalizeReasonForTransaction(explicitValue)
}

function resolveMeteringMethod(portalData: ProdatEnginePortalSnapshot, fallback?: string | null): string | null {
  const override = portalString(portalObject(portalData, 'testCaseOverrides'), 'meteringMethod')
  return sanitizeProdatToken(override ?? portalString(portalData, 'meteringMethod') ?? fallback ?? null, 12)
}

export function buildProfiledProdatSegments(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
  renderer?: string
  mode?: 'test' | 'production'
  variant?: string | null
  routeDecisionReason?: string | null
  selectedVersion?: string | null
  acceptedVersions?: string[]
}): ProdatEngineRenderResult {
  const portalData = input.portalSnapshot ?? null
  const context = input.context
  const issues = validateProdatContext(context)

  const bgmReference = compactProdatReference(context.bgmReference, 35)
  const lineItemReference = compactProdatReference(context.transactionReference || context.bgmReference, 35)
  const isPermissionMessage = isPermissionMessageCode(context.code)
  const isSupplierZ09 = context.code === 'Z09'
  const explicitReasonForTransaction = isHistoricalPermissionReason(input.variant ?? context.reasonForTransaction ?? null)
    ? 'S18'
    : portalString(portalData, 'reasonForTransaction') ?? context.reasonForTransaction ?? input.variant ?? null
  const reasonForTransaction = isPermissionMessage
    ? resolvePermissionReasonForCode(explicitReasonForTransaction)
    : normalizeReasonForTransaction(explicitReasonForTransaction)
  const isHistoricalPermission = isHistoricalPermissionReason(reasonForTransaction ?? input.variant ?? null)
  const meteringMethod = resolveMeteringMethod(portalData, context.meteringMethod)
  const installationDirection = sanitizeProdatToken(
    portalString(portalData, 'installationDirection') ?? context.installationDirection ?? null,
    12,
  )
  const permissionPurpose = sanitizeProdatToken(
    portalString(portalData, 'permissionPurpose') ?? context.permissionPurpose ?? null,
    12,
  )

  // Production rule (no-placeholder): never fabricate an object identifier such as
  // 'UNKNOWN'. When no real facility/metering point id exists the object id is
  // omitted. A Z01 customer-identity request is address-keyed and does not require
  // LIN per its rulebook profile, so omission is documented-safe; other codes
  // always carry a real id (enforced by their preflight) and are unaffected.
  const meterPointId = portalString(portalData, 'facilityId') ?? sanitizeProdatText(context.meterPointId)
  const hasObjectIdentifier = meterPointId.trim().length > 0

  const gridAreaId = portalString(portalData, 'gridAreaId') ?? sanitizeProdatText(context.gridAreaId)
  const startDate = isHistoricalPermission
    ? portalDate102(portalData, 'reportStartDateTime') ?? prodatDate102(context.startDate)
    : portalDate102(portalData, 'reportStartDateTime') ??
      portalDate102(portalData, 'agreementStartDateTime') ??
      prodatDate102(context.startDate)
  const reportEndDate203 =
    prodatDate203(
      portalString(portalData, 'reportEndDateTime') ??
      portalString(portalData, 'permissionEndDate') ??
      context.permissionEndDate ??
      (isHistoricalPermission ? null : portalString(portalData, 'agreementEndDateTime')) ??
      null,
    )

  const segments: string[] = [
    `BGM+${context.code}+${bgmReference}+9+AB`,
    `DTM+137:${prodatNowDate203(input.generatedAt)}:203`,
    'DTM+ZZZ:1:805',
    prodatPartySegment('FR', context.senderEdielId),
    prodatPartySegment('DO', context.receiverEdielId),
  ]

  // Only emit the LIN object identifier when a real id exists. No 'UNKNOWN'.
  if (hasObjectIdentifier) {
    segments.push(`LIN+1++${sanitizeProdatText(meterPointId)}:::9`)
  }

  const startDate203 = prodatDate203AtStartOfDay(startDate)
  if (context.code === 'Z18') {
    const permissionCreatedAt = prodatDate203(
      portalString(portalData, 'permissionTimestamp') ?? context.permissionTimestamp,
    )
    const reportingEndDate = prodatDate203(
      portalString(portalData, 'permissionEndDate') ?? context.permissionEndDate,
    )
    if (permissionCreatedAt) segments.push(`DTM+693:${permissionCreatedAt}:203`)
    if (reportingEndDate) segments.push(`DTM+164:${reportingEndDate}:203`)
  } else if (context.code === 'Z08') {
    const closureDate = prodatDate203AtStartOfDay(
      portalString(portalData, 'endDate') ?? context.endDate ?? context.permissionEndDate,
    )
    if (closureDate) segments.push(`DTM+93:${closureDate}:203`)
  } else if ((context.code === 'Z13' || context.code === 'Z14') && startDate203) {
    // PRODAT 26.A fält 302/321: tillståndsflöden använder rapportstart
    // och, för historiska mätvärden, rapportslut. De ska inte renderas som
    // DTM+92 avtalstart.
    segments.push(`DTM+90:${startDate203}:203`)
    if (isHistoricalPermission && reportEndDate203) segments.push(`DTM+91:${reportEndDate203}:203`)
  } else if (startDate203) {
    // Z09 uses validity date (field 216) in SG8/DTM qualifier 157.
    // Supplier AGT L7 failed when this was rendered as DTM+92.
    segments.push(`DTM+${isSupplierZ09 ? '157' : '92'}:${startDate203}:203`)
  }

  if (reasonForTransaction) {
    segments.push('CCI++Z13', isPermissionMessage ? prodatCav(reasonForTransaction) : `CAV+${reasonForTransaction}`)
  }

  if (meteringMethod) {
    segments.push('CCI++Z04', isPermissionMessage ? prodatCav(meteringMethod) : `CAV+${meteringMethod}`)
  }

  const reportingFrequency = sanitizeProdatToken(
    portalString(portalData, 'reportingFrequency') ?? context.reportingFrequency ?? null,
    12,
  )
  if (isPermissionMessage && reportingFrequency) {
    segments.push('CCI++Z12', prodatCavValue1(reportingFrequency, 12))
  }

  const energyProductId = sanitizeProdatToken(
    portalString(portalData, 'energyProductId') ?? context.energyProductId ?? null,
    35,
  )
  if (isPermissionMessage && energyProductId) {
    // Fält 506 Energiprodukt skickas som SG14/CCI+Z14 + SG14/CAV/7111,
    // med GS1 som kodlisteansvarig. Det ska inte renderas som PIA i permission-flöden.
    segments.push('CCI++Z14', prodatCavValue2(energyProductId, 35))
  }

  if (isPermissionMessage && installationDirection) {
    segments.push('CCI++Z22', prodatCav(installationDirection))
  }

  const permissionStatus = sanitizeProdatToken(
    portalString(portalData, 'permissionStatus') ?? context.permissionStatus ?? null,
    12,
  )
  if (isPermissionMessage && permissionStatus) {
    segments.push('CCI++Z23', prodatCav(permissionStatus))
  }

  if (isPermissionMessage && permissionPurpose) {
    segments.push('CCI++Z24', prodatCav(permissionPurpose))
  }

  const permissionEndReason = sanitizeProdatToken(
    portalString(portalData, 'permissionEndReason') ?? context.permissionEndReason ?? null,
    12,
  )
  if (isPermissionMessage && permissionEndReason) {
    segments.push('CCI++Z25', prodatCav(permissionEndReason))
  }

  const contractClosureReason = sanitizeProdatToken(
    portalString(portalData, 'contractClosureReason') ?? context.contractClosureReason ?? null,
    12,
  )
  if (context.code === 'Z08' && contractClosureReason) {
    segments.push('CCI++Z25', prodatCav(contractClosureReason))
  }

  segments.push(`RFF+LI:${lineItemReference}`)

  if (gridAreaId) {
    segments.push(`RFF+Z05:${sanitizeProdatText(gridAreaId)}`)
  }

  const permissionId = portalString(portalData, 'permissionId') ?? context.permissionId ?? null
  const powerOfAttorneyReference = portalString(portalData, 'powerOfAttorneyReference') ?? context.powerOfAttorneyReference
  if (context.code === 'Z18') {
    const z18PermissionId = sanitizeProdatText(permissionId ?? powerOfAttorneyReference ?? '')
    if (z18PermissionId) segments.push(`RFF+Z09:${z18PermissionId}`)
  } else if (!isSupplierZ09 && powerOfAttorneyReference) {
    segments.push(`RFF+ANJ:${sanitizeProdatText(powerOfAttorneyReference)}`)
  }

  if (!isSupplierZ09) {
    segments.push(prodatCustomerNadSegment({
    customerId: portalString(portalData, 'customerId') ?? context.customerId ?? null,
    customerIdCodeListQualifier: portalString(portalData, 'customerIdCodeListQualifier') ?? context.customerIdCodeListQualifier ?? null,
    customerName: portalString(portalData, 'customerName') ?? context.customerName,
    address: portalString(portalData, 'customerAddress') ?? context.customerAddress ?? null,
    city: portalString(portalData, 'customerCity') ?? context.customerCity ?? null,
    postalCode: portalString(portalData, 'customerPostalCode') ?? context.customerPostalCode ?? null,
    country: portalString(portalData, 'customerCountry') ?? context.customerCountry ?? null,
    }))
  }

  if (!isSupplierZ09 && context.code !== 'Z03' && context.code !== 'Z18') {
    segments.push(prodatInstallationNadSegment({
      meterPointId,
      address: portalString(portalData, 'siteAddress') ?? context.siteAddress ?? null,
      city: portalString(portalData, 'siteCity') ?? context.siteCity ?? null,
      postalCode: portalString(portalData, 'sitePostalCode') ?? context.sitePostalCode ?? null,
      country: portalString(portalData, 'siteCountry') ?? context.siteCountry ?? null,
    }))
  }

  const balanceResponsibleId = portalString(portalData, 'balanceResponsibleId') ?? context.balanceResponsibleId
  if (balanceResponsibleId) {
    segments.push(`NAD+Z02+${sanitizeProdatText(balanceResponsibleId)}:160:SVK`)
  }

  return {
    segments,
    issues,
    ackExpectation: deriveProdatAckExpectation(context.code),
    diagnostics: {
      engine: 'prodat',
      renderer: input.renderer ?? 'prodat.engine.buildProfiledProdatSegments',
      code: context.code,
      variant: input.variant ?? null,
      mode: input.mode,
      lineItemReference,
      bgmReference,
      reasonForTransaction,
      meteringMethod,
      objectIdentifierMissing: !hasObjectIdentifier,
      hasPortalSnapshot: Boolean(portalData),
      segmentCountBeforeEnvelope: segments.length,
      routeDecisionReason: input.routeDecisionReason ?? null,
      selectedVersion: input.selectedVersion ?? null,
      acceptedVersions: input.acceptedVersions ?? [],
    },
  }
}
