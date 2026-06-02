export type EdifactServiceStringAdvice = {
  componentDataElementSeparator: string
  dataElementSeparator: string
  decimalMark: string
  releaseCharacter: string
  repetitionSeparator: string
  segmentTerminator: string
  raw: string
}

export const DEFAULT_UNA: EdifactServiceStringAdvice = {
  componentDataElementSeparator: ':',
  dataElementSeparator: '+',
  decimalMark: '.',
  releaseCharacter: '?',
  repetitionSeparator: ' ',
  segmentTerminator: "'",
  raw: "UNA:+.? '",
}

export function parseUna(rawPayload: string | null | undefined): EdifactServiceStringAdvice {
  const raw = String(rawPayload ?? '')
  if (!raw.toUpperCase().startsWith('UNA')) return DEFAULT_UNA

  const candidate = raw.slice(0, 9)
  if (candidate.length < 9) return DEFAULT_UNA

  return {
    componentDataElementSeparator: candidate[3] ?? DEFAULT_UNA.componentDataElementSeparator,
    dataElementSeparator: candidate[4] ?? DEFAULT_UNA.dataElementSeparator,
    decimalMark: candidate[5] ?? DEFAULT_UNA.decimalMark,
    releaseCharacter: candidate[6] ?? DEFAULT_UNA.releaseCharacter,
    repetitionSeparator: candidate[7] ?? DEFAULT_UNA.repetitionSeparator,
    segmentTerminator: candidate[8] ?? DEFAULT_UNA.segmentTerminator,
    raw: candidate,
  }
}

export function serializeUna(una: Partial<EdifactServiceStringAdvice> = {}): string {
  return [
    'UNA',
    una.componentDataElementSeparator ?? DEFAULT_UNA.componentDataElementSeparator,
    una.dataElementSeparator ?? DEFAULT_UNA.dataElementSeparator,
    una.decimalMark ?? DEFAULT_UNA.decimalMark,
    una.releaseCharacter ?? DEFAULT_UNA.releaseCharacter,
    una.repetitionSeparator ?? DEFAULT_UNA.repetitionSeparator,
    una.segmentTerminator ?? DEFAULT_UNA.segmentTerminator,
  ].join('')
}

export function stripUna(rawPayload: string | null | undefined): string {
  const raw = String(rawPayload ?? '')
  return raw.toUpperCase().startsWith('UNA') ? raw.slice(9) : raw
}
