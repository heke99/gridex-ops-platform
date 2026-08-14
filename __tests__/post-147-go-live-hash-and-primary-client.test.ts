import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const goLiveActions = readFileSync('app/admin/platform/go-live/actions.ts', 'utf8')
const goLiveSummary = readFileSync('lib/integrations/tenantWebsiteGoLive.ts', 'utf8')
const tenantWebsiteClient = readFileSync('lib/integrations/tenantWebsiteClient.ts', 'utf8')
const lifecycleHashFix = readFileSync(
  'supabase/migrations/20260814230500_fix_canonical_tenant_lifecycle_request_hash.sql',
  'utf8',
)
const productionHashFixPath =
  'supabase/migrations/20260814235000_fix_canonical_production_command_request_hash.sql'

describe('post-#147 go-live residuals: hash binding + primary client', () => {
  it('binds request_payload and request_hash atomically for production transitions', () => {
    // #147 fixed lifecycle only. Production activate/pause and first-live-send
    // still enriched request_payload after insert, which the hash guard rejects.
    expect(lifecycleHashFix).toContain('request_payload = v_request')
    expect(lifecycleHashFix).toContain('request_hash = v_hash')

    expect(existsSync(productionHashFixPath)).toBe(true)
    const productionHashFix = readFileSync(productionHashFixPath, 'utf8')
    expect(productionHashFix).toContain('canonical_transition_ediel_production')
    expect(productionHashFix).toContain('canonical_approve_first_live_send')
    expect(productionHashFix).toMatch(
      /update\s+public\.canonical_command_results\s+set\s+request_payload\s*=\s*v_request\s*,\s*request_hash\s*=\s*v_hash/,
    )
    expect(productionHashFix).toContain("command_type = 'ediel.production.transition'")
    expect(productionHashFix).toContain(
      "command_type = 'ediel.production.first_live_send.approve'",
    )
  })

  it('verifies the same primary tenant_website client the go-live summary shows', () => {
    // Summary prefers metadata.primary; verify previously took newest by created_at.
    expect(tenantWebsiteClient).toContain('selectPrimaryTenantWebsiteClient')
    expect(goLiveSummary).toContain('selectPrimaryTenantWebsiteClient')
    expect(goLiveActions).toContain('selectPrimaryTenantWebsiteClient')
    expect(goLiveActions).not.toMatch(
      /from\('integration_api_clients'\)[\s\S]*?\.eq\('profile_key', 'tenant_website'\)[\s\S]*?\.limit\(1\)\.maybeSingle\(\)/,
    )
  })
})
