import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const agtRuntime = readFileSync('lib/ediel/testing/agtRuntime.ts', 'utf8')
const actorUi = readFileSync('components/admin/ediel/ActorTestingViews.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260815002945_fix_actor_profile_hash_and_authoritative_projection.sql', 'utf8')

describe('Ediel E2E regression guards', () => {
  it('selects only supplier identities for supplier AGT', () => {
    expect(agtRuntime).toContain(".in('actor_role', ['supplier', 'electricity_supplier'])")
    expect(agtRuntime).toContain('agt_active_test_actor_ambiguous')
  })

  it('does not offer machine-authoritative passed as a manual status', () => {
    expect(actorUi).not.toContain('<option value="passed">Godkänd</option>')
    expect(actorUi).toContain('Godkänd av evidensmotorn. Statusen är skrivskyddad')
    expect(actorUi).toContain("result?.status ?? 'manual_verified'")
  })

  it('keeps request hashes atomic and running projections non-destructive', () => {
    expect(migration).toContain('request_hash = v_hash')
    expect(migration).toContain("v_status='running'")
    expect(migration).toContain('EDIEL_TEST_PROJECTION_PRESERVED_AUTHORITATIVE')
    expect(migration).toContain("v_authoritative.status in ('passed','manual_verified')")
  })

  it('treats limited pilot as a post-first-send stop-loss', () => {
    const evidence = readFileSync('lib/ediel/certificationEvidence.ts', 'utf8')
    const pilotMigration = readFileSync('supabase/migrations/20260815003554_conditional_limited_pilot_evidence_gate.sql', 'utf8')
    const panel = readFileSync('components/admin/go-live/CertificationEvidencePanel.tsx', 'utf8')
    const goLivePage = readFileSync('app/admin/platform/go-live/[companyId]/page.tsx', 'utf8')
    expect(evidence).toContain('limited_pilot_requires_real_production_send')
    expect(evidence).toContain("type !== 'LIMITED_PILOT'")
    expect(pilotMigration).toContain("m.status = 'sent'")
    expect(pilotMigration).toContain("select 'LIMITED_PILOT'")
    expect(panel).toContain('Efter första live-send')
    expect(goLivePage).toContain('pilotRequired={certificationEvidence.pilotRequired}')
  })
})
