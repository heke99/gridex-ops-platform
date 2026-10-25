// reality-defects: T31
// T31: the reality world had no grid-owner builder for a Z02 answering our Z01 or for a Z06 E/F/G about the facility
// of our Z03, so J1-12 could not run. The builders (scripts/helpers/reality/inboundProdatWire.ts z02For/z06For) must
// produce files the product itself reads as the grid owner meant them: the platform's own syntax validator, canonical
// policy, field validation, PRODAT parser and lifecycle decide the code, subtype, reason, object, case reference and
// grid area, all taken from our own request.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'
import { asReceived } from '../scripts/helpers/reality/rejectsWire'
import { z02For, z06For, Z06_REASON, type Z06Kind } from '../scripts/helpers/reality/inboundProdatWire'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import type { EdielMessageRow } from '@/lib/ediel/types'

const SUPPLIER = '7360000000017', GRID_OWNER = '80001', BRP = '7360000000024'
const FACILITY = '735999123456789012', LI = 'LIE2ET31CASE', GRID = 'ALS', CUSTOMER = '199001011234'
const ours = (code: 'Z03' | 'Z01', parts: Parts[]) => raw(parts, code).replace('+S+R+', `+${SUPPLIER}:14+${GRID_OWNER}:14+`)
const z03 = ours('Z03', [['NAD', 'FR', [SUPPLIER, '160', 'SVK']], ['NAD', 'DO', [GRID_OWNER, '160', 'SVK']], line('1', FACILITY, undefined, '9'),
  ['DTM', ['92', '202611150000', '203']], ...characteristic('Z13', 'Z22'), ['RFF', ['Z05', GRID]], ['RFF', ['LI', LI]],
  ['NAD', 'UD', [CUSTOMER, 'SE2', '260'], '', 'Synthetic Person'], ['NAD', 'Z02', [BRP, '160', 'SVK']]])
const z01 = ours('Z01', [['NAD', 'FR', [SUPPLIER, '160', 'SVK']], ['NAD', 'DO', [GRID_OWNER, '160', 'SVK']], line('1', FACILITY, undefined, '9'),
  ['RFF', ['LI', LI]], ['NAD', 'UD', [CUSTOMER, 'SE2', '260'], '', 'Synthetic Person']])

/** The receiver's own facility facts (readings come in UTILTS), as the approved native Z06 fixture carries them. */
const RECEIVER_FACTS = { market: 'electricity', meterReadingsSentInUtilts: true } as const
/** The grid owner's file as the supplier receives it. */
const received = (wire: string, code: string): EdielMessageRow => ({ ...asReceived(wire), message_code: code, application_reference: '23-DDQ-PRODAT',
  sender_ediel_id: GRID_OWNER, receiver_ediel_id: SUPPLIER, parsed_payload: { prodatDependentFacts: RECEIVER_FACTS }, message_received_at: '2026-10-25T12:00:00.000000Z', created_at: '2026-10-25T12:00:00.000000Z' } as EdielMessageRow)
function productReading(wire: string, code: string, reason: string) {
  const row = received(wire, code), tokens = tokenizeEdifact(wire)
  const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code, subtypeOrReasonCode: reason, direction: 'inbound', referenceDate: '2026-10-25',
    associationAssignedCode: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', mode: 'parse', prodatDependentFacts: RECEIVER_FACTS })
  return { row, policy, syntax: validateEdifactSyntax(row),
    blocking: validateCanonicalPolicyFields({ policy, rawPayload: wire, rawSegments: tokens.segments.map(s => s.raw), una: tokens.una }).filter(i => i.blocking),
    parsed: parseProdatMessage(row), lifecycle: decideProdatLifecycle(row) }
}

describe('T31 the grid-owner builders produce Z06 E/F/G and Z02 the product reads as intended', () => {
  it.each(['E', 'F', 'G'] as Z06Kind[])('Z06 %s about the facility of our Z03', kind => {
    const built = z06For(z03, GRID_OWNER, kind)
    expect(built.reason).toBe({ E: 'E34', F: 'E64', G: 'E32' }[kind])
    const r = productReading(built.raw, 'Z06', Z06_REASON[kind])
    expect(r.syntax.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(r.policy).toMatchObject({ code: 'Z06', subtype: kind })
    expect(r.blocking).toEqual([])
    expect(r.parsed.messageCode).toBe('Z06')
    expect(r.parsed.lineItems).toHaveLength(1)
    expect(r.parsed.lineItems[0]).toMatchObject({ meteringPointId: FACILITY, lineItemReference: LI, gridAreaId: GRID, reasonForTransaction: Z06_REASON[kind] })
    expect(r.lifecycle).toMatchObject({ subtype: kind })
    expect(built.raw).toContain(`UNB+UNOC:3+${GRID_OWNER}:14+${SUPPLIER}:14+`)
    expect(built.raw).toContain(`DTM+157:${built.change}0000:203`)
    if (kind === 'E') expect(built.raw).toContain(`NAD+UD+${CUSTOMER}:SE2:260`)
  })

  it.each([['L', 'Z22'], ['LK', 'Z23']] as const)('Z02 %s answering our Z01', (variant, reason) => {
    const built = z02For(z01, GRID_OWNER, { variant, gridArea: GRID })
    const r = productReading(built.raw, 'Z02', reason)
    expect(r.syntax.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(r.policy).toMatchObject({ code: 'Z02', subtype: variant })
    expect(r.blocking).toEqual([])
    expect(r.parsed.messageCode).toBe('Z02')
    expect(r.parsed.lineItems[0]).toMatchObject({ meteringPointId: FACILITY, lineItemReference: LI, gridAreaId: GRID, reasonForTransaction: reason, endUserId: CUSTOMER })
    expect(r.lifecycle).toMatchObject({ subtype: variant, outcome: 'grid_owner_information_received', createSupplyPeriod: false, endSupplyPeriod: false })
  })

  it.each(['E', 'F', 'G'] as Z06Kind[])('Z06 %s answering a real platform Z03 (captured native normal switch)', kind => {
    const real = readFileSync(path.resolve(__dirname, '../scripts/reality/fixtures-z03-normal-switch.edi'), 'utf8')
    const built = z06For(real, '60000', kind)
    const r = productReading(built.raw, 'Z06', Z06_REASON[kind])
    expect(r.syntax.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(r.blocking).toEqual([])
    expect(r.parsed.lineItems[0]).toMatchObject({ meteringPointId: '735123456789051435', reasonForTransaction: Z06_REASON[kind] })
    expect(built.raw).toContain('UNB+UNOC:3+60000:')
  })

  it('answers only our own request to this grid owner', () => {
    expect(() => z06For(z03, '80002', 'E')).toThrow(/other_grid_owner/)
    expect(() => z02For(z03, GRID_OWNER)).toThrow(/z02_needs_our_z01/)
    expect(() => z02For(z01, '80002', { gridArea: GRID })).toThrow(/other_grid_owner/)
    expect(() => z02For(z01, GRID_OWNER)).toThrow(/z02_request_fact_missing:gridArea/)
  })
})
