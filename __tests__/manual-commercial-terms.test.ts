import { describe, expect, it } from 'vitest'
import { normalizeManualCommercialTerms } from '@/lib/inbound-mail/manualCommercialTerms'
import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'
import { interpretManualMail } from '@/lib/inbound-mail/manualMailInterpretation'

const receivedAt = '2026-10-18T12:00:00.000Z'

function normalize(extracted: ManualFacilityExtractedPayload, authoredText: string, timestamp = receivedAt) {
  return normalizeManualCommercialTerms({ extracted, authoredText, receivedAt: timestamp })
}

describe('normalizeManualCommercialTerms', () => {
  it.each([
    'Fullmakten är godkänd och BankID krävs inte.',
    'Fullmakten är godkänd. BankID krävs inte.',
    'BankID krävs inte och fullmakten är godkänd.',
    'Fullmakten är godkänd och behöver inte kompletteras med organisationsnummer.',
  ])('carries a precise harmless POA acceptance through interpretation and commercial normalization: %s', acceptance => {
    const authoredText = `${acceptance}\nTidigaste start: 2027-04-01\nBrytavgift: Ingen`
    const interpreted = interpretManualMail({ authoredText, extracted: { earliest_supplier_start_date: '2027-04-01', termination_fee: 'Ingen' } })
    expect(interpreted.reasons).toEqual([])
    const result = normalize(interpreted.extracted, authoredText)
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.terms).toEqual({ earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01', terminationFee: 'Ingen' })
  })

  it.each([
    'Fullmakten är godkänd och BankID krävs inte, men datumet gäller inte kunden.',
    'Fullmakten är godkänd. BankID krävs inte. Datumet gäller inte kunden.',
    'Datumet gäller inte kunden, men fullmakten är godkänd.',
  ])('preserves a commercial negation alongside a POA acceptance: %s', qualification => {
    const result = normalize({ earliest_supplier_start_date: '2027-04-01', termination_fee: 'Ingen' },
      `${qualification}\nTidigaste start: 2027-04-01\nBrytavgift: Ingen`)
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('negated_commercial_terms')
    expect(result.terms.effectiveStartDate).toBeUndefined()
  })

  it.each(['Detta datum är en uppskattning.', 'Datumet gäller för annan kund.', 'Startdatum är ungefärligt.'])('does not approve an uncertain or other-customer date: %s', (qualifier) => {
    const result = normalize({ earliest_supplier_start_date: '2027-04-01', termination_fee: 'Ingen' },
      `Tidigaste start: 2027-04-01\nBrytavgift: Ingen\n${qualifier}`)
    expect(result.ok).toBe(false)
    expect(result.terms.effectiveStartDate).toBeUndefined()
  })
  it('keeps source evidence and derives the day after inclusive contract expiration', () => {
    const result = normalize({ current_contract_end_date: '2027-03-31', notice_period: '3 månader' },
      'Hej!\nAvtalsslut: 2027-03-31\nUppsägningstid: 3 månader\nVänliga hälsningar')
    expect(result).toEqual({
      ok: true,
      reasons: [],
      terms: { contractEndDate: '2027-03-31', noticePeriod: '3 månader', effectiveStartDate: '2027-04-01' },
      evidence: { contractEndDate: 'Avtalsslut: 2027-03-31', noticePeriod: 'Uppsägningstid: 3 månader' },
    })
  })

  it.each([
    ['31/03/2027', '2027-03-31'],
    ['3.4.2027', '2027-04-03'],
    ['31 mars 2027', '2027-03-31'],
    ['den 1 januari 2027', '2027-01-01'],
    ['29 februari 2028', '2028-02-29'],
    ['2027-12-31', '2027-12-31'],
    ['t.o.m. 2027-03-31', '2027-03-31'],
  ])('normalizes a fully specified calendar date %s', (raw, expected) => {
    const result = normalize({ current_contract_end_date: raw }, `Avtalsslut: ${raw}`)
    expect(result.ok).toBe(true)
    expect(result.terms.contractEndDate).toBe(expected)
    expect(result.terms.effectiveStartDate).toBe(expected === '2027-12-31' ? '2028-01-01'
      : expected === '2028-02-29' ? '2028-03-01'
      : expected === '2027-04-03' ? '2027-04-04'
      : expected === '2027-01-01' ? '2027-01-02' : '2027-04-01')
  })

  it.each(['2027-02-29', '2027-04-31', '31/13/2027', '03/04/2027', '03/31/2027', '31/03/27',
    '2027-3-31', 'i morgon', 'nästa månad', '2027-03-31 eller 2027-04-30', '3027-03-31', '2047-03-31'])
  ('does not approve invalid, ambiguous or relative dates: %s', (raw) => {
    const result = normalize({ current_contract_end_date: raw }, `Avtalsslut: ${raw}`)
    expect(result.ok).toBe(false)
    expect(result.terms.effectiveStartDate).toBeUndefined()
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('uses an explicit later earliest start without deriving a cancellation deadline', () => {
    const result = normalize({ current_contract_end_date: '2027-03-31', earliest_supplier_start_date: '2027-04-15', notice_period: 'tre månader' },
      'Avtalsslut: 2027-03-31\nTidigaste startdatum: 2027-04-15\nUppsägningstid: tre månader')
    expect(result.ok).toBe(true)
    expect(result.terms).toEqual({ contractEndDate: '2027-03-31', earliestStartDate: '2027-04-15', effectiveStartDate: '2027-04-15', noticePeriod: '3 månader' })
    expect(result.terms.cancellationDeadline).toBeUndefined()
  })

  it('does not approve a start on the still-bound contract last day', () => {
    const result = normalize({ current_contract_end_date: '2027-03-31', earliest_supplier_start_date: '2027-03-31' },
      'Avtalsslut: 2027-03-31\nTidigaste startdatum: 2027-03-31')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('earliest_start_conflicts_with_contract_end')
  })

  it('can approve explicit earliest start alone', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' }, 'Tidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(true)
    expect(result.terms.effectiveStartDate).toBe('2027-01-01')
  })

  it('saves partial durations without inventing a start date', () => {
    const result = normalize({ notice_period: '30 dagar', binding_period: 'tolv månader' },
      'Uppsägningstid: 30 dagar\nBindningstid: tolv månader')
    expect(result.ok).toBe(true)
    expect(result.terms).toEqual({ noticePeriod: '30 dagar', bindingPeriod: '12 månader' })
  })

  it.each(['ingen uppsägningstid', 'ingen', '0 dagar'])('accepts a clearly stated zero notice period: %s', (raw) => {
    const result = normalize({ notice_period: raw }, `Uppsägningstid: ${raw}`)
    expect(result.ok).toBe(true)
    expect(result.terms.noticePeriod).toBe('0 dagar')
  })

  it.each(['0', 'möjligen tre månader', 'en månad och därefter 30 dagar', '3 månader eller 30 dagar'])
  ('does not normalize an uncertain duration: %s', (raw) => {
    expect(normalize({ notice_period: raw }, `Uppsägningstid: ${raw}`).ok).toBe(false)
  })

  it.each([
    'Det gäller endast om kunden säger upp avtalet i tid.',
    'Startdatum gäller förutsatt att uppsägning inkommer senast i december.',
    'Med reservation för att kunden har obetalda fakturor.',
    'Vi kan inte bekräfta detta datum.',
    'Datumet är preliminärt.',
    'Kunden måste säga upp avtalet först.',
    'Uppsägningen är inte registrerad.',
    'Det angivna datumet stämmer inte.',
    'Detta datum gäller bara efter att uppsägningen har bekräftats.',
    'Det finns ett villkor: kunden måste först kontakta oss.',
  ])('checks disqualifying language after the extracted field: %s', (condition) => {
    const result = normalize({ earliest_supplier_start_date: '2027-04-01' },
      `Tidigaste startdatum: 2027-04-01\n${condition}`)
    expect(result.ok).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('rejects contradictory repeated date labels even when extraction returned the first one', () => {
    const result = normalize({ current_contract_end_date: '2027-03-31' },
      'Avtalsslut: 2027-03-31\nAvtalsslut: 2027-04-30')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('conflicting_contract_end_date')
  })

  it('rejects contradictory repeated durations even when extraction returned the first one', () => {
    const result = normalize({ notice_period: '3 månader' }, 'Uppsägningstid: 3 månader\nUppsägningstid: 1 månad')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('conflicting_notice_period')
  })

  it('rejects different facility identifiers in one reply', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' },
      'Anläggnings-ID: 735999100000000001\nAnläggnings-ID: 735999100000000002\nTidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('multiple_facilities')
  })

  it.each([
    'Anläggnings-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002',
    'Anläggnings-ID: 735 999 100 000 000 001\nMätpunkts-ID: 735 999 100 000 000 002',
    'Anläggnings-ID: 735999100000000001; Mätpunkts-ID: 735999100000000002',
  ])('accepts one explicitly distinguished facility and metering identifier: %s', (identifiers) => {
    const result = normalize({ facility_id: '735999100000000001', metering_point_id: '735999100000000002', earliest_supplier_start_date: '2027-01-01' },
      `${identifiers}\nTidigaste startdatum: 2027-01-01`)
    expect(result.ok).toBe(true)
    expect(result.terms.effectiveStartDate).toBe('2027-01-01')
  })

  it.each([
    'Anläggnings-ID: 735999100000000001\nReferens: 735999100000000002',
    'Mätpunkts-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002',
    'Anläggnings-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002\nReferens: 735999100000000003',
    'Anläggnings-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002\nAnläggning 1: Gatan\nAnläggning 2: Vägen',
    'Anläggnings-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002\nBåda anläggningarna omfattas.',
  ])('keeps unknown or multiple-site identifier combinations blocked: %s', (identifiers) => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' }, `${identifiers}\nTidigaste startdatum: 2027-01-01`)
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('multiple_facilities')
  })

  it('does not accept a facility value that actually belongs to the separately labelled metering point', () => {
    const result = normalize({ facility_id: '735999100000000002', earliest_supplier_start_date: '2027-01-01' },
      'Anläggnings-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002\nTidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('facility_id_conflict')
  })

  it('does not accept a metering value that actually belongs to the separately labelled facility', () => {
    const result = normalize({ metering_point_id: '735999100000000001', earliest_supplier_start_date: '2027-01-01' },
      'Anläggnings-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002\nTidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('metering_point_id_conflict')
  })

  it('does not reject repetition of the same facility identifier', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' },
      'Anläggnings-ID: 735999100000000001\nAnläggning 735999100000000001\nTidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(true)
  })

  it('rejects multiple space-formatted facility identifiers', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' },
      'Anläggnings-ID: 735 999 100 000 000 001\nAnläggnings-ID: 735 999 100 000 000 002\nTidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('multiple_facilities')
  })

  it('rejects multiple labelled sites even when their facility identifiers are absent', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' },
      'Anläggning 1: Östra vägen\nAnläggning 2: Västra vägen\nTidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('multiple_facilities')
  })

  it('requires evidence from the newly authored reply', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' }, 'Hej, vi återkommer.')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('earliest_start_date_missing_evidence')
  })

  it('does not approve an empty or merely technical reply as commercial terms', () => {
    expect(normalize({}, 'Hej!').ok).toBe(false)
    expect(normalize({ facility_id: '735999100000000001' }, 'Anläggnings-ID: 735999100000000001').ok).toBe(false)
  })

  it('blocks a past deadline according to the Stockholm calendar day', () => {
    const result = normalize({ cancellation_deadline: '2026-10-18', earliest_supplier_start_date: '2027-01-01' },
      'Sista uppsägningsdatum: 2026-10-18\nTidigaste startdatum: 2027-01-01', '2026-10-18T22:30:00.000Z')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('cancellation_deadline_passed_without_registered_cancellation')
  })

  it('does not treat a deadline on the received Stockholm date as already passed', () => {
    const result = normalize({ cancellation_deadline: '2026-10-18' }, 'Sista uppsägningsdatum: 2026-10-18', '2026-10-18T20:30:00.000Z')
    expect(result.ok).toBe(true)
  })

  it('accepts a past deadline only with explicit registered cancellation', () => {
    const result = normalize({ cancellation_deadline: '2026-10-01', cancellation_registered: 'Ja', earliest_supplier_start_date: '2027-01-01' },
      'Sista uppsägningsdatum: 2026-10-01\nUppsägning registrerad: Ja\nTidigaste startdatum: 2027-01-01')
    expect(result.ok).toBe(true)
    expect(result.terms.cancellationRegistered).toBe('Ja')
  })

  it('does not ignore an unextracted deadline elsewhere in the reply', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' },
      'Tidigaste startdatum: 2027-01-01\nSista uppsägningsdatum: 2026-10-01')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('unextracted_cancellation_deadline')
  })

  it('uses field-specific evidence when a short value also occurs in another line', () => {
    const result = normalize({ termination_fee: '0 kr', cancellation_registered: 'Ja' },
      'Hej Jan!\nUppsägning registrerad: Ja\nBrytavgift: 0 kr')
    expect(result.ok).toBe(true)
    expect(result.evidence.cancellationRegistered).toBe('Uppsägning registrerad: Ja')
  })

  it('rejects a cancellation deadline after explicit contract expiration', () => {
    const result = normalize({ cancellation_deadline: '2027-04-01', current_contract_end_date: '2027-03-31' },
      'Sista uppsägningsdatum: 2027-04-01\nAvtalsslut: 2027-03-31')
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('cancellation_deadline_after_contract_end')
  })

  it('preserves a literal fee and known contract status without approving an unknown fee', () => {
    const result = normalize({ termination_fee: '0 kr', contract_status: 'tillsvidare' },
      'Brytavgift: 0 kr\nAvtalsstatus: tillsvidare')
    expect(result.ok).toBe(true)
    expect(result.terms).toEqual({ terminationFee: '0 kr', contractStatus: 'tillsvidare' })
    expect(normalize({ termination_fee: 'enligt senare beräkning' }, 'Brytavgift: enligt senare beräkning').ok).toBe(false)
  })

  it('does not process a reply with an invalid received timestamp', () => {
    expect(normalize({ earliest_supplier_start_date: '2027-01-01' }, 'Tidigaste startdatum: 2027-01-01', 'not-a-timestamp').ok).toBe(false)
    expect(normalize({ earliest_supplier_start_date: '2027-01-01' }, 'Tidigaste startdatum: 2027-01-01', '2026-02-30T12:00:00.000Z').ok).toBe(false)
  })

  it('rejects oversized authored replies rather than overlooking trailing conditions', () => {
    const result = normalize({ earliest_supplier_start_date: '2027-01-01' },
      `Tidigaste startdatum: 2027-01-01\n${'x'.repeat(100_001)}`)
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('authored_reply_too_large')
  })
})
