import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { isSchemaError } from '@/lib/http/apiError'
import { getSignedPowerOfAttorneyCoverage } from '@/lib/operations/powerOfAttorneyWorkflow'

export type ProvisioningStep =
  | 'application_persisted'
  | 'legal_persisted'
  | 'workflow_committed'
  | 'external_automation_queued'
  | 'compensated'
  | 'failed'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function recordProvisioningStep(input: {
  companyId: string
  applicationId: string
  operationId: string
  step: ProvisioningStep
  status: 'started' | 'completed' | 'failed'
  payload?: Record<string, unknown>
}) {
  const { error } = await supabaseService.rpc('gridex_record_application_provisioning_step', {
    p_company_id: input.companyId,
    p_customer_application_id: input.applicationId,
    p_operation_id: input.operationId,
    p_step: input.step,
    p_status: input.status,
    p_payload: input.payload ?? {},
  })
  if (error) {
    if (isSchemaError(error)) throw new Error('Kundansökans provisioning-saga saknas. Kör den senaste OPS-migrationen innan automation startas.')
    throw error
  }
}

async function canonicalProvisioningSnapshot(input: {
  companyId: string
  customerId: string
  powerOfAttorneyId?: string | null
  snapshot: Record<string, unknown>
}) {
  const powerOfAttorneyId = clean(input.powerOfAttorneyId)
  if (!powerOfAttorneyId) {
    return {
      ...input.snapshot,
      poa_externally_sendable: false,
      poa_canonical_verified: false,
    }
  }

  const signed = await getSignedPowerOfAttorneyCoverage({
    companyId: input.companyId,
    customerId: input.customerId,
    powerOfAttorneyId,
  })
  if (!signed) {
    return {
      ...input.snapshot,
      poa_externally_sendable: false,
      poa_canonical_verified: false,
    }
  }

  // The workflow must trust the immutable canonical POA that was actually
  // persisted, not a stale pre-commit boolean from the website payload. A
  // signed supplier-switch scope is sufficient for the external switch flow;
  // facility_information_lookup additionally covers metering/facility lookup.
  const supplierSwitchScope = signed.signedScopes.some(
    (scope) => scope.trim().toLowerCase() === 'supplier_switch',
  )
  return {
    ...input.snapshot,
    poa_externally_sendable: supplierSwitchScope,
    poa_canonical_verified: true,
    poa_signed_scopes: signed.signedScopes,
    poa_coverage: signed.coverage,
  }
}

export async function commitApplicationProvisioning(input: {
  companyId: string
  applicationId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  powerOfAttorneyId?: string | null
  desiredState: 'pending_customer_data' | 'ready_for_switch' | 'pending_review'
  snapshot: Record<string, unknown>
}): Promise<{ operationId: string; state: string; workflowId: string | null; continuationJobId: string | null }> {
  const operationId = randomUUID()
  const snapshot = await canonicalProvisioningSnapshot({
    companyId: input.companyId,
    customerId: input.customerId,
    powerOfAttorneyId: input.powerOfAttorneyId,
    snapshot: input.snapshot,
  })
  const { data, error } = await supabaseService.rpc('gridex_commit_customer_application_provisioning', {
    p_company_id: input.companyId,
    p_customer_application_id: input.applicationId,
    p_customer_id: input.customerId,
    p_customer_site_id: input.siteId ?? null,
    p_metering_point_id: input.meteringPointId ?? null,
    p_contract_id: input.contractId ?? null,
    p_power_of_attorney_id: clean(input.powerOfAttorneyId),
    p_operation_id: operationId,
    p_state: input.desiredState,
    p_snapshot: snapshot,
  })
  if (error) {
    if (isSchemaError(error)) throw new Error('Kundansökans atomiska commit saknas. Kör den senaste OPS-migrationen innan automation startas.')
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  const result = row as {
    operation_id?: unknown
    state?: unknown
    workflow_id?: unknown
    continuation_job_id?: unknown
  } | null
  return {
    operationId: clean(result?.operation_id) ?? operationId,
    state: clean(result?.state) ?? input.desiredState,
    workflowId: clean(result?.workflow_id),
    continuationJobId: clean(result?.continuation_job_id),
  }
}

export async function failApplicationProvisioning(input: {
  companyId: string
  applicationId: string
  operationId?: string | null
  code: string
  detail: string
}) {
  const operationId = clean(input.operationId) ?? randomUUID()
  try {
    await recordProvisioningStep({
      companyId: input.companyId,
      applicationId: input.applicationId,
      operationId,
      step: 'failed',
      status: 'failed',
      payload: { code: input.code, detail: input.detail },
    })
  } catch (error) {
    console.error('[customer-application-saga] failure recording failed', error)
  }
}
