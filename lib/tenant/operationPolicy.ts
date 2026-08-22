import { supabaseService } from '@/lib/supabase/service'

export type TenantOperation =
  | 'email.send'
  | 'webhook.deliver'
  | 'ediel.production.send'
  | 'ediel.test.process'
  | 'customer_automation.execute'
  | 'facility_lookup.execute'
  | 'invitation.accept'
  | 'company_user.manage'
  | 'production.prepare'
  | 'production.activate'
  | 'production.pause'
  | 'production.resume'
  | 'contract_channel.sell'
  | 'api_client.execute'

export type TenantOperationDecision = {
  allowed: boolean
  reason_code: string
  company_status: string | null
  capability_status: string | null
  production_status: string | null
  state_version: number
}

const TENANT_API_BUNDLE_OPERATIONS = new Set<TenantOperation>([
  'api_client.execute',
  'contract_channel.sell',
  'customer_automation.execute',
  'facility_lookup.execute',
  'email.send',
  'webhook.deliver',
])

async function hasActiveTenantApiBundle(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .eq('profile_key', 'tenant_website')
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Boolean(data?.id)
}

function normalizedDecision(
  row: Partial<TenantOperationDecision> | null,
): TenantOperationDecision {
  return {
    allowed: row?.allowed === true,
    reason_code: row?.reason_code ?? 'tenant_operation_decision_missing',
    company_status: row?.company_status ?? null,
    capability_status: row?.capability_status ?? null,
    production_status: row?.production_status ?? null,
    state_version: Number(row?.state_version ?? 0),
  }
}

export async function getTenantOperationDecision(
  companyId: string,
  operation: TenantOperation
): Promise<TenantOperationDecision> {
  if (!companyId) throw new Error('tenant_operation_company_id_required')
  const { data, error } = await supabaseService.rpc('canonical_tenant_operation_decision', {
    p_company_id: companyId,
    p_operation: operation,
  })
  if (error) throw error

  const row = (Array.isArray(data) ? data[0] : data) as Partial<TenantOperationDecision> | null
  const decision = normalizedDecision(row)
  if (decision.allowed) return decision

  // A canonical tenant_website API grant is the integration access grant.
  // Historical per-capability rows must not create a second activation step.
  // We only bypass stale capability_not_ready rows: tenant lifecycle and
  // production gates (for example Ediel/live sales) remain fail-closed.
  if (
    decision.reason_code === 'capability_not_ready' &&
    decision.company_status === 'active' &&
    TENANT_API_BUNDLE_OPERATIONS.has(operation) &&
    await hasActiveTenantApiBundle(companyId)
  ) {
    return {
      ...decision,
      allowed: true,
      reason_code: 'allowed_by_tenant_api_bundle',
      capability_status: 'api_bundle',
    }
  }

  return decision
}

export async function requireTenantOperationAllowed(companyId: string, operation: TenantOperation) {
  const decision = await getTenantOperationDecision(companyId, operation)
  if (!decision.allowed) {
    throw new Error(`tenant_operation_blocked:${operation}:${decision.reason_code}`)
  }
  return decision
}
