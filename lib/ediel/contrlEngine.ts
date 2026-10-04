import { segmentComposite, tokenizeEdifact, observeCompletedEdifactSegments, segmentSourceSpan } from '@/lib/ediel/core/edifactTokenizer'
import { escapeEdifactData } from '@/lib/ediel/core/una'
import { assertEdifactLatin1Representable } from '@/lib/ediel/core/edifactEncoding'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'

export type ContrlEngineOutcome = 'positive' | 'negative'
export type ContrlEngineSource = {
  rawPayload?: string | null
  /** Legacy metadata retained for callers; never original envelope authority. */
  interchangeReference?: string | null
  externalReference?: string | null
  id?: string | null
  senderEdielId?: string | null
  senderSubAddress?: string | null
  receiverEdielId?: string | null
  receiverSubAddress?: string | null
}
export type ContrlSourceEnvelope = {
  interchangeReference: string
  /** Source T§2.1 table2: first14 only when the original exceeds14. */
  uciReference: string
  senderComponents: string[]
  receiverComponents: string[]
  applicationReference:string
  testIndicator:''|'1'
}
export type ContrlEngineResult = {
  segments: string[]
  diagnostics: {
    engine: 'contrl'
    renderer: 'contrlEngine.renderContrl2Ediel2'
    originalInterchangeReference: string
    originalSenderComposite: string
    originalReceiverComposite: string
    syntaxActionCode: '1' | '4'
  }
}

/** A malformed business message can still have a usable technical envelope.
 * This bounded observation makes no claim that its complete syntax passed.
 * Missing, ambiguous or unrepresentable original identity cannot be repaired
 * from row metadata. The source-prescribed UCI projection retains the full
 * original in diagnostics; persistent authority separately fences ambiguity. */
export function contrlSourceEnvelope(rawPayload: string | null | undefined): ContrlSourceEnvelope {
  const held = (): never => { throw new EdielExecutionFailure({ kind: 'internal_failure', code: 'EDIEL_CONTRL_SOURCE_ENVELOPE_UNQUALIFIED' }, 'CONTRL kräver ett entydigt ursprungligt UNB-kuvert med återgivningsbara tekniska referenser.') }
  let wire: ReturnType<typeof tokenizeEdifact>
  try { wire = observeCompletedEdifactSegments(rawPayload) } catch { return held() }
  const unbs = wire.segments.filter(segment => segment.tag === 'UNB')
  const last=wire.segments.at(-1),span=last?segmentSourceSpan(last):null
  if(span&&String(rawPayload??'').slice(span.endOffset+1).trimStart().startsWith('UNB'+wire.una.dataElementSeparator))return held()
  if (unbs.length !== 1 || unbs[0].index !== 0 || wire.segments.some(segment=>segment.tag==='UNH'&&segmentComposite(segment,2,wire.una)[0]==='CONTRL')) return held()
  const application=segmentComposite(unbs[0],7,wire.una),indicator=segmentComposite(unbs[0],11,wire.una)
  if(application.length!==1||indicator.length!==1||!['','1'].includes(indicator[0]))return held()
  const reference = segmentComposite(unbs[0], 5, wire.una)
  const senderComponents = segmentComposite(unbs[0], 2, wire.una), receiverComponents = segmentComposite(unbs[0], 3, wire.una)
  if (reference.length !== 1 || !reference[0] || Array.from(reference[0]).length > 512
    || [senderComponents, receiverComponents].some(parts => !parts[0] || parts.length > 3 || parts.some(part => Array.from(part).length > 35))) return held()
  try { assertEdifactLatin1Representable([reference[0], ...senderComponents, ...receiverComponents].join('')) } catch { return held() }
  return { interchangeReference: reference[0], uciReference: reference[0].slice(0,14), senderComponents, receiverComponents,applicationReference:application[0],testIndicator:indicator[0] as ''|'1' }
}
export function renderContrl2Ediel2(params: {
  source: ContrlEngineSource
  outcome: ContrlEngineOutcome
  /** Deprecated: no parsed/local override may replace the physical original. */
  parsedInterchangeReference?: string | null
}): ContrlEngineResult {
  if(params.outcome==='positive'){try{tokenizeEdifact(params.source.rawPayload)}catch{throw new EdielExecutionFailure({kind:'internal_failure',code:'EDIEL_CONTRL_POSITIVE_SOURCE_SYNTAX_UNQUALIFIED'},'EDIEL_CONTRL_POSITIVE_SOURCE_SYNTAX_UNQUALIFIED: positiv CONTRL kräver att originalets hela syntax kan prövas.')}}
  const original = contrlSourceEnvelope(params.source.rawPayload)
  const originalSenderComposite = original.senderComponents.map(value => escapeEdifactData(value)).join(':')
  const originalReceiverComposite = original.receiverComponents.map(value => escapeEdifactData(value)).join(':')
  const syntaxActionCode = params.outcome === 'positive' ? '1' : '4'
  return {
    segments: [`UCI+${escapeEdifactData(original.uciReference)}+${originalSenderComposite}+${originalReceiverComposite}+${syntaxActionCode}`],
    diagnostics: { engine: 'contrl', renderer: 'contrlEngine.renderContrl2Ediel2', originalInterchangeReference: original.interchangeReference,
      originalSenderComposite, originalReceiverComposite, syntaxActionCode },
  }
}
