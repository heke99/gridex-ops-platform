import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { findCustomersByIdentifierValues } from '@/lib/customers/matchingService'
import type { EdielMatchCandidate, EdielMatchInput } from '@/lib/ediel/matching/matchingTypes'
import { cleanMatchText, confidenceFromScore, upperMatchText } from '@/lib/ediel/matching/matchingTypes'

function referenceValue(input: EdielMatchInput, qualifier: string): string | null {
  const canonical = parseCanonicalMessageRow(input.message)
  return canonical.references.find((reference) => upperMatchText(reference.qualifier) === qualifier.toUpperCase())?.value ?? null
}

export async function matchCustomerForAutomation(input: EdielMatchInput): Promise<EdielMatchCandidate[]> {
  const values = [
    cleanMatchText(referenceValue(input, 'UD')),
    cleanMatchText(input.message.external_reference),
    cleanMatchText(input.message.customer_id),
  ].filter((value): value is string => Boolean(value))

  if (values.length === 0) return []

  const data = await findCustomersByIdentifierValues({
    companyId: input.companyId ?? input.message.company_id ?? null,
    values,
    columns: ['id', 'customer_number', 'personal_number', 'org_number', 'email'],
    select: 'id, company_id, customer_number, personal_number, org_number, email, full_name, company_name, status',
    limit: 20,
  })

  return (data as Array<Record<string, unknown>>).map((row) => {
    const score = cleanMatchText(row.id) === cleanMatchText(input.message.customer_id) ? 180 : 105
    return {
      entityType: 'customer',
      entityId: cleanMatchText(row.id),
      confidence: confidenceFromScore(score),
      score,
      reason: score >= 180 ? 'customer_id_already_set' : 'customer_reference_candidate',
      details: {
        companyId: row.company_id,
        customerNumber: row.customer_number,
        status: row.status,
        searchedValues: values,
      },
    } satisfies EdielMatchCandidate
  })
}
