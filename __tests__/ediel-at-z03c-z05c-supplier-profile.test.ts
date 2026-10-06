// masterplan: AT-Z03C-SUPPLIER, AT-Z05C-SUPPLIER
// Component-only profiles/consumer probes; both whole rows remain NOT_EXECUTED.
// No native restoration, physical ACK, SMTP250 or complete Z04C chain is asserted.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closureFixture, CLOSURE_OBJECT } from './helpers/closureWireFixtures'
import { head, own as switchObject, source } from './fixtures/prodat-identity'
import { characteristic, raw, type Parts } from './fixtures/prodat-register'
import { msg as permissionFixture } from './fixtures/prodat-prior-flow'
import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), event: vi.fn(), notification: vi.fn(), workflow: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: io.notification }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))

import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { validateProdat } from '@/lib/ediel/prodat/validateProdat'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), supply: id(3), permission: id(4) }
const profiles = [{ code: 'Z03', direction: 'outbound', date: '92', field: '210' },
  { code: 'Z05', direction: 'inbound', date: '93', field: '211' }] as const
type Profile = typeof profiles[number]
function message(profile: Profile, count = 2) {
  const wire = profile.code === 'Z05'
    ? closureFixture({ reason: 'Z24', minute: '202610150000', li: 'OWN-CANCEL-LI', count }).wire
    : raw([...head(), ...Array.from({ length: count }, (_, index): Parts[] => {
      const object = switchObject(String(index + 1), index ? '735123456789012346' : CLOSURE_OBJECT, 'OWN-CANCEL-LI')
      const firstReference = object.findIndex(part => part[0] === 'RFF')
      return [...object.slice(0, firstReference), ...characteristic('Z04', 'Z03'),
        ...object.slice(firstReference), ['NAD', 'Z02', ['11111', '160', 'SVK']]]
    }).flat()], 'Z03').replaceAll('CAV+Z22', 'CAV+Z24')
  return { ...source(wire.replaceAll('CUSTOMER-1::89', '199001011234:SE2:260')
    .replaceAll('001::89', '199001011234:SE2:260').replaceAll('NET-1', 'NET'), profile.code),
  id: own.supply, company_id: own.company, direction: profile.direction, message_version: 'E2SE6A',
  created_at: '2026-10-05T12:00:00.000Z', message_received_at: '2026-10-05T12:00:00.000Z',
  customer_id: null, site_id: null, metering_point_id: null, switch_request_id: null,
  parsed_payload: { cached_end_date: '1900-01-01', supply_period_id: id(90) } }
}
function policy(profile: Profile, applicationReference = '23-DDQ-PRODAT') {
  return resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: profile.code, subtypeOrReasonCode: 'Z24',
    direction: profile.direction, referenceDate: '2026-10-05', associationAssignedCode: 'E2SE6A',
    applicationReference, mode: 'parse', prodatDependentFacts: profile.code === 'Z03' ? {
      endUserAddressObjects: [CLOSURE_OBJECT, '735123456789012346'].map(point =>
        selectedAddressFact(point, own.company, '9', '199001011234', ['Street'], 'SE2')),
      invoiceeObjects: [CLOSURE_OBJECT, '735123456789012346'].map(point =>
        selectedInvoiceeFact(point, own.company, '9', '199001011234', ['Street'], 'SE2', '12345', 'City')),
    } : undefined })
}
function issues(profile: Profile, wire = message(profile).raw_payload!) {
  // Preserve a valid physical envelope when isolating a field omission.
  wire = counted(wire)
  const tokenized = tokenizeEdifact(wire)
  return validateCanonicalPolicyFields({ policy: policy(profile), rawPayload: wire,
    rawSegments: tokenized.segments.map(segment => segment.raw), una: tokenized.una })
}
function counted(wire: string) {
  const segments = tokenizeEdifact(wire).segments
  const count = segments.findIndex(segment => segment.tag === 'UNT')
    - segments.findIndex(segment => segment.tag === 'UNH') + 1
  return wire.replace(/UNT\+\d+\+/, `UNT+${count}+`)
}
const blocking = (profile: Profile, wire?: string) => issues(profile, wire).filter(issue => issue.blocking)
const z05 = profiles[1]
function z15() {
  return { ...permissionFixture('Z15', 'Z24', 'OWN-PERMISSION-LI'), id: own.permission, company_id: own.company,
    message_version: 'E2SE6A', customer_id: null, metering_point_id: null, site_id: null,
    created_at: '2026-10-05T12:00:00.000Z', message_received_at: '2026-10-05T12:00:00.000Z' }
}
beforeEach(() => {
  vi.resetAllMocks()
  io.from.mockImplementation((table: string) => { throw Error(`unexpected_business_table:${table}`) })
  io.rpc.mockImplementation(async (name: string) => {
    if (name === 'ediel_apply_supply_source_v1') return { data: { applied: true, periods: [{ id: id(5), status: 'active' }] }, error: null }
    if (name === 'ediel_apply_permission_source_v1') return { data: { applied: true, permissionId: id(6), status: 'active' }, error: null }
    throw Error(`undeclared_rpc:${name}`)
  })
  io.event.mockResolvedValue(undefined)
  for (const port of [io.notification, io.workflow]) port.mockImplementation(() => { throw Error('unexpected_workflow_or_notification') })
})

describe.each(profiles)('$code C canonical component profile', profile => {
  it('accepts the complete C profile before exercising omissions', () => {
    expect(blocking(profile)).toEqual([])
    expect(validateProdat(message(profile).raw_payload!).ok).toBe(true)
    expect(validateEdifactSyntax(message(profile)).issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(policy(profile)).toMatchObject({ code: profile.code, subtype: 'C', applicationReference: '23-DDQ-PRODAT' })
    expect(parseProdatMessage(message(profile)).lineItems[0]).toMatchObject({ reasonForTransaction: 'Z24',
      lineItemReference: 'OWN-CANCEL-LI', endUserId: '199001011234' })
  })

  it.each([['LIN+', '314'], ['RFF+LI:', '226'], ['RFF+Z05:', '260'], ['NAD+UD+', '227'],
    ['CAV+Z24', '223']])('rejects missing required %s using its own field diagnostic', (selector, fieldNumber) => {
    const wire = message(profile).raw_payload!.split("'").filter(segment => !segment.startsWith(selector)).join("'")
    expect(blocking(profile, wire)).toContainEqual(expect.objectContaining({
      prodatDiagnostic: expect.objectContaining({ fieldNumber }) }))
  })

  it('does not borrow a required cancellation date from its sibling object', () => {
    const wire = message(profile, 2).raw_payload!
    expect(blocking(profile, wire)).toEqual([])
    const firstDate = new RegExp(`DTM\\+${profile.date}:[^']+'`)
    expect(blocking(profile, wire.replace(firstDate, ''))).toContainEqual(expect.objectContaining({
      prodatDiagnostic: expect.objectContaining({ fieldNumber: profile.field,
        occurrence: expect.objectContaining({ lineIndex: 0, objectId: CLOSURE_OBJECT }) }) }))
  })

  it('rejects malformed own cancellation time despite a cached date', () => {
    const wire = message(profile).raw_payload!.replace(new RegExp(`${profile.date}:\\d+:203`), `${profile.date}:NOT-A-DATE:203`)
    expect(blocking(profile, wire)).toContainEqual(expect.objectContaining({
      prodatDiagnostic: expect.objectContaining({ fieldNumber: profile.field }) }))
  })

  it('requires the selected installation parent to name the same cancellation object', () => {
    const wire = message(profile).raw_payload!
    const mutated = profile.code === 'Z05' ? wire.replace(`NAD+IT+${CLOSURE_OBJECT}`, 'NAD+IT+735123456789012346')
      : wire.replace('UNT+', "NAD+IT+735123456789012349::9+++Street+City++12345+SE'UNT+")
    if (profile.code === 'Z03') expect(blocking(profile, mutated)).toContainEqual(expect.objectContaining({
      code: 'PRODAT_DEPENDENT_OPTIONAL_INSTALLATION_ID_INVALID', fieldPath: 'NAD+IT/C082/3039' }))
    else expect(validateProdat(counted(mutated)).issues).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'prodat_party_structure_invalid', message: expect.stringContaining('233') }))
  })

  it('holds incomplete selected invoicee children even for cancellation', () => {
    const wire = message(profile).raw_payload!.replace('UNT+', "NAD+IV+199001011234:SE2:260++Synthetic+Other Street+City+++SE'UNT+")
    expect(blocking(profile, wire)).toContainEqual(expect.objectContaining({
      prodatDiagnostic: expect.objectContaining({ fieldNumber: '253' }) }))
  })

  it('cannot use the ESCO DGI application profile', () => {
    expect(() => policy(profile, '23-DGI-PRODAT')).toThrow()
    expect(io.rpc).not.toHaveBeenCalled()
  })
})

describe('Z05C and Z15C distinct actual inbound consumer paths', () => {
  it('routes supply continuation only to supply ownership, with no app period or final-billing task', async () => {
    expect(decideProdatLifecycle(message(z05))).toMatchObject({ process: 'cancellation', state: 'supply_continues',
      outcome: 'supply_continuation_confirmed', createSupplyPeriod: false, endSupplyPeriod: false })
    expect(await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(z05) })).toMatchObject({
      outcome: 'supply_continuation_confirmed', reviewRequired: false, updated: ['customer_supply_periods'] })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', {
      p_company_id: own.company, p_source_message_id: own.supply, p_actor_user_id: own.actor })
    expect(io.from).not.toHaveBeenCalled(); expect(io.notification).not.toHaveBeenCalled(); expect(io.workflow).not.toHaveBeenCalled()
  })

  it('routes the ESCO Z15C control only to permission ownership, never supply restoration', async () => {
    expect(decideProdatLifecycle(z15())).toMatchObject({ process: 'permission', state: 'permission_continues',
      outcome: 'permission_continues', createSupplyPeriod: false, endSupplyPeriod: false })
    expect(await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: z15() })).toMatchObject({
      outcome: 'permission_continues', reviewRequired: false, updated: ['metering_permissions'] })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_permission_source_v1', {
      p_company_id: own.company, p_source_message_id: own.permission, p_actor_user_id: own.actor, p_expected_permission_id: null })
    expect(io.from).not.toHaveBeenCalled(); expect(io.notification).not.toHaveBeenCalled(); expect(io.workflow).not.toHaveBeenCalled()
  })

  it.each(['Z05', 'Z15'])('a refused %s cancellation cannot upgrade the business result or write app rows', async code => {
    io.rpc.mockResolvedValue({ data: { applied: false, reason: 'immutable_original_unqualified' }, error: null })
    expect(await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: code === 'Z05' ? message(z05) : z15() }))
      .toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] })
    expect(io.from).not.toHaveBeenCalled(); expect(io.notification).not.toHaveBeenCalled(); expect(io.workflow).not.toHaveBeenCalled()
  })

  it('a source replay creates no app period or final-billing task', async () => {
    io.rpc.mockResolvedValue({ data: { applied: true, idempotent: true, periods: [{ id: id(5), status: 'active' }] }, error: null })
    for (let attempt = 0; attempt < 2; attempt++) expect(await applyInboundBusinessStateMachine({
      actorUserId: own.actor, message: message(z05) })).toMatchObject({ outcome: 'supply_continuation_confirmed',
      reviewRequired: false, updated: ['customer_supply_periods'] })
    expect(io.rpc).toHaveBeenCalledTimes(2); expect(io.from).not.toHaveBeenCalled()
  })

  it('a native error propagates without claiming restoration or recording app effects', async () => {
    io.rpc.mockResolvedValue({ data: null, error: Error('cancellation_original_scope_denied') })
    await expect(applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message(z05) }))
      .rejects.toThrow('cancellation_original_scope_denied')
    expect(io.from).not.toHaveBeenCalled(); expect(io.event).not.toHaveBeenCalled()
  })
})
