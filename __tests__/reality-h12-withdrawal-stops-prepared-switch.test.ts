// reality-defects: H-12
// H-12 (reality H run 2): after the Z03 is sent the switch is 'prepared' (the database binds the Z03 original and
// keeps that status until the Z04; GOR-06). A withdrawal registered on the customer card selected open switches with
// OPEN_SUPPLIER_SWITCH_STATUSES, which lacked 'prepared', so the sent switch was never stopped and no Z03C followed.
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OPEN_SUPPLIER_SWITCH_STATUSES, pauseOpenSupplierSwitchesForLifecycleBlock, type SwitchLifecycleBlock } from '@/lib/operations/switchLifecycleBlocks'

const C = '11111111-1111-4111-8111-111111111111'
const CUSTOMER = '22222222-2222-4222-8222-222222222222'

function fakeSupabase(rows: Array<{ id: string; status: string }>) {
  const transitions: Array<{ id: string; status: unknown; previous: unknown }> = []
  const supabase = {
    from(table: string) {
      expect(table).toBe('supplier_switch_requests')
      let statuses: string[] = []
      const query = {
        select: () => query,
        eq: () => query,
        in: (_column: string, values: string[]) => { statuses = values; return query },
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows.filter(r => statuses.includes(r.status)).map(r => ({ ...r, company_id: C, customer_id: CUSTOMER })), error: null }),
      }
      return query
    },
    async rpc(name: string, args: { p_request_id: string; p_patch: { status: unknown }; p_event: { payload: { previousStatus: unknown } } }) {
      expect(name).toBe('gridex_transition_supplier_switch_v1')
      transitions.push({ id: args.p_request_id, status: args.p_patch.status, previous: args.p_event.payload.previousStatus })
      return { error: null }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, transitions }
}

const block = (decisionType: SwitchLifecycleBlock['decisionType']): SwitchLifecycleBlock => ({
  source: 'customer_case', id: 'case-1', companyId: C, customerId: CUSTOMER, siteId: null, meteringPointId: null,
  decisionType, title: 'Ånger registrerad', reason: 'withdrawal', createdAt: '2026-10-24T20:13:25Z',
})

describe('H-12 a withdrawal stops a switch whose Z03 is sent (status prepared)', () => {
  it('counts prepared as an open switch', () => {
    expect(OPEN_SUPPLIER_SWITCH_STATUSES).toContain('prepared')
  })

  it('moves a prepared switch to cancellation_requested on withdrawal, so a Z03C is built', async () => {
    const { supabase, transitions } = fakeSupabase([{ id: 'sw-prepared', status: 'prepared' }, { id: 'sw-done', status: 'completed' }])
    const result = await pauseOpenSupplierSwitchesForLifecycleBlock(supabase, { block: block('withdrawal'), actorUserId: null })
    expect(result).toEqual({ paused: 1, requestIds: ['sw-prepared'] })
    expect(transitions).toEqual([{ id: 'sw-prepared', status: 'cancellation_requested', previous: 'prepared' }])
  })

  it('sends a prepared switch to manual follow-up when the customer is rejected', async () => {
    const { supabase, transitions } = fakeSupabase([{ id: 'sw-prepared', status: 'prepared' }])
    await pauseOpenSupplierSwitchesForLifecycleBlock(supabase, { block: block('rejected'), actorUserId: null })
    expect(transitions).toEqual([{ id: 'sw-prepared', status: 'manual_followup_required', previous: 'prepared' }])
  })
})
