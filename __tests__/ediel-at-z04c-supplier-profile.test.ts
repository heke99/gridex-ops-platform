// masterplan: AT-Z04C-SUPPLIER
// Component profile and consumer probes for a received DDQ Z04/Z24 (Z04C).
// Every 26.A Z04 "R" field of the frozen matrix is omitted individually and must
// produce its own national diagnostic. Native intake, owner SQL, ACK and
// compensation evidence are separate (SQL regression and native test).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCancellationProspectiveZ04 } from '../scripts/helpers/ediel-cancellation-prospective-source-2ea'
import { source } from './fixtures/prodat-identity'

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
import { PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { applySupplyMarketSource } from '@/lib/ediel/flows/supplyMarketTransition'
import { evaluateProdatTransactionReason } from '@/lib/ediel/prodat/prodatTransactionReason'
import { isQualifiedProdatApplicationError } from '@/lib/ediel/prodat/prodatDiagnosticProjection'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), source: id(3), period: id(4) }
// Distinct synthetic grid owner (FR) and own supplier (DO); no real actor.
const context = { external: '735123456789012345', receiver: '77777', sender: '88888', brpEdielId: '11111',
  customerIdentity: { id: '199001011234' }, gridAreaCode: 'TES', caseReference: 'OWN-ORIGINAL-LI', requestedStartDate: '2026-11-20' }
const complete = buildCancellationProspectiveZ04(context).replace('CAV+Z22', 'CAV+Z24')
function policy(overrides: Partial<Parameters<typeof resolveCanonicalEdielPolicy>[0]> = {}) {
  return resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z04', subtypeOrReasonCode: 'Z24', direction: 'inbound',
    referenceDate: '2026-10-18', associationAssignedCode: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', mode: 'parse',
    // Explicit receiver-local register fact for the synthetic declared readings.
    prodatDependentFacts: { market: 'electricity', meterReadingsSentInUtilts: true }, ...overrides })
}
// Preserve a valid physical envelope when isolating one omission.
function counted(wire: string) {
  const segments = tokenizeEdifact(wire).segments
  const count = segments.findIndex(segment => segment.tag === 'UNT') - segments.findIndex(segment => segment.tag === 'UNH') + 1
  return wire.replace(/UNT\+\d+\+/, `UNT+${count}+`)
}
function blocking(wire: string) {
  const physical = counted(wire), tokens = tokenizeEdifact(physical)
  return validateCanonicalPolicyFields({ policy: policy(), rawPayload: physical,
    rawSegments: tokens.segments.map(segment => segment.raw), una: tokens.una }).filter(issue => issue.blocking)
}
const segments = () => complete.split("'")
function dropSegment(prefix: string, withValue = false) {
  const all = segments(), index = all.findIndex(segment => segment.startsWith(prefix))
  expect(index, prefix).toBeGreaterThan(0)
  all.splice(index, withValue ? 2 : 1)
  return all.join("'")
}
function blankElement(prefix: string, element: number, component?: number) {
  const all = segments(), index = all.findIndex(segment => segment.startsWith(prefix))
  expect(index, prefix).toBeGreaterThan(0)
  const elements = all[index].split('+')
  expect(elements[element], `${prefix}#${element}`).toBeTruthy()
  if (component === undefined) elements[element] = ''
  else { const parts = elements[element].split(':'); expect(parts[component]).toBeTruthy(); parts[component] = ''; elements[element] = parts.join(':') }
  all[index] = elements.join('+')
  return all.join("'")
}
// Each R field's own physical location; group rows are asserted separately.
const omissions: Record<string, () => string> = {
  '311': () => complete.replace('++23-DDQ-PRODAT', '++'), '312': () => complete.replace('UN:E2SE6A', 'UN:'),
  '202': () => complete.replace('BGM+Z04+', 'BGM++'), '203': () => blankElement('BGM+', 2), '313': () => blankElement('BGM+', 4),
  '205': () => dropSegment('DTM+137'), '206': () => dropSegment('DTM+ZZZ'), '207': () => dropSegment('NAD+FR'), '208': () => dropSegment('NAD+DO'),
  '314': () => blankElement('LIN+', 1), '209': () => blankElement('LIN+', 3, 0), '210': () => dropSegment('DTM+92'), '508': () => dropSegment('DTM+354'),
  '213': () => dropSegment('QTY+31'), '217': () => dropSegment('CCI++Z04', true), '306': () => dropSegment('CCI++Z07', true),
  '222': () => dropSegment('CCI++Z12', true), '223': () => dropSegment('CCI++Z13', true), '254': () => dropSegment('CCI++Z15', true),
  '242': () => dropSegment('CCI++Z14', true), '224': () => dropSegment('RFF+MG'), '260': () => dropSegment('RFF+Z05'), '226': () => dropSegment('RFF+LI'),
  '227': () => blankElement('NAD+UD', 2), '228': () => blankElement('NAD+UD', 4), '231': () => blankElement('NAD+UD', 8),
  '232': () => blankElement('NAD+UD', 6), '316': () => blankElement('NAD+UD', 9), '233': () => blankElement('NAD+IT', 2),
  '234': () => blankElement('NAD+IT', 5), '262': () => blankElement('NAD+Z02', 2),
}
const z04 = PRODAT_26A_MESSAGE_CODES.indexOf('Z04')
const required = PRODAT_26A_FIELD_MATRIX.filter(row => row.requirements[z04] === 'R').map(row => row.fieldNumber)
const requiredFields = required.filter(field => /^\d+$/.test(field))
function message(overrides: Record<string, unknown> = {}) {
  return { ...source(complete, 'Z04'), id: own.source, company_id: own.company, message_version: 'E2SE6A',
    application_reference: '23-DDQ-PRODAT', sender_ediel_id: context.receiver, receiver_ediel_id: context.sender,
    created_at: '2026-10-18T08:00:00.000Z', message_received_at: '2026-10-18T08:00:00.000Z',
    customer_id: null, site_id: null, metering_point_id: null, switch_request_id: null,
    // Mutable cached projections are not authority for the cancelled period.
    parsed_payload: { start_date: '1900-01-01', supply_period_id: id(90), prodatDependentFacts: { market: 'electricity', meterReadingsSentInUtilts: true } },
    ...overrides }
}
beforeEach(() => {
  vi.resetAllMocks()
  io.from.mockImplementation((table: string) => { throw Error(`unexpected_business_table:${table}`) })
  io.rpc.mockImplementation(async (name: string) => { throw Error(`undeclared_rpc:${name}`) })
  io.event.mockResolvedValue(undefined)
  for (const port of [io.notification, io.workflow]) port.mockResolvedValue(undefined)
})

describe('received Z04C canonical profile and R-field omissions', () => {
  it('accepts the complete DDQ/BGM Z04/223 Z24 C profile before exercising omissions', () => {
    expect(complete).toContain('+23-DDQ-PRODAT'); expect(complete).toContain("BGM+Z04+"); expect(complete).toContain("CCI++Z13'CAV+Z24'")
    expect(blocking(complete)).toEqual([])
    expect(validateProdat(complete).issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(validateEdifactSyntax(message()).issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(policy()).toMatchObject({ family: 'PRODAT', code: 'Z04', subtype: 'C', direction: 'inbound', applicationReference: '23-DDQ-PRODAT' })
    expect(parseProdatMessage(message()).lineItems[0]).toMatchObject({ reasonForTransaction: 'Z24',
      lineItemReference: 'OWN-ORIGINAL-LI', endUserId: '199001011234' })
  })

  it('derives the omission set from the frozen 26.A matrix and covers every Z04 R field', () => {
    expect(required).toEqual(expect.arrayContaining(['END_USER_GROUP', 'INSTALLATION_GROUP']))
    expect(requiredFields.filter(field => !(field in omissions))).toEqual([])
    expect(requiredFields.length).toBeGreaterThanOrEqual(30)
  })

  it.each(requiredFields)('holds individually omitted required Z04C field %s with its own diagnostic', field => {
    const mutated = omissions[field]()
    expect(mutated).not.toBe(complete)
    expect(blocking(mutated)).toContainEqual(expect.objectContaining({
      prodatDiagnostic: expect.objectContaining({ fieldNumber: field }) }))
  })

  it.each([['NAD+UD', 'END_USER_GROUP', ['227', '228', '231', '232', '316']], ['NAD+IT', 'INSTALLATION_GROUP', ['233', '234']]] as const)(
    'holds a missing required %s group and each of its own required children', (prefix, group, children) => {
      const issues = blocking(dropSegment(prefix))
      expect(issues).toContainEqual(expect.objectContaining({ code: 'FIELD_MATRIX_REQUIRED_FIELD_MISSING', fieldPath: prefix,
        prodatDiagnostic: expect.objectContaining({ sourceRule: `PRODAT26A:§2.2:Z04:${group}` }) }))
      for (const child of children) expect(issues).toContainEqual(expect.objectContaining({
        prodatDiagnostic: expect.objectContaining({ fieldNumber: child, errorKind: 'missing' }) }))
    })

  it('reports a missing own 223 as the national transaction-reason diagnostic, not a borrowed C', () => {
    expect(blocking(omissions['223']())).toContainEqual(expect.objectContaining({ code: 'PRODAT_TRANSACTION_REASON_INVALID',
      prodatDiagnostic: expect.objectContaining({ fieldNumber: '223', errorKind: 'missing' }) }))
    const tokens = tokenizeEdifact(counted(omissions['223']()))
    const reason = evaluateProdatTransactionReason({ rawSegments: tokens.segments.map(segment => segment.raw), una: tokens.una, code: 'Z04' })
    expect(reason.applicationErrors).toHaveLength(1)
    expect(reason.applicationErrors[0]).toMatchObject({ ercCode: '41', fieldCode: '223', referenceNumber: context.external })
    expect(isQualifiedProdatApplicationError(reason.applicationErrors[0])).toBe(true)
  })
})

// D fields whose condition is met on the received wire. 214/218/259 are met by
// the explicit register-readings fact; the invoicee children are met once the
// own NAD+IV group is present. 229/252 depend on sender-side address facts and
// produce no receiver diagnostic; 320/240/319 are gas/serial/production-link
// fields that are inapplicable to this electricity consumption start.
const invoicee = "NAD+IV+199001011234:SE2:260++Synthetic Invoicee+Invoice Street+Invoice City++54321+SE'"
const withInvoicee = complete.replace('NAD+IT+', invoicee + 'NAD+IT+')
function blankIn(wire: string, prefix: string, element: number) {
  const all = wire.split("'"), index = all.findIndex(segment => segment.startsWith(prefix))
  expect(index, prefix).toBeGreaterThan(0)
  const elements = all[index].split('+'); expect(elements[element]).toBeTruthy(); elements[element] = ''
  all[index] = elements.join('+'); return all.join("'")
}
const z04Dependent = PRODAT_26A_FIELD_MATRIX.filter(row => row.requirements[z04] === 'D').map(row => row.fieldNumber)
describe('received Z04C dependent fields with their condition met', () => {
  it('the asserted D set is drawn from the frozen Z04 matrix column', () => {
    for (const field of ['214', '218', '259', '250', '251', '253', '317', '318', 'INVOICEE_GROUP']) expect(z04Dependent).toContain(field)
    expect(blocking(withInvoicee)).toEqual([])
  })
  it.each([['214', 'CCI++Z02'], ['218', 'CCI++Z05'], ['259', 'CCI++Z16']])('holds an omitted register-reading D field %s once readings are declared', (field, prefix) => {
    expect(blocking(dropSegment(prefix, true))).toContainEqual(expect.objectContaining({ code: 'PRODAT_DEPENDENT_FIELD_MISSING',
      prodatDiagnostic: expect.objectContaining({ fieldNumber: field }) }))
  })
  it.each([['250', 2], ['251', 4], ['317', 6], ['253', 8], ['318', 9]] as const)('holds an omitted invoicee child %s inside a present NAD+IV group', (field, element) => {
    expect(blocking(blankIn(withInvoicee, 'NAD+IV', element))).toContainEqual(expect.objectContaining({ code: 'PRODAT_INVOICEE_FORMAT_INVALID',
      prodatDiagnostic: expect.objectContaining({ fieldNumber: field }) }))
  })
})

describe('received Z04C application, direction and role boundaries', () => {
  it.each([['23-DGI-PRODAT', 'canonical_ediel_application_reference_not_allowed'], ['', 'canonical_ediel_application_reference_required'],
    [null, 'canonical_ediel_application_reference_required']] as const)('refuses the Z04C profile under application reference %j', (applicationReference, reason) => {
    expect(() => policy({ applicationReference })).toThrow(reason)
  })

  it('refuses another association code and the bilateral-only H reason', () => {
    expect(() => policy({ associationAssignedCode: 'E2SE5A' })).toThrow('ediel_guide_resolution_missing')
    expect(() => policy({ subtypeOrReasonCode: 'Z25' })).toThrow('prodat_bilateral_capability_required:Z04:H')
  })

  it('a DGI Z04C cannot reach a supply cancellation lifecycle', () => {
    expect(decideProdatLifecycle(message({ application_reference: '23-DGI-PRODAT' }))).toMatchObject({
      process: 'unexpected_direction', state: 'manual_review', outcome: 'unexpected_direction_review', createSupplyPeriod: false, endSupplyPeriod: false })
  })

  it('a received supplier-direction C (physical Z03C from the supplier) is a direction review with no supply call', async () => {
    // Genuine reverse physical direction: BGM Z03 sent by the supplier (FR) to the grid owner (DO).
    const reverse = complete.replace('BGM+Z04+', 'BGM+Z03+').replace(`NAD+FR+${context.receiver}:`, 'NAD+FR+SWAP:')
      .replace(`NAD+DO+${context.sender}:`, `NAD+DO+${context.receiver}:`).replace('NAD+FR+SWAP:', `NAD+FR+${context.sender}:`)
    expect(reverse).toContain(`NAD+FR+${context.sender}:`); expect(reverse).toContain(`NAD+DO+${context.receiver}:`)
    const received = message({ message_code: 'Z03', raw_payload: reverse, sender_ediel_id: context.sender, receiver_ediel_id: context.receiver })
    expect(decideProdatLifecycle(received)).toMatchObject({ process: 'unexpected_direction',
      outcome: 'unexpected_direction_review', createSupplyPeriod: false, endSupplyPeriod: false })
    expect(await applySupplyMarketSource({ actorUserId: own.actor, message: received }))
      .toMatchObject({ applied: false, reason: 'not_inbound_supply_source', periods: [], effectReceiptIds: [] })
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })

  it('an outbound-direction Z04C never calls the supply owner', async () => {
    expect(await applySupplyMarketSource({ actorUserId: own.actor, message: message({ direction: 'outbound' }) }))
      .toMatchObject({ applied: false, reason: 'not_inbound_supply_source', periods: [], effectReceiptIds: [] })
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })

  it('routes an accepted inbound Z04C only to the own supply owner with the source identity, never cached projections', async () => {
    io.rpc.mockResolvedValue({ data: { applied: true, periods: [{ id: own.period, status: 'cancelled' }] }, error: null })
    expect(decideProdatLifecycle(message())).toMatchObject({ code: 'Z04', subtype: 'C', process: 'cancellation',
      createSupplyPeriod: false, endSupplyPeriod: false })
    expect(await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message() })).toMatchObject({ reviewRequired: false })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', {
      p_company_id: own.company, p_source_message_id: own.source, p_actor_user_id: own.actor })
    expect(io.from).not.toHaveBeenCalled(); expect(io.notification).not.toHaveBeenCalled()
  })

  it.each(['supply_legal_actor_unqualified', 'supply_execution_actor_unqualified', 'supply_source_unavailable',
    'z04c_exact_original_unavailable', 'z04c_locked_original_mismatch', 'z04c_conflicting_periods',
    'z04c_effect_already_executed_compensation_required', 'z04c_current_sender_network_registry_required', 'z04c_start_already_cancelled'])('owner refusal %s holds for review without app writes or activation', async reason => {
    io.rpc.mockResolvedValue({ data: { applied: false, reason }, error: null })
    expect(await applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message() }))
      .toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] })
    expect(io.rpc).toHaveBeenCalledTimes(1)
    expect(io.from).not.toHaveBeenCalled(); expect(io.notification).not.toHaveBeenCalled()
  })

  it('a source transaction failure propagates without success events', async () => {
    io.rpc.mockResolvedValue({ data: null, error: Error('z04c source transaction rolled back') })
    await expect(applyInboundBusinessStateMachine({ actorUserId: own.actor, message: message() })).rejects.toThrow('z04c source transaction rolled back')
    expect(io.event).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
  })
})
