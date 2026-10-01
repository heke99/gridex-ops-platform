import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerCaseRow } from '@/lib/customer-cases/types'
import { createLifecycleDecisionFromCase, lifecycleDecisionTypeForCase } from '@/lib/operations/switchLifecycleBlocks'

const caseRow = {
  id: 'owned-case', company_id: 'owned-company', customer_id: 'owned-customer',
  site_id: null, metering_point_id: null, customer_contract_id: null,
  case_type: 'withdrawal', title: 'Mutable title', metadata: {},
  created_at: '2026-09-29T10:00:00Z', withdrawal_requested_at: null,
} as CustomerCaseRow

function adapter(insertResult: { data: { id: string } | null; error: { code: string; message?: string } | null }, readResult = { data: { id: 'existing-decision' } as { id: string } | null, error: null as { code: string } | null }) {
  const operations: unknown[][] = []
  const query = {
    select: (value: string) => { operations.push(['select', value]); return query },
    insert: (value: unknown) => { operations.push(['insert', value]); return query },
    eq: (column: string, value: unknown) => { operations.push(['eq', column, value]); return query },
    is: (column: string, value: unknown) => { operations.push(['is', column, value]); return query },
    limit: (value: number) => { operations.push(['limit', value]); return query },
    single: async () => insertResult,
    maybeSingle: async () => { operations.push(['read']); return readResult },
  }
  const client = { from: (table: string) => { operations.push(['from', table]); return query } } as unknown as SupabaseClient
  return { operations, client }
}

describe('actual lifecycle producer binding and qualified adapter outcomes', () => {
  it('attempts the current trigger-guarded insert before any replay read', async () => {
    const f = adapter({ data: { id: 'new-decision' }, error: null })
    expect(await createLifecycleDecisionFromCase(f.client, caseRow, 'actual-actor')).toBe('new-decision')
    expect(f.operations.map(operation => operation[0])).toEqual(['from', 'insert', 'select'])
    expect(f.operations[1][1]).toMatchObject({ source_customer_case_id: caseRow.id, company_id: caseRow.company_id, customer_id: caseRow.customer_id, created_by: 'actual-actor', scope_type: 'customer', scope_id: null, billing_blocked: true })
  })
  it('rereads exact identity only after a real unique error and excludes title from identity', async () => {
    const f = adapter({ data: null, error: { code: '23505' } })
    expect(await createLifecycleDecisionFromCase(f.client, caseRow, null)).toBe('existing-decision')
    expect(f.operations.filter(operation => operation[0] === 'eq')).toEqual([
      ['eq', 'source_customer_case_id', 'owned-case'], ['eq', 'company_id', 'owned-company'],
      ['eq', 'customer_id', 'owned-customer'], ['eq', 'decision_type', 'withdrawal'], ['eq', 'scope_type', 'customer'],
    ])
    expect(f.operations).toContainEqual(['is', 'scope_id', null])
  })
  it('includes the exact selected metering point in the unique-conflict reread', async () => {
    const f = adapter({ data: null, error: { code: '23505' } })
    await createLifecycleDecisionFromCase(f.client, { ...caseRow, site_id: 'site', metering_point_id: 'point' }, null)
    expect(f.operations).toContainEqual(['eq', 'scope_type', 'metering_point'])
    expect(f.operations).toContainEqual(['eq', 'scope_id', 'point'])
  })
  it('retains the original unique error if its exact source binding is absent', async () => {
    const error = { code: '23505', message: 'different unique boundary' }
    const f = adapter({ data: null, error }, { data: null, error: null })
    await expect(createLifecycleDecisionFromCase(f.client, caseRow, null)).rejects.toBe(error)
  })
  it('preserves an actual reread failure rather than inventing a replay', async () => {
    const error = { code: '42501' }
    const f = adapter({ data: null, error: { code: '23505' } }, { data: null, error })
    await expect(createLifecycleDecisionFromCase(f.client, caseRow, null)).rejects.toBe(error)
  })
  it('does not reread a binding/fault error', async () => {
    const error = { code: '23514' }, f = adapter({ data: null, error })
    await expect(createLifecycleDecisionFromCase(f.client, caseRow, null)).rejects.toBe(error)
    expect(f.operations.some(operation => operation[0] === 'read')).toBe(false)
  })
  it('retains explicit old-schema fallback and ordinary support does not write', async () => {
    const f = adapter({ data: null, error: { code: '42703' } })
    expect(await createLifecycleDecisionFromCase(f.client, caseRow, null)).toBeNull()
    const support = adapter({ data: null, error: null })
    expect(await createLifecycleDecisionFromCase(support.client, { ...caseRow, case_type: 'other' }, null)).toBeNull()
    expect(support.operations).toEqual([])
  })
  it.each([
    ['withdrawal', 'withdrawal'], ['onboarding_aborted', 'cancelled'], ['supplier_switch_aborted', 'cancelled'],
    ['rejected_customer', 'rejected'], ['binding_period_too_long', 'rejected'], ['incorrect_identity', 'rejected'],
    ['incorrect_site_data', 'rejected'], ['missing_authorization', 'rejected'], ['credit_risk', 'rejected'],
    ['technical_blocker', 'rejected'], ['other', null], ['sales_misunderstanding', null],
  ])('preserves the existing case type %s mapping', (type, decision) => {
    expect(lifecycleDecisionTypeForCase(type)).toBe(decision)
  })
})
