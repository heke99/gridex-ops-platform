// simulation: finding 20261029-3f1a8ab1/claude-track4/10
// A pipeline step that throws (for example a 57014 statement timeout in the
// business matcher, SLA timers or decision trace) must not leave the
// ediel_processing_runs row as 'running' forever: the run is marked 'failed'
// with a structured code/message/step, and the original error still propagates.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  runs: [] as Row[],
  traces: [] as Row[],
  updateError: null as null | { code: string; message: string },
  traceError: null as null | { code: string; message: string },
}))
const io = vi.hoisted(() => ({
  match: vi.fn(),
  sla: vi.fn(),
  event: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    if (table === 'ediel_processing_runs') {
      return {
        insert: (row: Row) => ({
          select: () => ({
            single: async () => {
              const stored = { id: `run-${db.runs.length + 1}`, ...row }
              db.runs.push(stored)
              return { data: { id: stored.id }, error: null }
            },
          }),
        }),
        update: (patch: Row) => {
          const filters: Array<[string, unknown]> = []
          const chain = {
            eq(column: string, value: unknown) { filters.push([column, value]); return chain },
            then(resolve: (value: { error: unknown }) => unknown, reject?: (reason: unknown) => unknown) {
              if (db.updateError) return Promise.resolve({ error: db.updateError }).then(resolve, reject)
              for (const row of db.runs) if (filters.every(([column, value]) => row[column] === value)) Object.assign(row, patch)
              return Promise.resolve({ error: null }).then(resolve, reject)
            },
          }
          return chain
        },
      }
    }
    if (table === 'ediel_decision_traces') {
      return { insert: async (row: Row) => { if (db.traceError) return { error: db.traceError }; db.traces.push(row); return { error: null } } }
    }
    throw new Error(`unexpected_table_${table}`)
  }
  return { supabaseService: { from } }
})
vi.mock('@/lib/ediel/matching/index', () => ({ resolveEdielBusinessMatch: io.match }))
vi.mock('@/lib/ediel/sla/createAckTimers', () => ({ createAckTimersForMessage: io.sla }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/ediel/core/canonicalMessage', () => ({ parseCanonicalMessageRow: () => ({ family: 'PRODAT', messageCode: 'Z04' }) }))
vi.mock('@/lib/ediel/decisionEngine', () => ({ decideProdatAperak: () => null, decideUtiltsResponse: () => null }))

import { analyzeEdielProcessingPipeline } from '@/lib/ediel/orchestrator/edielProcessingPipeline'
import type { EdielMessageRow } from '@/lib/ediel/types'

const timeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
const message = (): EdielMessageRow => ({
  id: 'msg-1', company_id: 'co-A', message_family: 'PRODAT', message_code: 'Z04', environment: 'test', test_flag: 1,
  parsed_payload: {}, validation_report: {},
} as unknown as EdielMessageRow)
const highMatch = { confidence: 'high', manualReviewReason: null, customerId: 'c', siteId: null, meteringPointId: null, processId: null, permissionId: null, candidates: [], warnings: [] }

beforeEach(() => {
  db.runs = []; db.traces = []; db.updateError = null; db.traceError = null
  io.match.mockReset(); io.sla.mockReset(); io.event.mockReset()
  io.match.mockResolvedValue(highMatch); io.sla.mockResolvedValue(null); io.event.mockResolvedValue(null)
})

describe('track4/10: a failing pipeline step closes its processing run', () => {
  it.each([
    ['business_match', () => { io.match.mockRejectedValue(timeout()) }, { createSlaTimers: false }],
    ['sla_timers', () => { io.sla.mockRejectedValue(timeout()) }, {}],
  ] as const)('57014 in %s: run marked failed with code/message/step and the error propagates', async (step, arrange, options) => {
    arrange()
    await expect(analyzeEdielProcessingPipeline({ actorUserId: 'actor-1', message: message(), createDecisionTrace: false, ...options }))
      .rejects.toMatchObject({ code: '57014' })

    expect(db.runs).toHaveLength(1)
    expect(db.runs[0]).toMatchObject({
      status: 'failed',
      updated_by: 'actor-1',
      payload: {
        sourceMessageId: 'msg-1',
        failedStep: step,
        error: { code: '57014', message: 'canceling statement due to statement timeout' },
      },
    })
    expect(typeof db.runs[0].completed_at).toBe('string')
    expect(io.event).not.toHaveBeenCalled()
  })

  it('57014 in decision_trace: run marked failed at decision_trace and the error propagates', async () => {
    db.traceError = { code: '57014', message: 'canceling statement due to statement timeout' }
    await expect(analyzeEdielProcessingPipeline({ actorUserId: 'actor-1', message: message(), createSlaTimers: false }))
      .rejects.toMatchObject({ code: '57014' })
    expect(db.runs[0]).toMatchObject({ status: 'failed', payload: { failedStep: 'decision_trace', error: { code: '57014' } } })
  })

  it('a failing failure-mark never replaces the original error', async () => {
    io.match.mockRejectedValue(timeout())
    db.updateError = { code: 'XX000', message: 'update failed' }
    await expect(analyzeEdielProcessingPipeline({ actorUserId: 'actor-1', message: message(), createSlaTimers: false, createDecisionTrace: false }))
      .rejects.toMatchObject({ code: '57014' })
  })

  it('a late failure after completion does not overwrite the completed run', async () => {
    io.event.mockRejectedValue(new Error('event_write_failed'))
    await expect(analyzeEdielProcessingPipeline({ actorUserId: 'actor-1', message: message(), createSlaTimers: false, createDecisionTrace: false }))
      .rejects.toThrow('event_write_failed')
    expect(db.runs[0]).toMatchObject({ status: 'completed' })
  })

  it('success path is unchanged: run completed, event written', async () => {
    const result = await analyzeEdielProcessingPipeline({ actorUserId: 'actor-1', message: message(), createSlaTimers: false, createDecisionTrace: false })
    expect(result.runId).toBe('run-1')
    expect(db.runs[0]).toMatchObject({ status: 'completed' })
    expect(io.event).toHaveBeenCalledTimes(1)
  })
})
