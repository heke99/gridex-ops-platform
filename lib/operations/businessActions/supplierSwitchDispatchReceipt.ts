import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

type Scope = { companyId: string; customerId: string; siteId: string; meteringPointId: string; switchRequestId: string; actorUserId: string }
type Receipt = { state: 'queued' | 'in_progress' | 'accepted'; messageId: string; outboxId?: string }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Read-only confirmation, never a resume/requeue permission. The physical
 * enqueue/resume transaction remains owned by the canonical DB producer. */
export async function readSupplierSwitchDispatchReceipt(scope: Scope): Promise<Receipt | null> {
  const source = await supabaseService.from('supplier_switch_requests').select('id,site_id,customer_site_id,metering_point_id,outbound_z03_message_id,request_type,prodat_variant,prodat_reason,status,requested_start_date,power_of_attorney_id,authorization_document_id,lifecycle_blocked,lifecycle_block_id,paused_at')
    .eq('company_id', scope.companyId).eq('customer_id', scope.customerId).eq('id', scope.switchRequestId).maybeSingle()
  if (source.error) throw source.error
  const s = source.data
  if (!s?.outbound_z03_message_id || (s.site_id ?? s.customer_site_id) !== scope.siteId
    || (s.site_id != null && s.site_id !== scope.siteId) || (s.customer_site_id != null && s.customer_site_id !== scope.siteId)
    || s.metering_point_id !== scope.meteringPointId) return null
  if (!['switch', 'move_in'].includes(s.request_type) || s.prodat_variant === 'C' || s.prodat_reason === 'Z24'
    || ['cancellation_requested', 'cancelled', 'failed', 'rejected', 'withdrawn', 'superseded', 'closed', 'completed', 'needs_review', 'manual_followup_required'].includes(s.status)
    || s.lifecycle_blocked !== false || s.lifecycle_block_id !== null || s.paused_at !== null) return null
  const subtype = s.prodat_variant === 'H' || s.prodat_reason === 'Z25' ? 'H'
    : s.request_type === 'move_in' || s.prodat_variant === 'LK' || s.prodat_reason === 'Z23' ? 'LK' : 'L'
  if (subtype === 'H' && (s.prodat_variant !== 'H' || s.prodat_reason !== 'Z25')) return null
  const original = await supabaseService.from('ediel_messages')
    .select('id,environment,status,direction,message_standard,message_family,message_code,customer_id,site_id,metering_point_id,switch_request_id,source_operation_id,intent_id,outbound_request_id,route_profile_id,communication_route_id,immutable_payload_hash,immutable_rendered_at,raw_payload')
    .eq('company_id', scope.companyId).eq('id', s.outbound_z03_message_id).maybeSingle()
  if (original.error) throw original.error
  const m = original.data
  if (!m || m.customer_id !== scope.customerId || m.site_id !== scope.siteId || m.metering_point_id !== scope.meteringPointId
    || m.switch_request_id !== scope.switchRequestId || m.source_operation_id !== scope.switchRequestId
    || m.direction !== 'outbound' || m.message_standard !== 'edifact' || m.message_family !== 'PRODAT' || m.message_code !== 'Z03'
    || !['test', 'production'].includes(m.environment) || !m.intent_id || !m.outbound_request_id || !m.route_profile_id || !m.communication_route_id
    || !m.immutable_rendered_at || !m.raw_payload || !m.immutable_payload_hash
    || createHash('sha256').update(m.raw_payload, 'utf8').digest('hex') !== m.immutable_payload_hash) return null
  const [intent, outbound] = await Promise.all([
    supabaseService.from('ediel_message_intents').select('id,environment,customer_id,customer_site_id,supplier_switch_request_id,operation_id,ediel_message_id,outbound_request_id,direction,message_family,message_code,validation_status,render_status,communication_route_id,route_profile_id,requested_effective_date,payload')
      .eq('company_id', scope.companyId).eq('id', m.intent_id).maybeSingle(),
    supabaseService.from('outbound_requests').select('id,environment,customer_id,site_id,metering_point_id,source_type,source_id,operation_id,request_type,communication_route_id')
      .eq('company_id', scope.companyId).eq('id', m.outbound_request_id).maybeSingle(),
  ])
  if (intent.error) throw intent.error
  if (outbound.error) throw outbound.error
  const i = intent.data, r = outbound.data
  const basis = record(i?.payload)
  if (!i || !r || i.environment !== m.environment || r.environment !== m.environment
    || i.customer_id !== scope.customerId || i.customer_site_id !== scope.siteId || i.supplier_switch_request_id !== scope.switchRequestId
    || i.operation_id !== scope.switchRequestId || i.ediel_message_id !== m.id || i.outbound_request_id !== r.id
    || i.direction !== 'outbound' || i.message_family !== 'PRODAT' || i.message_code !== 'Z03'
    || i.validation_status !== 'validated' || i.render_status !== 'rendered'
    || i.requested_effective_date !== s.requested_start_date || basis.requestType !== s.request_type
    || basis.transactionSubtype !== subtype || basis.reasonForTransaction !== (subtype === 'H' ? 'Z25' : subtype === 'LK' ? 'Z23' : 'Z22')
    || (basis.power_of_attorney_id ?? null) !== (s.power_of_attorney_id ?? null)
    || (s.authorization_document_id != null && basis.authorization_document_id !== s.authorization_document_id)
    || i.communication_route_id !== m.communication_route_id || i.route_profile_id !== m.route_profile_id
    || r.customer_id !== scope.customerId || r.site_id !== scope.siteId || r.metering_point_id !== scope.meteringPointId
    || r.source_type !== 'supplier_switch_request' || r.source_id !== scope.switchRequestId || r.operation_id !== scope.switchRequestId
    || r.request_type !== 'supplier_switch' || r.communication_route_id !== m.communication_route_id) return null
  const entries = await supabaseService.from('ediel_outbox')
    .select('id,status,intent_id,route_profile_id,source_message_id,lock_key,payload,immutable_payload_hash,attempts,send_attempt_count,current_send_attempt_id,locked_at,locked_by')
    .eq('company_id', scope.companyId).eq('environment', m.environment).eq('ediel_message_id', m.id).limit(2)
  if (entries.error) throw entries.error
  if (entries.data?.length === 1) {
    const o = entries.data[0]
    if (o.intent_id === i.id && o.route_profile_id === m.route_profile_id && o.source_message_id === null
      && o.lock_key === `outbound:${r.id}:${m.id}` && record(o.payload).outboundRequestId === r.id
      && (o.immutable_payload_hash === null || o.immutable_payload_hash === m.immutable_payload_hash)) {
      if (o.status === 'queued' && m.status === 'queued' && o.attempts === 0 && o.send_attempt_count === 0
        && o.current_send_attempt_id === null && o.locked_at === null && o.locked_by === null) return { state: 'queued', messageId: m.id, outboxId: o.id }
      const age = o.locked_at ? Date.now() - Date.parse(o.locked_at) : NaN
      if (o.status === 'sending' && ['queued', 'dispatching'].includes(m.status) && o.current_send_attempt_id && o.locked_by
        // Matches sendOutboxItem's strict ten-minute claim lease. An expired
        // reservation is uncertain, not proof of an active worker.
        && o.attempts > 0 && o.send_attempt_count > 0 && age >= 0 && age < 10 * 60000) return { state: 'in_progress', messageId: m.id, outboxId: o.id }
    }
  }
  // Fresh queue/active-lease confirmation above preserves the caller's
  // existing write authority. Reading private acceptance uses its separate
  // existing actor permission; never substitute a more privileged identity.
  // This server function checks both append-only journals and original bytes.
  const projection = await supabaseService.rpc('gridex_ediel_accepted_transport_projection_v1', {
    p_company_id: scope.companyId, p_environment: m.environment, p_actor_user_id: scope.actorUserId, p_message_id: m.id,
  })
  if (projection.error) throw projection.error
  const accepted = record(projection.data)
  if (projection.data != null && accepted.status === 'accepted_projection' && accepted.companyId === scope.companyId
    && accepted.environment === m.environment && accepted.messageId === m.id && accepted.originalHash === m.immutable_payload_hash
    && typeof accepted.attemptId === 'string' && typeof accepted.observedAt === 'string' && Number.isFinite(Date.parse(accepted.observedAt))
    && accepted.authorizesProviderEntry === false && accepted.deliveryProven === false) return { state: 'accepted', messageId: m.id }
  return null
}
