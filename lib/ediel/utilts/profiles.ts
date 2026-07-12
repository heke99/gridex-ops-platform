import { getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'
import type { UtiltsRuntimeFacts, UtiltsValidationIssue } from '@/lib/ediel/utiltsEngine'

function issue(code: string, title: string, description: string, reference?: string | null): UtiltsValidationIssue {
  return {
    severity: 'error',
    kind: 'application',
    code,
    title,
    description,
    aperakErcCode: '41',
    aperakFieldCode: '512',
    aperakText: 'MANDATORY FIELD MISSING',
    referenceQualifier: reference ? 'ACW' : null,
    referenceNumber: reference ?? null,
    lineItemReference: reference ?? null,
  }
}

function intervalCount(start: string | null, end: string | null, resolution: string | null): number | null {
  if (!start || !end || !resolution) return null
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  const minutes = Number(resolution)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(minutes) || minutes <= 0 || endMs <= startMs) return null
  const count = (endMs - startMs) / 60_000 / minutes
  return Number.isInteger(count) ? count : null
}

export function validateCanonicalUtiltsProfile(facts: UtiltsRuntimeFacts): UtiltsValidationIssue[] {
  const profile = getCanonicalUtiltsProfile(facts.messageCode)
  if (!profile) return [issue('UTILTS_PROFILE_MISSING', 'UTILTS-profil saknas', `Ingen aktiv profil finns för ${facts.messageCode ?? '(saknas)'}.`)]
  if (profile.messageCode === 'ERR') return []

  const transactions = facts.transactions.length > 0 ? facts.transactions : [{
    transactionId: facts.transactionId,
    meterPointId: facts.meterPointId,
    gridAreaId: facts.gridAreaId,
    deliveryPeriodStart: facts.deliveryPeriodStart,
    deliveryPeriodEnd: facts.deliveryPeriodEnd,
    resolution: facts.resolution,
    unit: facts.unit,
    quantities: facts.quantities,
  }]
  const issues: UtiltsValidationIssue[] = []
  if (profile.requiresTransaction && transactions.length === 0) issues.push(issue('UTILTS_TRANSACTION_REQUIRED', 'Transaktion saknas', `${profile.profileKey} kräver minst en transaktion.`))

  transactions.forEach((transaction, index) => {
    const reference = transaction.transactionId ?? facts.transactionId ?? `transaction-${index + 1}`
    if (!transaction.transactionId) issues.push(issue('UTILTS_TRANSACTION_ID_MISSING', 'Transaktions-id saknas', `${profile.profileKey} kräver IDE+24 eller TN-referens per transaktion.`, reference))
    if (profile.requiresMeteringPoint && !transaction.meterPointId && !facts.meterPointId) issues.push(issue('UTILTS_PROFILE_METERING_POINT_MISSING', 'Anläggnings-id saknas', `${profile.profileKey} kräver LOC+172 per transaktion.`, reference))
    if (profile.requiresGridArea && !transaction.gridAreaId && !facts.gridAreaId) issues.push(issue('UTILTS_PROFILE_GRID_AREA_MISSING', 'Nätområde saknas', `${profile.profileKey} kräver LOC+239.`, reference))
    if (profile.requiresPeriod && (!(transaction.deliveryPeriodStart ?? facts.deliveryPeriodStart) || !(transaction.deliveryPeriodEnd ?? facts.deliveryPeriodEnd))) issues.push(issue('UTILTS_PROFILE_PERIOD_MISSING', 'Leveransperiod saknas', `${profile.profileKey} kräver både start och slut i DTM+324.`, reference))
    if (profile.requiresResolution && !(transaction.resolution ?? facts.resolution)) issues.push(issue('UTILTS_PROFILE_RESOLUTION_MISSING', 'Upplösning saknas', `${profile.profileKey} kräver DTM+354.`, reference))
    if (profile.requiresUnit && !(transaction.unit ?? facts.unit)) issues.push(issue('UTILTS_PROFILE_UNIT_MISSING', 'Enhet saknas', `${profile.profileKey} kräver MEA-enhet.`, reference))
    const quantities = transaction.quantities?.length ? transaction.quantities : facts.quantities
    if (profile.requiresQuantities && quantities.length === 0) issues.push(issue('UTILTS_PROFILE_QUANTITY_MISSING', 'Mätvärden saknas', `${profile.profileKey} kräver QTY-värden.`, reference))

    if (profile.validatesDst && quantities.length > 0) {
      const expected = intervalCount(
        transaction.deliveryPeriodStart ?? facts.deliveryPeriodStart,
        transaction.deliveryPeriodEnd ?? facts.deliveryPeriodEnd,
        transaction.resolution ?? facts.resolution,
      )
      if (expected !== null && quantities.length !== expected) {
        issues.push({
          ...issue('UTILTS_DST_INTERVAL_COUNT_MISMATCH', 'Fel antal intervall', `${profile.profileKey} förväntar ${expected} intervall utifrån tidszon/DST och upplösning men innehåller ${quantities.length}.`, reference),
          kind: 'functional',
          utiltsErrCode: 'E87',
        })
      }
    }
  })
  return issues
}
