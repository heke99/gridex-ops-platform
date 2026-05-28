// lib/ediel/prodat/builders/generic.ts

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

function normalizeReasonForTransaction(value?: string | null, fallback: string | null = 'Z22'): string | null {
  const normalized = sanitizeProdatText(value).toUpperCase()
  if (normalized === 'LK' || normalized === 'Z23') return 'Z23'
  if (normalized === 'L' || normalized === 'Z22') return 'Z22'
  if (normalized === 'F' || normalized === 'Z06F' || normalized === 'Z09F' || normalized === 'E64') return 'E64'
  if (normalized === 'G' || normalized === 'Z06G' || normalized === 'Z09G' || normalized === 'E32') return 'E32'
  if (normalized === 'D' || normalized === 'Z09D' || normalized === 'Z70') return 'Z70'
  return normalized || fallback
}

function isPermissionMessageCode(code: string): boolean {
  return code === 'Z13' || code === 'Z14' || code === 'Z15' || code === 'Z18'
}

function defaultPermissionReasonForCode(code: string): string | null {
  // Production/SaaS-regel: Z13 är en tillståndsbegäran och måste bära
  // transaktionstyp i CCI++Z13/CAV. Om kundspecifik data inte skickar ett
  // explicit värde används standarden för korrekt Z13V. Övriga
  // tillståndsflöden får inte ärva leverantörsbytes-defaulten Z22.
  if (code === 'Z13' || code === 'Z14' || code === 'Z15' || code === 'Z18') return 'S17'
  return null
}

function resolvePermissionReasonForCode(code: string, explicitValue?: string | null): string | null {
  return normalizeReasonForTransaction(explicitValue, defaultPermissionReasonForCode(code))
}

function defaultPermissionInstallationDirection(code: string): string | null {
  // Fält 513 (Riktning / Type of Metering Point) skickas som SG14/CCI+Z22.
  // När masterdata saknar värde i ett SaaS-/TGT-flöde använder vi Combined
  // som säker fallback för Z13.
  if (code === 'Z13') return 'E19'
  return null
}

function resolvePermissionInstallationDirection(code: string, explicitValue?: string | null): string | null {
  const normalized = sanitizeProdatToken(explicitValue ?? null, 12)
  return normalized || defaultPermissionInstallationDirection(code)
}

function defaultPermissionPurpose(code: string, reasonForTransaction?: string | null): string | null {
  if (code !== 'Z13') return null
  if (reasonForTransaction === 'S18') return 'B72'
  return 'B71'
}

function resolvePermissionPurpose(code: string, explicitValue?: string | null, reasonForTransaction?: string | null): string | null {
  const normalized = sanitizeProdatToken(explicitValue ?? null, 12)
  return normalized || defaultPermissionPurpose(code, reasonForTransaction)
}

function resolveMeteringMethod(portalData: ProdatEnginePortalSnapshot, fallback?: string | null): string | null {
  const override = portalString(portalObject(portalData, 'testCaseOverrides'), 'meteringMethod')
  return sanitizeProdatToken(override ?? portalString(portalData, 'meteringMethod') ?? fallback ?? null, 12)
}

export function buildGenericProdatSegments(input: {
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
  const explicitReasonForTransaction = portalString(portalData, 'reasonForTransaction') ?? context.reasonForTransaction ?? null
  const reasonForTransaction = isPermissionMessage
    ? resolvePermissionReasonForCode(context.code, explicitReasonForTransaction)
    : normalizeReasonForTransaction(explicitReasonForTransaction, 'Z22')
  const meteringMethod = resolveMeteringMethod(portalData, context.meteringMethod)
  const installationDirection = isPermissionMessage
    ? resolvePermissionInstallationDirection(context.code, portalString(portalData, 'installationDirection') ?? context.installationDirection ?? null)
    : sanitizeProdatToken(portalString(portalData, 'installationDirection') ?? context.installationDirection ?? null, 12)
  const permissionPurpose = isPermissionMessage
    ? resolvePermissionPurpose(context.code, portalString(portalData, 'permissionPurpose') ?? context.permissionPurpose ?? null, reasonForTransaction)
    : sanitizeProdatToken(portalString(portalData, 'permissionPurpose') ?? context.permissionPurpose ?? null, 12)

  const meterPointId =
    portalString(portalData, 'facilityId') ??
    (sanitizeProdatText(context.meterPointId) || 'UNKNOWN')

  const gridAreaId = portalString(portalData, 'gridAreaId') ?? sanitizeProdatText(context.gridAreaId)
  const startDate =
    portalDate102(portalData, 'agreementStartDateTime') ??
    prodatDate102(context.startDate)

  const segments: string[] = [
    `BGM+${context.code}+${bgmReference}+9+AB`,
    `DTM+137:${prodatNowDate203(input.generatedAt)}:203`,
    'DTM+ZZZ:1:805',
    prodatPartySegment('FR', context.senderEdielId),
    prodatPartySegment('DO', context.receiverEdielId),
    `LIN+1++${sanitizeProdatText(meterPointId)}:::9`,
  ]

  const startDate203 = prodatDate203AtStartOfDay(startDate)
  if (startDate203) {
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

  const reportingFrequency = sanitizeProdatToken(portalString(portalData, 'reportingFrequency') ?? context.reportingFrequency ?? null, 12)
  if (isPermissionMessage && reportingFrequency) {
    segments.push('CCI++Z12', prodatCavValue1(reportingFrequency, 12))
  }

  const energyProductId = sanitizeProdatToken(portalString(portalData, 'energyProductId') ?? context.energyProductId ?? null, 35)
  if (isPermissionMessage && energyProductId) {
    // Fält 506 Energiprodukt skickas som SG14/CCI+Z14 + SG14/CAV/7111,
    // med GS1 som kodlisteansvarig. Det ska inte renderas som PIA i permission-flöden.
    segments.push('CCI++Z14', prodatCavValue1(energyProductId, 35))
  }

  if (isPermissionMessage && installationDirection) {
    segments.push('CCI++Z22', prodatCav(installationDirection))
  }

  const permissionStatus = sanitizeProdatToken(portalString(portalData, 'permissionStatus') ?? context.permissionStatus ?? null, 12)
  if (isPermissionMessage && permissionStatus) {
    segments.push('CCI++Z23', prodatCav(permissionStatus))
  }

  if (isPermissionMessage && permissionPurpose) {
    segments.push('CCI++Z24', prodatCav(permissionPurpose))
  }

  const permissionEndReason = sanitizeProdatToken(portalString(portalData, 'permissionEndReason') ?? context.permissionEndReason ?? null, 12)
  if (isPermissionMessage && permissionEndReason) {
    segments.push('CCI++Z25', prodatCav(permissionEndReason))
  }

  segments.push(`RFF+LI:${lineItemReference}`)

  if (gridAreaId) {
    segments.push(`RFF+Z05:${sanitizeProdatText(gridAreaId)}`)
  }

  const powerOfAttorneyReference = portalString(portalData, 'powerOfAttorneyReference') ?? context.powerOfAttorneyReference
  if (!isSupplierZ09 && powerOfAttorneyReference) {
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
    country: portalString(portalData, 'customerCountry') ?? context.customerCountry ?? 'SE',
    }))
  }

  if (!isSupplierZ09 && context.code !== 'Z03') {
    segments.push(prodatInstallationNadSegment({
      meterPointId,
      address: portalString(portalData, 'siteAddress') ?? context.siteAddress ?? null,
      city: portalString(portalData, 'siteCity') ?? context.siteCity ?? null,
      postalCode: portalString(portalData, 'sitePostalCode') ?? context.sitePostalCode ?? null,
      country: portalString(portalData, 'siteCountry') ?? context.siteCountry ?? 'SE',
    }))
  }

  const balanceResponsibleId = portalString(portalData, 'balanceResponsibleId') ?? context.balanceResponsibleId
  if (balanceResponsibleId) {
    segments.push(`NAD+Z02+${sanitizeProdatText(balanceResponsibleId)}:160:SVK`)
  }

  return {
    segments,
    issues,
    ackExpectation: deriveProdatAckExpectation(),
    diagnostics: {
      engine: 'prodat',
      renderer: input.renderer ?? 'prodat.engine.buildGenericProdatSegments',
      code: context.code,
      variant: input.variant ?? null,
      mode: input.mode,
      lineItemReference,
      bgmReference,
      reasonForTransaction,
      meteringMethod,
      hasPortalSnapshot: Boolean(portalData),
      segmentCountBeforeEnvelope: segments.length,
      routeDecisionReason: input.routeDecisionReason ?? null,
      selectedVersion: input.selectedVersion ?? null,
      acceptedVersions: input.acceptedVersions ?? [],
    },
  }
}
