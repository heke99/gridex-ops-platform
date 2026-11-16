import { supabaseService } from '@/lib/supabase/service'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { resolveAutomationActorId } from '@/lib/customer-operations/automationConfig'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'

type ClaimedJob = Pick<JobRow, 'id' | 'company_id' | 'customer_id' | 'customer_site_id' | 'metering_point_id'
  | 'job_type' | 'status' | 'locked_by' | 'lock_token' | 'created_by' | 'operation_id'>
type ServiceClient = typeof supabaseService
export type SupplierSwitchWorkerAuthority = Readonly<{ actorUserId: string; companyId: string }>
type Binding = { client: ServiceClient; job: ClaimedJob; actorUserId: string; purpose: 'start_supplier_switch' }
const bindings = new WeakMap<SupplierSwitchWorkerAuthority, Binding>()
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
const fields = ['id', 'company_id', 'customer_id', 'customer_site_id', 'metering_point_id', 'job_type',
  'status', 'locked_by', 'lock_token', 'created_by', 'operation_id'] as const
const forbidden = () => new Error('supplier_switch_worker_scope_forbidden')

/** Job identifiers select a current claimed row; creator identity alone grants nothing. */
async function requireCurrentJob(client: ServiceClient, selected: ClaimedJob): Promise<ClaimedJob> {
  if (client !== supabaseService || !uuid(selected.id) || !uuid(selected.company_id) || !uuid(selected.customer_id)
    || !uuid(selected.customer_site_id) || !uuid(selected.lock_token) || !selected.locked_by
    || selected.status !== 'running' || !['start_supplier_switch', 'recheck_switch_readiness'].includes(selected.job_type)) throw forbidden()
  const { data, error } = await client.from('customer_operation_jobs')
    .select('id,company_id,customer_id,customer_site_id,metering_point_id,job_type,status,locked_by,lock_token,created_by,operation_id')
    .eq('id', selected.id).eq('company_id', selected.company_id)
    .eq('status', 'running').eq('lock_token', selected.lock_token).eq('locked_by', selected.locked_by).maybeSingle()
  if (error) throw error
  if (!data || fields.some(field => data[field] !== selected[field])) throw forbidden()
  return Object.freeze(Object.fromEntries(fields.map(field => [field, data[field]]))) as ClaimedJob
}

async function requireCurrentActor(client: ServiceClient, job: ClaimedJob, expectedActor?: string): Promise<string> {
  const actorUserId = resolveAutomationActorId(job.created_by)
  if (expectedActor && actorUserId !== expectedActor) throw forbidden()
  // Never retry a denied assigned actor using the configured automation actor.
  await assertEdielTenantActor({ companyId: job.company_id, actorUserId, permission: 'communication.write' })
  const [company, operation] = await Promise.all([
    client.from('companies').select('id,status,is_active').eq('id', job.company_id).maybeSingle(),
    client.rpc('gridex_actor_has_company_permission', {
      p_actor_user_id: actorUserId, p_company_id: job.company_id, p_permission: 'operations.write',
    }),
  ])
  if (company.error) throw company.error
  if (operation.error) throw operation.error
  if (!company.data || company.data.id !== job.company_id || company.data.is_active === false
    || !isCompanyWritableInTenantWorkspace(company.data.status) || operation.data !== true) throw forbidden()
  return actorUserId
}

/** Internal service capability; not an HTTP action or a serializable tenant override. */
export async function authorizeSupplierSwitchWorkerJob(job: ClaimedJob, client: ServiceClient): Promise<SupplierSwitchWorkerAuthority> {
  const current = await requireCurrentJob(client, job)
  const actorUserId = await requireCurrentActor(client, current)
  const authority = Object.freeze({ companyId: current.company_id, actorUserId })
  bindings.set(authority, { client, job: current, actorUserId, purpose: 'start_supplier_switch' })
  return authority
}

/** Revalidate the claim/current authority at the business preflight boundary; consume once. */
export async function consumeSupplierSwitchWorkerAuthority(authority: SupplierSwitchWorkerAuthority, client: ServiceClient,
  target: { actorUserId: string; customerId: string; siteId?: string | null; meteringPointId?: string | null },
  purpose: 'start_supplier_switch'): Promise<string> {
  const binding = bindings.get(authority)
  if (!binding || binding.client !== client || client !== supabaseService || binding.purpose !== purpose
    || binding.actorUserId !== target.actorUserId || binding.job.customer_id !== target.customerId
    || binding.job.customer_site_id !== target.siteId
    || (binding.job.metering_point_id && binding.job.metering_point_id !== target.meteringPointId)) throw forbidden()
  bindings.delete(authority)
  const current = await requireCurrentJob(client, binding.job)
  await requireCurrentActor(client, current, binding.actorUserId)
  return current.company_id
}
