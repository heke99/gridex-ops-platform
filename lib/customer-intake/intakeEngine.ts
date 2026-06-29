import { supabaseService } from '@/lib/supabase/service'
import { calculateIntakeReadiness, type IntakeReadinessInput, type IntakeReadinessResult } from '@/lib/customer-intake/readinessEngine'

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function minimalIntakeValues(values: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in values) output[key] = values[key]
  }
  return output
}

export type IntakeApiClient = {
  id?: string | null
  company_id?: string | null
  companyId?: string | null
}

export function resolveIntakeTenantFromApiClient(client: IntakeApiClient): string {
  const companyId = client.company_id ?? client.companyId ?? null
  if (!companyId) throw new Error('website_api_client_missing_company_scope')
  return companyId
}

export async function resolveIntakeTenantFromAdmin(actorUserId: string): Promise<string> {
  const { data, error } = await supabaseService
    .from('company_memberships')
    .select('company_id,role,status')
    .eq('user_id', actorUserId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  const companyId = (data as { company_id?: string | null } | null)?.company_id
  if (!companyId) throw new Error('admin_missing_operational_company_scope')
  return companyId
}

export async function validateContractForTenant(params: {
  companyId: string
  contractId?: string | null
  pricePlanVersionId?: string | null
}): Promise<void> {
  if (params.contractId) {
    const { data, error } = await supabaseService
      .from('customer_contracts')
      .select('id')
      .eq('company_id', params.companyId)
      .eq('id', params.contractId)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('contract_does_not_belong_to_company')
  }

  if (params.pricePlanVersionId) {
    const { data, error } = await supabaseService
      .from('price_plan_versions')
      .select('id')
      .eq('company_id', params.companyId)
      .eq('id', params.pricePlanVersionId)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('price_plan_version_does_not_belong_to_company')
  }
}

export async function calculateCustomerIntakeReadiness(input: IntakeReadinessInput): Promise<IntakeReadinessResult> {
  return calculateIntakeReadiness(input)
}

export async function createOrUpdateCustomerTenantSafe(input: {
  companyId: string
  customerId?: string | null
  values: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  if (input.customerId) {
    const { data, error } = await supabaseService
      .from('customers')
      .update({ ...input.values, updated_at: new Date().toISOString() })
      .eq('company_id', input.companyId)
      .eq('id', input.customerId)
      .select('*')
      .single()
    if (error) throw error
    return data as Record<string, unknown>
  }

  const { data, error } = await supabaseService
    .from('customers')
    .insert({ ...input.values, company_id: input.companyId })
    .select('*')
    .single()
  if (error) throw error
  return data as Record<string, unknown>
}

export async function createOrUpdateSiteTenantSafe(input: {
  companyId: string
  siteId?: string | null
  values: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  if (input.siteId) {
    const { data, error } = await supabaseService
      .from('customer_sites')
      .update({ ...input.values, updated_at: new Date().toISOString() })
      .eq('company_id', input.companyId)
      .eq('id', input.siteId)
      .select('*')
      .single()
    if (error) throw error
    return data as Record<string, unknown>
  }

  const { data, error } = await supabaseService
    .from('customer_sites')
    .insert({ ...input.values, company_id: input.companyId })
    .select('*')
    .single()
  if (!error) return data as Record<string, unknown>
  if (!missingSchema(error)) throw error

  const fallbackPayload = {
    ...minimalIntakeValues(input.values, ['customer_id', 'site_name', 'facility_id', 'status']),
    company_id: input.companyId,
  }
  const fallback = await supabaseService
    .from('customer_sites')
    .insert(fallbackPayload)
    .select('*')
    .single()
  if (fallback.error) throw fallback.error
  return fallback.data as Record<string, unknown>
}

export async function createOrUpdateMeteringPointTenantSafe(input: {
  companyId: string
  meteringPointId?: string | null
  values: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  if (input.meteringPointId) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .update({ ...input.values, updated_at: new Date().toISOString() })
      .eq('company_id', input.companyId)
      .eq('id', input.meteringPointId)
      .select('*')
      .single()
    if (error) throw error
    return data as Record<string, unknown>
  }

  const { data, error } = await supabaseService
    .from('metering_points')
    .insert({ ...input.values, company_id: input.companyId })
    .select('*')
    .single()
  if (!error) return data as Record<string, unknown>
  if (!missingSchema(error)) throw error

  const fallbackPayload = {
    ...minimalIntakeValues(input.values, ['customer_id', 'site_id', 'customer_site_id', 'metering_point_id', 'meter_point_id', 'status']),
    company_id: input.companyId,
  }
  const fallback = await supabaseService
    .from('metering_points')
    .insert(fallbackPayload)
    .select('*')
    .single()
  if (fallback.error) throw fallback.error
  return fallback.data as Record<string, unknown>
}

export async function createLegalAcceptances(input: {
  companyId: string
  rows: Array<Record<string, unknown>>
}): Promise<void> {
  if (input.rows.length === 0) return
  const { error } = await supabaseService
    .from('customer_legal_acceptances')
    .insert(input.rows.map((row) => ({ ...row, company_id: input.companyId })))
  if (error) throw error
}

export async function createPowerOfAttorney(input: {
  companyId: string
  values: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .insert({ ...input.values, company_id: input.companyId })
    .select('*')
    .single()
  if (error) throw error
  return data as Record<string, unknown>
}

export async function createContractSnapshot(input: {
  companyId: string
  values: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseService
    .from('contract_price_snapshots')
    .insert({ ...input.values, company_id: input.companyId })
    .select('*')
    .single()
  if (error) throw error
  return data as Record<string, unknown>
}
