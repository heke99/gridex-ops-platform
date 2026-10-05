import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shared = readFileSync('lib/ediel/flows/shared.ts', 'utf8')
const z01 = readFileSync('lib/ediel/flows/prodatCustomerMasterdata.ts', 'utf8')
const z03 = readFileSync('lib/ediel/flows/prodatSwitch.ts', 'utf8')


describe('Ediel server-side database client contract', () => {
  it('uses the service client for server-only Ediel domain flows', () => {
    expect(shared).toContain("import { supabaseService } from '@/lib/supabase/service'")
    expect(shared).toMatch(/export async function makeServerClient\(\)\s*{\s*return supabaseService\s*}/)
    expect(shared).not.toContain('createSupabaseServerClient')
  })

  it('keeps Z01 and Z03 on the shared server-only client contract', () => {
    expect(z01).toContain('const supabase = await makeServerClient()')
    expect(z03).toContain('const supabase = await makeServerClient()')
  })

  it('does not weaken canonical routing or switch gates', () => {
    expect(z01).toContain('resolveDecisionBackedOutboundContext')
    expect(z03).toContain("supabaseService.rpc('gridex_assert_supplier_switch_ready'")
    expect(z03).toContain('resolveDecisionBackedOutboundContext')
  })
})
