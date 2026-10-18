import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'

export type ManualFacilityFacts = {
  annualConsumptionKwh?: number
  currentSupplierName?: string
  meteringMethod?: string
  reportingFrequency?: string
  readingFrequency?: 'hourly' | 'daily' | 'monthly' | 'manual'
}

type FactField = {
  source: 'annual_consumption' | 'current_supplier' | 'metering_method' | 'reporting_frequency'
  label: RegExp
  normalize: (raw: string) => ManualFacilityFacts | null
}

function clean(value: string): string {
  return value.normalize('NFC').replace(/[\u00a0\u202f]/g, ' ').replace(/[ \t]+/g, ' ').trim().replace(/[.;]+$/, '').trim()
}

function annualEnergy(raw: string): ManualFacilityFacts | null {
  const match = /^(\d+|\d{1,3}(?: \d{3})+)(?:,(\d{1,3}))?\s*(kwh|mwh)(?:\s*\/\s*(?:år|year))?$/i.exec(raw)
  if (!match) return null
  const whole = Number(match[1].replace(/ /g, ''))
  const fraction = match[2] ?? ''
  if (!Number.isSafeInteger(whole)) return null
  const kwh = match[3].toLowerCase() === 'mwh'
    ? whole * 1000 + (fraction ? Number(fraction.padEnd(3, '0')) : 0)
    : whole + (fraction ? Number(fraction) / 10 ** fraction.length : 0)
  if (!Number.isFinite(kwh) || kwh < 0 || kwh > Number.MAX_SAFE_INTEGER) return null
  return { annualConsumptionKwh: kwh }
}

function supplierName(raw: string): ManualFacilityFacts | null {
  // This is an observed display name from the network owner, never proof of a
  // legal party, registry ID, recipient address or commercial contract terms.
  if (raw.length < 2 || raw.length > 120 || !/^[\p{L}\p{M}\d &'’().,\-]+$/u.test(raw)) return null
  if ((raw.match(/\p{L}/gu)?.length ?? 0) < 2 || /\d{6,}/.test(raw)) return null
  if (/^\d{2}[A-Z0-9][A-Z0-9-]{13}$/.test(raw) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw)) return null
  if (/(?:^|[^\p{L}\p{M}])(?:om|if|eller|förutsatt|förutsätter|villkor|förbehåll|enligt|kanske|eventuellt|okänd|okänt|saknas|kunden|ska|skall|kan|bör|måste|är|inte|ej)(?=[^\p{L}\p{M}]|$)/iu.test(raw)) return null
  return { currentSupplierName: raw }
}

function meteringMethod(raw: string): ManualFacilityFacts | null {
  if (!/^(?:schablon(?:mätning|avräkning)?|tim(?:mätning|avräkning)?|timvis(?: mätning)?|kvart(?:s?mätning|savräkning)?|kvartsvis(?: mätning)?)$/i.test(raw)) return null
  return { meteringMethod: raw }
}

function reportingFrequency(raw: string): ManualFacilityFacts | null {
  let readingFrequency: ManualFacilityFacts['readingFrequency']
  if (/^(?:tim|timme|timvis|per timme|varje timme|1 timme|60 minuter|hourly)$/i.test(raw)) readingFrequency = 'hourly'
  else if (/^(?:dag|dygn|daglig(?:en)?|dygnsvis|per dygn|varje (?:dag|dygn)|1 dag|24 timmar|daily)$/i.test(raw)) readingFrequency = 'daily'
  else if (/^(?:månad|månadsvis|månatlig(?:en)?|varje månad|1 månad|monthly)$/i.test(raw)) readingFrequency = 'monthly'
  else if (/^(?:manuell(?:t)?|manual)$/i.test(raw)) readingFrequency = 'manual'
  else if (!/^(?:kvart|kvartsvis|varje kvart|15 (?:minuter|min)|quarter[ -]hourly)$/i.test(raw)) return null
  // Quarter-hour data has no corresponding reading_frequency enum value.
  // Retain its original metadata without silently changing its granularity.
  return readingFrequency ? { reportingFrequency: raw, readingFrequency } : { reportingFrequency: raw }
}

const FIELDS: FactField[] = [
  // A minus after the energy label can be a negative value, so it must never
  // be discarded as a harmless label separator.
  { source: 'annual_consumption', label: /(?<![\p{L}\p{N}])(?:årsenergi(?:n)?|arsenergi(?:n)?|årsförbrukning(?:en)?|annual[\s_-]*consumption)(?![\p{L}\p{N}])/iu, normalize: annualEnergy },
  { source: 'current_supplier', label: /(?<![\p{L}\p{N}])(?:nuvarande\s+(?:elhandelsföretag|elleverantör|leverantör)|befintligt\s+elhandelsföretag|elhandelsföretag|current[\s_-]*supplier)(?![\p{L}\p{N}])/iu, normalize: supplierName },
  { source: 'metering_method', label: /(?<![\p{L}\p{N}])(?:mätmetod(?:en)?|matmetod(?:en)?|metering[\s_-]*method)(?![\p{L}\p{N}])/iu, normalize: meteringMethod },
  { source: 'reporting_frequency', label: /(?<![\p{L}\p{N}])(?:rapporteringsfrekvens(?:en)?|reporting[\s_-]*frequency|rapporteras)(?![\p{L}\p{N}])/iu, normalize: reportingFrequency },
]

// Identity and geographical facts are validated by their canonical adapters;
// their explicit labels still delimit neighbouring optional prose facts.
const IDENTITY_OR_AREA_LABEL = /^(?:anläggnings[- ]?(?:id|nummer|numret)|anlaggnings[- ]?(?:id|nummer|numret)|gsrn|mätpunkts?[- ]?(?:id|nummer|numret)|mätpunkten|nät(?:avräknings)?område(?:t)?|områdes[- ]?id|elområde(?:t)?|budområde(?:t)?|facility[ _-]?id|metering[ _-]?point[ _-]?id|grid[ _-]?area|price[ _-]?area)(?![\p{L}\p{N}])/iu

function sourceValues(field: FactField, lines: string[]): string[] {
  const values: string[] = []
  for (const line of lines) {
    for (const match of line.matchAll(new RegExp(field.label.source, 'giu'))) {
      // The complete adjacent clause supplies the value. Never search ahead
      // for a convenient number or discard an intervening qualifier. Sentence
      // boundaries keep another field out while preserving E.ON and decimals.
      const tail = line.slice((match.index ?? 0) + match[0].length)
      const boundary = /;|\.(?=\s|$)/.exec(tail)
      let clause = tail
      if (boundary) {
        const continuation = tail.slice(boundary.index + boundary[0].length).trim()
        const anotherFact = IDENTITY_OR_AREA_LABEL.test(continuation) || FIELDS.some(candidate => {
          const next = candidate.label.exec(continuation)
          if (!next) return false
          const prefix = continuation.slice(0, next.index).trim()
          return !prefix || (candidate.source === 'reporting_frequency' && /^(?:mätvärdena|värdena|uppgifterna)$/i.test(prefix))
        })
        // Drop only a terminal stop or the boundary before another recognized
        // fact. An unknown suffix may qualify this value, so preserve it and
        // let the strict value grammar reject it instead of hiding a condition.
        if (!continuation || anotherFact) clause = tail.slice(0, boundary.index)
      }
      const separator = field.source === 'annual_consumption' ? /^\s*:?\s*/ : /^\s*[:\-]?\s*/
      const value = clause.replace(separator, '').replace(/^(?:är|ar|is)\s+/i, '')
      values.push(clean(value))
    }
  }
  return values
}

function normalize(field: FactField, raw: string): ManualFacilityFacts | null {
  return raw.length <= 160 && !/[\r\n]/.test(raw) ? field.normalize(raw) : null
}

function identity(value: ManualFacilityFacts): string {
  // Display spelling stays intact in the result. Compare repeated names and
  // labels without treating casing or ordinary whitespace as a conflict.
  return JSON.stringify(value).toLocaleLowerCase('sv-SE')
}

export function normalizeManualFacilityFacts(input: {
  extracted: ManualFacilityExtractedPayload
  authoredText: string
}): { ok: boolean; reasons: string[]; facts: ManualFacilityFacts } {
  const facts: ManualFacilityFacts = {}
  const reasons: string[] = []
  const lines = input.authoredText.split(/\r?\n/).map(clean)
  for (const field of FIELDS) {
    const mentioned = sourceValues(field, lines)
    const rawValue = input.extracted[field.source]
    const raw = typeof rawValue === 'string' && rawValue.trim() ? clean(rawValue) : null
    if (raw === null && !mentioned.length) continue
    if (!mentioned.length) {
      reasons.push(`${field.source}_source_missing`)
      continue
    }
    if (raw !== null && !mentioned.includes(raw)) {
      reasons.push(`${field.source}_source_mismatch`)
      continue
    }
    const values = mentioned.map((value) => normalize(field, value))
    if (values.some((value) => value === null)) {
      reasons.push(`${field.source}_invalid`)
      continue
    }
    const valid = values as ManualFacilityFacts[]
    if (new Set(valid.map(identity)).size !== 1) {
      reasons.push(`${field.source}_conflicting_values`)
      continue
    }
    Object.assign(facts, normalize(field, raw ?? mentioned[0]))
  }
  return { ok: reasons.length === 0, reasons, facts }
}
