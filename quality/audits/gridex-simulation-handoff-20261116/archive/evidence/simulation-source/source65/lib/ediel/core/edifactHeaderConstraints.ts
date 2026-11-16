import { EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS } from './edifactReferenceConstraints'
import { segmentComposite, segmentUntrimmedRaw, tokenizeEdifact } from './edifactTokenizer'

/** Full authenticated P pp40–41/96–97: 0068 and S010 are X, not used.
 * P119 separately requires received PRODAT extra X information to be ignored.
 * These are national guide rules; optional UNH data is not a syntax error. */
export const EDIFACT_UNUSED_HEADER_CONSTRAINTS = Object.freeze({
  version: 1,
  segment: 'UNH',
  unusedElements: Object.freeze([
    Object.freeze({ elementIndex: 3, field: '0068' }),
    Object.freeze({ elementIndex: 4, field: 'S010' }),
  ]),
  ignoredIncomingMessageType: 'PRODAT',
  diagnosticCode: 'EDIEL_UNH_UNUSED_ELEMENT',
  profiles: Object.freeze(EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS.profiles
    .filter(profile => profile.source.id === 'P').map(profile => Object.freeze({
      technicalProfile: profile.technicalProfile,
      source: Object.freeze({ ...profile.source,
        pages: Object.freeze(profile.technicalProfile[0] === 'PRODAT' ? [40, 41, 119] : [96, 97]) }),
    }))),
})

export type EdifactUnusedHeaderObservation = {
  segmentIndex: number
  field: string
  fieldPath: string
  ignored: boolean
}

/** Observes original decoded components once, retaining physical whitespace.
 * The caller supplies actual direction; no payload flag grants an exception. */
export function edifactUnusedHeaderObservations(rawPayload: string, direction: 'inbound' | 'outbound'): EdifactUnusedHeaderObservation[] {
  const wire = tokenizeEdifact(rawPayload)
  const observations: EdifactUnusedHeaderObservation[] = []
  for (const segment of wire.segments) {
    if (segment.tag !== EDIFACT_UNUSED_HEADER_CONSTRAINTS.segment) continue
    const physical = { ...segment, raw: segmentUntrimmedRaw(segment) }
    const type = segmentComposite(physical, 2, wire.una)
    if (!EDIFACT_UNUSED_HEADER_CONSTRAINTS.profiles.some(profile => profile.technicalProfile.every((part, index) => type[index] === part))) continue
    for (const field of EDIFACT_UNUSED_HEADER_CONSTRAINTS.unusedElements) {
      if (segmentComposite(physical, field.elementIndex, wire.una).some(component => component.length > 0)) {
        observations.push({ segmentIndex: segment.index, field: field.field, fieldPath: `UNH/${field.field}`,
          ignored: direction === 'inbound' && type[0] === EDIFACT_UNUSED_HEADER_CONSTRAINTS.ignoredIncomingMessageType })
      }
    }
  }
  return observations
}
