import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAutomaticAckPolicy } from '@/lib/ediel/core/ackPolicy'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { createAutomaticAcksForInboundMessage } from '@/lib/ediel/orchestrator'
import type { EdielMessageRow } from '@/lib/ediel/types'

const ports = vi.hoisted(() => ({
  prepare: vi.fn(),
  create: vi.fn(),
  rpc: vi.fn(() => { throw new Error('Unexpected storage operation in local policy fixture') }),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc } }))
vi.mock('@/lib/ediel/ack/prepareSourceAckDraft', () => ({ prepareSourceAckDraft: ports.prepare }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: ports.create }))
vi.mock('@/lib/ediel/transport', () => ({
  sendEdielMessageViaSmtp: vi.fn(() => { throw new Error('Unexpected transport in local policy fixture') }),
}))

const raw = [
  'UNB+UNOC:3+54321:14+12345:14+260331:2300+I++23-DDQ-PRODAT',
  'UNH+M+PRODAT:D:97A:UN:E2SE6A', 'BGM+Z04+DOC+9', 'DTM+137:202603312300:203',
  'LIN+1++735123456789012345::9', 'CCI++Z13', 'CAV+Z22', 'UNT+7+M', 'UNZ+1+I',
].join("'") + "'"
const positivePolicy = { shouldSendContrl: true, shouldSendPositiveAperak: true }
const actorUserId = 'synthetic-operator'

function source(receivedAt: string | null, createdAt = receivedAt ?? ''): EdielMessageRow {
  return {
    id: 'synthetic-prodat-policy-clock',
    direction: 'inbound',
    message_standard: 'edifact',
    message_family: 'PRODAT',
    message_code: 'Z04',
    raw_payload: raw,
    message_version: 'E2SE6A',
    application_reference: '23-DDQ-PRODAT',
    message_received_at: receivedAt,
    created_at: createdAt,
    communication_route_id: null,
    validation_report: {},
    parsed_payload: {},
  } as EdielMessageRow
}

beforeEach(() => { vi.clearAllMocks() })

describe('automatic PRODAT ACK guide selection around 26-A admission', () => {
  it.each([
    '2026-03-31T22:00:00.000Z',
    '2026-03-31T22:00:00.001Z',
    '2026-03-31T23:59:59.999Z',
    '2026-04-01T00:00:00.000Z',
    '2026-04-01T00:00:00+02:00',
  ])('uses the same Stockholm guide date as ordinary admission for %s', async receivedAt => {
    const message = source(receivedAt, '2026-03-31T21:59:59.999Z')
    const incoming = resolveCanonicalMessagePolicy(message)
    expect(incoming).toMatchObject({ referenceDate: '2026-04-01', guide: { guideRevision: '26-A' } })
    await expect(getAutomaticAckPolicy(message)).resolves.toMatchObject(positivePolicy)
  })

  it.each([
    '2026-03-31T21:59:59.999Z',
    '2026-04-01T02:59:59.999+05:00',
  ])('does not select 26-A before its effective instant for %s', async receivedAt => {
    const message = source(receivedAt, '2026-04-01T00:00:00.000Z')
    expect(() => resolveCanonicalMessagePolicy(message)).toThrow(/ediel_guide_resolution_missing:PRODAT:2026-03-31/)
    await expect(getAutomaticAckPolicy(message)).rejects.toThrow(/ediel_guide_resolution_missing:PRODAT:2026-03-31/)
  })

  it('uses the persisted creation instant when intake has no receipt timestamp', async () => {
    await expect(getAutomaticAckPolicy(source(null, '2026-03-31T22:00:00.000Z'))).resolves.toMatchObject(positivePolicy)
  })

  it.each([
    [null, ''],
    ['invalid-receipt', '2026-04-01T00:00:00.000Z'],
    ['2026-04-01Tinvalid', '2026-04-01T00:00:00.000Z'],
    [null, '2026-04-31T00:00:00.000Z'],
  ] as const)('holds a missing or invalid admission clock with received=%s and created=%s', async (receivedAt, createdAt) => {
    await expect(getAutomaticAckPolicy(source(receivedAt, createdAt))).rejects.toThrow('canonical_ack_reference_date_missing')
  })

  it('preserves a canonical policy already recorded on the source', async () => {
    const resolved = resolveCanonicalMessagePolicy(source('2026-04-01T00:00:00.000Z'))
    if (!resolved) throw new Error('The admitted PRODAT fixture must have a canonical policy')
    const original = source('2026-03-31T21:59:59.999Z')
    await expect(getAutomaticAckPolicy({
      ...original,
      validation_report: { canonicalPolicy: { ackRule: resolved.ackRule } },
    })).resolves.toMatchObject(positivePolicy)
  })

  it('reaches normal ACK draft and creation ports from the automatic entry at Swedish midnight', async () => {
    const original = source('2026-03-31T22:00:00.000Z')
    ports.prepare.mockImplementation(async ({ ackFamily }: { ackFamily: string }) => ({ kind: 'new', draft: { family: ackFamily } }))
    ports.create.mockImplementation(async ({ ackFamily }: { ackFamily: string }) => ({ id: ackFamily, message_family: ackFamily }))
    const result = await createAutomaticAcksForInboundMessage({ actorUserId, sourceMessage: original })
    expect(result).toMatchObject({
      policy: positivePolicy,
      created: [{ message_family: 'CONTRL' }, { message_family: 'APERAK' }],
    })
    for (const [index, family] of ['CONTRL', 'APERAK'].entries()) {
      expect(ports.prepare).toHaveBeenNthCalledWith(index + 1, {
        actorUserId, sourceMessage: original, ackFamily: family, outcome: 'positive',
      })
      expect(ports.create).toHaveBeenNthCalledWith(index + 1, {
        actorUserId, sourceMessage: original, ackFamily: family, outcome: 'positive', draft: { family },
      })
    }
    expect(ports.rpc).not.toHaveBeenCalled()
  })

  it('stops before draft or ACK effects when the guide is not yet effective', async () => {
    const original = source('2026-03-31T21:59:59.999Z')
    await expect(createAutomaticAcksForInboundMessage({ actorUserId, sourceMessage: original })).rejects.toThrow(
      /ediel_guide_resolution_missing:PRODAT:2026-03-31/,
    )
    expect(ports.prepare).not.toHaveBeenCalled()
    expect(ports.create).not.toHaveBeenCalled()
    expect(ports.rpc).not.toHaveBeenCalled()
  })
})
