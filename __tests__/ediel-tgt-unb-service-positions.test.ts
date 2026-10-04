import { beforeEach, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { canonicalAckRequirementsForFamilyCode } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import { reportingId, reportingPrepared } from './fixtures/prodat-reporting-permission'
import { buildInterchange } from '@/lib/ediel/testing/tgtEdifact.part-2'
import type { DraftReferences } from '@/lib/ediel/testing/tgtEdifact.part-1'

// Only the synthetic mock-portal database/evaluation boundary is substituted.
// Both real TGT producers and the shared envelope/ACK authorities execute.
const io = vi.hoisted(() => ({ run: {} as Record<string, unknown>, step: {} as Record<string, unknown>, create: vi.fn(), runtime: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/ediel/db', async original => ({ ...await original<typeof import('@/lib/ediel/db')>(),
  listEdielTestRuns: async () => [io.run], listEdielMessages: async () => [], listEdielTestRunMessages: async () => [], listEdielMessagesByIds: async () => [],
  createEdielMessage: io.create, attachEdielMessageToTestRun: async () => undefined,
}))
vi.mock('@/lib/ediel/testing/tgtRegistry', async original => ({ ...await original<typeof import('@/lib/ediel/testing/tgtRegistry')>(),
  evaluateEdielTgtRun: () => ({ testRun: io.run, matches: [], definition: { suite: 'PRODAT', roleCode: 'esco', testCaseCode: '8.1.3', expectedSteps: [io.step] } }),
  getEdielTgtNextAction: () => ({ stepNo: 1, action: 'wait_for_portal', description: 'Declared synthetic portal step' }),
}))
vi.mock('@/lib/ediel/systemTestSettings', () => ({ requireEdielSystemTestRuntimeContext: io.runtime }))
import { createMockPortalMessageForNextStep } from '@/lib/ediel/testing/tgtAutopilot'

const refs: DraftReferences = { interchangeRef: 'PREALLOCATED14', messageRef: 'OWNMSG', transactionRef: 'TX', externalRef: 'DOC', originalInterchangeRef: 'OLD', originalMessageRef: 'OLDMSG',
  createdDate: '260919', createdTime: '1200', createdLongDate: '20260919' }
const families = ['PRODAT', 'UTILTS', 'UTILTS_ERR', 'APERAK', 'CONTRL'] as const
beforeEach(() => {
  vi.clearAllMocks()
  const p = reportingPrepared()
  io.run = p.run
  io.runtime.mockResolvedValue(p.runtime)
  io.create.mockResolvedValue({ id: reportingId(99) })
})

for (const family of families) it(`actual ${family} TGT draft preserves APP/0031 and puts 0035 in physical element11`, () => {
  const raw = buildInterchange({ refs, family, version: family === 'UTILTS' ? 'E5SE5A' : 'E2SE6A', senderEdielId: '12345', receiverEdielId: '54321',
    senderSubAddress: 'OWN', receiverSubAddress: 'REMOTE', applicationReference: '23-DGI-PRODAT', bodySegments: ['BGM+Z13+DOC+9+AB'] })
  const wire = EdifactEnvelopeCodec.decode(raw), unb = wire.segments.find(s => s.tag === 'UNB')!
  expect(unb.elements[7]).toBe('23-DGI-PRODAT')
  expect(unb.elements[9]).toBe(canonicalAckRequirementsForFamilyCode({ family, code: 'Z13' }).requiresContrl ? '1' : '')
  expect(unb.elements[10]).toBe('')
  expect(unb.elements[11]).toBe('1')
  expect(wire.environment).toBe('test')
  expect(wire.interchangeReference).toBe(refs.interchangeRef)
  expect([wire.date, wire.time]).toEqual([refs.createdDate, refs.createdTime])
  expect(wire.segments.find(s => s.tag === 'UNT')?.elements.slice(1)).toEqual(['3', refs.messageRef])
})

for (const family of families) it(`actual ${family} mock-portal producer uses the same service positions`, async () => {
  io.step = { stepNo: 1, actor: 'portal', direction: 'inbound', family, code: family === 'PRODAT' ? 'Z14' : family, outcome: 'positive', title: 'Synthetic source' }
  await createMockPortalMessageForNextStep({ actorUserId: reportingId(12), companyId: reportingId(10), testRunId: reportingId(11) })
  const input = io.create.mock.calls[0][0]
  const wire = EdifactEnvelopeCodec.decode(input.rawPayload), unb = wire.segments.find(s => s.tag === 'UNB')!
  expect(unb.elements[9]).toBe(canonicalAckRequirementsForFamilyCode({ family, code: String(io.step.code) }).requiresContrl ? '1' : '')
  expect(unb.elements[10]).toBe('')
  expect(unb.elements[11]).toBe('1')
  expect(wire.sender).toBe('54321')
  expect(wire.receiver).toBe('12345')
  expect(input.testFlag).toBe(1)
  expect(input.parsedPayload.mockOnly).toBe(true)
})

it('the actual draft serializes technical identifiers as data and holds inconsistent preallocated source clocks', () => {
  const input = { refs, family: 'PRODAT' as const, version: 'E2SE6A', senderEdielId: 'OWN+ONE', receiverEdielId: 'REMOTE:TWO',
    senderSubAddress: "S'ONE", applicationReference: '23-DGI-PRODAT', bodySegments: ['BGM+Z13+DOC+9'] }
  const wire = EdifactEnvelopeCodec.decode(buildInterchange(input))
  expect(wire.sender).toBe('OWN+ONE'); expect(wire.senderSubAddress).toBe("S'ONE"); expect(wire.receiver).toBe('REMOTE:TWO')
  expect(wire.segments.filter(s => s.tag === 'UNB')).toHaveLength(1)
  expect(() => buildInterchange({ ...input, refs: { ...refs, createdDate: '260918' } })).toThrow('tgt_unb_source_clock_required')
})
