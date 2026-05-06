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

function normalizeReasonForTransaction(value?: string | null): string {
  const normalized = sanitizeProdatText(value).toUpperCase()
  if (normalized === 'LK' || normalized === 'Z23') return 'Z23'
  if (normalized === 'L' || normalized === 'Z22') return 'Z22'
  if (normalized === 'F' || normalized === 'Z06F' || normalized === 'Z09F' || normalized === 'E64') return 'E64'
  if (normalized === 'G' || normalized === 'Z06G' || normalized === 'Z09G' || normalized === 'E32') return 'E32'
  if (normalized === 'D' || normalized === 'Z09D' || normalized === 'Z70') return 'Z70'
  return normalized || 'Z22'
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
  const reasonForTransaction = normalizeReasonForTransaction(
    portalString(portalData, 'reasonForTransaction') ?? context.reasonForTransaction ?? null
  )
  const meteringMethod = resolveMeteringMethod(portalData, context.meteringMethod)

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
    segments.push(`DTM+92:${startDate203}:203`)
  }

  segments.push('CCI++Z13', `CAV+${reasonForTransaction}`)

  if (meteringMethod) {
    segments.push('CCI++Z04', `CAV+${meteringMethod}`)
  }

  segments.push(`RFF+LI:${lineItemReference}`)

  if (gridAreaId) {
    segments.push(`RFF+Z05:${sanitizeProdatText(gridAreaId)}`)
  }

  const powerOfAttorneyReference = portalString(portalData, 'powerOfAttorneyReference') ?? context.powerOfAttorneyReference
  if (powerOfAttorneyReference) {
    segments.push(`RFF+ANJ:${sanitizeProdatText(powerOfAttorneyReference)}`)
  }

  segments.push(prodatCustomerNadSegment({
    customerId: portalString(portalData, 'customerId') ?? context.customerId ?? null,
    customerIdCodeListQualifier: portalString(portalData, 'customerIdCodeListQualifier') ?? context.customerIdCodeListQualifier ?? null,
    customerName: portalString(portalData, 'customerName') ?? context.customerName,
    address: portalString(portalData, 'customerAddress') ?? context.customerAddress ?? null,
    city: portalString(portalData, 'customerCity') ?? context.customerCity ?? null,
    postalCode: portalString(portalData, 'customerPostalCode') ?? context.customerPostalCode ?? null,
    country: portalString(portalData, 'customerCountry') ?? context.customerCountry ?? 'SE',
  }))

  if (context.code !== 'Z03') {
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
