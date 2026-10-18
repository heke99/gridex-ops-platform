import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'
import { prepareManualMailAiInput, type ManualMailAiResult } from '@/lib/inbound-mail/manualMailAiReader'

type Field = keyof ManualFacilityExtractedPayload
const mappings: Record<string, { target: Field; meaning: RegExp }> = {
  facility_id: { target: 'facility_id', meaning: /anläggnings[- ]?(?:id|nummer|numret)|facility|gsrn/i },
  metering_point_id: { target: 'metering_point_id', meaning: /mätpunkt|metering.point/i },
  grid_area: { target: 'grid_area_code', meaning: /nät(?:avräknings)?område(?:t)?|områdes.?id|grid.area/i },
  price_area: { target: 'price_area_code', meaning: /elområde(?:t)?|budområde(?:t)?|price.area/i },
  annual_consumption: { target: 'annual_consumption', meaning: /års(?:förbrukningen|förbrukning|energin|energi)|annual.consumption/i },
  current_supplier: { target: 'current_supplier', meaning: /\b(?:nuvarande\s+(?:leverantör|elleverantör|elhandelsföretag)|befintligt\s+elhandelsföretag|elhandelsföretag|current[\s_-]*supplier)\b/i },
  metering_method: { target: 'metering_method', meaning: /mätmetod|metering.method/i },
  reporting_frequency: { target: 'reporting_frequency', meaning: /rapporteringsfrekvens|rapporteras|reporting.frequency/i },
  notice_period: { target: 'notice_period', meaning: /uppsägningstid|notice.period/i },
  binding_period: { target: 'binding_period', meaning: /bindningstid|binding.period/i },
  contract_end: { target: 'current_contract_end_date', meaning: /avtal.*(?:slut|löper.*till|gäller.*till)|contract.end/i },
  earliest_start: { target: 'earliest_supplier_start_date', meaning: /tidigaste.*start|(?:kan|får).*(?:börja|starta)|leverantörsbyte.*(?:möjligt|från)|earliest.start/i },
  cancellation_deadline: { target: 'cancellation_deadline', meaning: /(?:sista|senaste).*uppsägn|måste.*sägas.upp|cancellation.deadline/i },
  cancellation_registered: { target: 'cancellation_registered', meaning: /uppsägning.*(?:registrerad|mottagen|bekräftad)|registrerad.uppsägning/i },
  contract_status: { target: 'contract_status', meaning: /avtalsstatus|avtalet.är|contract.status/i },
  termination_fee: { target: 'termination_fee', meaning: /brytavgift|termination.fee/i },
}

function normalized(value: string): string { return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv-SE').replace(/[.;]+$/, '') }

type IdentifierRole = 'facility_id' | 'metering_point_id'
const IDENTIFIER_LABELS: Record<IdentifierRole, RegExp> = {
  facility_id: /(?<![\p{L}\p{N}])(?:anläggnings[- ]?(?:id|nummer|numret)|facility(?:[ _-]?(?:id|number))?|gsrn)(?![\p{L}\p{N}])/giu,
  metering_point_id: /(?<![\p{L}\p{N}])(?:mätpunkts?[- ]?(?:id|nummer|numret)|mätpunkten|metering[ _-]?point(?:[ _-]?id)?)(?![\p{L}\p{N}])/giu,
}

function identifierRole(prefix: string): IdentifierRole | null {
  let nearest: { role: IdentifierRole; start: number; end: number } | null = null
  for (const role of ['facility_id', 'metering_point_id'] as const) {
    for (const match of prefix.matchAll(IDENTIFIER_LABELS[role])) {
      const start = match.index ?? 0
      if (!nearest || start > nearest.start) nearest = { role, start, end: start + match[0].length }
    }
  }
  if (!nearest) return null
  const link = prefix.slice(nearest.end)
  return /^\s*[:=-]?\s*(?:(?:är|ar|is|nr\.?|nummer|numret)\s*)?:?\s*$/i.test(link) ? nearest.role : null
}

function identifierInventory(text: string): Map<string, Set<IdentifierRole>> {
  const identifiers = new Map<string, Set<IdentifierRole>>()
  for (const match of text.matchAll(/(?<!\d)(?:\d[ \t-]*){17}\d(?!\d)/g)) {
    const id = match[0].replace(/\D/g, '')
    const start = match.index ?? 0
    const prefix = text.slice(text.lastIndexOf('\n', start - 1) + 1, start)
    const roles = identifiers.get(id) ?? new Set<IdentifierRole>()
    const role = identifierRole(prefix)
    if (role) roles.add(role)
    identifiers.set(id, roles)
  }
  return identifiers
}

/** Shared role evidence for interpretation and commercial normalization. Two
 * different IDs are safe only when each has exactly one explicit adjacent
 * role and together they identify one facility and one metering point. */
export function inspectManualMailIdentifierRoles(text: string): {
  identifiers: Map<string, Set<IdentifierRole>>
  ambiguous: boolean
} {
  const identifiers = identifierInventory(text)
  const distinctRoles = new Set([...identifiers.values()].flatMap((roles) => [...roles]))
  const explicitPair = identifiers.size === 2 && [...identifiers.values()].every((roles) => roles.size === 1) && distinctRoles.size === 2
  return { identifiers, ambiguous: (identifiers.size > 1 && !explicitPair) || /(?:flera|båda|samtliga)\s+(?:anläggningar|kunder|mätpunkter)/i.test(text) }
}

function hasAdjacentMeaning(quote: string, value: string, field: string): boolean {
  const mapping = mappings[field]
  if (!value) return false
  if (mapping.target === 'facility_id' || mapping.target === 'metering_point_id') {
    return identifierInventory(quote).get(value.replace(/[ \t-]/g, ''))?.has(mapping.target) === true
  }
  return quote.split('\n').some((line) => {
    for (let start = line.indexOf(value); start >= 0; start = line.indexOf(value, start + value.length)) {
      const prefix = line.slice(0, start)
      for (const meaning of prefix.matchAll(new RegExp(mapping.meaning.source, 'gi'))) {
        const link = prefix.slice((meaning.index ?? 0) + meaning[0].length)
        // Only grammatical linking words may stand between the meaning and
        // value. Another field, date, clause or customer cannot supply a link.
        if (/^\s*[:=-]?\s*(?:(?:är|ar|is|den|från|till|och|med|hos|er|en|ett|tidigast|senast|på)\s+)*$/i.test(link)) return true
      }
    }
    return false
  })
}

export function withoutExactPoaAcceptances(text: string): string {
  const accepted = /^(?:fullmakten|fullmakt)\s+(?:är\s+)?(?:godkänd|accepterad)$/i
  const noSignature = /^(?:bankid(?:[- ]signatur)?|bankid[- ]signering|signatur|underskrift)\s+(?:krävs|behövs)\s+(?:inte|ej)$/i
  const noCompletion = /^(?:fullmakten|fullmakt)\s+(?:är\s+)?(?:godkänd|accepterad)\s+och\s+(?:behöver|måste)\s+(?:inte|ej)\s+kompletteras(?:\s+med\s+(?:organisationsnummer|bankid(?:[- ]signatur)?|signatur|underskrift))?$/i
  return text.split(/[.!?\n]/).filter((sentence) => {
    const value = sentence.trim()
    const joined = value.split(/\s+och\s+/i)
    const acceptedWithNoSignature = joined.length === 2 && (
      (accepted.test(joined[0]) && noSignature.test(joined[1])) || (noSignature.test(joined[0]) && accepted.test(joined[1]))
    )
    return !accepted.test(value) && !noSignature.test(value) && !noCompletion.test(value) && !acceptedWithNoSignature
  }).join('\n')
}

export function interpretManualMail(input: {
  authoredText: string
  extracted: ManualFacilityExtractedPayload
  reading?: ManualMailAiResult
}): { extracted: ManualFacilityExtractedPayload; reasons: string[] } {
  const extracted = { ...input.extracted }
  const reasons = new Set<string>()
  const text = input.authoredText
  if (text.length > 100_000) return { extracted, reasons: ['reply_too_large'] }
  if (/\b(?:förutsatt|förutsätter|preliminärt?|villkor(?:at)?|reservation|conditional)\b|under\s+förutsättning|gäller\s+(?:endast|bara)|\bom\s+(?:kunden|ni|du|vi|uppsägning|avtalet)/i.test(text)) reasons.add('conditional_reply')
  // A negative in any clause can qualify an otherwise valid-looking value.
  // Explicit POA acceptance sentences are assessed by their own adapter.
  const relevantText = withoutExactPoaAcceptances(text)
  if (/\b(?:inte|ej)\b/i.test(relevantText)) reasons.add('negated_reply')
  if (/\b(?:uppskattning|uppskattat|uppskattad|ungefär|cirka|troligen|antagligen|prognos|estimated?|approximate)\b/i.test(text)) reasons.add('uncertain_reply')
  if (/(?:annan|annat|andra|fel)\s+(?:kund|kunder|anläggning|mätpunkt|person|avtal)|(?:another|different|other)\s+(?:customer|facility|person)/i.test(text)) reasons.add('other_customer_reply')
  const { identifiers, ambiguous: ambiguousIdentifiers } = inspectManualMailIdentifierRoles(text)
  if (ambiguousIdentifiers) reasons.add('multiple_facilities')
  for (const role of ['facility_id', 'metering_point_id'] as const) {
    const value = extracted[role]?.replace(/[ \t-]/g, '')
    if (value && !identifiers.get(value)?.has(role)) reasons.add(`field_meaning_unverified:${role}`)
  }
  const identities = new Set(Array.from(text.matchAll(/\b(?:person(?:nummer)?|organisationsnummer|kundnummer)\s*[:#-]\s*([A-Z0-9+-]{5,20})/gi), (match) => match[1]))
  if (identities.size > 1) reasons.add('multiple_customers')
  if (input.reading?.status === 'completed') {
    const reviewReasons = 'review_reasons' in input.reading ? input.reading.review_reasons : undefined
    if (!Array.isArray(reviewReasons) || reviewReasons.some((reason) => typeof reason !== 'string' || !reason)) reasons.add('ai_evidence_invalid')
    else for (const reason of reviewReasons) reasons.add(`ai_review_required:${reason}`)
    const prepared = prepareManualMailAiInput(text)
    if (prepared.status !== 'ready') reasons.add('ai_evidence_invalid')
    else {
      if (input.reading.outcome === 'poa_rejected' || input.reading.outcome === 'completion_requested') reasons.add('counterparty_requires_action')
      for (const field of input.reading.fields) {
        const mapping = mappings[field.field]
        if (!mapping) continue
        if (!prepared.paragraphs.includes(field.quote) || !field.quote.includes(field.value)) { reasons.add('ai_evidence_invalid'); continue }
        if (!hasAdjacentMeaning(field.quote, field.value, field.field)) { reasons.add(`ai_field_meaning_unverified:${field.field}`); continue }
        let value = field.value.trim()
        if (mapping.target === 'facility_id' || mapping.target === 'metering_point_id') {
          value = value.replace(/[ \t-]/g, '')
          if (!/^\d{18}$/.test(value)) { reasons.add(`invalid_field:${mapping.target}`); continue }
        }
        if (mapping.target === 'grid_area_code' || mapping.target === 'price_area_code') value = value.toUpperCase()
        const previous = extracted[mapping.target]
        if (previous && !normalized(previous).includes(normalized(value))) { reasons.add(`conflicting_field:${mapping.target}`); continue }
        extracted[mapping.target] = value
      }
    }
  }
  return { extracted, reasons: [...reasons] }
}
