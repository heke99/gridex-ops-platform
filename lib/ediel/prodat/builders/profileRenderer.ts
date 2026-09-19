import {evaluateProdatDateEvents} from '@/lib/ediel/rulebook/prodatDateEventPolicy'
import {isProdatDateEventField} from '@/lib/ediel/prodat/prodatDateEvents'
import {evaluateProdatInvoicee} from '@/lib/ediel/rulebook/prodatInvoiceePolicy'
import {INVOICEE_FIELDS} from '@/lib/ediel/prodat/prodatInvoicee'
import {evaluateProdatEndUserAddress} from '@/lib/ediel/rulebook/prodatEndUserAddressPolicy'
import { validateProdatZ14Policy, z14DependentRules } from '@/lib/ediel/rulebook/prodatZ14Policy'
import { resolveProdatRegisterConditionFacts } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { resolveProdatRegisterInputs, prodatObjectIdentityAgency } from '@/lib/ediel/prodat/prodatRegisterInput'
import { renderProdatRegisterObject } from '@/lib/ediel/prodat/render/registers'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import type { RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import { isProdatReadingField } from '@/lib/ediel/prodat/prodatRegisterReadings'
import { reconcileProdatRegisterInventoryStatus, validateProdatRegisterPolicy } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import { prodatRegisterFieldScope } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { buildProdatDateSegments, resolveProdatDateInputs } from '@/lib/ediel/prodat/render/dateSegments'
import { validateProdatDateFields } from '@/lib/ediel/prodat/prodatDateValidation'
import { prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields'
import { PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { renderProdatDocumentHeader } from '@/lib/ediel/prodat/prodatDocumentFields'
// lib/ediel/prodat/builders/profileRenderer.ts

import type {
  ProdatEngineAckExpectation,
  ProdatEnginePortalSnapshot,
  ProdatEngineInvoiceeContext,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import {
  compactProdatReference,
  prodatCustomerNadSegment,
  prodatInvoiceeNadSegment,
  prodatInstallationNadSegment,
  prodatPartySegment,
  prodatBalanceResponsibleSegment,
  sanitizeProdatText,
  sanitizeProdatToken,
} from '@/lib/ediel/prodat/render/segments'
import { validateProdatContext } from '@/lib/ediel/prodat/render/validate'
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import {
  resolveCanonicalEdielPolicy,
  type CanonicalEdielPolicy,
} from '@/lib/ediel/rulebook/canonicalEdielPolicy'

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

function portalPartyText(portalData: ProdatEnginePortalSnapshot, key: string): string | null {
  const value = portalData?.[key]
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('prodat_party_snapshot_invalid')
  return value.trim() // An explicitly empty party field must not borrow a fallback.
}

function portalPartyLines(portalData: ProdatEnginePortalSnapshot, key: string): readonly string[] | undefined {
  const value = portalData?.[key]
  if (value == null) return undefined
  if (!Array.isArray(value) || !value.every(part => typeof part === 'string')) throw new Error('prodat_party_snapshot_invalid')
  return value as string[]
}

function portalAgency<T extends string>(portalData: ProdatEnginePortalSnapshot, key: string, allowed: readonly T[]): T | undefined {
  const value = portalPartyText(portalData, key)
  if (value === null) return undefined
  if (!allowed.includes(value as T)) throw new Error('prodat_party_code_list_invalid')
  return value as T
}

function invoiceeContext(portalData: ProdatEnginePortalSnapshot, fallback: ProdatEngineInvoiceeContext | null | undefined): ProdatEngineInvoiceeContext | null {
  if (!portalData || !Object.prototype.hasOwnProperty.call(portalData, 'invoicee')) return fallback ?? null
  if (portalData.invoicee === null) return null
  const data = objectValue(portalData.invoicee)
  if (!data) throw new Error('prodat_party_snapshot_invalid')
  return {
    id: portalPartyText(data, 'id'), idCodeListQualifier: portalPartyText(data, 'idCodeListQualifier'),
    idAgency: portalAgency(data, 'idAgency', ['89', '260'] as const),
    name: portalPartyText(data, 'name') ?? '', nameLines: portalPartyLines(data, 'nameLines'),
    address: portalPartyText(data, 'address'), addressLines: portalPartyLines(data, 'addressLines'),
    city: portalPartyText(data, 'city'), postalCode: portalPartyText(data, 'postalCode'), country: portalPartyText(data, 'country'),
  }
}

function portalObject(portalData: ProdatEnginePortalSnapshot, key: string): Record<string, unknown> | null {
  return objectValue(portalData?.[key])
}

function resolveMeteringMethod(portalData: ProdatEnginePortalSnapshot, fallback?: string | null): string | null {
  const override = portalString(portalObject(portalData, 'testCaseOverrides'), 'meteringMethod')
  return sanitizeProdatToken(override ?? portalString(portalData, 'meteringMethod') ?? fallback ?? null, 12)
}

function rendererPolicy(input: {
  portalSnapshot?: ProdatEnginePortalSnapshot
  context: ProdatEngineProductionContext
  generatedAt?: Date
  mode?: 'test' | 'production'
  variant?: string | null
  policy?: CanonicalEdielPolicy
}): CanonicalEdielPolicy {
  if (input.policy) return input.policy
  return resolveCanonicalEdielPolicy({
    family: 'PRODAT',
    messageCode: input.context.code,
    subtypeOrReasonCode: input.variant ?? input.context.reasonForTransaction ?? input.context.contractClosureReason ?? null,
    direction: 'outbound',
    referenceDate: (input.generatedAt ?? new Date()).toISOString().slice(0, 10),
    businessContext: input.context.businessContext ?? null,
    bilateralCapabilityVerified: input.context.bilateralCapabilityVerified ?? undefined,
    prodatDependentFacts: {
      market: 'electricity',
      ...resolveProdatRegisterConditionFacts(input.context.dependentConditionFacts,input.portalSnapshot),
    },
    mode: input.mode === 'production' ? 'send' : 'catalog_evidence',
  })
}

function ackExpectationFromPolicy(policy: CanonicalEdielPolicy): ProdatEngineAckExpectation {
  const requiresContrl = policy.ackRule.technicalAck === 'CONTRL'
  const requiresAperak = policy.ackRule.applicationAck === 'APERAK' || policy.ackRule.applicationAck === 'transactional'
  return {
    requiresContrl,
    requiresAperak,
    contrlStatus: requiresContrl ? 'pending' : 'not_required',
    aperakStatus: requiresAperak ? 'pending' : 'not_required',
    utiltsErrStatus: 'not_required',
    ackDueAt: null,
  }
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
  policy?: CanonicalEdielPolicy
}): ProdatEngineRenderResult {
  const portalData = input.portalSnapshot ?? null
  const context = input.context
  const policy = rendererPolicy(input)
  const dateInputs = resolveProdatDateInputs(policy.code, policy.subtype, context, portalData)
  const issues = validateProdatContext({ ...context, ...dateInputs })

  const bgmReference = context.bgmReference.trim()
  const bgmSegment = renderProdatDocumentHeader({ code: policy.code, documentId: bgmReference })
  const lineItemReference = compactProdatReference(context.transactionReference || context.bgmReference, 35)
  const isPermissionMessage = policy.processGroup === 'metering_access'
  const isSupplierZ09 = policy.code === 'Z09'
  const reasonForTransaction = policy.transactionReasonCode
  const meteringMethod = resolveMeteringMethod(portalData, context.meteringMethod)
  const installationDirection = sanitizeProdatToken(
    portalString(portalData, 'installationDirection') ?? context.installationDirection ?? null,
    12,
  )
  const permissionPurpose = sanitizeProdatToken(
    portalString(portalData, 'permissionPurpose') ?? context.permissionPurpose ?? null,
    12,
  )

  const meterPointId = portalPartyText(portalData, 'facilityId') ?? context.meterPointId.trim()
  const hasObjectIdentifier = meterPointId.trim().length > 0
  const identityAgency = prodatObjectIdentityAgency(context.meterPointIdAgency)

  const gridAreaId = portalString(portalData, 'gridAreaId') ?? sanitizeProdatText(context.gridAreaId)
  const dates = buildProdatDateSegments(policy.code, policy.subtype, dateInputs, input.generatedAt)

  const segments: string[] = [
    bgmSegment,
    ...dates.header,
    prodatPartySegment('FR', context.legalSenderId ?? context.senderEdielId, context.legalSenderCountry ?? 'SE'),
    prodatPartySegment('DO', context.legalReceiverId ?? context.receiverEdielId, context.legalReceiverCountry ?? 'SE'),
  ]

  if (hasObjectIdentifier) {
    segments.push(`LIN+1++${escapeEdifactValue(meterPointId)}:::${identityAgency}`)
  } else {
    segments.push('LIN+1')
  }

  segments.push(...dates.line)
  const negativePermissionResponse = policy.code === 'Z14' && policy.subtype === 'N'
  const carriesPermissionIdentity = policy.code === 'Z18' || policy.code === 'Z15'
    || (policy.code === 'Z14' && !negativePermissionResponse)

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
  if (policy.code === 'Z08' && contractClosureReason) {
    segments.push('CCI++Z25', prodatCav(contractClosureReason))
  }

  segments.push(`RFF+LI:${lineItemReference}`)

  if (gridAreaId) {
    segments.push(`RFF+Z05:${sanitizeProdatText(gridAreaId)}`)
  }

  const permissionId = portalString(portalData, 'permissionId') ?? context.permissionId ?? null
  const powerOfAttorneyReference = portalString(portalData, 'powerOfAttorneyReference') ?? context.powerOfAttorneyReference
  if (carriesPermissionIdentity) {
    const canonicalPermissionId = sanitizeProdatText(permissionId ?? '')
    if (canonicalPermissionId) segments.push(`RFF+Z09:${canonicalPermissionId}`)
  } else if (!isSupplierZ09 && policy.code !== 'Z14' && powerOfAttorneyReference) {
    segments.push(`RFF+ANJ:${sanitizeProdatText(powerOfAttorneyReference)}`)
  }

  const partyFieldAllowed = (field: string) => {
    const descriptor = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === field)
    const codeIndex = PRODAT_26A_MESSAGE_CODES.findIndex(code => code === policy.code)
    return Boolean(descriptor) && codeIndex >= 0 && descriptor?.requirements[codeIndex] !== '-'
      && !isProdatFieldInInapplicableParent({ messageCode: policy.code, subtype: policy.subtype, fieldNumber: field })
  }

  const addressOverridden=portalData && (Object.hasOwn(portalData,'customerAddressLines') || Object.hasOwn(portalData,'customerAddress'))
  const ownAddressLines=addressOverridden ? Object.hasOwn(portalData,'customerAddressLines') ? portalPartyLines(portalData,'customerAddressLines') ?? [] : undefined : context.customerAddressLines
  const ownAddress=addressOverridden ? portalPartyText(portalData,'customerAddress') : context.customerAddress
  if (partyFieldAllowed('END_USER_GROUP')) {
    segments.push(prodatCustomerNadSegment({
      customerId: portalPartyText(portalData, 'customerId') ?? context.customerId ?? null,
      customerIdCodeListQualifier: portalPartyText(portalData, 'customerIdCodeListQualifier') ?? context.customerIdCodeListQualifier ?? null,
      customerName: portalPartyText(portalData, 'customerName') ?? context.customerName,
      nameLines: portalPartyLines(portalData, 'customerNameLines') ?? context.customerNameLines,
      idAgency: portalAgency(portalData, 'customerIdAgency', ['89', '260'] as const) ?? context.customerIdAgency,
      addressLines: partyFieldAllowed('229') ? ownAddressLines : undefined,
      address: partyFieldAllowed('229') ? ownAddress ?? null : null,
      city: partyFieldAllowed('232') ? portalPartyText(portalData, 'customerCity') ?? context.customerCity ?? null : null,
      postalCode: partyFieldAllowed('231') ? portalPartyText(portalData, 'customerPostalCode') ?? context.customerPostalCode ?? null : null,
      country: portalPartyText(portalData, 'customerCountry') ?? context.customerCountry ?? null,
    }))
  }

  const siteAddress = portalPartyText(portalData, 'siteAddress') ?? context.siteAddress ?? null
  const siteAddressLines = portalPartyLines(portalData, 'siteAddressLines') ?? context.siteAddressLines
  const optionalInstallation = ['Z01', 'Z03', 'Z08'].includes(policy.code)
  const installationAddressSupplied = Boolean(siteAddress?.trim() || siteAddressLines?.some(value => value.trim()))
  // P26.A p22 makes this parent optional for Z01/Z03/Z08. Complete,
  // installation-specific object data selects it; an incomplete optional group
  // is omitted rather than emitted with one of its mandatory children missing.
  const installationSelected = !optionalInstallation || (hasObjectIdentifier && installationAddressSupplied)
  if (partyFieldAllowed('INSTALLATION_GROUP') && installationSelected) {
    segments.push(prodatInstallationNadSegment({
      meterPointId,
      address: siteAddress,
      addressLines: siteAddressLines,
      idAgency: portalAgency(portalData, 'siteIdAgency', ['9', '89'] as const) ?? context.siteIdAgency ?? (optionalInstallation ? identityAgency : undefined),
      city: portalPartyText(portalData, 'siteCity') ?? context.siteCity ?? null,
      postalCode: portalPartyText(portalData, 'sitePostalCode') ?? context.sitePostalCode ?? null,
      country: portalPartyText(portalData, 'siteCountry') ?? context.siteCountry ?? null,
    }))
  }

  const invoicee = partyFieldAllowed('INVOICEE_GROUP') ? invoiceeContext(portalData, context.invoicee) : null
  if (invoicee) {
    segments.push(prodatInvoiceeNadSegment({
      customerId: invoicee.id, customerIdCodeListQualifier: invoicee.idCodeListQualifier,
      idAgency: invoicee.idAgency, customerName: invoicee.name, nameLines: invoicee.nameLines,
      address: invoicee.address, addressLines: invoicee.addressLines, city: invoicee.city,
      postalCode: invoicee.postalCode, country: invoicee.country,
    }))
  }

  const balanceResponsibleId = portalPartyText(portalData, 'balanceResponsibleId') ?? context.balanceResponsibleId
  if (partyFieldAllowed('262') && balanceResponsibleId) {
    segments.push(prodatBalanceResponsibleSegment(balanceResponsibleId))
  }

  const registers = resolveProdatRegisterInputs(context,portalData)
  const expanded = renderProdatRegisterObject({code:policy.code,segments,registers})
  segments.splice(0,segments.length,...expanded.segments)
  const registerPolicy = {...policy, fieldRules:policy.fieldRules.filter(rule => 'fieldNumber' in rule && prodatRegisterFieldScope(String(rule.fieldNumber ?? rule.fieldKey)) === 'local')}
  const registerFailures = validateCanonicalPolicyFields({policy:registerPolicy,rawSegments:segments})
  for (const failure of registerFailures) {
    issues.push({severity:failure.severity,code:failure.code,title:failure.title,description:failure.description})
  }
  if (policy.code === 'Z14') {
    const firstLine = segments.findIndex(segment => segment.startsWith('LIN+'))
    const failures = [
      ...validateProdatZ14Policy({family:'PRODAT',code:'Z14',rawSegments:segments.slice(firstLine),applicationReference:policy.applicationReference}, z14DependentRules()),
    ]
    for (const failure of failures) issues.push({severity:failure.severity,code:failure.code,title:failure.title,description:failure.description})
  }
  for (const failure of validateProdatDateFields(policy.code, segments)) {
    issues.push({ severity: 'error', code: failure.code, title: failure.title,
      description: failure.description })
  }

  for (const failure of prodatPartySyntaxIssues(segments)) {
    issues.push({ severity: 'error', code: failure.kind === 'length' ? 'FIELD_MATRIX_FIELD_LENGTH_INVALID' : 'FIELD_MATRIX_FIELD_FORMAT_INVALID',
      title: 'Ogiltigt PRODAT-partfält',
      description: `NAD fält ${failure.fieldNumber ?? 'part'} följer inte PRODAT 26.A:s partsdefinition.`,
    })
  }

  const addressDecision=evaluateProdatEndUserAddress({code:policy.code,rawSegments:segments,facts:policy.prodatDependentFacts})
  for(const failure of addressDecision.issues) issues.push({severity:failure.severity,code:failure.code,title:failure.title,description:failure.description})
  const renderedReadings = validateProdatRegisterPolicy({code:policy.code,rawSegments:segments,
    facts:policy.prodatDependentFacts,rules:registerPolicy.fieldRules.filter((rule): rule is RulebookFieldRule => 'family' in rule),applicationReference:policy.applicationReference,
    requireIndependentInventory:policy.direction === 'outbound'}).readings
  const dateDecision=evaluateProdatDateEvents({code:policy.code,rawSegments:segments,facts:policy.prodatDependentFacts})
  for(const failure of dateDecision.issues)issues.push({severity:failure.severity,code:failure.code,title:failure.title,description:failure.description})
  const invoiceeDecision=evaluateProdatInvoicee({code:policy.code,rawSegments:segments,facts:policy.prodatDependentFacts})
  for(const failure of invoiceeDecision.issues) issues.push({severity:failure.severity,code:failure.code,title:failure.title,description:failure.description})
  const dependentConditionStatuses = policy.prodatDependentConditions.map(condition =>
    isProdatDateEventField(policy.code,condition.fieldNumber)?{...condition,status:dateDecision.statuses.get(condition.fieldNumber)??'undetermined',decisionPhase:'rendered_wire_date_event' as const}:
    INVOICEE_FIELDS.includes(condition.fieldNumber)
      ? {...condition,status:invoiceeDecision.statuses.get(condition.fieldNumber) ?? 'undetermined',decisionPhase:'rendered_wire_invoicee' as const}
      :
    condition.fieldNumber==='229'
      ? {...condition,status:addressDecision.status,decisionPhase:'rendered_wire_address' as const}
      : isProdatReadingField(condition.fieldNumber)
      ? { ...condition, status: renderedReadings.get(condition.fieldNumber) ?? 'undetermined' as const,
        decisionPhase: 'rendered_wire_readings' as const }
      : condition.conditionId === 'optional_installation_wire_parent'
      ? { ...condition, status: installationSelected ? 'required' as const : 'not_required' as const,
        decisionPhase: 'rendered_wire_parent' as const }
      : condition.conditionId === 'multiple_meter_registers'
        ? { ...condition,
          status: reconcileProdatRegisterInventoryStatus(condition.status, registerFailures),
          decisionPhase: 'rendered_wire_inventory' as const }
      : condition)

  return {
    segments,
    issues,
    ackExpectation: ackExpectationFromPolicy(policy),
    diagnostics: {
      engine: 'prodat',
      registerCount: expanded.registerCount,
      registerEvidence: createProdatRegisterEvidence({code:policy.code,rawSegments:segments,facts:policy.prodatDependentFacts}),
      renderer: input.renderer ?? 'prodat.engine.buildProfiledProdatSegments',
      code: context.code,
      variant: policy.subtype,
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
      profileKey: policy.profileKey,
      rulebookProcessGroup: policy.processGroup,
      rulebookApplicationReference: policy.applicationReference,
      canonicalPolicySourceTrace: policy.sourceTrace as unknown as Array<Record<string, unknown>>,
      dateEventReadiness:['Z06','Z09','Z10'].includes(policy.code)?'unqualified':'not_applicable',
      dependentConditionStatuses: dependentConditionStatuses as unknown as Array<Record<string, unknown>>,
    },
  }
}
