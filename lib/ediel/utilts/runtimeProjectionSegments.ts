import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { DEFAULT_UNA, escapeEdifactData } from '@/lib/ediel/core/una'

/** Legacy runtime readers use canonical service characters. This read-only
 * projection decodes each physical component once and escapes literal service
 * characters again; the original wire and its observed transactions stay live. */
export function utiltsRuntimeProjectionSegments(raw: string): string[] {
  const wire = tokenizeEdifact(raw)
  return wire.segments.map(segment => segment.elements.map((_, index) =>
    segmentComposite(segment, index, wire.una).map(value => escapeEdifactData(value, DEFAULT_UNA))
      .join(DEFAULT_UNA.componentDataElementSeparator)).join(DEFAULT_UNA.dataElementSeparator))
}
