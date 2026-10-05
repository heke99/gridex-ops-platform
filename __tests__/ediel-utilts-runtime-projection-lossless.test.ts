import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import type {EdielMessageRow} from '@/lib/ediel/types'
import { expect, it } from 'vitest'
import {parseUtiltsRuntimeFacts} from '@/lib/ediel/utiltsEngine.part-1'
import { utiltsRuntimeProjectionSegments } from '@/lib/ediel/utilts/runtimeProjectionSegments'
import { segmentComposite, segmentSourceSpan, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

it('projects the known custom alphabet without reinterpreting literal delimiters or changing original token offsets', () => {
  const raw = 'UNA*;,! ~UNB;UNOC*3;MS*14;MR*14;261001*1811;I;;23-DDQ-S02-S~UNH;M;UTILTS*D*02B*UN*E5SE5A~IDE;24;OWN!;IDE!*X!!+?:~SEQ;;1~QTY;135*NULL~STS;8;46~FTX;AAO;;;BAD!;!*+?:!!!~~UNT;8;M~UNZ;1;I~'
  const wire = tokenizeEdifact(raw), span = segmentSourceSpan(wire.segments[2])
  expect(segmentComposite(wire.segments[2], 2, wire.una)).toEqual(['OWN;IDE*X!+?:'])
  expect(utiltsRuntimeProjectionSegments(raw)).toEqual([
    'UNB+UNOC:3+MS:14+MR:14+261001:1811+I++23-DDQ-S02-S',
    'UNH+M+UTILTS:D:02B:UN:E5SE5A', 'IDE+24+OWN;IDE*X!?+???:', 'SEQ++1', 'QTY+135:NULL', 'STS+8+46',
    'FTX+AAO+++BAD;*?+???:!~', 'UNT+8+M', 'UNZ+1+I',
  ])
  const facts=parseUtiltsRuntimeFacts(raw)
  expect(facts.transactions[0]).toMatchObject({transactionId:'OWN;IDE*X!+?:',quantities:[{qualifier:'135',value:null}]})
  expect(facts.rawSegments[2]).toBe('IDE;24;OWN!;IDE!*X!!+?:')
  expect(facts.utiltsObservedTransactions?.[0].segmentIndex).toBe(2)
  expect(segmentSourceSpan(wire.segments[2])).toEqual(span)
  expect(raw.slice(span!.startOffset, span!.endOffset)).toBe('IDE;24;OWN!;IDE!*X!!+?:')
})

it.each(['APERAK','CONTRL','DELFOR'] as const)('reads actual %s family from custom UNA tokens', family=>{
 const raw=`UNA*;,! ~UNB;UNOC*3;MS*14;MR*14;261001*1811;I;;23-DDQ-E66-S~UNH;M;${family}*D*02B*UN*E5SE5A~BGM;34;D;9~UNT;3;M~UNZ;1;I~`
 const parsed=parseCanonicalMessageRow({direction:'inbound',message_standard:'edifact',raw_payload:raw} as EdielMessageRow)
 expect(parsed.family).toBe(family)
 expect(parsed.sender).toBe('MS');expect(parsed.receiver).toBe('MR')
})
