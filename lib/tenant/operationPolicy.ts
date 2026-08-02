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
  if (!row || row.allowed !== true) {
    return {
      allowed: false,
      reason_code: row?.reason_code ?? 'tenant_operation_decision_missing',
      company_status: row?.company_status ?? null,
      capability_status: row?.capability_status ?? null,
      production_status: row?.production_status ?? null,
      state_version: Number(row?.state_version ?? 0),
    }
  }
  return {
    allowed: true,
    reason_code: row.reason_code ?? 'allowed',
    company_status: row.company_status ?? null,
    capability_status: row.capability_status ?? null,
    production_status: row.production_status ?? null,
    state_version: Number(row.state_version ?? 0),
  }
}

export async function requireTenantOperationAllowed(companyId: string, operation: TenantOperation) {
  const decision = await getTenantOperationDecision(companyId, operation)
  if (!decision.allowed) {
    throw new Error(`tenant_operation_blocked:${operation}:${decision.reason_code}`)
  }
  return decision
}
