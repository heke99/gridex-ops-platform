import { expect, it } from 'vitest'
import { authoredManualReply } from '@/lib/inbound-mail/manualReplyAssessment'
import { normalizeManualCommercialTerms } from '@/lib/inbound-mail/manualCommercialTerms'

it('never approves dates after silently dropping a condition beyond a length boundary', () => {
  const raw = 'Tidigaste start: 2027-04-01\nBrytavgift: Ingen\n'
    + 'Information.\n'.repeat(9000) + 'Detta gäller endast om kunden först säger upp avtalet.'
  const result = normalizeManualCommercialTerms({ extracted: { earliest_supplier_start_date: '2027-04-01', termination_fee: 'Ingen' },
    authoredText: authoredManualReply(raw), receivedAt: '2026-10-18T12:00:00.000Z' })
  expect(result.ok).toBe(false)
  expect(result.terms.effectiveStartDate).toBeUndefined()
})

it('still excludes quoted history when a large old thread follows a short actual response', () => {
  const raw = 'Tidigaste start: 2027-04-01\nBrytavgift: Ingen\n\n> ' + 'Gammal historik.'.repeat(9000)
  expect(authoredManualReply(raw)).toBe('Tidigaste start: 2027-04-01\nBrytavgift: Ingen')
})
