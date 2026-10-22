import { describe, expect, it, vi } from 'vitest'
import { normalizeManualCommercialTerms } from '@/lib/inbound-mail/manualCommercialTerms'

function start(raw: string, receivedAt = '2026-10-21T12:00:00.000Z', line = `Tidigaste startdatum: ${raw}`) {
  return normalizeManualCommercialTerms({ extracted: { earliest_supplier_start_date: raw }, authoredText: line, receivedAt, receivedAtSource: 'imap_internal_date' })
}

describe('explicit relative supplier start uses the original Stockholm calendar date', () => {
  it.each([
    ['om 30 dagar', '2026-10-21T12:00:00Z', '2026-11-20'],
    ['om 30 kalenderdagar', '2026-10-21T12:00:00Z', '2026-11-20'],
    ['om 30 dagar från idag', '2026-10-21T12:00:00Z', '2026-11-20'],
    ['om 30 dagar från i dag', '2026-10-21T12:00:00Z', '2026-11-20'],
    ['om 30 dagar från mejlets datum', '2026-10-21T12:00:00Z', '2026-11-20'],
    ['om 30 dagar', '2026-10-24T22:30:00Z', '2026-11-24'],
    ['om 30 dagar', '2026-03-28T23:30:00Z', '2026-04-28'],
    ['om 30 dagar', '2026-12-15T12:00:00Z', '2027-01-14'],
    ['om 30 dagar', '2028-02-08T12:00:00Z', '2028-03-09'],
    ['om 0 dagar', '2026-10-21T12:00:00Z', '2026-10-21'],
  ])('resolves %s from persisted %s as %s', (raw, receivedAt, expected) => {
    const result = start(raw, receivedAt)
    expect(result.ok).toBe(true)
    expect(result.terms.earliestStartDate).toBe(expected)
    expect(result.terms.effectiveStartDate).toBe(expected)
    expect(result.evidence.earliestStartDate).toBe(`Tidigaste startdatum: ${raw}`)
    expect(result.terms.cancellationDeadline).toBeUndefined()
  })

  it('uses the complete source phrase when the AI candidate is a shorter exact quote', () => {
    const result = start('30 dagar', undefined, 'Kunden kan starta om 30 dagar.')
    expect(result.ok).toBe(true)
    expect(result.terms.effectiveStartDate).toBe('2026-11-20')
  })

  it.each([
    ['1 april 2027', 'Kunden kan börja hos er tidigast den 1 april 2027.', '2027-04-01'],
    ['2026-11-20', 'Leverantörsbyte är möjligt från 2026-11-20', '2026-11-20'],
    ['2026-11-20', 'Leverantörsbyte från 2026-11-20', '2026-11-20'],
  ])('retains an existing AI-supported full-year supplier-start wording: %s in %s', (raw, line, expected) => {
    expect(start(raw, undefined, line).terms.effectiveStartDate).toBe(expected)
  })

  it('refuses relative dates when arrival provenance is absent instead of trusting a processing timestamp', () => {
    const result = normalizeManualCommercialTerms({ extracted: { earliest_supplier_start_date: 'om 30 dagar' },
      authoredText: 'Kunden kan starta om 30 dagar', receivedAt: '2026-10-21T12:00:00Z' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('earliest_start_date_missing_receipt_basis')
    expect(result.terms.effectiveStartDate).toBeUndefined()
  })

  it('retains the originally received day on a later retry', () => {
    vi.useFakeTimers(); vi.setSystemTime('2027-02-01T12:00:00Z')
    try { expect(start('om 30 dagar').terms.effectiveStartDate).toBe('2026-11-20') }
    finally { vi.useRealTimers() }
  })

  it.each(['inom 30 dagar', 'senast om 30 dagar', 'om cirka 30 dagar', 'om 30 arbetsdagar', 'om 30 bankdagar',
    'om 30 dagar efter uppsägning', '30 dagar', 'om -1 dagar', 'om 9999 dagar', '1 November', 'om 30 dagar eller 60 dagar'])
  ('keeps an uncertain interval or absent anchor under review: %s', raw => {
    const result = start(raw)
    expect(result.ok).toBe(false)
    expect(result.terms.effectiveStartDate).toBeUndefined()
  })

  it('does not turn an unrelated notice duration into earliest start evidence', () => {
    const result = start('30 dagar', undefined, 'Uppsägningstid: 30 dagar. Kunden kan starta om 60 dagar.')
    expect(result.ok).toBe(false)
    expect(result.terms.effectiveStartDate).toBeUndefined()
  })

  it('checks a conflicting absolute date after a relative date', () => {
    const result = start('om 30 dagar', undefined, 'Tidigaste startdatum: om 30 dagar\nTidigaste startdatum: 2026-12-01')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('conflicting_earliest_start_date')
  })

  it.each(['Kunden kan börja om 60 dagar', 'Kunden får börja 2027-01-01', 'Kunden kan påbörja sin el om 60 dagar', 'Kunden kan börja hos er tidigast den 1 april 2027.', 'Leverantörsbyte är möjligt från 2027-01-01'])
  ('checks every supported earliest-start meaning for a conflicting second statement: %s', other => {
    const result = start('om 30 dagar', undefined, `Tidigaste startdatum: om 30 dagar\n${other}`)
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('conflicting_earliest_start_date')
  })

  it.each(['Uppsägningen kan börja om 30 dagar', 'Handläggningen kan börja om 30 dagar'])
  ('does not mistake another process milestone for customer supply: %s', line => {
    expect(start('om 30 dagar', undefined, line).ok).toBe(false)
  })

  it.each(['Uppsägningen kan börja 2026-11-20', 'Handläggningen kan börja 2026-11-20', 'Uppsägningens tidigaste startdatum: 2026-11-20'])
  ('also rejects an absolute date quoted from another milestone: %s', line => {
    expect(start('2026-11-20', undefined, line).ok).toBe(false)
  })

  it('does not override an inclusive contract end with an earlier relative start', () => {
    const result = normalizeManualCommercialTerms({ extracted: { earliest_supplier_start_date: 'om 30 dagar', current_contract_end_date: '2026-11-30' },
      authoredText: 'Tidigaste startdatum: om 30 dagar\nAvtalsslut: 2026-11-30', receivedAt: '2026-10-21T12:00:00Z', receivedAtSource: 'imap_internal_date' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('earliest_start_conflicts_with_contract_end')
  })

  it('keeps cancellation conditions and missing year blocked', () => {
    const result = start('om 30 dagar', undefined, 'Tidigaste startdatum: om 30 dagar\nKunden måste säga upp avtalet först.')
    expect(result.ok).toBe(false)
    expect(result.terms.effectiveStartDate).toBeUndefined()
  })

  it('accepts an explicit Swedish duration prefix without inventing a cancellation or start', () => {
    const result = normalizeManualCommercialTerms({ extracted: { notice_period: 'på 15 dagar' },
      authoredText: 'Uppsägningstid: på 15 dagar', receivedAt: '2026-10-21T12:00:00Z' })
    expect(result.ok).toBe(true)
    expect(result.terms.noticePeriod).toBe('15 dagar')
    expect(result.terms.effectiveStartDate).toBeUndefined()
    expect(result.terms.cancellationDeadline).toBeUndefined()
  })
})
