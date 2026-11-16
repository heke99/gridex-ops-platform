import { segmentComposite, tokenizeEdifact } from './edifactTokenizer'

export const prodatAperakDualReferenceConflict = {
  id: 'P16B_APERAK96A_OWN_Z07_LI_CARDINALITY',
  directory: {
    key: 'APERAK:D:96A:UN',
    archiveSha256: '1f94c7663a48bbc99d48e93bab16ed2ee127fda73682e6f4c80363256cbcdcd2',
    member: 'TRMD.ZIP!APERAK_D.96A',
    memberSha256: '6d3b4705dcb8b10833278f1aa662717d17c2cca6e4450f6be7bc29abb8741561',
    locator: '§4.3.1 positions0130–0180: SG3 C999 / ERC M1 / FTX C1 / SG4 C1 / RFF M1 / FTX C9',
  },
  national: {
    frozenRegistrySha256: '83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95',
    locator: 'P26A/16B p105 SG4/RFF; p100 SG1/ACW; p103–104 own ERC/FTX',
    z07Condition: 'Obligatorisk om anläggnings-id finns för kvitterad anläggning i PRODAT.',
    liCondition: 'Obligatorisk om ärendereferens finns för kvitterad anläggning i PRODAT.',
    ercApplicability: {
      positiveCode: '100',
      negativeCodes: ['40', '41', '42'],
      sourceFinding: 'P16B p103: godkänd ERC100 följs av FTX,RFF; p104 skiljer endast FTX för godkänd/avvisad; p105 har ingen negativ-ERC-avgränsning för de två RFF-villkoren.',
    },
  },
  // Owner decision 2026-10-02: follow the national guide (P26A/16B p105).
  // APERAK E2SE6A may carry RFF+Z07 then RFF+LI in one SG4 (unsmGrammar.ts).
  resolution: 'RESOLVED_NATIONAL_GUIDE_OWNER_DECISION_20261002',
} as const

export type UnsmOwnReferenceSourceConflict = {
  conflictId: typeof prodatAperakDualReferenceConflict.id
  ackErcSegmentIndex: number
  sourceLinSegmentIndex: number
  objectId: string
  lineReference: string
  blocking: false
}

/** Read-only diagnostic locating the resolved dual own reference. It never
 * authorizes an ACK or supplies an outcome; the grammar decides validity.
 * Both references must belong to one actual physical original LIN and to one
 * physical response ERC. Caller metadata and neighbouring editions are unused. */
export function diagnoseProdatAperakOwnReferenceConflict(ackRaw: string, sourceRaw: string): UnsmOwnReferenceSourceConflict[] {
  const ack = tokenizeEdifact(ackRaw)
  const source = tokenizeEdifact(sourceRaw)
  const one = (tag: string, tokens: typeof ack) => tokens.segments.filter(segment => segment.tag === tag)
  const ackUnh = one('UNH', ack)
  const sourceUnh = one('UNH', source)
  const sourceBgm = one('BGM', source)
  const ackBgm = one('BGM', ack)
  if (ackUnh.length !== 1 || sourceUnh.length !== 1 || sourceBgm.length !== 1 || ackBgm.length !== 1
    || segmentComposite(ackUnh[0], 2, ack.una).join(':') !== 'APERAK:D:96A:UN:E2SE6A'
    || segmentComposite(sourceUnh[0], 2, source.una).join(':') !== 'PRODAT:D:97A:UN:E2SE6A'
    || segmentComposite(ackBgm[0], 3, ack.una)[0] !== '34') return []
  const headerEnd = ack.segments.find(segment => segment.tag === 'ERC')?.index ?? Infinity
  const documentRefs = ack.segments.filter(segment => segment.tag === 'RFF' && segment.index < headerEnd
    && segmentComposite(segment, 1, ack.una)[0] === 'ACW')
  if (documentRefs.length !== 1 || segmentComposite(documentRefs[0], 1, ack.una)[1]
    !== segmentComposite(sourceBgm[0], 2, source.una)[0]) return []
  const originalObjects = one('LIN', source).map(lin => {
    const next = source.segments.find(segment => segment.index > lin.index && ['LIN', 'UNT'].includes(segment.tag))?.index ?? Infinity
    const refs = source.segments.filter(segment => segment.index > lin.index && segment.index < next && segment.tag === 'RFF'
      && segmentComposite(segment, 1, source.una)[0] === 'LI')
    return { lin, id: segmentComposite(lin, 3, source.una)[0], refs }
  })
  const conflicts: UnsmOwnReferenceSourceConflict[] = []
  for (const erc of one('ERC', ack)) {
    const next = ack.segments.find(segment => segment.index > erc.index && ['ERC', 'UNT'].includes(segment.tag))?.index ?? Infinity
    const refs = ack.segments.filter(segment => segment.index > erc.index && segment.index < next && segment.tag === 'RFF')
    const z07 = refs.filter(segment => segmentComposite(segment, 1, ack.una)[0] === 'Z07')
    const li = refs.filter(segment => segmentComposite(segment, 1, ack.una)[0] === 'LI')
    if (z07.length !== 1 || li.length !== 1) continue
    const objectId = segmentComposite(z07[0], 1, ack.una)[1]
    const lineReference = segmentComposite(li[0], 1, ack.una)[1]
    if (!objectId || !lineReference) continue
    const matches = originalObjects.filter(object => object.id === objectId && object.refs.length === 1
      && segmentComposite(object.refs[0], 1, source.una)[1] === lineReference)
    if (matches.length === 1) conflicts.push({ conflictId: prodatAperakDualReferenceConflict.id,
      ackErcSegmentIndex: erc.index, sourceLinSegmentIndex: matches[0].lin.index, objectId, lineReference, blocking: false })
  }
  return conflicts
}
