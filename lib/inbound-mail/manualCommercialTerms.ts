import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'
import { inspectManualMailIdentifierRoles, withoutExactPoaAcceptances } from '@/lib/inbound-mail/manualMailInterpretation'

export type ManualCommercialTerms = {
  contractEndDate?: string
  earliestStartDate?: string
  cancellationDeadline?: string
  noticePeriod?: string
  bindingPeriod?: string
  terminationFee?: string
  contractStatus?: string
  cancellationRegistered?: string
  effectiveStartDate?: string
}

export type ManualCommercialTermsResult = {
  ok: boolean
  reasons: string[]
  terms: ManualCommercialTerms
  evidence: Record<string, string>
}

type Field = {
  source: keyof ManualFacilityExtractedPayload
  target: Exclude<keyof ManualCommercialTerms, 'effectiveStartDate'>
  reason: string
  label: RegExp
  kind: 'date' | 'duration' | 'fee' | 'status' | 'registered'
}

const FIELDS: Field[] = [
  { source: 'current_contract_end_date', target: 'contractEndDate', reason: 'contract_end_date', label: /(?:avtalets?\s+(?:slutdatum|slutdag)|avtalsslut|slutdatum|contract[\s_-]*end|avtalet\s+(?:löper|gäller)\s+(?:till\s+och\s+med|t\.?\s*o\.?\s*m\.?|till))/i, kind: 'date' },
  { source: 'earliest_supplier_start_date', target: 'earliestStartDate', reason: 'earliest_start_date', label: /(?:tidigaste\s+(?:leveransstart|start(?:datum)?(?:\s+hos\s+ny\s+leverantör)?)|kunden\s+kan\s+(?:tidigast\s+)?starta(?:\s+hos\s+(?:en\s+)?ny\s+leverantör)?|earliest[\s_-]*start)/i, kind: 'date' },
  { source: 'cancellation_deadline', target: 'cancellationDeadline', reason: 'cancellation_deadline', label: /(?:sista\s+uppsägnings(?:datum|dag)|senaste\s+uppsägningsdatum|avtalet\s+måste\s+(?:senast\s+)?sägas\s+upp|cancellation[\s_-]*deadline)/i, kind: 'date' },
  { source: 'notice_period', target: 'noticePeriod', reason: 'notice_period', label: /(?:uppsägningstid|uppsagningstid|notice[\s_-]*period)/i, kind: 'duration' },
  { source: 'binding_period', target: 'bindingPeriod', reason: 'binding_period', label: /(?:bindningstid|binding[\s_-]*period)/i, kind: 'duration' },
  { source: 'termination_fee', target: 'terminationFee', reason: 'termination_fee', label: /(?:brytavgift|termination[\s_-]*fee)/i, kind: 'fee' },
  { source: 'contract_status', target: 'contractStatus', reason: 'contract_status', label: /(?:avtalsstatus|contract[\s_-]*status)/i, kind: 'status' },
  { source: 'cancellation_registered', target: 'cancellationRegistered', reason: 'cancellation_registered', label: /(?:uppsägning\s+registrerad|registrerad\s+uppsägning)/i, kind: 'registered' },
]

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december']
const NUMBER_WORDS: Record<string, number> = { en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, tolv: 12 }

function folded(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv-SE')
}

function stripLabelSeparator(value: string): string {
  return value.trim().replace(/^[:\-]\s*/, '').replace(/[.;]+$/, '').trim()
}

function normalizeDate(raw: string, receivedYear: number): string | null {
  const value = stripLabelSeparator(folded(raw)).replace(/^(?:den\s+|är\s+|t\.?\s*o\.?\s*m\.?\s+|till\s+och\s+med\s+|fr\.?\s*o\.?\s*m\.?\s+|från\s+och\s+med\s+)/, '')
  let year: number
  let month: number
  let day: number
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const numeric = value.match(/^(\d{1,2})([/.])(\d{1,2})\2(\d{4})$/)
  const written = value.match(/^(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})$/)
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (numeric) {
    [year, month, day] = [Number(numeric[4]), Number(numeric[3]), Number(numeric[1])]
    // Slash notation with both components <=12 also permits the US reading.
    if (numeric[2] === '/' && day <= 12) return null
  } else if (written) [year, month, day] = [Number(written[3]), MONTHS.indexOf(written[2]) + 1, Number(written[1])]
  else return null
  if (year < 1900 || year > 2199 || year > receivedYear + 10 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function normalizeDuration(raw: string): string | null {
  const value = stripLabelSeparator(folded(raw))
  if (/^(?:ingen(?:\s+(?:uppsägningstid|bindningstid))?|utan\s+(?:uppsägningstid|bindningstid))$/.test(value)) return '0 dagar'
  const match = value.match(/^(\d{1,3}|en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|tolv)\s+(dag(?:ar)?|månad(?:er)?|mån)$/)
  if (!match) return null
  const amount = /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1]]
  const days = match[2].startsWith('dag')
  return `${amount} ${days ? amount === 1 ? 'dag' : 'dagar' : amount === 1 ? 'månad' : 'månader'}`
}

function normalizeValue(field: Field, raw: string, receivedYear: number): string | null {
  if (field.kind === 'date') return normalizeDate(raw, receivedYear)
  if (field.kind === 'duration') return normalizeDuration(raw)
  const value = stripLabelSeparator(folded(raw))
  if (field.kind === 'fee') return /^(?:\d+(?:[,.]\d{1,2})?\s*(?:kr|sek)|ingen(?:\s+brytavgift)?)$/.test(value) ? stripLabelSeparator(raw) : null
  if (field.kind === 'status') return /^(?:tills\s?vidare|aktivt?|löpande|tidsbundet?|uppsagt?|avslutat?|rörligt|fastpris)$/.test(value) ? stripLabelSeparator(raw) : null
  if (field.kind === 'registered') {
    if (/^(?:ja|registrerad|bekräftad|mottagen)$/.test(value)) return stripLabelSeparator(raw)
    if (/^(?:nej|ej\s+registrerad|inte\s+registrerad)$/.test(value)) return stripLabelSeparator(raw)
  }
  return null
}

function stockholmDate(receivedAt: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(receivedAt)) return null
  if (!normalizeDate(receivedAt.slice(0, 10), Number(receivedAt.slice(0, 4)))) return null
  const date = new Date(receivedAt)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-')
}

/**
 * Accepts only explicit, unambiguous terms grounded in the newly authored reply.
 * A labelled contract end is an inclusive last contract day; its next calendar
 * day is the earliest possible new start. Notice periods never imply a notice
 * was served and never produce a deadline or a start date.
 *
 * Partial terms may be returned with ok=false for diagnostics. Callers must
 * apply only ok=true results and independently enforce tenant/site ownership.
 */
export function normalizeManualCommercialTerms(input: {
  extracted: ManualFacilityExtractedPayload
  authoredText: string
  receivedAt: string
}): ManualCommercialTermsResult {
  const reasons = new Set<string>()
  const terms: ManualCommercialTerms = {}
  const evidence: Record<string, string> = {}
  const receivedDate = stockholmDate(input.receivedAt)
  if (!receivedDate) return { ok: false, reasons: ['received_at_invalid'], terms, evidence }
  // Never truncate: a dropped last paragraph might contain a limiting condition.
  if (input.authoredText.length > 100_000) return { ok: false, reasons: ['authored_reply_too_large'], terms, evidence }
  const receivedYear = Number(receivedDate.slice(0, 4))
  const text = input.authoredText.normalize('NFC')
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const entireReply = folded(text)

  // Inspect the entire authored text, including conditions after a clean field.
  if (/\b(?:förutsatt|preliminärt?|reservation|villkor(?:at)?|conditional|provided\s+that)\b|under\s+förutsättning|gäller\s+(?:endast|bara)|\bom\s+(?:kunden|ni|du|vi|uppsägning|avtalet)|(?:måste|behöver|ska)\s+(?:först\s+)?(?:säga(?:s)?\s+upp|inkomma\s+med\s+uppsägning)|kräver\s+(?:en\s+)?uppsägning/i.test(entireReply)) reasons.add('conditional_commercial_terms')
  // Exact harmless POA acceptance sentences have the same meaning at both
  // stages. A negation or condition about the commercial facts remains intact.
  if (/\b(?:inte|ej)\b|utan\s+bekräftelse|\bnot\s+confirmed\b/i.test(folded(withoutExactPoaAcceptances(text)))) reasons.add('negated_commercial_terms')
  if (/\b(?:uppskattning|uppskattat?|ungefär(?:ligt)?|cirka|troligen|eventuellt|osäkert?|tentative|estimated)\b/i.test(entireReply)) reasons.add('uncertain_commercial_terms')
  if (/(?:annan|annat|fel|övrig)\s+(?:kund|anläggning|mätpunkt)|avser\s+(?:någon|något)\s+annat/i.test(entireReply)) reasons.add('other_customer_terms')

  const { identifiers, ambiguous: ambiguousIdentifiers } = inspectManualMailIdentifierRoles(text)
  const numberedSites = new Set(Array.from(text.matchAll(/\banläggning(?:en)?\s*(?:(?:nr|nummer|#)\s*)?(\d{1,3})\b/gi), (match) => match[1]))
  if (ambiguousIdentifiers || numberedSites.size > 1 || /(?:flera|båda|samtliga)\s+(?:anläggningar(?:na)?|mätpunkter(?:na)?)/i.test(entireReply)) reasons.add('multiple_facilities')
  for (const role of ['facility_id', 'metering_point_id'] as const) {
    const value = input.extracted[role]?.replace(/[ \t-]/g, '')
    if (value && identifiers.size && !identifiers.get(value)?.has(role)) reasons.add(`${role}_conflict`)
  }

  for (const field of FIELDS) {
    const raw = input.extracted[field.source]?.trim()
    if (!raw) {
      if (lines.some((line) => {
        const match = line.match(field.label)
        return match && match.index !== undefined && stripLabelSeparator(line.slice(match.index + match[0].length))
      })) reasons.add(`unextracted_${field.reason}`)
      continue
    }
    const candidateLines = lines.filter((line) => folded(line).includes(folded(raw)))
    const labelledLine = candidateLines.find((line) => field.label.test(line))
    const sourceLine = labelledLine ?? (field.kind === 'registered' ? undefined : candidateLines[0])
    if (!sourceLine) {
      reasons.add(`${field.reason}_missing_evidence`)
      continue
    }
    const value = normalizeValue(field, raw, receivedYear)
    if (!value) {
      reasons.add(`${field.reason}_invalid_or_ambiguous`)
      continue
    }
    terms[field.target] = value
    evidence[field.target] = sourceLine

    // The first labelled value alone cannot overrule a conflicting second one.
    const repeatedValues = new Set<string>()
    for (const line of lines) {
      const match = line.match(field.label)
      if (!match || match.index === undefined) continue
      const labelledRaw = stripLabelSeparator(line.slice(match.index + match[0].length))
      if (!labelledRaw) continue
      const repeated = normalizeValue(field, labelledRaw, receivedYear)
      if (repeated) repeatedValues.add(folded(repeated))
      else reasons.add(`${field.reason}_invalid_or_ambiguous`)
    }
    if (repeatedValues.size > 1 || (repeatedValues.size === 1 && !repeatedValues.has(folded(value)))) reasons.add(`conflicting_${field.reason}`)
  }

  if (terms.contractEndDate && terms.earliestStartDate && terms.earliestStartDate <= terms.contractEndDate) reasons.add('earliest_start_conflicts_with_contract_end')
  if (terms.cancellationDeadline && terms.contractEndDate && terms.cancellationDeadline > terms.contractEndDate) reasons.add('cancellation_deadline_after_contract_end')
  const registered = terms.cancellationRegistered && /^(?:ja|registrerad|bekräftad|mottagen)$/.test(folded(terms.cancellationRegistered))
  if (terms.cancellationDeadline && terms.cancellationDeadline < receivedDate && !registered) reasons.add('cancellation_deadline_passed_without_registered_cancellation')
  if (Object.keys(terms).length === 0) reasons.add('commercial_terms_missing')

  if (reasons.size === 0) {
    if (terms.contractEndDate) {
      const followingDay = new Date(`${terms.contractEndDate}T00:00:00.000Z`)
      followingDay.setUTCDate(followingDay.getUTCDate() + 1)
      terms.effectiveStartDate = followingDay.toISOString().slice(0, 10)
    }
    if (terms.earliestStartDate) terms.effectiveStartDate = terms.earliestStartDate
  }
  return { ok: reasons.size === 0, reasons: [...reasons], terms, evidence }
}
