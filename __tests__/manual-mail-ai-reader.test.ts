import { describe, expect, it } from 'vitest'
import { readManualMailWithAi, prepareManualMailAiInput, restoreManualMailAiReading } from '@/lib/inbound-mail/manualMailAiReader'

const config = { enabled: true, apiKey: 'synthetic-secret' }
const body = 'Avtalet löper till 2027-03-31. Tidigaste start är 2027-04-01 om uppsägningen kommer in senast 2027-02-28.'
const parsed = { outcome: 'contract_information', outcome_source: 0, review_reasons: ['conditional'], fields: [{ field: 'earliest_start', value: '2027-04-01', source: 0 }] }
function response(value: unknown = parsed, changes: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    status: 'completed', model: 'gpt-6-luna',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 3000, output_tokens: 1000 }, ...changes,
  }), { status: 200 })
}

describe('read-only manual mail AI boundary', () => {
  it('preserves separate raw candidates for several server-partitioned facilities in one bounded reading', async () => {
    const paragraphs = Array.from({ length: 17 }, (_, index) => `Anläggnings-ID: 7359991000000000${String(index).padStart(2, '0')}\nTidigaste start: 2027-04-01`)
    const value = { outcome: 'contract_information', outcome_source: 0, review_reasons: ['multiple_facilities'],
      fields: paragraphs.map((_, source) => ({ field: 'earliest_start', value: '2027-04-01', source })) }
    const result = await readManualMailWithAi(paragraphs.join('\n\n'), config, async () => response(value),
      { documentSources: true, multiSite: true } as Parameters<typeof readManualMailWithAi>[3])
    expect(result.status).toBe('completed')
    if (result.status === 'completed') expect(result.fields.map(field => field.source)).toEqual(paragraphs.map((_, index) => index))
  })
  it('preserves document headers while masking identifiers and keeps body history filtering unchanged', () => {
    const text = 'Kunduppgifter\n\nFrom: person@example.test\nTo: handling@example.test\nPersonnummer: 198001019999\nÄrende GX-FIR-ABC123\n\nTidigaste startdatum: 2027-04-01'
    const documents = prepareManualMailAiInput(text, { documentSources: true })
    expect(documents).toEqual({ status: 'ready', paragraphs: ['Kunduppgifter',
      'From: [MASKERAT]\nTo: [MASKERAT]\nPersonnummer: [MASKERAT]\nÄrende [MASKERAT]',
      'Tidigaste startdatum: 2027-04-01'] })
    expect(prepareManualMailAiInput(text)).toEqual({ status: 'ready', paragraphs: ['Kunduppgifter'] })
  })

  it('grounds the final document source above the body-only source limit and restores its ordinal', async () => {
    const paragraphs = [...Array.from({ length: 159 }, (_, index) => `Dokumentstycke ${index}`), 'Tidigaste startdatum: 2027-04-01']
    const text = paragraphs.join('\n\n')
    const result = await readManualMailWithAi(text, config, async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      expect(request.text.format.schema.properties.outcome_source.maximum).toBe(159)
      expect(request.text.format.schema.properties.fields.items.properties.source.maximum).toBe(159)
      expect(JSON.parse(request.input[0].content[0].text).untrusted_reply_paragraphs[159])
        .toEqual({ source: 159, text: 'Tidigaste startdatum: 2027-04-01' })
      return response({ ...parsed, outcome_source: 159, fields: [{ field: 'earliest_start', value: '2027-04-01', source: 159 }] })
    }, { documentSources: true })
    expect(result).toMatchObject({ status: 'completed', outcome_source: 159,
      fields: [{ field: 'earliest_start', value: '2027-04-01', source: 159, quote: 'Tidigaste startdatum: 2027-04-01' }] })
    expect(restoreManualMailAiReading(result, text, { documentSources: true })).toMatchObject({ outcome_source: 159, fields: [{ source: 159 }] })
    expect(restoreManualMailAiReading(result, text)).toBeUndefined()
  })

  it('accepts document input above the body size limit without changing body-only limits', async () => {
    const text = [...Array(7).fill('x'.repeat(1800)), 'Tidigaste startdatum: 2027-04-01'].join('\n\n')
    expect(prepareManualMailAiInput(text)).toEqual({ status: 'skipped', reason: 'input_too_large' })
    expect((await readManualMailWithAi(text, config, async () => response({ ...parsed, outcome_source: 7,
      fields: [{ field: 'earliest_start', value: '2027-04-01', source: 7 }] }), { documentSources: true })).status).toBe('completed')
  })

  it.each([
    [...Array(13).fill('x'.repeat(1900))].join('\n\n'),
    Array(161).fill('Stycke').join('\n\n'),
    `Tidigaste startdatum: 2027-04-01\n\n${'x'.repeat(2001)}`,
  ])('rejects oversized document input without truncation or provider calls %#', async (text) => {
    let calls = 0
    const result = await readManualMailWithAi(text, config, async () => { calls += 1; return response() }, { documentSources: true })
    expect(result).toEqual({ status: 'skipped', reason: 'input_too_large' })
    expect(calls).toBe(0)
  })

  it('preserves the selected ordinal when identical document paragraphs occur twice', async () => {
    const quote = 'Tidigaste startdatum: 2027-04-01'
    const text = `${quote}\n\n${quote}\n\nVillkoren är bekräftade.`
    const result = await readManualMailWithAi(text, config, async () => response({ ...parsed, outcome_source: 1,
      fields: [{ field: 'earliest_start', value: '2027-04-01', source: 1 }] }), { documentSources: true })
    expect(restoreManualMailAiReading(result, text, { documentSources: true }))
      .toMatchObject({ status: 'completed', outcome_source: 1, fields: [{ source: 1, quote }] })
    expect(restoreManualMailAiReading({ ...result, outcome_source: 2 }, text, { documentSources: true })).toBeUndefined()
    const restoredField = { field: 'earliest_start', value: '2027-04-01', quote, source: 2 }
    expect(restoreManualMailAiReading({ ...result, fields: [restoredField] }, text, { documentSources: true })).toBeUndefined()
  })

  it('requires document source ordinals when restoring instead of inferring them from quotes', async () => {
    const result = await readManualMailWithAi(body, config, async () => response())
    expect(restoreManualMailAiReading(result, body, { documentSources: true })).toBeUndefined()
    expect(result).not.toHaveProperty('outcome_source')
    if (result.status === 'completed') expect(result.fields[0]).not.toHaveProperty('source')
  })

  it.each([-1, 160, 1.5])('rejects invalid document evidence ordinal %s', async (source) => {
    expect(await readManualMailWithAi(body, config, async () => response({ ...parsed, outcome_source: source,
      fields: [{ field: 'earliest_start', value: '2027-04-01', source }] }), { documentSources: true }))
      .toMatchObject({ status: 'failed', reason: 'invalid_output' })
  })

  it('does not call the provider when disabled, unconfigured or input exceeds its limit', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('must not be called') }
    expect(await readManualMailWithAi(body, { enabled: false, apiKey: 'synthetic-secret' }, fetcher)).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(await readManualMailWithAi(body, { enabled: true }, fetcher)).toEqual({ status: 'skipped', reason: 'not_configured' })
    expect(await readManualMailWithAi('a'.repeat(12001), config, fetcher)).toEqual({ status: 'skipped', reason: 'input_too_large' })
    expect(await readManualMailWithAi('', config, fetcher)).toEqual({ status: 'skipped', reason: 'empty_input' })
  })

  it('sends only the authored reply, masks direct identifiers and preserves full evidence paragraphs', async () => {
    const text = `${body}\n\nPersonnummer: 198001019999\nKontakt: person@example.test\n\n> Tidigaste start är 2026-01-01.`
    const input = prepareManualMailAiInput(text)
    expect(input.status).toBe('ready')
    expect(JSON.stringify(input)).not.toContain('198001019999')
    expect(JSON.stringify(input)).not.toContain('person@example.test')
    expect(JSON.stringify(input)).not.toContain('2026-01-01')
    const result = await readManualMailWithAi(text, config, async () => response())
    expect(result).toMatchObject({ status: 'completed', mode: 'read_only', review_required: true,
      fields: [{ field: 'earliest_start', value: '2027-04-01', quote: body }],
      usage: { input_tokens: 3000, output_tokens: 1000 }, estimated_cost_usd: 0.0008,
    })
  })

  it('fixes the API destination, forbids tools and storage, and bounds generation', async () => {
    const fetcher: typeof fetch = async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/responses')
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      const request = JSON.parse(String(init?.body))
      expect(request).toMatchObject({ model: 'gpt-6-luna', store: false, tools: [], tool_choice: 'none', max_output_tokens: 1600, reasoning: { effort: 'none' } })
      expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true })
      expect(request.text.format.schema.required).toContain('review_reasons')
      expect(request.text.format.schema.properties.review_reasons).toMatchObject({ type: 'array', maxItems: 7,
        items: { type: 'string', enum: ['conditional', 'negated', 'multiple_customers', 'multiple_facilities', 'contradictory', 'uncertain', 'other_customer'] } })
      expect(JSON.stringify(request)).not.toContain('synthetic-secret')
      return response()
    }
    expect((await readManualMailWithAi(body, config, fetcher)).status).toBe('completed')
  })

  it.each(['conditional', 'negated', 'multiple_customers', 'multiple_facilities', 'contradictory', 'uncertain', 'other_customer'])(
    'preserves the model global review reason %s alongside literal field evidence', async (reason) => {
      const result = await readManualMailWithAi(body, config, async () => response({ ...parsed, review_reasons: [reason] }))
      expect(result).toMatchObject({ status: 'completed', review_reasons: [reason],
        fields: [{ field: 'earliest_start', value: '2027-04-01', quote: body }] })
    },
  )

  it('keeps a qualifier from a later paragraph even when the date has a clean first-paragraph citation', async () => {
    const first = 'Tidigaste startdatum: 2027-04-01'
    const last = 'Detta gäller endast om kunden säger upp avtalet i tid. Det andra avtalet avser en annan kund.'
    const result = await readManualMailWithAi(`${first}\n\n${last}`, config, async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      const input = JSON.parse(request.input[0].content[0].text)
      expect(input.untrusted_reply_paragraphs).toEqual([{ source: 0, text: first }, { source: 1, text: last }])
      return response({ ...parsed, review_reasons: ['conditional', 'multiple_customers', 'other_customer'] })
    })
    expect(result).toMatchObject({ status: 'completed', review_reasons: ['conditional', 'multiple_customers', 'other_customer'],
      fields: [{ field: 'earliest_start', value: '2027-04-01', quote: first }] })
  })

  it.each([undefined, null, 'uncertain', ['execute_email'], [1], { uncertain: true }, Array(8).fill('uncertain')])(
    'fails closed for missing or invalid global review classifications %#', async (reviewReasons) => {
      expect(await readManualMailWithAi(body, config, async () => response({ ...parsed, review_reasons: reviewReasons })))
        .toMatchObject({ status: 'failed', reason: 'invalid_output' })
    },
  )

  it('can restore fresh review reasons but never upgrades a legacy reading without the classification', async () => {
    const result = await readManualMailWithAi(body, config, async () => response({ ...parsed, review_reasons: ['uncertain', 'multiple_customers'] }))
    expect(result.status).toBe('completed')
    expect(restoreManualMailAiReading(result, body)).toMatchObject({ status: 'completed', review_reasons: ['uncertain', 'multiple_customers'] })
    const legacy = { ...result } as Record<string, unknown>
    delete legacy.review_reasons
    expect(restoreManualMailAiReading(legacy, body)).toBeUndefined()
    expect(restoreManualMailAiReading({ ...result, review_reasons: ['perform_action'] }, body)).toBeUndefined()
  })

  it.each([
    { ...parsed, company_id: 'injected-tenant' },
    { ...parsed, fields: [{ field: 'customer_id', value: '2027-04-01', source: 0 }] },
    { ...parsed, fields: [{ field: 'earliest_start', value: '2027-05-01', source: 0 }] },
    { ...parsed, fields: [{ field: 'earliest_start', value: '2027-04-01', source: 99 }] },
    { ...parsed, outcome_source: null },
    { ...parsed, fields: [{ field: 'earliest_start', value: '2026-01-01', source: 1 }] },
  ])('rejects unsupported identity, ungrounded and quoted-history claims %#', async (value) => {
    expect(await readManualMailWithAi(`${body}\n\n> 2026-01-01`, config, async () => response(value)))
      .toMatchObject({ status: 'failed', reason: 'invalid_output' })
  })

  it.each([
    { status: 'incomplete' },
    { output: [{ type: 'function_call', name: 'send_email', arguments: '{}' }] },
    { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }] }] },
  ])('fails closed on incomplete responses, tool calls and refusals %#', async (changes) => {
    expect(await readManualMailWithAi(body, config, async () => response(parsed, changes)))
      .toMatchObject({ status: 'failed', reason: 'invalid_output' })
  })

  it.each([[401, 'authentication'], [429, 'rate_limited'], [503, 'provider_unavailable']] as const)(
    'does not persist or retry provider errors %i', async (status, reason) => {
      let calls = 0
      const result = await readManualMailWithAi(body, config, async () => { calls += 1; return new Response('sensitive provider response', { status }) })
      expect(calls).toBe(1)
      expect(result).toEqual({ status: 'failed', reason })
    },
  )

  it('does not expose request headers or mail content in transport errors', async () => {
    expect(await readManualMailWithAi(body, config, async () => { throw new Error('synthetic-secret sensitive mail') }))
      .toEqual({ status: 'failed', reason: 'transport_error' })
  })
})
