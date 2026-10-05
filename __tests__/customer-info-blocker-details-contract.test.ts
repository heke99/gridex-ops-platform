import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('customer_info_requests blocker_details contract', () => {
  const migration = readFileSync(
    'supabase/migrations/20260903140000_customer_info_blocker_details_contract_guard.sql',
    'utf8',
  )

  it('normalizes explicit NULL blocker_details to the canonical empty json object', () => {
    expect(migration).toContain(
      "new.blocker_details := coalesce(new.blocker_details, '{}'::jsonb);",
    )
    expect(migration).toContain('before insert or update of blocker_details')
    expect(migration).toContain('customer_info_requests_normalize_blocker_details')
  })

  it('keeps the normalization at the database boundary for every caller', () => {
    expect(migration).toContain(
      'create or replace function public.gridex_normalize_customer_info_blocker_details()',
    )
    expect(migration).toContain('on public.customer_info_requests')
    expect(migration).toContain("where blocker_details is null;")
  })
})
