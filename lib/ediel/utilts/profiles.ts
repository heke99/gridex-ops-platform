import { canonicalUtiltsObservationRequirements, getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'
import type { UtiltsRuntimeFacts, UtiltsValidationIssue } from '@/lib/ediel/utiltsEngine'
import { expectedObservationCountForResolution } from '@/lib/ediel/utilts/resolution'
import { resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionIdentity'
import {segmentComposite,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {isValidUtiltsTransactionReference} from './physicalReference'

export const E66_INVALID_DELIVERY_PERIOD_ISSUE = 'UTILTS_E66_DELIVERY_PERIOD_INVALID'
export const E66_INVALID_REGISTRATION_DATE_ISSUE = 'UTILTS_E66_REGISTRATION_DATE_INVALID'
export const UTILTS_MISSING_DELIVERY_PERIOD_ISSUE = 'UTILTS_PROFILE_PERIOD_MISSING'

function issue(code: string, title: string, description: string, reference?: string | null, field = '512'): UtiltsValidationIssue {
  return {
    severity: 'error',
    kind: 'application',
    code,
    title,
    description,
    aperakErcCode: '41',
    aperakFieldCode: field,
    aperakText: 'MANDATORY FIELD MISSING',
    referenceQualifier: reference ? 'ACW' : null,
    referenceNumber: reference ?? null,
    lineItemReference: reference ?? null,
  }
}

function qualifier(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function isCalendarMinute(compact: string): boolean {
  if (!/^\d{12}$/.test(compact)) return false
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:00.000Z`
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) && date.toISOString() === iso
}

function e66TransactionDateIssues(facts: UtiltsRuntimeFacts, index: number, reference: string, legacyPeriodMissing: boolean): UtiltsValidationIssue[] {
  const observed = facts.utiltsObservedTransactions?.[index]
  const transaction = facts.transactions[index]
  if (!observed || observed.transactionId !== transaction.transactionId) return []

  // The legacy quarter/hour requirement already rejects an unusable SG5
  // registration. Preserve its one field error for existing rejected inputs.
  const legacyRegistrationMissing = !transaction.registrationTime && (transaction.resolution === '15' || transaction.resolution === '60')
  const issues: UtiltsValidationIssue[] = []
  for (const segment of observed.segments) {
    // U annex 1 p.125 assigns these date formats to SG5. After the first
    // SEQ, DTM+597 describes an observation in a different field scope.
    if (segment.tag === 'SEQ') break
    if (segment.tag !== 'DTM') continue
    // The parser keeps a default-alphabet projection at each source ordinal,
    // including for messages with a different UNA. Keep the physical ordinal
    // for the outgoing APERAK's exact source-value copy.
    const token = tokenizeEdifact(facts.runtimeSegments?.[segment.index] ?? segment.raw).segments[0]
    const [qualifier, value, format] = segmentComposite(token, 1)
    if (qualifier !== '324' && qualifier !== '597') continue
    const isDeliveryPeriod = qualifier === '324'
    if (isDeliveryPeriod ? legacyPeriodMissing : legacyRegistrationMissing) continue
    const field = isDeliveryPeriod ? '245' : '512'
    const code = isDeliveryPeriod ? E66_INVALID_DELIVERY_PERIOD_ISSUE : E66_INVALID_REGISTRATION_DATE_ISSUE
    const expectedFormat = isDeliveryPeriod ? '719' : '203'
    const compact = value?.trim() ?? ''
    const formatCode = format?.trim()
    if (!formatCode || !compact) {
      const missing = formatCode ? 'datumvärde' : 'formatkod'
      issues.push(issue(code, 'Ofullständigt datumfält', `DTM+${qualifier} i SG5 saknar ${missing}.`, reference, field))
      continue
    }

    const wrongFormat = formatCode !== expectedFormat
    const start = compact.slice(0, 12)
    const end = compact.slice(12)
    const validDate = isDeliveryPeriod
      ? isCalendarMinute(start) && isCalendarMinute(end) && start < end
      : isCalendarMinute(compact)
    if (!wrongFormat && validDate) continue

    const dateField = isDeliveryPeriod ? 'leveransperiod' : 'registreringstidpunkt'
    const title = wrongFormat ? 'Ogiltig datumformatkod' : `Ogiltig ${dateField}`
    const invalidDate = isDeliveryPeriod
      ? 'DTM+324 i format 719 kräver giltiga datum och klockslag med minutprecision samt ett slut efter starten.'
      : 'DTM+597 i format 203 kräver giltigt datum och klockslag med minutprecision.'
    const description = wrongFormat ? `DTM+${qualifier} i SG5 kräver formatkod ${expectedFormat}.` : invalidDate
    issues.push({
      ...issue(code, title, description, reference, field),
      aperakErcCode: '42',
      aperakText: 'INCORRECT DATA',
      aperakInvalidOccurrence: { segmentIndex: segment.index, elementIndex: 1, componentIndex: wrongFormat ? 2 : 1 },
    })
  }
  return issues
}

/** Prior/current §3.6.2 and §3.6.18: one E30 meter stand is a dated
 * instant, with neither delivery interval nor energy resolution. This only
 * exempts the two missing-field checks; other canonical validation remains. */
export function isSingletonE30Reading(facts: UtiltsRuntimeFacts, index: number): boolean {
  if (facts.messageCode !== 'E30') return false
  const observed = facts.utiltsObservedTransactions?.[index]
  const transaction = facts.transactions[index]
  if (!observed || !transaction || observed.identityQualifier !== '24' || !observed.transactionId
    || observed.observations.length !== 1 || transaction.deliveryPeriodRaw || transaction.resolution
    || transaction.quantities.length !== 1 || transaction.quantities[0].qualifier !== '220') return false
  const reading = observed.observations[0]
  if (reading.quantities.length !== 1 || reading.quantities[0].qualifier !== '220' || !reading.quantities[0].value) return false
  const dates = reading.segments.filter(segment=>segment.tag==='DTM').map(segment=>{
    const token=tokenizeEdifact(facts.runtimeSegments?.[segment.index]??segment.raw).segments[0]
    return token ? segmentComposite({...token,raw:segmentUntrimmedRaw(token)},1) : []
  }).filter(parts=>parts[0]==='597')
  if (dates.length !== 1 || dates[0].length!==3 || !/^\d{12}$/.test(dates[0][1]) || dates[0][2]!=='203') return false
  const minute = dates[0][1],year=Number(minute.slice(0,4)),month=Number(minute.slice(4,6)),day=Number(minute.slice(6,8)),
    hour=Number(minute.slice(8,10)),clockMinute=Number(minute.slice(10,12))
  const parsed=new Date(Date.UTC(year,month-1,day,hour,clockMinute))
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day
    &&parsed.getUTCHours()===hour&&parsed.getUTCMinutes()===clockMinute
}

function intervalQuantities(
  messageCode: string | null | undefined,
  quantities: Array<{ qualifier: string | null; value: number | null; raw: string }>,
) {
  if (!['E30','E66','S07'].includes(String(messageCode ?? '').trim().toUpperCase())) return quantities

  // Field 516 in the Swedish 25-A-3 matrix is QTY+136 (periodic energy).
  // Field 517 is QTY+220 (meter reading). Register readings are evidence for
  // E66 reconciliation, not interval energy rows and must never inflate the
  // expected observation count.
  return quantities.filter((quantity) => qualifier(quantity.qualifier) === '136')
}

export function validateCanonicalUtiltsProfile(facts: UtiltsRuntimeFacts, functionalEligible?: ReadonlySet<string>): UtiltsValidationIssue[] {
  const profile = getCanonicalUtiltsProfile(facts.messageCode)
  if (!profile) return [issue('UTILTS_PROFILE_MISSING', 'UTILTS-profil saknas', `Ingen aktiv profil finns för ${facts.messageCode ?? '(saknas)'}.`)]
  if (profile.messageCode === 'ERR') return []

  // Global facts are a legacy summary of the first/all IDEs. They never fill
  // an absent field or transaction in the physical source scope (U §2/3.8).
  const transactions = facts.transactions
  const issues: UtiltsValidationIssue[] = []
  if (profile.requiresTransaction && transactions.length === 0) issues.push(issue('UTILTS_TRANSACTION_REQUIRED', 'Transaktion saknas', `${profile.profileKey} kräver minst en transaktion.`, null, '505'))

  transactions.forEach((transaction, index) => {
    const reference = resolveUtiltsTransactionId(
      transaction.transactionId,
      index,
    )
    if (!transaction.transactionId) issues.push(issue('UTILTS_TRANSACTION_ID_MISSING', 'Transaktions-id saknas', `${profile.profileKey} kräver IDE+24 per transaktion.`, reference, '505'))
    else if(!isValidUtiltsTransactionReference(transaction.transactionId)) issues.push({
      ...issue('UTILTS_TRANSACTION_ID_INVALID','Ogiltigt transaktions-id','Transaktions-id uppfyller inte källfält505 an..35.',reference,'505'),
      aperakErcCode:'42',aperakText:'INCORRECT DATA',
      aperakInvalidOccurrence:facts.utiltsObservedTransactions?.[index] ? {segmentIndex:facts.utiltsObservedTransactions[index].segmentIndex,elementIndex:2,componentIndex:0} : undefined,
    })
    if (profile.requiresMeteringPoint && !(facts.messageCode === 'E66'
      ? transaction.meterPointId || transaction.regulatingObjectPresent
      : transaction.meterPointId)) issues.push(issue('UTILTS_PROFILE_METERING_POINT_MISSING', 'Anläggnings-id saknas', `${profile.profileKey} kräver ${facts.messageCode === 'E66' ? 'LOC+172 eller LOC+175' : 'LOC+172'} per transaktion.`, reference, '209'))
    if (profile.requiresGridArea && !transaction.gridAreaId) issues.push(issue('UTILTS_PROFILE_GRID_AREA_MISSING', 'Nätområde saknas', `${profile.profileKey} kräver LOC+239.`, reference, '260a'))
    const singletonReading = isSingletonE30Reading(facts, index)
    const missingPeriod = profile.requiresPeriod && !singletonReading && (!transaction.deliveryPeriodStart || !transaction.deliveryPeriodEnd)
    if (missingPeriod) issues.push(issue(UTILTS_MISSING_DELIVERY_PERIOD_ISSUE, 'Leveransperiod saknas', `${profile.profileKey} kräver både start och slut i DTM+324.`, reference, '245'))
    if (profile.messageCode === 'E66') issues.push(...e66TransactionDateIssues(facts, index, reference, missingPeriod))
    if (profile.requiresResolution && !singletonReading && !transaction.resolution) issues.push(issue('UTILTS_PROFILE_RESOLUTION_MISSING', 'Upplösning saknas', `${profile.profileKey} kräver DTM+354.`, reference, '508'))
    const quantities = transaction.quantities
    const observations=facts.utiltsObservedTransactions?.[index]?.observations ?? []
    const requirement=canonicalUtiltsObservationRequirements(profile.messageCode,{quantityCount:quantities.length,
      hasAmountOrPrice:observations.some(observation=>observation.segments.some(segment=>segment.tag==='MOA' || segment.tag==='PRI'))})
    if (requirement.unitRequired && !transaction.unit) issues.push(issue('UTILTS_PROFILE_UNIT_MISSING', 'Enhet saknas', `${profile.profileKey} kräver MEA-enhet för denna kvantitetsgren.`, reference, '264'))
    if (requirement.quantitiesRequired && quantities.length === 0) issues.push(issue('UTILTS_PROFILE_QUANTITY_MISSING', 'Mätvärden saknas', `${profile.profileKey} kräver QTY-värden i denna observationsgren.`, reference, ['S02','S03','S04'].includes(profile.messageCode) ? '515' : 'QTY/6060'))

    const countedQuantities = intervalQuantities(facts.messageCode, quantities)
    if (profile.validatesDst && countedQuantities.length > 0 && (!functionalEligible || functionalEligible.has(reference))) {
      const expected = expectedObservationCountForResolution({
        start: transaction.deliveryPeriodStart,
        end: transaction.deliveryPeriodEnd,
        value: transaction.resolution,
        format: transaction.resolutionFormat ?? null,
      })
      if (expected !== null && countedQuantities.length !== expected) {
        issues.push({
          ...issue('UTILTS_DST_INTERVAL_COUNT_MISMATCH', 'Fel antal intervall', `${profile.profileKey} förväntar ${expected} energiobservationer utifrån leveransperiod och DTM+354 men innehåller ${countedQuantities.length}.`, reference),
          kind: 'functional',
          utiltsErrCode: 'E87',
        })
      }
    }
  })
  return issues
}
