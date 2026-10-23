// reality-defects: F106
// The missed-CONTRL resume re-runs only the technical CONTRL owner of
// processInboundEdielMessage (endpoint -> recorded syntax decision -> captured
// evidence -> canonical CONTRL gateway -> insert-only queued outbox entry) for
// one stored inbound source of the claimed tenant and lane. It never re-runs
// business processing, never acknowledges a CONTRL and never touches another
// tenant's or lane's source. Synthetic rows and named ports only.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { utiltsStructureWire } from './helpers/structuralComparisonFixtures'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  message: null as Row | null,
  calls: [] as string[],
  outbox: [] as Row[],
  endpoint: true,
  existing: null as Row | null,
  createError: null as unknown,
}))

const TENANT = '00000000-0000-4000-8000-0000000f1070'
const ACTOR = '00000000-0000-4000-8000-0000000f10ac'
const SOURCE = '00000000-0000-4000-8000-0000000e6601'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: () => { throw new Error('undeclared rpc') }, from: () => { throw new Error('undeclared table') } } }))
vi.mock('@/lib/ediel/db', () => ({
  getEdielMessageById: async (id: string, options?: { companyId?: string | null }) => {
    const row = io.message
    if (!row || row.id !== id || (options?.companyId && row.company_id !== options.companyId)) return null
    return structuredClone(row)
  },
  createEdielMessageEvent: async (value: Row) => { io.calls.push(`event:${String(value.message)}`); return { id: 'event' } },
}))
vi.mock('@/lib/ediel/services/authorization', () => ({
  assertEdielTenantActor: async (input: { companyId: string; permission: string }) => { io.calls.push(`actor:${input.companyId}:${input.permission}`) },
}))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority', async () => {
  const { createHash } = await import('node:crypto')
  const hash = () => createHash('sha256').update(String(io.message?.raw_payload ?? ''), 'utf8').digest('hex')
  return {
    readEdielTechnicalSourceEndpoint: async (sourceMessageId: string) => {
      io.calls.push('endpoint')
      return io.endpoint ? { sourceMessageId, companyId: TENANT, environment: 'production', sourceHash: hash() } : null
    },
    recordEdielTechnicalSyntaxDecision: async (input: { syntaxDecision: string }) => { io.calls.push(`syntax:${input.syntaxDecision}`) },
    captureEdielTechnicalSyntaxAckEvidence: async () => { io.calls.push('capture'); return { captured: true } },
    technicalSyntaxAckQualification: () => ({ syntaxDecision: 'accepted', sourceHash: hash() }),
  }
})
vi.mock('@/lib/ediel/ack/prepareSourceAckDraft', () => ({
  prepareSourceAckDraft: async (input: { ackFamily: string; outcome: string }) => {
    io.calls.push(`prepare:${input.ackFamily}:${input.outcome}`)
    return io.existing ? { kind: 'existing', message: io.existing } : { kind: 'draft', draft: { rawPayload: 'UNA:+.? \'UNB+...' } }
  },
}))
vi.mock('@/lib/ediel/core/kernel', () => ({
  createCanonicalAckMessage: async (input: { ackFamily: string; outcome?: string; sourceMessage: EdielMessageRow }) => {
    io.calls.push(`create:${input.ackFamily}:${input.outcome}`)
    if (io.createError) throw io.createError
    return { id: 'fresh-contrl', company_id: TENANT, environment: 'production', direction: 'outbound', message_family: 'CONTRL',
      message_code: 'CONTRL', status: 'draft', related_message_id: input.sourceMessage.id, raw_payload: 'UNA:+.? \'UNB+CONTRL' }
  },
}))
vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({
  createOutboxItem: async (input: Row) => { io.outbox.push(input); io.calls.push(`outbox:${String(input.status)}`); return { id: 'outbox' } },
}))

import { resumeInboundTechnicalAck } from '@/lib/ediel/flows/inboundProcessing'

function source(overrides: Row = {}): Row {
  return { id: SOURCE, company_id: TENANT, environment: 'production', direction: 'inbound', message_standard: 'edifact',
    message_family: 'UTILTS', message_code: 'E66', status: 'parsed', processing_status: 'parsed', raw_payload: utiltsStructureWire(),
    sender_ediel_id: '12345', receiver_ediel_id: '54321', validation_report: {}, parsed_payload: {}, ...overrides }
}
const target = { actorUserId: ACTOR, edielMessageId: SOURCE, companyId: TENANT, environment: 'production' as const }

beforeEach(() => {
  io.message = source(); io.calls = []; io.outbox = []; io.endpoint = true; io.existing = null; io.createError = null
})

describe('F106 technical CONTRL owner resume', () => {
  it('creates and queues the missing positive CONTRL through the same technical owner, without business processing', async () => {
    await expect(resumeInboundTechnicalAck(target)).resolves.toEqual({ outcome: 'created', ackMessageId: 'fresh-contrl' })
    expect(io.calls).toEqual(['endpoint', `actor:${TENANT}:communication.write`, 'syntax:accepted', 'capture',
      'prepare:CONTRL:positive', 'create:CONTRL:positive', 'outbox:queued'])
    expect(io.outbox).toEqual([expect.objectContaining({ sourceMessageId: SOURCE, status: 'queued', queueOnlyIfInserted: true,
      message: expect.objectContaining({ id: 'fresh-contrl' }) })])
  })

  it('a protected existing original is returned without a new reply or outbox write', async () => {
    io.existing = { id: 'retained-contrl', company_id: TENANT, environment: 'production', direction: 'outbound', message_family: 'CONTRL',
      related_message_id: SOURCE, raw_payload: 'UNA:+.? \'UNB+CONTRL' }
    await expect(resumeInboundTechnicalAck(target)).resolves.toEqual({ outcome: 'existing', ackMessageId: 'retained-contrl' })
    expect(io.calls.filter((call) => call.startsWith('create:') || call.startsWith('outbox:'))).toEqual([])
  })

  it('a source without technical endpoint gets no reply', async () => {
    io.endpoint = false
    await expect(resumeInboundTechnicalAck(target)).resolves.toEqual({ outcome: 'no_endpoint', ackMessageId: null })
    expect(io.calls).toEqual(['endpoint'])
  })

  it('never acknowledges a CONTRL, a cancelled source, or a source of another tenant or lane', async () => {
    io.message = source({ message_family: 'CONTRL', message_code: 'CONTRL' })
    await expect(resumeInboundTechnicalAck(target)).resolves.toEqual({ outcome: 'not_applicable', ackMessageId: null })
    io.message = source({ status: 'cancelled' })
    await expect(resumeInboundTechnicalAck(target)).resolves.toEqual({ outcome: 'not_applicable', ackMessageId: null })
    io.message = source({ company_id: '00000000-0000-4000-8000-0000000f1071' })
    await expect(resumeInboundTechnicalAck(target)).resolves.toEqual({ outcome: 'not_applicable', ackMessageId: null })
    io.message = source({ environment: 'test' })
    await expect(resumeInboundTechnicalAck(target)).resolves.toEqual({ outcome: 'not_applicable', ackMessageId: null })
    expect(io.calls).toEqual([])
  })

  it('a renewed failure propagates to the resume without an outbox write', async () => {
    io.createError = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    await expect(resumeInboundTechnicalAck(target)).rejects.toThrow('canceling statement due to statement timeout')
    expect(io.outbox).toEqual([])
  })
})
