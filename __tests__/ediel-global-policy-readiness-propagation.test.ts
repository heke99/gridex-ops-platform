import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('global Ediel policy readiness propagation', () => {
  const migration = readFileSync(
    'supabase/migrations/20260903150000_ediel_global_policy_readiness_propagation.sql',
    'utf8',
  )

  it('recaptures tenant configuration snapshots after any rule-version change', () => {
    expect(migration).toContain('after insert or update or delete on public.ediel_rule_versions')
    expect(migration).toContain('for each statement')
    expect(migration).toContain('canonical_capture_ediel_configuration_snapshot_v1_unchecked')
    expect(migration).toContain("'ediel_global_policy_changed'")
  })

  it('covers every tenant that already participates in Ediel readiness or production state', () => {
    expect(migration).toContain('from public.ediel_configuration_snapshots s')
    expect(migration).toContain('from public.ediel_production_state p')
    expect(migration).toContain('select distinct s.company_id')
    expect(migration).toContain('select distinct p.company_id')
  })

  it('keeps the trigger helper private and relies on the canonical fail-closed snapshot path', () => {
    expect(migration).toContain('create or replace function private.ediel_global_policy_change_snapshot_trigger()')
    expect(migration).toContain('revoke all on function private.ediel_global_policy_change_snapshot_trigger()')
    expect(migration).toContain('execute function private.ediel_global_policy_change_snapshot_trigger()')
  })
})
