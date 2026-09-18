import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'
import type { EdielTgtExpectedStep, EdielTgtRunEvaluation, EdielTgtTestCaseDefinition } from '@/lib/ediel/testing/tgtRegistry'
const io = vi.hoisted(() => ({ from: vi.fn(), runs: vi.fn(), messages: vi.fn(), links: vi.fn(), byIds: vi.fn(),
  create: vi.fn(), attach: vi.fn(), evaluate: vi.fn(), next: vi.fn(), runtime: vi.fn(), source: vi.fn(),
  staticSource: vi.fn(), readFacts: vi.fn(), build: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/ediel/db', () => ({ listEdielTestRuns: io.runs, listEdielMessages: io.messages,
  listEdielTestRunMessages: io.links, listEdielMessagesByIds: io.byIds,
  createEdielMessage: io.create, attachEdielMessageToTestRun: io.attach }))
vi.mock('@/lib/ediel/testing/tgtRegistry', () => ({ evaluateEdielTgtRun: io.evaluate, getEdielTgtNextAction: io.next, getEdielTgtTestCaseByCode: vi.fn() }))
vi.mock('@/lib/ediel/systemTestSettings', () => ({ requireEdielSystemTestRuntimeContext: io.runtime }))
vi.mock('@/lib/ediel/testing/tgtTestDataStore', () => ({ getEdielTgtDynamicTestDataForCase: io.source }))
vi.mock('@/lib/ediel/testing/tgtTestData', () => ({ getEdielTgtTestDataForCase: io.staticSource }))
vi.mock('@/lib/ediel/testing/tgtRegisterFacts', () => ({ readTgtRegisterFacts: io.readFacts }))
vi.mock('@/lib/ediel/testing/tgtEdifact', () => ({ buildEdielTgtDraft: io.build }))
import { runTgtAutopilotForRun, createMockPortalMessageForNextStep, autoAttachImportedMessageToActiveTgtRun } from '@/lib/ediel/testing/tgtAutopilot'

const args = { actorUserId: 'operator', companyId: 'tenant-a', testRunId: 'run-a' }
const step: EdielTgtExpectedStep = { stepNo: 4, actor: 'gridex', direction: 'outbound', family: 'PRODAT', code: 'Z04', required: true, title: 'Register exchange', description: 'Synthetic register workflow' }
let run: EdielTestRunRow
let evaluation: EdielTgtRunEvaluation
let draft: { step: EdielTgtExpectedStep; validationIssues: Array<{ severity: string; title: string; description: string }>; messageInput: Record<string, unknown> }
let route: { data: Record<string, unknown> | null; error: Error | null }
let filters: Array<[string, unknown]>
const incoming = (overrides: Partial<EdielMessageRow> = {}) => ({ id: 'inbound', company_id: 'tenant-a', environment: 'test', test_flag: 1,
  direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04', status: 'received', ack_outcome: null, ...overrides }) as EdielMessageRow

beforeEach(() => {
  vi.clearAllMocks()
  run = { id: 'run-a', company_id: 'tenant-a', test_suite: 'PRODAT', role_code: 'supplier', test_case_code: '1.2.5', status: 'running', notes: 'source-bound' } as EdielTestRunRow
  evaluation = { testRun: run, definition: { suite: 'PRODAT', roleCode: 'supplier', testCaseCode: '1.2.5', expectedSteps: [step] } as EdielTgtTestCaseDefinition,
    matches: [], passedSteps: 0, requiredSteps: 1, missingRequiredSteps: 1, hasMismatch: false, computedStatus: 'in_progress' }
  draft = { step, validationIssues: [], messageInput: { companyId: 'tenant-a', mailbox: 'test-mail', validationReport: { preserved: true } } }
  io.runs.mockResolvedValue([run]); io.messages.mockResolvedValue([]); io.links.mockResolvedValue([]); io.byIds.mockResolvedValue([])
  io.evaluate.mockImplementation(() => evaluation); io.next.mockReturnValue({ kind: 'create_file', stepNo: 4, description: 'next' })
  io.source.mockResolvedValue(null); io.staticSource.mockReturnValue({ sourceNote: 'fixture' }); io.readFacts.mockReturnValue({ market: 'electricity', registerObjects: [] })
  io.runtime.mockResolvedValue({ companyId: 'tenant-a', actorEdielId: '92825', testPortalEdielId: '10000', senderSubaddress: 'DDQ', defaultReceiverSubaddress: 'DDQ', testPortalEmail: 'test@example.invalid' })
  io.build.mockImplementation(() => draft); io.create.mockResolvedValue({ id: 'draft-a' }); io.attach.mockResolvedValue(undefined)
  route = { data: null, error: null }; filters = []
  const query = { select: vi.fn(() => query), eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return query }), maybeSingle: vi.fn(async () => route) }
  io.from.mockReturnValue(query)
})

// Real orchestration with external DB/source/builder boundaries mocked. No
// network send or live database call is available from these tests.
describe('register autopilot orchestration and transport boundary', () => {
  it.each(['missing', 'other-tenant'])('rejects a %s run before runtime or draft construction', async (kind) => {
    io.runs.mockResolvedValue(kind === 'missing' ? [] : [{ ...run, company_id: 'tenant-b' }])
    await expect(runTgtAutopilotForRun(args)).rejects.toThrow('TGT-run saknas')
    expect(io.runtime).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled()
  })
  it('loads older linked evidence with a company scope, deduplicates it and supplies explicit IDs', async () => {
    const stale = incoming({ id: 'linked', status: 'draft' })
    const current = { ...stale, status: 'received' }
    io.messages.mockResolvedValue([stale, incoming({ id: 'other' })]); io.links.mockResolvedValue([{ ediel_message_id: 'linked' }]); io.byIds.mockResolvedValue([current])
    await runTgtAutopilotForRun(args)
    expect(io.runs).toHaveBeenCalledWith({ scope: 'tenant', companyId: 'tenant-a' })
    expect(io.byIds).toHaveBeenCalledWith(['linked'], { companyId: 'tenant-a' })
    expect(io.evaluate).toHaveBeenCalledWith(run, [current, expect.objectContaining({ id: 'other' })], { explicitMessageIds: ['linked'] })
  })
  it('does not construct drafts for unmapped, completed or actionless runs', async () => {
    evaluation.definition = null
    expect((await runTgtAutopilotForRun(args)).action).toBe('blocked')
    evaluation.definition = { expectedSteps: [step] } as EdielTgtTestCaseDefinition
    io.next.mockReturnValue({ kind: 'complete', stepNo: null })
    expect((await runTgtAutopilotForRun(args)).action).toBe('complete')
    io.next.mockReturnValue({ kind: 'not_mapped', stepNo: null, description: 'Blocked source' })
    expect(await runTgtAutopilotForRun(args)).toMatchObject({ action: 'blocked', description: 'Blocked source' })
    expect(io.build).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled()
  })
  it('treats an inconsistent next step as an error, not successful completion', async () => {
    io.next.mockReturnValue({ stepNo: 99 })
    await expect(runTgtAutopilotForRun(args)).rejects.toThrow('Steg 99')
    expect(io.create).not.toHaveBeenCalled()
  })
  it('waits for real portal evidence instead of creating a simulated response automatically', async () => {
    evaluation.definition!.expectedSteps = [{ ...step, actor: 'portal', direction: 'inbound' }]
    expect(await runTgtAutopilotForRun(args)).toMatchObject({ action: 'waiting_for_portal_file', stepNo: 4, messageId: null })
    expect(io.create).not.toHaveBeenCalled(); expect(io.runtime).not.toHaveBeenCalled()
  })
  it('locks a draft to its tenant-owned run route and preserves existing validation evidence', async () => {
    run.route_profile_id = 'profile-a'; run.encryption_mode = 'none'
    route.data = { communication_route_id: 'route-a', mailbox: 'bound-mail', encryption_mode: 'none', certificate_id: 'cert-a' }
    expect((await runTgtAutopilotForRun(args)).action).toBe('created_gridex_draft')
    expect(filters).toEqual([['id', 'profile-a'], ['company_id', 'tenant-a']])
    expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ communicationRouteId: 'route-a', mailbox: 'bound-mail', validationReport: {
      preserved: true, lockedSendContext: expect.objectContaining({ testRunId: 'run-a', routeProfileId: 'profile-a', communicationRouteId: 'route-a', certificateId: 'cert-a' }),
    } }))
    expect(io.attach).toHaveBeenCalledWith({ companyId: 'tenant-a', testRunId: 'run-a', edielMessageId: 'draft-a', stepNo: 4, expectedDirection: 'outbound', expectedFamily: 'PRODAT', expectedCode: 'Z04' })
  })
  it('propagates route lookup errors before persistence', async () => {
    run.route_profile_id = 'profile-a'; route.error = new Error('route lookup failed')
    await expect(runTgtAutopilotForRun(args)).rejects.toThrow('route lookup failed')
    expect(io.create).not.toHaveBeenCalled(); expect(io.attach).not.toHaveBeenCalled()
  })
  it('does not invent route bindings for an absent route row', async () => {
    run.route_profile_id = 'profile-a'
    await runTgtAutopilotForRun(args)
    expect(io.create.mock.calls[0][0]).not.toHaveProperty('communicationRouteId')
    expect(io.create.mock.calls[0][0].validationReport).toEqual({ preserved: true })
  })
  it('blocks builder errors but retains warnings; uses static source only when no dynamic source exists', async () => {
    draft.validationIssues = [{ severity: 'error', title: 'Missing register evidence', description: 'Unknown readings' }]
    expect(await runTgtAutopilotForRun(args)).toMatchObject({ action: 'blocked', description: expect.stringContaining('Missing register evidence') })
    expect(io.create).not.toHaveBeenCalled()
    expect(io.readFacts).toHaveBeenCalledWith(expect.objectContaining({ testData: { sourceNote: 'fixture' } }))
    draft.validationIssues[0].severity = 'warning'
    io.source.mockResolvedValue({ sourceNote: 'imported' }); io.staticSource.mockClear()
    expect((await runTgtAutopilotForRun(args)).action).toBe('created_gridex_draft')
    expect(io.staticSource).not.toHaveBeenCalled()
    expect(io.readFacts).toHaveBeenLastCalledWith(expect.objectContaining({ testData: { sourceNote: 'imported' } }))
  })
  it.each(['PRODAT_REGISTER_FACTS_INVALID', 'prodat_register_condition_undetermined'])('blocks %s without creating a transport record', async (failure) => {
    io.readFacts.mockImplementation(() => { throw failure })
    expect(await runTgtAutopilotForRun(args)).toMatchObject({ action: 'blocked', description: expect.stringContaining(failure) })
    expect(io.create).not.toHaveBeenCalled()
  })
  it('does not turn unexpected storage or runtime failures into a harmless register warning', async () => {
    io.runtime.mockRejectedValueOnce(new Error('runtime unavailable'))
    await expect(runTgtAutopilotForRun(args)).rejects.toThrow('runtime unavailable')
    io.create.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(runTgtAutopilotForRun(args)).rejects.toThrow('storage unavailable')
    expect(io.attach).not.toHaveBeenCalled()
  })
  it('does not attempt PRODAT register-fact extraction for a CONTRL step', async () => {
    evaluation.definition!.expectedSteps = [{ ...step, family: 'CONTRL', code: 'CONTRL' }]
    await runTgtAutopilotForRun(args)
    expect(io.readFacts).not.toHaveBeenCalled()
    expect(io.build).toHaveBeenCalledWith(expect.objectContaining({ registerFacts: undefined }))
  })
})

describe('explicit internal simulation of register-flow portal steps', () => {
  it('rejects simulation when no portal step is available', async () => {
    expect((await createMockPortalMessageForNextStep(args)).action).toBe('blocked')
    evaluation.definition = null
    expect((await createMockPortalMessageForNextStep(args)).action).toBe('blocked')
    expect(io.create).not.toHaveBeenCalled()
  })
  it('rejects a nonexistent step before making synthetic evidence', async () => {
    io.next.mockReturnValue({ stepNo: 99 })
    await expect(createMockPortalMessageForNextStep(args)).rejects.toThrow('Steg 99')
    expect(io.create).not.toHaveBeenCalled()
  })
  it.each(['PRODAT', 'CONTRL', 'APERAK'] as const)('marks simulated %s as inbound test-only and binds it to the prior message', async family => {
    const portalStep: EdielTgtExpectedStep = { ...step, actor: 'portal', direction: 'inbound', family, code: family === 'PRODAT' ? 'Z04' : family, outcome: family === 'PRODAT' ? undefined : 'positive' }
    evaluation.definition!.expectedSteps = [portalStep]
    evaluation.matches = [{ step: { ...step, stepNo: 1 }, status: 'passed', issues: [], message: incoming({ id: 'prior', interchange_reference: 'prior-interchange' }) }]
    const result = await createMockPortalMessageForNextStep(args)
    expect(result).toMatchObject({ action: 'created_mock_portal_message', messageId: 'draft-a', stepNo: 4 })
    const input = io.create.mock.calls[0][0]
    expect(input).toMatchObject({ companyId: 'tenant-a', actorUserId: 'operator', direction: 'inbound', environment: 'test', testFlag: 1, transportType: 'manual_upload',
      mailbox: 'tgt-mock-portal', status: 'received', relatedMessageId: 'prior', requiresContrl: false, requiresAperak: false,
      parsedPayload: expect.objectContaining({ mockOnly: true, testRunId: 'run-a' }), validationReport: expect.objectContaining({ mockOnly: true, warning: expect.stringContaining('inte skickas') }),
    })
    expect(input.rawPayload).toContain('UNZ+1+'); expect(input.subject).toContain('[MOCK]')
    expect(io.attach).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'tenant-a', expectedFamily: family, expectedDirection: 'inbound' }))
    expect(io.create).toHaveBeenCalledTimes(1)
  })
  it('retains negative outcome and no fabricated related record when there is no previous message', async () => {
    evaluation.definition!.expectedSteps = [{ ...step, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', outcome: 'negative' }]
    io.runtime.mockResolvedValue({ actorEdielId: '92825', testPortalEdielId: '10000' })
    await createMockPortalMessageForNextStep(args)
    expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ ackOutcome: 'negative', relatedMessageId: null, parsedPayload: expect.objectContaining({ ackOutcome: 'negative', mockOnly: true }) }))
    expect(io.build).not.toHaveBeenCalled()
  })
})

describe('linking imported register messages to tenant-owned test runs', () => {
  it.each([{ company_id: 'tenant-b' }, { environment: 'production' }, { test_flag: 0 }])('rejects out-of-scope evidence %j before a database lookup', async overrides => {
    await expect(autoAttachImportedMessageToActiveTgtRun({ companyId: 'tenant-a', edielMessage: incoming(overrides as Partial<EdielMessageRow>) })).rejects.toThrow()
    expect(io.runs).not.toHaveBeenCalled(); expect(io.attach).not.toHaveBeenCalled()
  })
  it('links only a matching inbound portal step on the explicit active case', async () => {
    const portal = { ...step, actor: 'portal', direction: 'inbound' }
    evaluation.definition!.expectedSteps = [step, portal] as EdielTgtExpectedStep[]
    const other = { ...run, id: 'other-run', test_case_code: '1.2.6' }
    io.runs.mockResolvedValue([other, { ...run, id: 'closed', status: 'passed' }, run])
    const result = await autoAttachImportedMessageToActiveTgtRun({ companyId: 'tenant-a', edielMessage: incoming(), explicitTestCaseCode: ' 1.2.5 ' })
    expect(result).toMatchObject({ action: 'linked_imported_message', testRunId: 'run-a', messageId: 'inbound' })
    expect(io.attach).toHaveBeenCalledTimes(1)
    expect(io.attach).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'tenant-a', testRunId: 'run-a', expectedCode: 'Z04' }))
  })
  it.each([{ direction: 'outbound' }, { message_family: 'CONTRL' }, { message_code: 'Z06' }])('does not link a mismatched message %j', async overrides => {
    evaluation.definition!.expectedSteps = [{ ...step, actor: 'portal', direction: 'inbound' }]
    expect(await autoAttachImportedMessageToActiveTgtRun({ companyId: 'tenant-a', edielMessage: incoming(overrides as Partial<EdielMessageRow>) })).toBeNull()
    expect(io.attach).not.toHaveBeenCalled()
  })
  it('does not fall back to another case when explicit source identity has no matching run', async () => {
    evaluation.definition!.expectedSteps = [{ ...step, actor: 'portal', direction: 'inbound' }]
    expect(await autoAttachImportedMessageToActiveTgtRun({ companyId: 'tenant-a', edielMessage: incoming(), explicitTestCaseCode: '2.1.1' })).toBeNull()
    expect(io.attach).not.toHaveBeenCalled()
    evaluation.definition = null
    expect(await autoAttachImportedMessageToActiveTgtRun({ companyId: 'tenant-a', edielMessage: incoming() })).toBeNull()
  })
  it('does not attach an explicitly wrong ACK outcome to a portal step', async () => {
    evaluation.definition!.expectedSteps = [{ ...step, actor: 'portal', direction: 'inbound', family: 'APERAK', code: 'APERAK', outcome: 'positive' }]
    expect(await autoAttachImportedMessageToActiveTgtRun({ companyId: 'tenant-a', edielMessage: incoming({ message_family: 'APERAK', message_code: 'APERAK', ack_outcome: 'negative' }) })).toBeNull()
    expect(io.attach).not.toHaveBeenCalled()
  })
})
