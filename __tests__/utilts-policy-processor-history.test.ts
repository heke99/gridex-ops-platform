// FINDINGS F80 (policy processor): a (re)run of a non-billing inbound UTILTS
// source through processInboundUtiltsMessageByCanonicalPolicy replaces
// validation_report.utiltsRuntime but keeps the previous runtime in the
// append-only validation_report.utiltsRuntimeHistory (same helper as the actual
// metering path). Collaborators are mocked; synthetic data only.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  get: vi.fn(), update: vi.fn(), event: vi.fn(), acks: vi.fn(), authorize: vi.fn(), actual: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.authorize }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get, updateEdielMessageStatus: io.update, createEdielMessageEvent: io.event }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/ediel/core/messagePolicy', () => ({ resolveCanonicalMessagePolicy: vi.fn() }))
vi.mock('@/lib/ediel/core/runtimeDecision', () => ({
  readCanonicalPeriodicReasonAuthority: () => null,
  readCanonicalUtiltsIssuerIdentityAuthority: () => null,
}))
vi.mock('@/lib/ediel/flows/utiltsCanonicalValidation', () => ({
  initialCanonicalUtiltsDecision: vi.fn(async () => ({ policy: POLICY })),
  holdCanonicalEvidenceGateBlocked: vi.fn(async () => false),
  recordFinalCanonicalUtiltsDecision: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ediel/rulebook/utiltsAckPolicy', () => ({ applyCertifiedUtiltsAckPolicy: () => ({ reason: 'certified', contrl: true }) }))
vi.mock('@/lib/ediel/utilts/inboundBusinessOutcome', () => ({
  resolveUtiltsInboundBusinessOutcome: () => ({
    kind: 'reference_data', allowBillingConsumption: false, allowMeteringValueIngest: false,
    allowIndividualCustomerLink: false, requireGridAreaScope: true,
  }),
}))
vi.mock('@/lib/ediel/utilts/transactionPersistence', () => ({
  buildUtiltsTransactionPersistencePayload: vi.fn(() => []),
  persistUtiltsTransactionResults: vi.fn(async () => []),
  resolveUtiltsTransactionId: (id: string | null, index: number) => id ?? `TX${index}`,
}))
vi.mock('@/lib/ediel/utiltsEngine', () => ({
  runUtiltsRuntimeForMessage: vi.fn(() => RUNTIME),
  utiltsRuntimeSegments: vi.fn(() => []),
}))
vi.mock('@/lib/ediel/utilts/qualifyReceivedStructure', () => ({
  qualifyReceivedUtiltsStructure: vi.fn(async () => ({ runtime: RUNTIME, hasInternalReview: false, hasNationalMismatch: false, evidence: {} })),
}))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', () => ({
  createUtiltsRuntimeAcks: io.acks,
  resolveUtiltsRuntimeTestCaseCode: vi.fn(async () => null),
  stringOrNull: (value: unknown) => (typeof value === 'string' && value ? value : null),
}))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-2', () => ({ processInboundUtiltsMessage: io.actual }))
vi.mock('@/lib/ediel/utilts/consumptionPreparation', () => ({ prepareUtiltsConsumptionContracts: vi.fn(async () => []) }))

const POLICY = vi.hoisted(() => ({
  family: 'UTILTS', direction: 'inbound', code: 'S02', profileKey: 'utilts-s02', processGroup: 'reference',
  guide: { guideRevision: 'r1' }, semantics: { dataScope: 'grid_area' },
}))
const RUNTIME = vi.hoisted(() => ({
  transactionDispositions: [],
  validation: { classification: 'accepted', ok: true },
  normalizedPayload: {},
  facts: { transactions: [] },
  ackPlan: { reason: 'runtime' },
}))

import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import type { UtiltsRuntimeHistoryEntry } from '@/lib/ediel/utilts/utiltsResumability'

const ACTOR = 'actor-user-1'
const SOURCE_ID = '44444444-4444-4444-8444-000000000001'

function source(validationReport: Record<string, unknown>) {
  return {
    id: SOURCE_ID, company_id: 'company-a', environment: 'test', direction: 'inbound', message_family: 'UTILTS',
    message_code: 'S02', status: 'validated', customer_id: null, site_id: null, metering_point_id: null,
    raw_payload: 'UNA:+.? \'', parsed_payload: {}, parsed_at: '2026-10-21T10:00:00Z', validation_report: validationReport,
  }
}

type UpdateInput = { validationReport: Record<string, unknown> }
const lastValidationReport = () => (io.update.mock.calls.at(-1)?.[0] as UpdateInput).validationReport

beforeEach(() => {
  vi.clearAllMocks()
  io.authorize.mockResolvedValue(undefined)
  io.event.mockResolvedValue(null)
  io.update.mockImplementation(async (input: UpdateInput) => ({ ...source(input.validationReport) }))
})

it('keeps the previous utiltsRuntime (e.g. an internal-review hold) in an append-only history on rerun', async () => {
  const heldRuntime = { validation: { classification: 'internal_review' }, ackPlan: { reason: 'held' }, createdAckMessageIds: ['contrl-1'] }
  const olderEntry: UtiltsRuntimeHistoryEntry = { supersededAt: '2026-10-20T09:00:00.000Z', supersededByActorUserId: 'earlier-actor', runtime: { first: true } }
  io.get.mockResolvedValue(source({ utiltsRuntime: heldRuntime, utiltsRuntimeHistory: [olderEntry], unrelated: 'kept' }))
  io.acks.mockResolvedValue(['aperak-2'])

  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: ACTOR, edielMessageId: SOURCE_ID })

  expect(io.actual).not.toHaveBeenCalled()
  expect(io.update).toHaveBeenCalledTimes(1)
  const report = lastValidationReport()
  expect(report.unrelated).toBe('kept')
  expect(report.utiltsRuntime).toMatchObject({ createdAckMessageIds: ['aperak-2'], validation: RUNTIME.validation })
  const history = report.utiltsRuntimeHistory as UtiltsRuntimeHistoryEntry[]
  expect(history).toHaveLength(2)
  expect(history[0]).toEqual(olderEntry)
  expect(history[1]).toEqual({ supersededAt: expect.any(String), supersededByActorUserId: ACTOR, runtime: heldRuntime })
  expect(Number.isNaN(Date.parse(history[1].supersededAt))).toBe(false)
})

it('starts with an empty history on the first run and grows by one entry per later run', async () => {
  io.get.mockResolvedValueOnce(source({}))
  io.acks.mockResolvedValueOnce(['run-1'])
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: ACTOR, edielMessageId: SOURCE_ID })
  const first = lastValidationReport()
  expect(first.utiltsRuntimeHistory).toEqual([])
  expect(first.utiltsRuntime).toMatchObject({ createdAckMessageIds: ['run-1'] })

  io.get.mockResolvedValueOnce(source(first))
  io.acks.mockResolvedValueOnce(['run-2'])
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: 'actor-user-2', edielMessageId: SOURCE_ID })
  const second = lastValidationReport()
  expect(second.utiltsRuntime).toMatchObject({ createdAckMessageIds: ['run-2'] })
  expect(second.utiltsRuntimeHistory).toEqual([
    { supersededAt: expect.any(String), supersededByActorUserId: 'actor-user-2', runtime: first.utiltsRuntime },
  ])

  io.get.mockResolvedValueOnce(source(second))
  io.acks.mockResolvedValueOnce(['run-3'])
  await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: ACTOR, edielMessageId: SOURCE_ID })
  const third = lastValidationReport()
  const history = third.utiltsRuntimeHistory as UtiltsRuntimeHistoryEntry[]
  expect(history.map((entry) => (entry.runtime as { createdAckMessageIds: string[] }).createdAckMessageIds)).toEqual([['run-1'], ['run-2']])
})
