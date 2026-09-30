import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { canonicalUtiltsTransactions } from './canonicalObservationScope'
import { normalizeEdifactResolution } from './resolution'

/** U §3.6.19 is a national packaging rule, not EDIFACT envelope syntax. */
export function utiltsPackagingGuideViolations(raw: string): Array<{code:string;field:string;description:string}> {
  const wire = tokenizeEdifact(raw)
  const violations: Array<{code:string;field:string;description:string}> = []
  if (wire.segments.filter(segment => segment.tag === 'UNH').length !== 1) {
    violations.push({code:'UTILTS_PACKAGING_MESSAGE_COUNT',field:'UNH/0062',description:'En UTILTS-överföring ska innehålla exakt ett UNH-meddelande enligt U §3.6.19.'})
  }
  const receiverIds = wire.segments.filter(segment => segment.tag === 'NAD' && segmentComposite(segment,1,wire.una)[0] === 'MR')
    .map(segment => segmentComposite(segment,2,wire.una)[0])
  if (new Set(receiverIds).size > 1) {
    violations.push({code:'UTILTS_PACKAGING_MULTIPLE_RECEIVERS',field:'NAD/3039',description:'En UTILTS-överföring får bara ha en juridisk mottagare enligt U §3.6.19.'})
  }
  const messageStart = wire.segments.findIndex(segment => segment.tag === 'UNH')
  if (messageStart < 0) return violations
  const reasons = new Set<string>()
  const resolutions = new Set<string>()
  for (const transaction of canonicalUtiltsTransactions(wire.segments.slice(messageStart),wire.una,0)) {
    // SG5 fields apply before this IDE's first SG8 observation. Observation
    // quality STS and local DTM never choose a batch's reason or resolution.
    const stop = transaction.observations[0]?.segmentIndex ?? Number.POSITIVE_INFINITY
    for (const segment of transaction.segments.filter(segment => segment.index < stop)) {
      if (segment.tag === 'STS' && segmentComposite(segment,1,wire.una)[0] === '7') {
        const reason = segmentComposite(segment,3,wire.una)[0]
        if (reason) reasons.add(reason)
      }
      if (segment.tag === 'DTM') {
        const [qualifier,value,format] = segmentComposite(segment,1,wire.una)
        if (qualifier !== '354' || !['802','805','806','807'].includes(format)) continue
        const resolution = normalizeEdifactResolution({value,format})
        if (resolution === 'P1M') resolutions.add('month')
        if (['PT15M','PT0.25H','PT900S'].includes(resolution ?? '')) resolutions.add('quarter')
      }
    }
  }
  if (reasons.size > 1) violations.push({code:'UTILTS_PACKAGING_MIXED_REASONS',field:'223',description:'Anledningen i eget SG5/STS+7 ska vara samma för samtliga transaktioner enligt U §2 och §3.6.19.'})
  if (resolutions.has('quarter') && resolutions.has('month')) violations.push({code:'UTILTS_PACKAGING_MIXED_RESOLUTIONS',field:'508',description:'Kvarts- och månadsupplösning får inte blandas i samma UTILTS-överföring enligt U §3.6.19.'})
  return violations
}
