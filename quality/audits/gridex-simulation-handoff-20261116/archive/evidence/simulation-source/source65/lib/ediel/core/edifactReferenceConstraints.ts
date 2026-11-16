import sourceManifest from '@/docs/ediel/masterplan-v2/registers/source_manifest.json'

function source(id: string, pages: readonly number[]) {
  const entry = sourceManifest.find(entry => entry.id === id)
  if (!entry) throw new Error('edifact_reference_source_unavailable')
  return Object.freeze({ id, filename: entry.filename, sha256: entry.sha256, pages: Object.freeze(pages) })
}

/** Source-owned UNH/UNT 0062 bounds, not full UNSM grammar or guide selection.
 * P full original pp41/84/97/105 and U pp71/100/112/120 explicitly state an..14.
 * The technical profile identifies the proven scope. Unknown profiles retain
 * their separate syntax/guide authority; no CONTRL bound is inferred here. */
export const EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS = Object.freeze({
  version: 1,
  field: '0062',
  maximumDecodedLength: 14,
  profiles: Object.freeze([
    Object.freeze({ technicalProfile: Object.freeze(['PRODAT', 'D', '97A', 'UN', 'E2SE6A']), source: source('P', [41, 84]) }),
    Object.freeze({ technicalProfile: Object.freeze(['APERAK', 'D', '96A', 'UN', 'E2SE6A']), source: source('P', [97, 105]) }),
    // A proven physical bound grants no gas-market activation or capability.
    Object.freeze({ technicalProfile: Object.freeze(['PRODAT', 'D', '97A', 'UN', 'E2SE6B']), source: source('P', [41, 84]) }),
    Object.freeze({ technicalProfile: Object.freeze(['APERAK', 'D', '96A', 'UN', 'E2SE6B']), source: source('P', [97, 105]) }),
    Object.freeze({ technicalProfile: Object.freeze(['UTILTS', 'D', '02B', 'UN', 'E5SE5A']), source: source('U', [71, 100]) }),
    Object.freeze({ technicalProfile: Object.freeze(['APERAK', 'D', '04A', 'UN', 'E5SE5A']), source: source('U', [112, 120]) }),
  ]),
})

export function edifactMessageReferenceMaximum(technicalProfile: readonly string[]): number | null {
  return EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS.profiles.some(profile =>
    profile.technicalProfile.every((part, index) => technicalProfile[index] === part))
    ? EDIFACT_MESSAGE_REFERENCE_CONSTRAINTS.maximumDecodedLength : null
}
