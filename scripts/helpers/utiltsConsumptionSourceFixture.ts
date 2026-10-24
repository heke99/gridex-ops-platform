import { segmentSourceSpan, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { utiltsRecountUnt } from '../../__tests__/helpers/utiltsNativeSourceFixture'

/** E30 sources below are adapted from E66 templates. Drop only inherited
 * SG5 LIN506 and the SG6 E12/513 group; shared U3/U5 R/X rules apply equally.
 * This edits new fixture originals only. Namespace defects and every asserted
 * processor/SQL outcome remain intact; retries use their original stored wire. */
export function cleanE30SourceFixture(raw: string, code: string): string {
  if (code !== 'E30') return raw
  const wire=tokenizeEdifact(raw), removed: Array<{startOffset:number;endOffset:number}>=[]
  let own=false, observations=false, nextCav=false
  for (const segment of wire.segments) {
    if (segment.tag==='IDE') { own=true;observations=false;nextCav=false;continue }
    if (segment.tag==='UNH'||segment.tag==='UNT') { own=false;nextCav=false }
    if (!own) continue
    if (segment.tag==='SEQ') observations=true
    const cav=nextCav&&segment.tag==='CAV'
    nextCav=false
    const cci=!observations&&segment.tag==='CCI'&&segment.raw==='CCI+++E12::260'
    if ((!observations&&segment.tag==='LIN')||cci||cav) {
      const span=segmentSourceSpan(segment)
      if (!span) throw Error('e30_fixture_source_span_missing')
      removed.push(span)
      nextCav=cci
    }
  }
  for (const span of removed.reverse()) {
    const end=span.endOffset+wire.una.segmentTerminator.length
    if (raw.slice(span.endOffset,end)!==wire.una.segmentTerminator) throw Error('e30_fixture_source_terminator_missing')
    raw=raw.slice(0,span.startOffset)+raw.slice(end)
  }
  return utiltsRecountUnt(raw)
}
