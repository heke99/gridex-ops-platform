import { segmentComposite, type EdifactTokenizeResult, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'

/** P26.A page14 compares BGM main functions, explicitly excluding subtype.
 * Actor/profile/role compatibility is the additional internal batching guard
 * from ENV-07. This projection confers no route, tenant or send authority. */
export const PRODAT_BATCH_SOURCE = Object.freeze({
  rule: 'ENV-07', document: 'P26.A', page: 14,
  originalSha256: '83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95',
})

export type ProdatInterchangeBatchIssue = {
  code: 'PRODAT_BATCH_FUNCTION_MIXED' | 'PRODAT_BATCH_FAMILY_MIXED' | 'PRODAT_BATCH_PROFILE_MIXED'
    | 'PRODAT_BATCH_PARTY_SCOPE_UNDETERMINED' | 'PRODAT_BATCH_PARTY_SCOPE_MIXED' | 'PRODAT_BATCH_FUNCTION_UNDETERMINED'
  description: string
  segment: string
  source: typeof PRODAT_BATCH_SOURCE
}

export function prodatInterchangeBatchIssues(tokens: EdifactTokenizeResult): ProdatInterchangeBatchIssue[] {
  const { segments, una } = tokens
  const messages: EdifactTokenizedSegment[][] = []
  let current: EdifactTokenizedSegment[] | null = null
  for (const segment of segments) {
    if (segment.tag === 'UNH') { current = [segment]; messages.push(current) }
    else if (segment.tag === 'UNT') current = null
    else if (current) current.push(segment)
  }
  if (messages.length <= 1) return []
  const profiles = messages.map(message => segmentComposite(message[0], 2, una).map(value => value.trim().toUpperCase()))
  if (!profiles.some(profile => profile[0] === 'PRODAT')) return []
  const failure = (code: ProdatInterchangeBatchIssue['code'], description: string, segment: string): ProdatInterchangeBatchIssue[] =>
    [{ code, description, segment, source: PRODAT_BATCH_SOURCE }]
  if (profiles.some(profile => profile[0] !== 'PRODAT')) {
    return failure('PRODAT_BATCH_FAMILY_MIXED', 'Dela överföringen: ett PRODAT-kuvert får inte användas för blandade familjer eller ett första-meddelande-beslut.', 'UNH')
  }
  const functions = messages.map(message => {
    const beforeObjects = message.slice(1, message.findIndex(segment => segment.tag === 'LIN') < 0 ? undefined
      : message.findIndex(segment => segment.tag === 'LIN'))
    const bgms = beforeObjects.filter(segment => segment.tag === 'BGM')
    const value = bgms.length === 1 ? segmentComposite(bgms[0], 1, una)[0]?.trim().toUpperCase() : null
    return value && /^Z\d{2}$/.test(value) ? value : null
  })
  if (functions.some(value => value === null)) {
    return failure('PRODAT_BATCH_FUNCTION_UNDETERMINED', 'Batchens egna huvudfunktioner måste vara entydiga fysiska BGM/1001. Inget APERAK-fältfel eller syntaxfel härleds av detta interna håll.', 'BGM')
  }
  if (new Set(functions).size !== 1) {
    return failure('PRODAT_BATCH_FUNCTION_MIXED', 'P26.A sida14 förbjuder olika PRODAT-huvudfunktioner inom samma UNA/UNB–UNZ. Dela batchen före kodning och sändning; undertyp ingår inte i jämförelsen.', 'BGM')
  }
  if (new Set(profiles.map(profile => JSON.stringify(profile))).size !== 1) {
    return failure('PRODAT_BATCH_PROFILE_MIXED', 'Dela batchen: varje PRODAT-meddelande måste ha samma egna UNH-profil och directoryedition.', 'UNH')
  }
  const parties = messages.map(message => {
    const firstObject = message.findIndex(segment => segment.tag === 'LIN')
    const header = message.slice(1, firstObject < 0 ? undefined : firstObject)
    const rows = header.filter(segment => segment.tag === 'NAD').map(segment => ({
      role: segmentComposite(segment, 1, una), identity: segmentComposite(segment, 2, una),
    }))
    const hasOwn = (role: string) => rows.filter(row => row.role.length === 1 && row.role[0] === role).length === 1
    if (!hasOwn('FR') || !hasOwn('DO') || rows.some(row => row.role.length !== 1 || !row.role[0] || !row.identity[0])) return null
    return JSON.stringify(rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))
  })
  if (parties.some(value => value === null)) {
    return failure('PRODAT_BATCH_PARTY_SCOPE_UNDETERMINED', 'Batchens egna juridiska FR/DO-parter och roller är inte entydiga före första LIN. En objekts- eller syskonpart får inte ersätta dem.', 'NAD')
  }
  if (new Set(parties).size !== 1) {
    return failure('PRODAT_BATCH_PARTY_SCOPE_MIXED', 'Dela batchen: egna juridiska aktörer, kodlistor och roller måste vara gemensamma. UNB-transportparterna ersätter inte NAD-parterna.', 'NAD')
  }
  return []
}
