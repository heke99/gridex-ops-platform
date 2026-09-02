import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260902221500_facility_initial_address_and_unknown_supplier_semantics.sql',
)
const migration = fs.readFileSync(migrationPath, 'utf8')

describe('facility initial address canonicalization migration', () => {
  it('does not treat the first canonical address hash as an address change in the canonical RPC', () => {
    expect(migration).toContain(
      'v_address_changed := v_previous_hash is not null and v_previous_hash is distinct from p_address_hash;',
    )
    expect(migration).not.toContain(
      'v_address_changed := v_previous_hash is distinct from p_address_hash;',
    )
  })

  it('does not treat raw-address to canonical-hash representation change as a mutation in the table trigger', () => {
    expect(migration).toContain(
      'create or replace function public.gridex_invalidate_site_operations_on_address_change()',
    )
    expect(migration).toContain('if v_old_hash is null and v_new_hash is not null then')
    expect(migration).toContain(
      'v_address_changed := v_old_raw_fingerprint is distinct from v_new_raw_fingerprint;',
    )
  })

  it('keeps real established-address mutation fail-closed', () => {
    expect(migration).toContain(
      "status = 'needs_review', stale_reason = 'site_address_changed_after_operation_started'",
    )
    expect(migration).toContain(
      "status = 'manual_review_required', blocker_reason = 'Anläggningsadressen ändrades. Skapa en ny nätägarresolution och begäran.'",
    )
    expect(migration).toContain("verification_status = 'pending_verification'")
    expect(migration).toContain("'derived_context_invalidated',v_address_changed")
    expect(migration).toContain('v_old_hash is distinct from v_new_hash')
  })

  it('normalizes missing supplier identity to explicit unknown at the database boundary', () => {
    expect(migration).toContain('gridex_normalize_customer_site_current_supplier_unknown_v1')
    expect(migration).toContain('new.current_supplier_unknown := true;')
    expect(migration).toContain('new.current_supplier_unknown := false;')
    expect(migration).toContain('trg_gridex_customer_site_current_supplier_unknown_v1')
  })
})
