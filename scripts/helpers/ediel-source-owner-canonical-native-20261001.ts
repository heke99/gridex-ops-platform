// Legitimate local source-owner setup. These helpers use the configured real
// service Data API; no received/dispatch receipt or verified flag is supplied.
import { expect } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'

export async function receiveSourceOwnerZ04(input: {
  id: string; companyId: string; customerId: string; siteId: string; pointId: string; switchId: string
  rawPayload: string; parsedPayload: EdielMessageRow['parsed_payload']
  receivedAt: string; senderEdielId: string; receiverEdielId: string
}) {
  const { data: profile, error: profileError } = await supabaseService
    .from('ediel_message_profiles').select('id,profile_key,profile,rule_pack_id')
    .eq('profile_key', 'PRODAT:Z04:L:26.A:r3').eq('is_enabled', true).single()
  expect(profileError).toBeNull(); expect(profile).toBeTruthy()
  const { data: pack, error: packError } = await supabaseService
    .from('ediel_rule_packs').select('id,guide_version,guide_revision,source_hash')
    .eq('id', profile!.rule_pack_id).single()
  expect(packError).toBeNull(); expect(pack).toBeTruthy()
  const { data, error } = await supabaseService.from('ediel_messages').insert({
    id: input.id, company_id: input.companyId, customer_id: input.customerId,
    site_id: input.siteId, metering_point_id: input.pointId, switch_request_id: input.switchId, environment: 'test',
    direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT',
    message_code: 'Z04', status: 'received', raw_payload: input.rawPayload,
    parsed_payload: input.parsedPayload, message_received_at: input.receivedAt,
    application_reference: '23-DDQ-PRODAT', sender_ediel_id: input.senderEdielId,
    receiver_ediel_id: input.receiverEdielId, canonical_rule_pack_id: pack!.id,
    rule_profile_key: profile!.profile_key, rule_profile_version_id: profile!.id,
    rule_profile_version: `${pack!.guide_version}:r${pack!.guide_revision}`,
    rule_pack_checksum: pack!.source_hash, rule_pack_snapshot: profile!.profile,
  }).select('*').single()
  expect(error).toBeNull(); expect(data).toBeTruthy()
  return data as unknown as EdielMessageRow
}

/** Hash complete rows inside PostgreSQL, retaining numeric and timestamp
 * precision. The caller binds only its own isolated company. */
export function sourceOwnerBusinessSnapshotSql(companyLiteral: string) {
  const tables = ['ediel_messages', 'supplier_switch_requests', 'customer_supply_periods',
    'customer_cases', 'ediel_message_events', 'ediel_ack_chains', 'supplier_switch_events',
    'outbound_requests', 'outbound_dispatch_events', 'customer_application_workflows',
    'customer_application_workflow_events', 'domain_events', 'event_outbox',
    'customer_operation_events', 'customer_operation_jobs', 'tenant_email_outbox', 'ediel_outbox', 'audit_logs']
  return `SELECT jsonb_build_object(${tables.map(table =>
    `'${table}',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.${table} x WHERE company_id=${companyLiteral})`).join(',')},
    'lifecycleReceipts',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY source_message_id),'[]')::text,'UTF8')),'hex') FROM private.gridex_inbound_switch_lifecycle_receipts x WHERE company_id=${companyLiteral}),
    'processFacts',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM gridex_correction_process.facts x WHERE company_id=${companyLiteral}));`
}
