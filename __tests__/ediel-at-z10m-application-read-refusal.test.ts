// AT-Z10M-SUPPLIER component evidence only: declared SDK responses exercise
// real service-read/binding/staging gates. No native, SQL/RLS or owner authority.
import { beforeEach, expect, it, vi } from 'vitest'
import { createOrUpdateInboundProdatCase } from '@/lib/ediel/inboundCases'
import { projectProdatRegisterValidation } from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import { projectProdatApplicationObjects } from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { evidenceHash } from '@/lib/ediel/utilts/durableSourceDiscovery'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'

const ports = vi.hoisted(() => ({
  rpc: vi.fn(), abortSignal: vi.fn(), from: vi.fn(), event: vi.fn(),
  forbidden: vi.fn((name: string) => { throw new Error('Unexpected application IO: ' + name) }),
  reply: { data: null, error: null } as { data: Record<string, unknown> | null; error: unknown },
  inserted: null as Record<string, unknown> | null,
  sequence: [] as string[],
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc, from: ports.from } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: () => ports.forbidden('tenantDb') }))
vi.mock('@/lib/ediel/db', () => ({
  createEdielMessageEvent: ports.event,
  getEdielMessageById: () => ports.forbidden('getEdielMessageById'),
  linkEdielMessage: () => ports.forbidden('linkEdielMessage'),
}))
vi.mock('@/lib/customers/canonicalOnboarding', () => ({
  canonicalIdempotencyKey: () => ports.forbidden('canonicalIdempotencyKey'),
  onboardCustomerGraph: () => ports.forbidden('onboardCustomerGraph'),
}))
vi.mock('@/lib/ediel/safeApplyReview', () => ({
  approveSafeMasterdataChanges: () => ports.forbidden('approveSafeMasterdataChanges'),
}))
vi.mock('@/lib/ediel/flows/receivedProdatStructuralAcks', () => ({
  createReceivedProdatStructuralAcks: () => ports.forbidden('createReceivedProdatStructuralAcks'),
}))
vi.mock('@/lib/ediel/services/authorization', () => ({
  assertEdielTenantActor: () => ports.forbidden('assertEdielTenantActor'),
}))

const companyId = '00000000-0000-4000-8000-000000000002'
const sourceId = '00000000-0000-4000-8000-000000000001'
const assessmentId = '00000000-0000-4000-8000-000000000003'
const actorId = '00000000-0000-4000-8000-000000000004'
const caseId = '00000000-0000-4000-8000-000000000005'

// Existing independent native changeWire body, fixed synthetic wire values.
// Supplied register cells are serialization data, never receiver-owned facts.
function sourceWire() {
  const body: Parts[] = [
    ['NAD', 'FR', ['12345', '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    ['NAD', 'DO', ['54321', '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', '735123456789012345', '1', '9'),
    ['DTM', ['157', '202610010000', '203']], ['DTM', ['354', '15', '806']],
    ...characteristic('Z13', 'E58'), ...characteristic('Z04', 'Z04'),
    ...characteristic('Z12', 'D', 3), ...characteristic('Z15', 'Z32'),
    ...characteristic('Z14', 'L639Q', 3), ...characteristic('Z16', '101', 3),
    ...characteristic('Z02', '1', 3), ...characteristic('Z05', '6', 3),
    ['RFF', ['MG', 'NEW-METER']], ['RFF', ['Z02', 'METER-1']],
    ['RFF', ['Z05', 'NET']], ['RFF', ['LI', 'M-DECLARED-UNIT']],
    ['NAD', 'Z02', ['54321', '160', 'SVK']],
    line('2', '735123456789012345', '2', '9'),
    ...characteristic('Z16', '102', 3), ...characteristic('Z02', '1', 3),
    ...characteristic('Z05', '6', 3),
  ]
  return raw(body, 'Z10')
}

function input() {
  const message = {
    id: sourceId, company_id: companyId, direction: 'inbound',
    message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z10',
    environment: 'test', status: 'received', raw_payload: sourceWire(),
    parsed_payload: { applicationDecision: 'accepted', businessAccepted: true,
      structuralSourceReview: { assessmentId: 'foreign-public-claim', objects: [] } },
    validation_report: { applicationDecision: 'accepted' },
  } as unknown as EdielMessageRow
  const tokens = tokenizeEdifact(message.raw_payload!)
  // Pure projections construct the declared RPC shape; completeInvocation is
  // declared test boundary data, not an executed qualified field invocation.
  const register = projectProdatRegisterValidation({
    code: 'Z10', rawSegments: tokens.segments.map(segment => segment.raw), una: tokens.una,
    registerIssues: [], fieldIssues: [], completeRuleSelection: true,
    handledFields: new Set(['314', '209', '258']),
  })
  const application = projectProdatApplicationObjects({
    register, issues: [], completeInvocation: true,
  })
  const response = {
    ...application, sourcePayloadHash: evidenceHash(message.raw_payload!), assessmentId,
  }
  return { message, response }
}

beforeEach(() => {
  vi.clearAllMocks()
  ports.reply = { data: null, error: null }
  ports.inserted = null
  ports.sequence = []
  ports.rpc.mockImplementation(() => {
    ports.sequence.push('rpc')
    return { abortSignal: ports.abortSignal }
  })
  ports.abortSignal.mockImplementation(() => {
    ports.sequence.push('abortSignal')
    return Promise.resolve(ports.reply)
  })
  ports.from.mockImplementation((table: string) => {
    ports.sequence.push('from:' + table)
    if (table !== 'ediel_inbound_cases') return ports.forbidden('table:' + table)
    return {
      select: (columns: string) => {
        expect(columns).toBe('*')
        return { eq: (column: string, value: unknown) => {
          expect([column, value]).toEqual(['ediel_message_id', sourceId])
          return { maybeSingle: async () => ({ data: null, error: null }) }
        } }
      },
      insert: (payload: Record<string, unknown>) => {
        ports.sequence.push('insert')
        ports.inserted = structuredClone(payload)
        return { select: (columns: string) => {
          expect(columns).toBe('*')
          return { single: async () => ({ data: { ...payload, id: caseId }, error: null }) }
        } }
      },
    }
  })
  ports.event.mockImplementation(async () => { ports.sequence.push('event') })
})

function expectReadBoundary() {
  expect(ports.rpc.mock.calls).toEqual([[
    'ediel_read_prodat_application_objects_v1',
    { p_company_id: companyId, p_source_message_id: sourceId },
  ]])
  expect(ports.abortSignal).toHaveBeenCalledTimes(1)
  expect(ports.abortSignal.mock.calls[0]).toEqual([expect.any(AbortSignal)])
  expect(ports.forbidden).not.toHaveBeenCalled()
}

async function expectRefusal(message: EdielMessageRow) {
  const before = structuredClone(message)
  const responseBefore = structuredClone(ports.reply)
  await expect(createOrUpdateInboundProdatCase({ actorUserId: actorId, message }))
    .rejects.toThrow('structural_apply_complete_own_application_required')
  expectReadBoundary()
  expect(ports.from).not.toHaveBeenCalled()
  expect(ports.inserted).toBeNull()
  expect(ports.event).not.toHaveBeenCalled()
  expect(ports.sequence).toEqual(['rpc', 'abortSignal'])
  expect(message).toEqual(before)
  expect(ports.reply).toEqual(responseBefore)
}

it('stages a source-bound declared response through the real case consumer', async () => {
  const { message, response } = input()
  const before = structuredClone(message)
  const responseBefore = structuredClone(response)
  ports.reply = { data: response, error: null }
  const result = await createOrUpdateInboundProdatCase({ actorUserId: actorId, message })
  expectReadBoundary()
  expect(response.objects).toMatchObject([{
    objectId: '735123456789012345', identityAgency: '9',
    registers: [{ lineIndex: 0, lineNumber: '1', registerIndex: '1', registerPosition: 1 },
      { lineIndex: 1, lineNumber: '2', registerIndex: '2', registerPosition: 2 }],
  }])
  expect(ports.from.mock.calls).toEqual([['ediel_inbound_cases'], ['ediel_inbound_cases']])
  expect(result).toMatchObject({
    id: caseId, company_id: companyId, ediel_message_id: sourceId,
    status: 'pending_review', customer_id: null, site_id: null, metering_point_id: null,
    match_confidence: 0, created_by: actorId, updated_by: actorId,
    proposed_action: { structuralSourceReview: {
      version: 1, assessmentId,
      objects: [{ objectId: '735123456789012345', identityAgency: '9',
        lineIndex: expect.any(Number), applicationDecision: 'accepted' }],
    } },
  })
  // The consumer stores the first physical LIN segment index, not register ordinal.
  expect((ports.inserted!.proposed_action as Record<string, unknown>).structuralSourceReview)
    .toMatchObject({ objects: [{ lineIndex: 7 }] })
  expect(ports.event.mock.calls).toEqual([[expect.objectContaining({
    actorUserId: actorId, edielMessageId: sourceId,
    eventType: 'manual_note', eventStatus: 'warning',
    payload: expect.objectContaining({ inboundCaseId: caseId,
      match: { customerId: null, siteId: null, meteringPointId: null, confidence: 0 } }),
  })]])
  expect(ports.sequence).toEqual([
    'rpc', 'abortSignal', 'from:ediel_inbound_cases', 'from:ediel_inbound_cases', 'insert', 'event',
  ])
  expect(message).toEqual(before)
  expect(response).toEqual(responseBefore)
})

it.each(['error', 'missing'] as const)('refuses RPC %s before staging despite public accepted flags', async kind => {
  const { message, response } = input()
  // A non-null SDK error dominates even otherwise valid declared returned data.
  ports.reply = kind === 'error'
    ? { data: response, error: { code: 'DECLARED_SERVICE_REFUSAL', message: 'declared SDK refusal' } }
    : { data: null, error: null }
  await expectRefusal(message)
})

it.each(['source hash', 'second register scope'] as const)('refuses mismatched returned %s before staging', async kind => {
  const { message, response } = input()
  if (kind === 'source hash') response.sourcePayloadHash = 'f'.repeat(64)
  else response.objects[0].registers[1] = structuredClone(response.objects[0].registers[0])
  ports.reply = { data: response, error: null }
  await expectRefusal(message)
})
