import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { canonicalUtiltsTransactions, utiltsPhysicalQuantityQuality } from './canonicalObservationScope'
import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { utiltsE30StandardEnergyUnit, utiltsPhysicalQuantityUnit } from './quantityUnitScope'
import { canonicalUtiltsDecimal, utiltsEnergyQuantityKwh } from './exactDecimal'
import { supportedUtiltsConsumptionIdentity } from './consumptionIdentity'
import { flattenUtiltsTransactionSeries, matchForSeriesItem, stringOrNull, toMeteringReadingType, type UtiltsTransactionMatch } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import { matchMeteringPointIdByIdentifier, matchSiteAndCustomerForMeteringPoint } from '@/lib/ediel/matching'
import { localEdifactDateTimeToUtc, parseEdifactTimezoneOffsetFromSegments } from './timezone'
import { addNormalizedResolution, normalizeEdifactResolution } from './resolution'
import { resolveUtiltsTransactionId } from './transactionIdentity'
import {physicalUtiltsReference,isValidUtiltsTransactionReference} from './physicalReference'
import { utiltsSeriesKind } from './transactionPersistence'
import { canonicalAbsoluteInstant, consumptionConflict, validateUtiltsConsumptionContract, type UtiltsConsumptionAttribution, type UtiltsConsumptionContract, type UtiltsBillingContext } from './consumptionContract'
import {utiltsRuntimeSegments,type UtiltsRuntimeResult } from '@/lib/ediel/utiltsEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'

export async function prepareUtiltsConsumptionContracts(input: {
  message: EdielMessageRow
  runtime: UtiltsRuntimeResult
  policy: CanonicalEdielPolicy
  matches: readonly UtiltsTransactionMatch[]
  dataRequest: GridOwnerDataRequestRow | null
  fallback: { customerId: string | null; siteId: string | null; meteringPointId: string | null; gridOwnerId: string | null }
  allowConsumption: boolean
}): Promise<UtiltsConsumptionContract[]> {
  const { message, runtime, policy } = input
  const companyId = stringOrNull(message.company_id)
  if (!companyId) consumptionConflict('company_missing')
  const wire = tokenizeEdifact(message.raw_payload ?? '')
  const sourceTransactionsPhysical = canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(segment => segment.tag === 'UNH')),wire.una,0)
  const timezone = parseEdifactTimezoneOffsetFromSegments(utiltsRuntimeSegments(runtime.facts))
  const absolute = (value: unknown) => canonicalAbsoluteInstant(localEdifactDateTimeToUtc(stringOrNull(value), timezone))
  const noAttribution = (reason: string): UtiltsConsumptionAttribution => ({ capability: 'skip', reason, customerId: null, siteId: null, customerSiteId: null, meteringPointId: null, gridOwnerId: null, sourceRequestId: null })
  // Resolve local instants before the pure legacy extractor performs interval
  // arithmetic. Otherwise E30's local Date input would depend on the host TZ.
  const acceptedIds = new Set(runtime.transactionDispositions.flatMap((d, i) => d.disposition === 'accepted' ? [resolveUtiltsTransactionId(d.transactionId, i)] : []))
  const sourceTransactions = Array.isArray(runtime.normalizedPayload.transactions) ? runtime.normalizedPayload.transactions : []
  // The normalized payload carries one entry per observation interval, so
  // several entries can belong to one physical IDE transaction. Each entry is
  // bound to its physical transaction by reference (by position only when the
  // shapes coincide), and quantity membership advances one cursor per physical
  // transaction so no physical quantity is consumed twice.
  const physicalCursors = new Map<object, number>()
  const physicalFor = (tx: Record<string, unknown>, index: number) => {
    const reference = physicalUtiltsReference(tx.transactionId)
    const owned = reference ? sourceTransactionsPhysical.filter(transaction => transaction.transactionId === reference) : []
    if (owned.length === 1) return owned[0]
    return !reference && sourceTransactions.length === sourceTransactionsPhysical.length ? sourceTransactionsPhysical[index] : undefined
  }
  const projected = sourceTransactions.flatMap((value, index) => {
    const tx = value as Record<string, unknown>
    if (!input.allowConsumption || !acceptedIds.has(resolveUtiltsTransactionId(physicalUtiltsReference(tx.transactionId), index))) return []
    if (policy.code === 'E30' || policy.code === 'E66') {
      const resolution = normalizeEdifactResolution({ value: stringOrNull(tx.resolution), format: stringOrNull(tx.resolutionFormat) })
      const quantities = Array.isArray(tx.quantities) ? tx.quantities.filter(quantity => (quantity as Record<string,unknown>).qualifier === '136') : []
      const physical = physicalFor(tx, index)
      if (!physical) consumptionConflict('physical_quantity_membership')
      const physicalQuantities = physical.observations.flatMap(observation => observation.quantities)
      const seriesOrdinals = new Map<string | null, number>()
      return quantities.map(quantity => {
        const source = quantity as Record<string, unknown>, cursor = physicalCursors.get(physical) ?? 0
        const at = physicalQuantities.findIndex((candidate, position) => position >= cursor && candidate.raw === source.raw && candidate.qualifier === '136')
        if (at < 0) consumptionConflict('physical_quantity_membership')
        physicalCursors.set(physical, at + 1)
        const observation = physical.observations.find(observation => observation.quantities.includes(physicalQuantities[at]))!
        const register = observation.references.find(reference => reference.qualifier === 'AES' && reference.directReferenceSlot)?.value ?? null
        const ordinal = seriesOrdinals.get(register) ?? 0
        seriesOrdinals.set(register, ordinal + 1)
        const start = resolution ? addNormalizedResolution(stringOrNull(tx.deliveryPeriodStart), resolution, ordinal) : stringOrNull(tx.deliveryPeriodStart)
        const end = resolution ? addNormalizedResolution(start, resolution) : stringOrNull(tx.deliveryPeriodEnd)
        if ((!resolution && quantities.length > 1) || !start || !end || absolute(end) > absolute(tx.deliveryPeriodEnd)) consumptionConflict('observation_interval_unresolved')
        return { ...tx, deliveryPeriodStart: absolute(start), deliveryPeriodEnd: absolute(end), resolution, quantities: [quantity] }
      })
    }
    return [{ ...tx, deliveryPeriodStart: absolute(tx.deliveryPeriodStart), deliveryPeriodEnd: absolute(tx.deliveryPeriodEnd),
      resolution: normalizeEdifactResolution({ value: stringOrNull(tx.resolution), format: stringOrNull(tx.resolutionFormat) }) }]
  })
  const series = input.allowConsumption ? flattenUtiltsTransactionSeries({ ...runtime.normalizedPayload, transactions: projected }, message) : []
  const result: UtiltsConsumptionContract[] = []
  for (const [index, disposition] of runtime.transactionDispositions.entries()) {
    const transactionId = resolveUtiltsTransactionId(disposition.transactionId, index)
    const transaction = runtime.facts.transactions[index]
    if (!transaction || resolveUtiltsTransactionId(transaction.transactionId, index) !== transactionId) consumptionConflict('physical_membership')
    const consume = input.allowConsumption && disposition.disposition === 'accepted'
    const items = consume ? series.filter(item => (item.rawItem.quantity as Record<string,unknown>).qualifier === '136' && (item.transactionReference ?? (runtime.facts.transactions.length === 1 ? transactionId : null)) === transactionId) : []
    let metering = noAttribution(consume ? 'no_eligible_observations' : 'no_consumption')
    if (items.length) {
      const identity = supportedUtiltsConsumptionIdentity(message.raw_payload ?? '', index)
      if (!identity || identity.transactionId !== transactionId || items.some(item => item.externalMeteringPointId !== identity.point)) consumptionConflict('identity_unsupported')
      const match = matchForSeriesItem(items[0], input.matches)
      let point = match?.meteringPointId ?? input.fallback.meteringPointId
      if (items[0].externalMeteringPointId && !match?.meteringPointId) point = await matchMeteringPointIdByIdentifier({ companyId, identifiers: [items[0].externalMeteringPointId] })
      const owner = point ? match?.customerId ? match : await matchSiteAndCustomerForMeteringPoint({ companyId, meteringPointId: point }) : null
      const customer = owner?.customerId ?? input.fallback.customerId
      metering = {
        capability: point && customer ? 'write' : 'skip', reason: !point ? 'metering_point_not_matched_within_tenant' : !customer ? 'customer_not_matched_for_metering_point' : null,
        customerId: customer, siteId: owner?.siteId ?? input.fallback.siteId, customerSiteId: owner?.siteId ?? input.fallback.siteId,
        meteringPointId: point, gridOwnerId: owner?.gridOwnerId ?? input.fallback.gridOwnerId, sourceRequestId: input.dataRequest?.id ?? null,
      }
    }
    const physical = sourceTransactionsPhysical[index]
    if (!physical || physical.transactionId !== transactionId) consumptionConflict('physical_quantity_membership')
    const physicalQuantities = physical.observations.flatMap(observation => observation.quantities)
    let sourceCursor = 0
    const observations = items.map((item, ordinal) => {
      const tx = item.rawItem.transaction as Record<string, unknown>
      const qty = item.rawItem.quantity as Record<string, unknown>
      let readingType = toMeteringReadingType(item.readingType)
      const sourceQuantity = physicalQuantities.findIndex((quantity, position) => position >= sourceCursor && quantity.raw === qty.raw && quantity.qualifier === qty.qualifier)
      if (sourceQuantity < 0 || physicalQuantities[sourceQuantity].value === null) consumptionConflict('physical_quantity_membership')
      sourceCursor = sourceQuantity + 1
      const original = physicalQuantities[sourceQuantity]
      const observation = physical.observations.find(observation=>observation.quantities.includes(original)) ?? null
      const quality = utiltsPhysicalQuantityQuality(observation, original, wire.una)
      if (quality === '56') readingType = 'estimated'
      const headerEnd = physical.observations[0]?.segmentIndex ?? Infinity
      const product = physical.segments.filter(segment => segment.index < headerEnd && segment.tag === 'LIN')
      if (product.length > 1) consumptionConflict('physical_product_ambiguous')
      const productCode = product.length ? segmentComposite(product[0], 3, wire.una)[0] || null : null
      const unit = policy.code==='E30' ? utiltsE30StandardEnergyUnit(physical,original,wire.una) : utiltsPhysicalQuantityUnit(physical,observation,original,wire.una)
      if (!unit) consumptionConflict('physical_quantity_unit')
      const quantity = utiltsEnergyQuantityKwh(canonicalUtiltsDecimal(original.value!,wire.una.decimalMark),unit)
      if (quantity === null) consumptionConflict('non_active_energy_consumption')
      return { ordinal, sourceOrdinal: sourceQuantity, quantity,
        periodStart: absolute(item.periodStart), periodEnd: absolute(item.periodEnd), readAt: absolute(item.readAt),
        resolution: stringOrNull(tx.resolution) ?? stringOrNull(runtime.normalizedPayload.resolution), unit: 'kWh' as const,
        quality, readingType, direction: readingType === 'production' ? 'production' as const : 'consumption' as const,
        registerCode: observation?.references.find(reference => reference.qualifier === 'AES' && reference.directReferenceSlot)?.value ?? null, productCode,
        sourceLineReference: item.externalMeteringPointId ?? stringOrNull(qty.lineReference), externalPoint: item.externalMeteringPointId, gridArea: item.externalGridAreaId }
    })
    const billingAllowed = consume && observations.length > 0 && input.dataRequest?.request_scope === 'billing_underlay' && Boolean(input.fallback.customerId)
    const periodStart = consume && runtime.normalizedPayload.periodStart ? absolute(runtime.normalizedPayload.periodStart) : null
    const periodEnd = consume && runtime.normalizedPayload.periodEnd ? absolute(runtime.normalizedPayload.periodEnd) : null
    const date = periodEnd ?? periodStart
    const billing: UtiltsBillingContext = {
      ...noAttribution('billing_not_applicable'), ...input.fallback, customerSiteId: input.fallback.siteId,
      capability: billingAllowed ? 'write' : 'skip', reason: billingAllowed ? null : 'billing_not_applicable',
      sourceRequestId: input.dataRequest?.id ?? null, requestScope: input.dataRequest?.request_scope ?? null,
      periodStart, periodEnd, month: date ? new Date(date).getUTCMonth() + 1 : null, year: date ? new Date(date).getUTCFullYear() : null,
      status: 'received', sourceSystem: 'ediel_utilts', currency: 'SEK',
    }
    const rejectedDiagnostic=disposition.disposition==='guide_rejected' && disposition.responseType==='negative_aperak' && disposition.issueCodes.includes('UTILTS_TRANSACTION_ID_INVALID') && !isValidUtiltsTransactionReference(transactionId)
    result.push(validateUtiltsConsumptionContract({
      version: rejectedDiagnostic ? 3 : 2, projectionVersion: rejectedDiagnostic ? 'utilts-rejected-diagnostic-v3' : 'utilts-consumption-v2', attributionVersion: 'tenant-match-v1', companyId, environment: message.environment,
      messageCode: policy.code, transactionId, seriesKind: utiltsSeriesKind(policy.code), profileKey: policy.profileKey,
      profileVersion: message.rule_profile_version ?? null, rulePackHash: message.rule_pack_checksum ?? null, guideRevision: policy.guide.guideRevision,
      interpretation: { localPeriodStart: transaction.deliveryPeriodStart, localPeriodEnd: transaction.deliveryPeriodEnd, localRegistration: transaction.registrationTime,
        resolutionValue: transaction.resolution, resolutionFormat: transaction.resolutionFormat, timezoneRaw: timezone?.raw ?? null,
        timezoneFormat: timezone?.format ?? null, offsetMinutes: timezone?.offsetMinutes ?? null, timestampPolicy: consume ? 'explicit-offset-v1' : 'no-consumption-v1' },
      observations, metering, billing, billingContributionOrdinals: billingAllowed ? observations.map(o => o.ordinal) : [], sourceType: 'ediel_utilts',
    }))
  }
  return result
}
