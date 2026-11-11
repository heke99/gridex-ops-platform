import {segmentSourceSpan,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'

export type NativeFixtureParties = Readonly<{sender: string; receiver: string}>

/** Bind synthetic placeholders only at their declared transport/party addresses. */
export function bindNativeFixturePartyAddresses(raw: string, parties: NativeFixtureParties): string {
  const {segments,una}=tokenizeEdifact(raw)
  const d=una.dataElementSeparator,c=una.componentDataElementSeparator
  let bound=raw
  // Reverse source order keeps every original span valid without reserializing wire.
  for(const segment of [...segments].reverse()) {
    if(segment.tag!=='UNB'&&segment.tag!=='NAD')continue
    const span=segmentSourceSpan(segment)
    if(!span)throw new Error('native_fixture_address_source_span_missing')
    const source=raw.slice(span.startOffset,span.endOffset)
    const replacement=segment.tag==='UNB'
      ? source.replace(`UNB${d}UNOC${c}3${d}91100${c}ZZ${d}21660${c}ZZ${d}`,
          `UNB${d}UNOC${c}3${d}${parties.sender}${c}ZZ${d}${parties.receiver}${c}ZZ${d}`)
      : source.replace(`NAD${d}MS${d}91100${c}SVK${c}260`,`NAD${d}MS${d}${parties.sender}${c}SVK${c}260`)
          .replace(`NAD${d}MR${d}21660${c}SVK${c}260`,`NAD${d}MR${d}${parties.receiver}${c}SVK${c}260`)
    if(replacement!==source)bound=bound.slice(0,span.startOffset)+replacement+bound.slice(span.endOffset)
  }
  return bound
}
