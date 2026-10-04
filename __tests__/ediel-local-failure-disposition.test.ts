// masterplan: OPS-05, AT-OPS-05
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyEdielFailure, EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
const fault = vi.hoisted(() => ({ active: false }))
vi.mock('@/lib/ediel/core/messagePolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ediel/core/messagePolicy')>()
  return { ...actual, resolveCanonicalMessagePolicy: (...args: Parameters<typeof actual.resolveCanonicalMessagePolicy>) => {
    if (fault.active) throw new Error('local_configuration_failure')
    return actual.resolveCanonicalMessagePolicy(...args)
  } }
})
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {raw as independentRaw,characteristic,type Parts} from './fixtures/prodat-register'
import {head,own} from './fixtures/prodat-identity'
const body:Parts[]=[...head(),...own('1','735123456789012345','CASE-A')]
body.splice(6,0,...characteristic('Z04','Z01'))
body.push(['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'])
const raw=independentRaw(body,'Z03')
const message = { raw_payload: raw, message_family: 'PRODAT', message_code: 'Z03', message_standard: 'edifact', direction: 'inbound', environment: 'test', message_received_at: '2026-09-30T12:00:00Z', created_at: '2026-09-30T12:00:00Z', parsed_payload: {}, status: 'received' } as EdielMessageRow
afterEach(() => { fault.active = false })

describe('local failures are not national field rejections', () => {
  it('holds an unknown local thrown failure with no invented APERAK42', () => {
    fault.active = true
    const result = resolveCanonicalRuntimeDecision(message)
    expect(result.applicationDecision).toBe('manual_review')
    expect(result.prodatProcessingDisposition?.kind).toBe('internal_review')
    expect(result.responsePlan.some(item => item.family === 'APERAK' || item.family === 'UTILTS_ERR')).toBe(false)
    expect(result.validationReport.failureDisposition).toMatchObject({ kind: 'internal_failure' })
  })
  it('retains a real independently source-qualified national42/202', () => {
    // ZZZ fits the directory's an..3 document code. The unknown national code
    // therefore reaches its own policy phase instead of failing wire length.
    const result = resolveCanonicalRuntimeDecision({ ...message, raw_payload: raw.replace('BGM+Z03', 'BGM+ZZZ') })
    expect(result.applicationDecision).toBe('rejected')
    expect(result.responsePlan.find(item => item.family === 'APERAK')?.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ ercCode: '42', fieldCode: '202' })]))
  })
  it('preserves typed quarantine and unsupported categories without giving them protocol authority', () => {
    expect(classifyEdielFailure(new EdielExecutionFailure({ kind: 'security_quarantine', code: 'ACTOR_UNTRUSTED' }, 'held')).kind).toBe('security_quarantine')
    expect(classifyEdielFailure(new EdielExecutionFailure({ kind: 'unsupported_capability', code: 'CAPABILITY_HELD' }, 'held')).kind).toBe('unsupported_capability')
    expect(classifyEdielFailure(new Error('42'))).toMatchObject({ kind: 'internal_failure' })
  })
})

describe('OPS-05: an internal failure preserves the original and its acknowledgement status', () => {
  it('leaves raw payload and CONTRL/APERAK status untouched and plans no external application response', () => {
    fault.active = true
    const row = { ...message, contrl_status: 'received', aperak_status: 'pending', requires_contrl: true, requires_aperak: true } as EdielMessageRow
    const before = structuredClone(row)
    const result = resolveCanonicalRuntimeDecision(row)
    expect(row).toEqual(before)
    expect(result.responsePlan.filter(item => item.family === 'APERAK' || item.family === 'UTILTS_ERR')).toEqual([])
    expect(result.validationReport.failureDisposition).toMatchObject({ kind: 'internal_failure' })
    expect(JSON.stringify(result.responsePlan)).not.toMatch(/"ercCode":"42"/)
  })
})
