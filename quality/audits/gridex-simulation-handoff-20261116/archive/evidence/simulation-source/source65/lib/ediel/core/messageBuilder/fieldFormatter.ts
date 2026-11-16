// lib/ediel/core/messageBuilder/fieldFormatter.ts

const RELEASE_CHARACTER = '?'
const SERVICE_CHARS = new Set(["'", '+', ':', '?'])

export function effectiveEdifactLength(value: string | null | undefined): number {
  const text = String(value ?? '')
  let length = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === RELEASE_CHARACTER && index + 1 < text.length) {
      length += 1
      index += 1
      continue
    }
    length += 1
  }
  return length
}

export function escapeEdifactValue(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/\r|\n/g, ' ')
    .split('')
    .map((char) => SERVICE_CHARS.has(char) ? `${RELEASE_CHARACTER}${char}` : char)
    .join('')
    .trim()
}

export function normalizeEdifactIdentifier(value: string | number | null | undefined, maxLength?: number): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[ÅÄ]/g, 'A')
    .replace(/Ö/g, 'O')
    .replace(/[åä]/g, 'A')
    .replace(/ö/g, 'O')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9._-]/g, '')

  return typeof maxLength === 'number' ? normalized.slice(0, maxLength) : normalized
}

export function segmentTag(segment: string | null | undefined): string {
  return String(segment ?? '').split('+')[0]?.trim().toUpperCase() ?? ''
}

export function segmentElement(segment: string | null | undefined, index: number): string | null {
  const value = String(segment ?? '').split('+')[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

export function compositeComponent(value: string | null | undefined, index: number): string | null {
  const component = String(value ?? '').split(':')[index]?.trim() ?? ''
  return component.length > 0 ? component : null
}
