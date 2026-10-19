import { expect, it } from 'vitest'
import type { Database } from '@/supabase/database.types'
import { readManualMailWithAi } from '@/lib/inbound-mail/manualMailAiReader'

// Explicitly opt-in: default local/CI test runs never call a paid provider.
it.skipIf(process.env.GRIDEX_VERIFY_PRODUCTION_AI !== '1')('verifies the deployed production AI credential using only synthetic mail text', async () => {
  const result = await readManualMailWithAi('Avtalet löper till 2027-03-31.', {
    enabled: true, apiKey: process.env.OPENAI_API_KEY?.trim(),
  })
  // Only safe status metadata is logged; neither headers nor provider bodies.
  if (result.status !== 'completed') throw new Error(`Production AI check failed: ${result.reason}`)
  expect(result.mode).toBe('read_only')
  expect(result.fields).toContainEqual({ field: 'contract_end', value: '2027-03-31', quote: 'Avtalet löper till 2027-03-31.' })
  console.info('GRIDEX_MANUAL_MAIL_AI_PRODUCTION_CHECK', JSON.stringify({
    status: result.status, model: result.model, usage: result.usage, estimated_cost_usd: result.estimated_cost_usd,
  }))
}, 20_000)

it.skipIf(process.env.GRIDEX_VERIFY_PRODUCTION_AI !== '1')('verifies the configured production automation actor without changing its identity or permissions', async () => {
  const { getSupabaseServiceEnv } = await import('@/lib/env/supabaseServer')
  if (new URL(getSupabaseServiceEnv().url).hostname !== 'piidsfebjqjmnepdpnas.supabase.co') {
    throw new Error('Production mail check failed: unexpected_database_project')
  }
  const { validateAutomationUserConfig } = await import('@/lib/customer-operations/automationConfig')
  const { ok, issue, userId } = await validateAutomationUserConfig()
  console.info('GRIDEX_MANUAL_MAIL_AUTOMATION_PRODUCTION_CHECK', JSON.stringify({ ok, issue, mode: 'read_only' }))
  if (!ok || !userId) throw new Error(`Production mail check failed: automation_actor_${issue}`)

  // Explicit operator-only inventory across active case companies. No tenant
  // is chosen from email data, and this audit never changes authorization.
  let failureCode = 'automation_actor_scope_read_unavailable'
  try {
    const { supabaseService } = await import('@/lib/supabase/service')
    const maximumRows = 500
    const terminalStatuses = '(completed,cancelled,canceled,rejected,failed)'
    const [memberships, requests, switches] = await Promise.all([
      supabaseService.from('company_memberships')
        .select<'company_id', Pick<Database['public']['Tables']['company_memberships']['Row'], 'company_id'>>('company_id', { count: 'exact' })
        .eq('user_id', userId).eq('status', 'active').eq('is_active', true)
        .not('accepted_at', 'is', null).limit(maximumRows + 1),
      supabaseService.from('grid_owner_information_requests')
        .select<'company_id', Pick<Database['public']['Tables']['grid_owner_information_requests']['Row'], 'company_id'>>('company_id', { count: 'exact' })
        .not('status', 'in', terminalStatuses).limit(maximumRows + 1),
      supabaseService.from('supplier_switch_requests')
        .select<'company_id', Pick<Database['public']['Tables']['supplier_switch_requests']['Row'], 'company_id'>>('company_id', { count: 'exact' })
        .not('status', 'in', terminalStatuses).limit(maximumRows + 1),
    ])
    if (memberships.error || requests.error || switches.error
      || !memberships.data || !requests.data || !switches.data) throw new Error(failureCode)

    // A sentinel alone cannot prove completeness under a lower server cap.
    // Require exact matching totals before claiming any company is covered.
    failureCode = 'automation_actor_scope_scan_incomplete'
    if ([memberships, requests, switches].some(result => result.count === null
      || result.count > maximumRows || result.data === null || result.count !== result.data.length)) {
      throw new Error(failureCode)
    }
    const cases = [...requests.data, ...switches.data]
    const scopes = new Set<string>()
    failureCode = 'automation_actor_scope_case_unscoped'
    for (const row of cases) {
      if (!row.company_id) throw new Error(failureCode)
      scopes.add(row.company_id)
    }
    failureCode = 'automation_actor_scope_scan_incomplete'
    if (scopes.size > maximumRows) throw new Error(failureCode)

    const accepted = new Set(memberships.data.map(row => row.company_id))
    let membershipCovered = 0
    let permissionCovered = 0
    failureCode = 'automation_actor_scope_permission_unavailable'
    for (const companyId of scopes) {
      if (accepted.has(companyId)) membershipCovered += 1
      const args: Database['public']['Functions']['gridex_actor_has_company_permission']['Args'] = {
        p_actor_user_id: userId, p_company_id: companyId, p_permission: 'metering.write',
      }
      const permission = await supabaseService.rpc('gridex_actor_has_company_permission', args)
      if (permission.error) throw new Error(failureCode)
      if (permission.data === true) permissionCovered += 1
    }
    const covered = membershipCovered === scopes.size && permissionCovered === scopes.size
    console.info('GRIDEX_PRODUCTION_ACTOR_SCOPE_READONLY', JSON.stringify({
      ok: covered, mode: 'read_only', active_case_count: cases.length, scope_count: scopes.size,
      membership_covered_count: membershipCovered, permission_covered_count: permissionCovered,
      auth_profile_active: true, production_writes: 0,
    }))
    failureCode = 'automation_actor_scope_coverage_missing'
    if (!covered) throw new Error(failureCode)
  } catch {
    // SDK/transport failures can contain identifiers. Emit fixed codes only.
    throw new Error(`Production mail check failed: ${failureCode}`)
  }
}, 20_000)
