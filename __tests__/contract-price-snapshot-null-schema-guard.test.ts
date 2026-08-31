import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
  resolve(__dirname, '../supabase/migrations/20260831093000_fix_contract_snapshot_null_schema_guard.sql'),
  'utf8',
)

describe('contract price snapshot NULL schema guard', () => {
  it('returns non-v6 snapshots before commercial-selection validation even when schema identity is NULL', () => {
    expect(migration).toContain(
      "new.snapshot_schema_version is distinct from 'gridex_contract_pricing_v6_selection'",
    )
    expect(migration).not.toContain(
      "new.snapshot_schema_version<>'gridex_contract_pricing_v6_selection'",
    )
    expect(migration).not.toContain(
      "new.snapshot_schema_version <> 'gridex_contract_pricing_v6_selection'",
    )
  })

  it('keeps strict v6 commercial identity and quote parity validation intact', () => {
    expect(migration).toContain("message='contract_commercial_snapshot_identity_incomplete'")
    expect(migration).toContain("message='contract_snapshot_quote_selection_mismatch'")
    expect(migration).toContain("'website_customer_applications'")
    expect(migration).toContain('v_quote.quote_hash is distinct from new.quote_hash')
    expect(migration).toContain('v_quote.resolved_price_components')
  })
})
