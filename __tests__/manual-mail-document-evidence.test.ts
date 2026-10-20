import { describe, expect, it } from 'vitest'
import { prepareManualMailAiInput, restoreManualMailAiReading } from '@/lib/inbound-mail/manualMailAiReader'
import { interpretManualMail } from '@/lib/inbound-mail/manualMailInterpretation'

describe('complete raw value evidence', () => {
  it.each([
    ['Årsenergi: 5000 kWh', 'annual_consumption', 'annual_consumption', '5000', '500'],
    ['Brytavgift: 1000 kr', 'termination_fee', 'termination_fee', '1000 kr', '1'],
  ])('does not narrow the explicit value in %s to a numeric substring', (text, field, target, original, value) => {
    const result = interpretManualMail({ authoredText: text, extracted: { [target]: original }, reading: {
      status: 'completed', mode: 'read_only', review_required: true, model: 'gpt-6-luna', outcome: 'facility_information',
      outcome_quote: text, review_reasons: [], fields: [{ field: field as 'annual_consumption' | 'termination_fee', value, quote: text }],
    } })
    expect(result.extracted).toMatchObject({ [target]: original })
    expect(result.reasons.length).toBeGreaterThan(0)
  })
})
import { createManualMailSourceCorpus, isManualMailSourceCorpus } from '@/lib/inbound-mail/manualMailEvidenceSources'
import type { ManualDocumentManifestEntry, ManualDocumentUnit } from '@/lib/inbound-mail/manualMailDocumentParser'

type SourceOptions = { documentSources: true }
const prepareDocuments = prepareManualMailAiInput as (text: string, options: SourceOptions) => ReturnType<typeof prepareManualMailAiInput>
const restoreDocuments = restoreManualMailAiReading as (value: unknown, text: string, options: SourceOptions) => ReturnType<typeof restoreManualMailAiReading>

describe('complete document evidence supplied by the server', () => {
  const text = 'Se bilagan.\n\n-----Original Message-----\nAvtalsslut: 2027-03-31\n\nTidigaste start: 2027-04-01'

  it('retains document text that resembles an email history header', () => {
    const result = prepareDocuments(text, { documentSources: true })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.paragraphs).toContain('-----Original Message-----\nAvtalsslut: 2027-03-31')
      expect(result.paragraphs).toContain('Tidigaste start: 2027-04-01')
    }
  })

  it('accepts a complete bounded document corpus instead of applying the smaller body-only limit', () => {
    const paragraphs = Array.from({ length: 100 }, (_, index) => `Dokumentrad ${index}: ${'a'.repeat(130)}`)
    const result = prepareDocuments(paragraphs.join('\n\n'), { documentSources: true })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.paragraphs).toHaveLength(100)
  })

  it('restores a saved reading against the same complete document paragraphs', () => {
    const saved = { status: 'completed', mode: 'read_only', model: 'gpt-6-luna', outcome: 'contract_information',
      outcome_quote: '-----Original Message-----\nAvtalsslut: 2027-03-31', outcome_source: 1, review_reasons: [],
      fields: [{ field: 'contract_end', value: '2027-03-31', quote: '-----Original Message-----\nAvtalsslut: 2027-03-31', source: 1 }] }
    expect(restoreDocuments(saved, text, { documentSources: true })).toMatchObject({ status: 'completed', fields: saved.fields })
  })

  it('still strips quoted history for ordinary body-only reading', () => {
    const result = prepareManualMailAiInput(text)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.paragraphs).not.toContain('-----Original Message-----\nAvtalsslut: 2027-03-31')
  })
})

const hash = 'a'.repeat(64)
const manifest = (): ManualDocumentManifestEntry[] => [{ attachmentId: 'part:1:original', mimePart: 1, sha256: hash,
  mimeType: 'application/pdf', filename: 'avtal.pdf', sizeBytes: 400, sourceRole: 'attachment', pageCount: 1 }]
const units = (): ManualDocumentUnit[] => [{ attachmentId: 'part:1:original', sha256: hash, origin: 'pdf_ocr',
  locator: 'page:1', text: 'Avtalsslut: 2027-03-31\n\nTidigaste start: 2027-04-01' }]

describe('immutable document evidence corpus', () => {
  it('keeps complete paragraphs and their original document provenance in reader order', () => {
    const result = createManualMailSourceCorpus('Hej.\n\nSe bilagan.', units(), manifest())
    expect(result).toMatchObject({ ok: true, documentSources: true, sourceVersion: 2,
      text: 'Hej.\n\nSe bilagan.\n\nAvtalsslut: 2027-03-31\n\nTidigaste start: 2027-04-01',
      catalog: [{ source: 0, origin: 'body', text: 'Hej.', part: 0 }, { source: 1, origin: 'body', text: 'Se bilagan.', part: 1 },
        { source: 2, origin: 'pdf_ocr', attachmentId: 'part:1:original', sha256: hash, locator: 'page:1', part: 0, text: 'Avtalsslut: 2027-03-31' },
        { source: 3, origin: 'pdf_ocr', attachmentId: 'part:1:original', sha256: hash, locator: 'page:1', part: 1, text: 'Tidigaste start: 2027-04-01' }] })
    if (!result.ok) return
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/)
    const reading = prepareManualMailAiInput(result.text, { documentSources: true })
    expect(reading.status).toBe('ready')
    if (reading.status === 'ready') expect(reading.paragraphs).toEqual(result.catalog.map(entry => entry.text))
  })

  it('takes immutable snapshots without freezing or retaining mutable caller objects', () => {
    const originalUnits = units(), originalManifest = manifest()
    const result = createManualMailSourceCorpus('Se bilagan.', originalUnits, originalManifest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const savedHash = result.sourceHash
    originalUnits[0].text = 'Ändrat'
    originalManifest[0].filename = 'ändrat.pdf'
    expect(result.sourceHash).toBe(savedHash)
    expect(result.text).not.toContain('Ändrat')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.catalog)).toBe(true)
    expect(result.catalog.every(entry => Object.isFrozen(entry))).toBe(true)
  })

  it('brands only immutable factory results rather than accepting caller-spoofed or restored objects', () => {
    const result = createManualMailSourceCorpus('Se bilagan.', units(), manifest())
    expect(isManualMailSourceCorpus(result)).toBe(true)
    expect(isManualMailSourceCorpus({ ...result })).toBe(false)
    expect(isManualMailSourceCorpus(JSON.parse(JSON.stringify(result)))).toBe(false)
    expect(isManualMailSourceCorpus(Object.freeze({ ...result }))).toBe(false)
    expect(isManualMailSourceCorpus(createManualMailSourceCorpus('', [], []))).toBe(false)
    expect(isManualMailSourceCorpus(null)).toBe(false)
  })

  it('canonicalizes object keys while binding complete original whitespace and provenance', () => {
    const original = createManualMailSourceCorpus('Se bilagan.', units(), manifest(), 'extractor-v1')
    const reorderedManifest = manifest().map(entry => Object.fromEntries(Object.entries(entry).reverse()) as ManualDocumentManifestEntry)
    expect(createManualMailSourceCorpus('Se bilagan.', units(), reorderedManifest, 'extractor-v1')).toEqual(original)
    expect(original.ok).toBe(true)
    if (!original.ok) return
    const variants = [
      createManualMailSourceCorpus('Se bilagan. ', units(), manifest(), 'extractor-v1'),
      createManualMailSourceCorpus('Se bilagan.', [{ ...units()[0], text: `${units()[0].text} ` }], manifest(), 'extractor-v1'),
      createManualMailSourceCorpus('Se bilagan.', [{ ...units()[0], locator: 'page:2' }], manifest(), 'extractor-v1'),
      createManualMailSourceCorpus('Se bilagan.', units(), [{ ...manifest()[0], filename: 'annan.pdf' }], 'extractor-v1'),
      createManualMailSourceCorpus('Se bilagan.', units(), manifest(), 'extractor-v2'),
      createManualMailSourceCorpus('Se bilagan.', [{ ...units()[0], sha256: 'b'.repeat(64) }], [{ ...manifest()[0], sha256: 'b'.repeat(64) }], 'extractor-v1'),
    ]
    for (const variant of variants) {
      expect(variant.ok).toBe(true)
      if (variant.ok) expect(variant.sourceHash).not.toBe(original.sourceHash)
    }
  })

  it.each([
    ['unbound identifier', { attachmentId: 'other' }],
    ['changed original bytes hash', { sha256: 'b'.repeat(64) }],
    ['invalid original bytes hash', { sha256: 'not-a-hash' }],
    ['empty locator', { locator: '' }],
    ['empty unit', { text: '  \n  ' }],
  ])('rejects %s before any text can be read', (_name, patch) => {
    expect(createManualMailSourceCorpus('Se bilagan.', [{ ...units()[0], ...patch }], manifest())).toMatchObject({ ok: false })
  })

  it('rejects duplicate document locators while allowing the same locator in different attachments', () => {
    expect(createManualMailSourceCorpus('', [units()[0], { ...units()[0], text: 'Annat besked' }], manifest())).toMatchObject({ ok: false })
    const otherManifest = { ...manifest()[0], attachmentId: 'part:2:other', mimePart: 2 }
    expect(createManualMailSourceCorpus('', [units()[0], { ...units()[0], attachmentId: otherManifest.attachmentId }], [...manifest(), otherManifest])).toMatchObject({ ok: true })
  })

  it('rejects ambiguous duplicate manifest identities and promoted forwarded sources', () => {
    expect(createManualMailSourceCorpus('', units(), [...manifest(), { ...manifest()[0] }])).toMatchObject({ ok: false })
    expect(createManualMailSourceCorpus('', units(), [{ ...manifest()[0], sourceRole: 'forwarded' }])).toMatchObject({ ok: false })
  })

  it('binds forwarded manifest entries without promoting their text into the current reading', () => {
    const forwarded = { ...manifest()[0], attachmentId: 'forwarded', mimePart: 2, sourceRole: 'forwarded' as const }
    const result = createManualMailSourceCorpus('', units(), [...manifest(), forwarded])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.catalog).toHaveLength(2)
      expect(result.catalog.every(entry => entry.attachmentId === units()[0].attachmentId)).toBe(true)
      const withoutHistory = createManualMailSourceCorpus('', units(), manifest())
      if (withoutHistory.ok) expect(result.manifestHash).not.toBe(withoutHistory.manifestHash)
    }
  })

  it('splits complete OCR paragraphs without clipping text or losing source locations', () => {
    const text = `${'a'.repeat(1800)}\n\n${'b'.repeat(1800)}`
    const result = createManualMailSourceCorpus('', [{ ...units()[0], text }], manifest())
    expect(result).toMatchObject({ ok: true, text })
    if (result.ok) expect(result.catalog.map(entry => [entry.locator, entry.part, entry.text.length])).toEqual([['page:1', 0, 1800], ['page:1', 1, 1800]])
  })

  it.each(['a'.repeat(2001), `${'a'.repeat(1500)}\n${'b'.repeat(600)}`])('rejects an oversized complete paragraph instead of slicing it', text => {
    expect(createManualMailSourceCorpus('', [{ ...units()[0], text }], manifest())).toMatchObject({ ok: false, reasons: ['document_source_paragraph_limit'] })
  })

  it('enforces the inclusive 160-paragraph boundary across body and documents', () => {
    const text = Array.from({ length: 159 }, (_, index) => `Rad ${index}`).join('\n\n')
    const result = createManualMailSourceCorpus('Se bilagan.', [{ ...units()[0], text }], manifest())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.catalog.at(-1)?.source).toBe(159)
    expect(createManualMailSourceCorpus('Hej.\n\nSe bilagan.', [{ ...units()[0], text }], manifest())).toMatchObject({ ok: false, reasons: ['document_source_count_limit'] })
  })

  it('enforces the complete 24000-character corpus boundary including paragraph separators', () => {
    const text = Array.from({ length: 12 }, (_, index) => 'a'.repeat(index === 11 ? 1978 : 2000)).join('\n\n')
    expect(text).toHaveLength(24_000)
    expect(createManualMailSourceCorpus('', [{ ...units()[0], text }], manifest())).toMatchObject({ ok: true, text })
    expect(createManualMailSourceCorpus('', [{ ...units()[0], text: `${text}a` }], manifest())).toMatchObject({ ok: false, reasons: ['document_source_character_limit'] })
  })

  it('refuses an empty reading and invalid extractor version without producing a usable hash', () => {
    expect(createManualMailSourceCorpus(' \n ', [], [])).toMatchObject({ ok: false })
    expect(createManualMailSourceCorpus('Hej', [], [], '')).toMatchObject({ ok: false })
  })
})
