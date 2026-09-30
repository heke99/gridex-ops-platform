import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

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
  return violations
}
