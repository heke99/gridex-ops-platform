// reality-defects: H3d (slice 3: owner decision 2026-10-24 B5 on the contract card's "Uppsägning mottagen": the planned
// end is the notice end, not the binding end, and the operator's fee review is requested; B6 the cron reports the lead)
// Calls lib/customer-contracts/db.ts addCustomerContractEvent and terminationNoticeExpiry with a recording Supabase
// stand-in (the SQL behaviour is proven in h3d-termination-binding-z08-lead.test.ts). Synthetic ids only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ rpc: [] as Array<{ name: string; args: Record<string, unknown> }>, rpcResults: {} as Record<string, unknown> }))

vi.mock('@/lib/supabase/service', () => {
  const rows: Record<string, unknown> = {
    customer_contracts: { starts_at: '2026-09-01', ends_at: '2027-09-01', binding_months: 12, notice_months: 1, status: 'active',
      auto_renew_enabled: true, auto_renew_term_months: 12, termination_reason: null },
    customer_contract_notice_terms: { notice_days: 14 },
  }
  const query = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'is', 'lte', 'gte', 'or', 'order', 'limit']) chain[method] = () => chain
    chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null })
    return chain
  }
  return {
    supabaseService: {
      from: (table: string) => query(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args })
        if (name === 'gridex_record_customer_contract_event_v1') return { data: { event: { id: 'event-1' } }, error: null }
        return { data: calls.rpcResults[name] ?? {}, error: null }
      },
    },
  }
})

import { addCustomerContractEvent } from '@/lib/customer-contracts/db'
import { createTerminationNoticeExpiryTasks, TERMINATION_Z08_TASK_LEAD_DAYS } from '@/lib/customer-contracts/terminationNoticeExpiry'

const company = '11111111-1111-4111-8111-111111111111'
const contract = '88888888-8888-4888-8888-888888888888'
const customer = '55555555-5555-4555-8555-555555555555'
const actor = 'abababab-abab-4bab-8bab-abababababab'

beforeEach(() => { calls.rpc.length = 0 })

describe("H3d B5 the contract card's 'Uppsägning mottagen'", () => {
  it('records the notice end (1 month + 14 days), not the agreed/binding end, and requests the fee review', async () => {
    await addCustomerContractEvent({ companyId: company, customerContractId: contract, customerId: customer, eventType: 'termination_notice_received',
      happenedAt: '2026-10-10', actorUserId: actor })
    expect(calls.rpc.map(call => call.name)).toEqual(['gridex_record_customer_contract_event_v1', 'gridex_termination_break_fee_review_v1'])
    expect(calls.rpc[0].args).toMatchObject({ p_event_type: 'termination_notice_received', p_derived_ends_at: '2026-11-24' })
    expect(calls.rpc[1].args).toEqual({ p_company_id: company, p_customer_contract_id: contract, p_actor_user_id: actor })
  })

  it('another event requests no review', async () => {
    await addCustomerContractEvent({ companyId: company, customerContractId: contract, customerId: customer, eventType: 'note', actorUserId: actor })
    expect(calls.rpc.map(call => call.name)).toEqual(['gridex_record_customer_contract_event_v1'])
  })
})

describe('H3d B6 the scheduled check', () => {
  it('reports the created and closed tasks and the lead the database used', async () => {
    calls.rpcResults.gridex_termination_notice_expiry_tasks_v1 = { as_of: '2026-10-27', tasks_created: 1, contract_ids: [contract], tasks_closed: 2, lead_days: 14 }
    const result = await createTerminationNoticeExpiryTasks({ companyId: company, asOf: '2026-10-27' })
    expect(result).toEqual({ asOf: '2026-10-27', tasksCreated: 1, contractIds: [contract], tasksClosed: 2, leadDays: TERMINATION_Z08_TASK_LEAD_DAYS })
    expect(calls.rpc).toEqual([{ name: 'gridex_termination_notice_expiry_tasks_v1', args: { p_company_id: company, p_as_of: '2026-10-27' } }])
  })
})
