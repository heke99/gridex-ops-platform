import { beforeEach, describe, expect, it, vi } from 'vitest'

type Company = Record<string, unknown> & { id: string }

const state = vi.hoisted(() => ({
  companies: [] as Company[],
  listError: null as Error | null,
  insertErrors: new Map<string, unknown>(),
  finishErrors: new Map<string, unknown>(),
  periodLocks: new Map<string, { status: string } | null>(),
  lockErrors: new Map<string, Error>(),
  releaseErrors: new Map<string, Error>(),
  pipelineErrors: new Map<string, Error>(),
  insertCalls: [] as Array<Record<string, unknown>>,
  finishCalls: [] as Array<{ companyId: string; values: Record<string, unknown> }>,
  schemaReady: vi.fn(async () => undefined),
  previousMonth: vi.fn(() => '2026-08'),
  metering: vi.fn(),
  underlays: vi.fn(),
  preparation: vi.fn(),
  withLock: vi.fn(),
}))

vi.mock('@/lib/platform/schemaReadiness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform/schemaReadiness')>()
  return { ...actual, assertPlatformSchemaReady: state.schemaReady }
})

vi.mock('@/lib/time/stockholm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/time/stockholm')>()
  return { ...actual, previousStockholmBillingMonth: state.previousMonth }
})

vi.mock('@/lib/automation/locks', () => ({
  withAutomationLock: state.withLock,
}))

vi.mock('@/lib/billing/invoiceReadiness', () => ({
  getBillingPeriodLock: vi.fn(async ({ companyId }: { companyId: string }) =>
    state.periodLocks.get(companyId) ?? null),
}))

vi.mock('@/lib/metering/monthlyAutopilot', () => ({
  runMeteringMarketDataAutopilot: state.metering,
}))

vi.mock('@/lib/billing/underlayEngine', () => ({
  generateBillingUnderlaysForMonth: state.underlays,
}))

vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({
  prepareInvoiceDraftsForReview: state.preparation,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      if (table === 'companies') {
        const query = {
          selectedCompanyId: null as string | null,
          select() { return query },
          eq(column: string, value: unknown) {
            if (column === 'id') query.selectedCompanyId = String(value)
            return query
          },
          order() { return query },
          async range(from: number, to: number) {
            if (state.listError) return { data: null, error: state.listError }
            return { data: state.companies.slice(from, to + 1), error: null }
          },
          async maybeSingle() {
            if (state.listError) return { data: null, error: state.listError }
            return {
              data: state.companies.find((company) => company.id === query.selectedCompanyId) ?? null,
              error: null,
            }
          },
        }
        return query
      }

      if (table === 'billing_automation_runs') {
        return {
          insert(values: Record<string, unknown>) {
            state.insertCalls.push(values)
            const companyId = String(values.company_id)
            return {
              select() { return this },
              async single() {
                return state.insertErrors.has(companyId)
                  ? { data: null, error: state.insertErrors.get(companyId) }
                  : { data: { id: `run:${companyId}` }, error: null }
              },
            }
          },
          update(values: Record<string, unknown>) {
            let companyId = ''
            const query = {
              eq(column: string, value: unknown) {
                if (column === 'company_id') companyId = String(value)
                return query
              },
              select() { return query },
              async maybeSingle() {
                state.finishCalls.push({ companyId, values })
                return state.finishErrors.has(companyId)
                  ? { data: null, error: state.finishErrors.get(companyId) }
                  : { data: { id: `run:${companyId}` }, error: null }
              },
            }
            return query
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  },
}))

import {
  runMonthlyBillingAutomation,
  runMonthlyBillingAutomationForCompany,
} from '@/lib/billing/monthlyAutomation'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

function company(id: string, overrides: Record<string, unknown> = {}): Company {
  return {
    id,
    status: 'active',
    is_active: true,
    billing_automation_enabled: true,
    invoice_export_enabled: true,
    invoice_export_target_system: 'capway_aptic',
    billing_provider_environment: 'test',
    ...overrides,
  }
}

beforeEach(() => {
  state.companies = []
  state.listError = null
  state.insertErrors.clear()
  state.finishErrors.clear()
  state.periodLocks.clear()
  state.lockErrors.clear()
  state.releaseErrors.clear()
  state.pipelineErrors.clear()
  state.insertCalls = []
  state.finishCalls = []
  state.schemaReady.mockReset().mockResolvedValue(undefined)
  state.previousMonth.mockReset().mockReturnValue('2026-08')
  state.metering.mockReset().mockImplementation(async ({ companyId }: { companyId: string }) => {
    const error = state.pipelineErrors.get(companyId)
    if (error) throw error
    return { imported: 1, matched: 1, requested: 0, review: 0, stopped: 0 }
  })
  state.underlays.mockReset().mockResolvedValue({ created: 1, blocked: 0 })
  state.preparation.mockReset().mockResolvedValue({ underlays: 1, created: 1, blocked: 0, failed: 0 })
  state.withLock.mockReset().mockImplementation(async (input: {
    companyId: string
    lockKey: string
    run: (lock: { lockKey: string; lockToken: string }) => Promise<unknown>
  }) => {
    const error = state.lockErrors.get(input.companyId)
    if (error) throw error
    const result = await input.run({ lockKey: input.lockKey, lockToken: `token:${input.companyId}` })
    const releaseError = state.releaseErrors.get(input.companyId)
    if (releaseError) throw releaseError
    return result
  })
})

describe('monthly billing automation company isolation', () => {
  it('records an invalid company configuration and continues with the next company', async () => {
    state.companies = [
      company('company-a', { invoice_export_target_system: null }),
      company('company-b'),
    ]

    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' })

    expect(result).toMatchObject({ billingMonth: '2026-07', processed: 2, completed: 1, completedWithBlockers: 0, failed: 1 })
    expect(result.results).toEqual([
      expect.objectContaining({ companyId: 'company-a', billingMonth: '2026-07', status: 'failed', automationRunId: null, error: expect.stringContaining('Capway/Aptic') }),
      expect.objectContaining({ companyId: 'company-b', billingMonth: '2026-07', status: 'completed', automationRunId: 'run:company-b' }),
    ])
    expect(state.insertCalls.map((row) => row.company_id)).toEqual(['company-b'])
  })

  it('isolates a held lock and still completes the next company', async () => {
    state.companies = [company('company-a'), company('company-b')]
    state.lockErrors.set('company-a', new Error('held lock for company-a'))

    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' })

    expect(result.results).toEqual([
      expect.objectContaining({ companyId: 'company-a', status: 'failed', automationRunId: null, error: 'held lock for company-a' }),
      expect.objectContaining({ companyId: 'company-b', status: 'completed' }),
    ])
  })

  it.each([
    ['run insertion', state.insertErrors, 'insert failed'],
    ['run finalization', state.finishErrors, 'finish failed'],
  ] as const)('isolates a %s failure and still completes the next company', async (_label, errors, message) => {
    state.companies = [company('company-a'), company('company-b')]
    errors.set('company-a', _label === 'run insertion' ? { message } : new Error(message))

    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' })

    expect(result).toMatchObject({ processed: 2, completed: 1, failed: 1 })
    expect(result.results[0]).toMatchObject({ companyId: 'company-a', billingMonth: '2026-07', status: 'failed', automationRunId: null, error: message })
    expect(result.results[1]).toMatchObject({ companyId: 'company-b', status: 'completed' })
  })

  it('isolates a lock release failure and still completes the next company', async () => {
    state.companies = [company('company-a'), company('company-b')]
    state.releaseErrors.set('company-a', new Error('release failed'))

    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' })

    expect(result).toMatchObject({ processed: 2, completed: 1, failed: 1 })
    expect(result.results[0]).toMatchObject({ companyId: 'company-a', billingMonth: '2026-07', status: 'failed', automationRunId: null, error: 'release failed' })
    expect(result.results[1]).toMatchObject({ companyId: 'company-b', status: 'completed' })
  })

  it('preserves explicit-company failure semantics', async () => {
    state.companies = [company('company-a')]
    state.lockErrors.set('company-a', new Error('explicit lock failure'))

    await expect(runMonthlyBillingAutomation({ companyId: 'company-a', billingMonth: '2026-07', actorUserId: 'actor-1' }))
      .rejects.toThrow('explicit lock failure')
  })

  it('validates the global month before schema and company-list side effects', async () => {
    state.companies = [company('company-a')]

    await expect(runMonthlyBillingAutomation({ billingMonth: '2026-13', actorUserId: 'actor-1' }))
      .rejects.toThrow('Fakturamånad är ogiltig.')
    expect(state.schemaReady).not.toHaveBeenCalled()
    expect(state.withLock).not.toHaveBeenCalled()
  })

  it('preserves global company-list failures', async () => {
    state.listError = new Error('company list unavailable')

    await expect(runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' }))
      .rejects.toThrow('company list unavailable')
    expect(state.withLock).not.toHaveBeenCalled()
  })

  it('preserves global schema-readiness failures', async () => {
    state.schemaReady.mockRejectedValueOnce(new Error('schema unavailable'))

    await expect(runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' }))
      .rejects.toThrow('schema unavailable')
    expect(state.withLock).not.toHaveBeenCalled()
  })

  it.each([
    ['typed gate', new PlatformSchemaNotReadyError('schema became unready')],
    ['raw database', { code: '08006', message: 'readiness query unavailable' }],
  ] as const)('propagates a refreshed %s readiness failure by identity before tenant work', async (_label, failure) => {
    state.companies = [company('company-a'), company('company-b')]
    state.schemaReady.mockResolvedValueOnce(undefined).mockRejectedValue(failure)

    await expect(runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' }))
      .rejects.toBe(failure)
    expect(state.schemaReady).toHaveBeenCalledTimes(2)
    expect(state.withLock).not.toHaveBeenCalled()
    expect(state.metering).not.toHaveBeenCalled()
  })

  it('keeps the public single-company readiness preflight', async () => {
    const failure = new PlatformSchemaNotReadyError('single-company schema failure')
    state.schemaReady.mockRejectedValueOnce(failure)

    await expect(runMonthlyBillingAutomationForCompany({
      companyId: 'company-a',
      companyConfig: company('company-a'),
      billingMonth: '2026-07',
      actorUserId: 'actor-1',
    })).rejects.toBe(failure)
    expect(state.schemaReady).toHaveBeenCalledTimes(1)
    expect(state.withLock).not.toHaveBeenCalled()
  })

  it('treats a locked billing period as a successful no-op without downstream work', async () => {
    state.companies = [company('company-a')]
    state.periodLocks.set('company-a', { status: 'locked' })

    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' })

    expect(result).toMatchObject({ processed: 1, completed: 1, completedWithBlockers: 0, failed: 0 })
    expect(result.results[0]).toMatchObject({ companyId: 'company-a', status: 'completed', prepared: 0, blocked: 0, failed: 0 })
    expect(state.metering).not.toHaveBeenCalled()
    expect(state.underlays).not.toHaveBeenCalled()
    expect(state.preparation).not.toHaveBeenCalled()
  })

  it('keeps tenant scope and summarizes completed, blocked, and failed company results', async () => {
    state.companies = [company('company-a'), company('company-b'), company('company-c')]
    state.preparation.mockImplementation(async ({ companyId }: { companyId: string }) => {
      if (companyId === 'company-b') return { underlays: 3, created: 1, blocked: 2, failed: 0 }
      return { underlays: 1, created: 1, blocked: 0, failed: 0 }
    })
    state.pipelineErrors.set('company-c', new Error('metering failed for company-c'))

    const result = await runMonthlyBillingAutomation({ billingMonth: '2026-07', actorUserId: 'actor-1' })

    expect(result).toMatchObject({ processed: 3, completed: 1, completedWithBlockers: 1, failed: 1 })
    expect(result.results.map((row) => [row.companyId, row.status])).toEqual([
      ['company-a', 'completed'],
      ['company-b', 'completed_with_blockers'],
      ['company-c', 'failed'],
    ])
    expect(state.metering.mock.calls.map(([input]) => [input.companyId, input.billingMonth])).toEqual([
      ['company-a', '2026-07'],
      ['company-b', '2026-07'],
      ['company-c', '2026-07'],
    ])
  })

  it('resolves the default billing month once for the whole invocation', async () => {
    state.companies = [company('company-a'), company('company-b')]
    state.previousMonth.mockReturnValueOnce('2026-08').mockReturnValue('2026-09')

    const result = await runMonthlyBillingAutomation({ actorUserId: 'actor-1' })

    expect(state.previousMonth).toHaveBeenCalledTimes(1)
    expect(result.billingMonth).toBe('2026-08')
    expect(result.results.map((row) => row.billingMonth)).toEqual(['2026-08', '2026-08'])
  })
})
