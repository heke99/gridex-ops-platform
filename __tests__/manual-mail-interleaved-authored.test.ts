import { describe, expect, it } from 'vitest'
import { authoredManualReply, authoredManualReplyRequiresReview, stripQuotedManualReplyHtml } from '@/lib/inbound-mail/manualReplyAssessment'
import { normalizeManualCommercialTerms } from '@/lib/inbound-mail/manualCommercialTerms'
import { prepareManualMailAiInput } from '@/lib/inbound-mail/manualMailAiReader'
import { extractManualFacilityFields } from '@/lib/customer-operations/manualFacilityResponseParser'

const dateAndFee = 'Tidigaste start: 2027-04-01\nBrytavgift: Ingen'
const condition = 'Datumet gäller endast om kunden först säger upp avtalet.'

describe('interleaved authored mail clauses', () => {
  it('retains a later authored condition after an inline quotation for both AI and server parsing', () => {
    const raw = `${dateAndFee}\n> När kan kunden börja?\n${condition}`
    const authored = authoredManualReply(raw)
    const result = normalizeManualCommercialTerms({ extracted: { earliest_supplier_start_date: '2027-04-01', termination_fee: 'Ingen' },
      authoredText: authored, receivedAt: '2026-10-18T12:00:00.000Z' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('conditional_commercial_terms')
    expect(result.terms.effectiveStartDate).toBeUndefined()
    expect(authored).toContain(condition)
    const aiInput = prepareManualMailAiInput(raw)
    expect(aiInput.status).toBe('ready')
    if (aiInput.status === 'ready') expect(aiInput.paragraphs.join('\n')).toContain(condition)
    expect(authoredManualReplyRequiresReview(raw)).toBe(true)
  })

  it('retains unquoted replies between several nested quote blocks without promoting their facts', () => {
    const raw = '> Anläggnings-ID: 735999100000000009\nTack för frågan.\n>> Avtalsslut: 2026-11-01\n> Brytavgift: 5000 kr\n' + dateAndFee + '\n' + condition
    const authored = authoredManualReply(raw)
    expect(authored).toContain(dateAndFee)
    expect(authored).toContain(condition)
    expect(authored).not.toContain('735999100000000009')
    expect(authored).not.toContain('2026-11-01')
    expect(authored).not.toContain('5000 kr')
    expect(extractManualFacilityFields(authored)).toMatchObject({ facility_id: null, current_contract_end_date: null })
  })

  it.each([
    '\nOn Monday, someone wrote:\nAnläggnings-ID: 735999100000000009',
    '\nDen 18 oktober skrev någon:\nAnläggnings-ID: 735999100000000009',
    '\n----- Original Message -----\nAnläggnings-ID: 735999100000000009',
    '\nFrån: Äldre kundservice\nSkickat: igår\nTill: tidigare mottagare\nAnläggnings-ID: 735999100000000009',
  ])('keeps ordinary historical reply headers as a cutoff: %s', (history) => {
    expect(authoredManualReply(`${dateAndFee}${history}`)).toBe(dateAndFee)
  })

  it('flags an ambiguous inline reply after a history header without promoting old history', () => {
    const raw = `${dateAndFee}\nOn Monday, someone wrote:\n> När kan kunden börja?\n${condition}`
    expect(authoredManualReply(raw)).toBe(dateAndFee)
    expect(authoredManualReplyRequiresReview(raw)).toBe(true)
  })

  it('leaves an ordinary top reply followed only by quoted history unflagged', () => {
    const raw = `${dateAndFee}\n\n> Anläggnings-ID: 735999100000000009\n> ${condition}\n> Gammal signatur`
    expect(authoredManualReply(raw)).toBe(dateAndFee)
    expect(authoredManualReplyRequiresReview(raw)).toBe(false)
  })
})

describe('authored HTML following quoted blocks', () => {
  it('preserves the authored suffix after a closed blockquote and flags interleaving', () => {
    const html = `<p>Tidigaste start: 2027-04-01</p><p>Brytavgift: Ingen</p><blockquote><p>Avtalsslut: 2026-11-01</p></blockquote><p>${condition}</p>`
    const result = stripQuotedManualReplyHtml(html)
    expect(result.html).toContain(condition)
    expect(result.html).toContain('Tidigaste start: 2027-04-01')
    expect(result.html).not.toContain('2026-11-01')
    expect(result.requiresReview).toBe(true)
  })

  it('handles nested quote blocks and quoted greater-than attributes without leaking historical facts', () => {
    const html = `<p>Aktuellt svar</p><BLOCKQUOTE data-label="1 > 0"><p>Gammalt svar</p><blockquote>735999100000000009</blockquote></BLOCKQUOTE><p>${condition}</p>`
    const result = stripQuotedManualReplyHtml(html)
    expect(result.html).toContain('Aktuellt svar')
    expect(result.html).toContain(condition)
    expect(result.html).not.toContain('Gammalt svar')
    expect(result.html).not.toContain('735999100000000009')
    expect(result.requiresReview).toBe(true)
  })

  it('leaves an ordinary top HTML reply and fully quoted history eligible for normal parsing', () => {
    const result = stripQuotedManualReplyHtml('<p>Aktuellt svar</p><blockquote>Gammalt svar</blockquote>\n</body></html>')
    expect(result.html).toContain('Aktuellt svar')
    expect(result.html).not.toContain('Gammalt svar')
    expect(result.requiresReview).toBe(false)
  })

  it.each([
    '<p>Tidigaste start: 2027-04-01</p><blockquote><p>Oklart slut',
    '<p>Tidigaste start: 2027-04-01</p></blockquote><p>Oklart ursprung</p>',
    '<p>Tidigaste start: 2027-04-01</p><blockquote data-label="saknar slut',
    '<p>Tidigaste start: 2027-04-01</p><!-- saknar slut',
  ])('requires review rather than approve truncated or ambiguous HTML: %s', (html) => {
    expect(stripQuotedManualReplyHtml(html).requiresReview).toBe(true)
  })

  it('does not treat a comment or a quoted attribute as a quote element', () => {
    const html = `<p title='literal <blockquote> text'>Aktuellt svar</p><!-- <blockquote> Gammal kommentar --> <p>${condition}</p>`
    const result = stripQuotedManualReplyHtml(html)
    expect(result.html).toContain(condition)
    expect(result.html).toContain('Aktuellt svar')
    expect(result.requiresReview).toBe(false)
  })
})
