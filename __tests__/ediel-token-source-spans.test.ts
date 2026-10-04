import { describe, expect, it } from 'vitest'
import * as tokenizer from '@/lib/ediel/core/edifactTokenizer'

describe('immutable original tokenizer evidence', () => {
  it('retains exact original source offsets through UNA, CRLF and outer whitespace normalization', () => {
    const raw = "UNA:+.? '\r\nUNB+UNOC:3+S+R+260930:1400+I'\r\n  FTX+AAO+++Å ?'value  '\r\nUNZ+1+I'\r\n"
    const tokenized = tokenizer.tokenizeEdifact(raw)
    const ftx = tokenized.segments.find(segment => segment.tag === 'FTX')!
    const startOffset = raw.indexOf("'\r\n  FTX") + 1
    const endOffset = raw.indexOf("'\r\nUNZ")
    expect(tokenizer.segmentSourceSpan(ftx)).toEqual({ startOffset, endOffset, unit: 'utf16_code_unit' })
    expect(tokenizer.segmentOriginalRaw(ftx)).toBe(raw.slice(startOffset, endOffset))
    expect(tokenizer.segmentUntrimmedRaw(ftx)).toBe("  FTX+AAO+++Å ?'value  ")
    expect(ftx.raw).toBe("FTX+AAO+++Å ?'value")
    expect(JSON.stringify(ftx)).not.toContain('sourceSpan')
  })

  it('retains alternate-UNA released terminators in one physical segment source', () => {
    const raw = 'UNA*;.! ~UNB;UNOC*3;S;R;260930*1400;I~FTX;AAO;;;X!~Y~UNZ;1;I~'
    const { segments, una } = tokenizer.tokenizeEdifact(raw)
    const ftx = segments.find(segment => segment.tag === 'FTX')!
    expect(tokenizer.segmentOriginalRaw(ftx)).toBe('FTX;AAO;;;X!~Y')
    expect(tokenizer.segmentComposite(ftx, 4, una)).toEqual(['X~Y'])
    expect(tokenizer.segmentSourceSpan(ftx)?.startOffset).toBe(raw.indexOf('FTX'))
  })

  it('never lends original source provenance to copied or mutated tokens', () => {
    const segment = tokenizer.tokenizeEdifact("FTX+AAO+++ORIGINAL'").segments[0]
    expect(tokenizer.segmentOriginalRaw({ ...segment })).toBeNull()
    segment.raw = 'FTX+AAO+++CHANGED'
    expect(tokenizer.segmentSourceSpan(segment)).toBeNull()
    expect(tokenizer.segmentOriginalRaw(segment)).toBeNull()
  })
})
