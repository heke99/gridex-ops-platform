import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CONTRACT_TYPES } from '@/lib/pricing/commercialModel'

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'supabase', 'migrations', name), 'utf8')
}

describe('customer onboarding database constraint parity', () => {
  it('keeps site process aggregation inside the canonical customer intake vocabulary', () => {
    const sql = migration('20260823185028_fix_customer_process_summary_intake_status.sql')

    expect(sql).toContain("when v_total=0 then 'needs_admin_review'")
    expect(sql).toContain("when v_blocked>0 then 'blocked'")
    expect(sql).toContain("when v_pending>0 then 'pending_information'")
    expect(sql).toContain("when v_active=v_total then 'active_supply'")
    expect(sql).not.toContain("then 'in_progress'")
    expect(sql).not.toContain("then 'partially_blocked'")
  })

  it('allows every canonical commercial contract type in customer_contracts', () => {
    const sql = migration('20260823185352_align_customer_contract_quarterly_type.sql')

    for (const contractType of CONTRACT_TYPES) {
      expect(sql).toContain(`'${contractType}'::text`)
    }
  })
})
