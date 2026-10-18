import { describe, expect, it } from 'vitest'
import { readManualMailWithAi, prepareManualMailAiInput } from '@/lib/inbound-mail/manualMailAiReader'

const config = { enabled: true, apiKey: 'synthetic-secret' }
const body = 'Avtalet löper till 2027-03-31. Tidigaste start är 2027-04-01 om uppsägningen kommer in senast 2027-02-28.'
const parsed = { outcome: 'contract_information', outcome_source: 0, fields: [{ field: 'earliest_start', value: '2027-04-01', source: 0 }] }
function response(value: unknown = parsed, changes: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    status: 'completed', model: 'gpt-6-luna',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 3000, output_tokens: 1000 }, ...changes,
  }), { status: 200 })
}

describe('read-only manual mail AI boundary', () => {
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
      expect(JSON.stringify(request)).not.toContain('synthetic-secret')
      return response()
    }
    expect((await readManualMailWithAi(body, config, fetcher)).status).toBe('completed')
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
