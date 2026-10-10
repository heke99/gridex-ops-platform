// Existing H native read-only source snapshots and failure-only SELECTs.
import { nativeSql as sql, literal } from './ediel-normal-switch-native-fixture'

type Row = Record<string, unknown>
type SmtpObservation = { send: { mock: { calls: readonly unknown[] } } }

// Capture the owning suite's live SMTP object; every query stays read-only.
export function createHNativeSourceInspection<Fixture extends { companyId: string }, Original extends { id: string }>(smtp: SmtpObservation) {
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
function rows(table: string, company: string, order = 'id') {
  return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY ${order}),'[]') FROM ${table} r WHERE company_id=${literal(company)}`)
}
function business(f: { companyId: string }) {
  return { customers: rows('public.customers', f.companyId), sites: rows('public.customer_sites', f.companyId),
    points: rows('public.metering_points', f.companyId), contracts: rows('public.customer_contracts', f.companyId),
    periods: rows('public.customer_supply_periods', f.companyId), permissions: rows('public.metering_permissions', f.companyId),
    switches: rows('public.supplier_switch_requests', f.companyId),
    transitions: rows('gridex_received_sources.supply_source_transitions', f.companyId, 'source_message_id'),
    confirmations: rows('gridex_received_sources.normal_switch_confirmations', f.companyId, 'period_id'),
    bilateral: rows('gridex_bilateral_prodat.supply_effect_receipts', f.companyId, 'source_message_id'),
    activations: rows('gridex_received_sources.normal_supply_activations', f.companyId, 'period_id') }
}
// Failure-only SELECTs expose the committed boundary without applying another
// effect, manufacturing a receipt, or changing the original assertion.
function effectFailureDiagnostic(companyId: string, sourceId: string) {
  try {
    return sql(`SELECT jsonb_build_object('stage','after_actual_processor',
      'canonicalLeaves',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'syntax',a.facts_text::jsonb->'syntaxDecision','application',a.facts_text::jsonb->'applicationDecision',
        'functional',a.facts_text::jsonb->'functionalDecision','registerValidation',a.facts_text::jsonb->'registerValidation')),'[]')
        FROM gridex_received_sources.validation_assessments a WHERE a.company_id=${literal(companyId)} AND a.source_message_id=${literal(sourceId)}
        AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)),
      'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(companyId)} AND source_message_id=${literal(sourceId)}),
      'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(companyId)} AND source_message_id=${literal(sourceId)}),
      'capabilityReceipts',(SELECT count(*) FROM gridex_bilateral_prodat.source_capability_receipts WHERE company_id=${literal(companyId)} AND source_message_id=${literal(sourceId)}),
      'blockedAckGuards',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'family',e.event_payload->>'ackFamily','guard',left(e.message,512))),'[]')
        FROM public.ediel_message_events e WHERE e.company_id=${literal(companyId)} AND e.ediel_message_id=${literal(sourceId)}
        AND e.event_type='manual_note' AND e.event_status='warning'
        AND e.event_payload->>'blockedBy'='canonical_inbound_ack_guard'))`)
  } catch (error) { return {stage:'diagnostic_select_failed',message:record(error).message ?? String(error)} }
}
function sealed(id: string) {
  return sql(`SELECT jsonb_build_object('id',m.id,'raw',m.raw_payload,'hash',m.immutable_payload_hash,
    'company',m.company_id,'direction',m.direction,'environment',m.environment,'receivedAt',m.message_received_at,
    'canonical',jsonb_build_object('pack',m.canonical_rule_pack_id,'key',m.rule_profile_key,'profile',m.rule_profile_version_id,
      'version',m.rule_profile_version,'checksum',m.rule_pack_checksum,'snapshot',m.rule_pack_snapshot),
    'execution',m.execution_context_snapshot,
    'inbound',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE source_message_id=m.id),
    'rules',(SELECT to_jsonb(r) FROM gridex_ediel_source_rules.receipts r WHERE source_message_id=m.id),
    'source',(SELECT to_jsonb(r) FROM gridex_received_sources.sources r WHERE source_message_id=m.id))
    FROM public.ediel_messages m WHERE id=${literal(id)}`)
}
function durable(f: Fixture, original: Original, sourceId: string) {
  // Existing original/control sources only: a fresh negative source may acquire
  // its own assessments and timers without changing this protected replay graph.
  const scoped = (table: string, key = 'id', sourceKey = 'source_message_id') => sql<Row[]>(
    `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY ${key}),'[]') FROM ${table} r
      WHERE company_id=${literal(f.companyId)} AND ${sourceKey} IN(${literal(original.id)},${literal(sourceId)})`)
  return { business: business(f), original: sealed(original.id), source: sealed(sourceId),
    profiles: rows('gridex_bilateral_prodat.profile_versions', f.companyId), origins: rows('gridex_bilateral_prodat.origins', f.companyId, 'ground_id'),
    artifacts: rows('gridex_bilateral_prodat.artifacts', f.companyId), reviews: rows('gridex_bilateral_prodat.reviews', f.companyId),
    snapshots: rows('public.customer_operation_request_snapshots', f.companyId),
    sourceCapabilities: rows('gridex_bilateral_prodat.source_capability_receipts', f.companyId, 'source_message_id'),
    outboundOperations: rows('gridex_bilateral_prodat.outbound_operations', f.companyId, 'message_id'),
    outboundReceipts: rows('gridex_bilateral_prodat.outbound_receipts', f.companyId, 'message_id'),
    switchOriginals: rows('gridex_received_sources.switch_originals', f.companyId, 'message_id'),
    ownerWitnesses: rows('gridex_ediel_outbound_owner.witnesses', f.companyId),
    ownerConsumptions: rows('gridex_ediel_outbound_owner.consumptions', f.companyId, 'witness_id'),
    requests: rows('public.outbound_requests', f.companyId),
    responseBindings: rows('gridex_ediel_ack_guide.prodat_response_owner_bindings', f.companyId, 'witness_id'),
    structuralBindings: rows('gridex_ediel_ack_guide.prodat_structural_response_bindings', f.companyId, 'witness_id'),
    assessments: scoped('gridex_received_sources.validation_assessments'),
    ignoredFacets: scoped('gridex_received_sources.prodat_ignored_field_facets', 'canonical_assessment_id'),
    objectFacets: scoped('gridex_received_sources.prodat_object_validation_facets', 'assessment_id'),
    responseFacets: scoped('gridex_received_sources.prodat_response_facets', 'assessment_id'),
    applicationFacets: scoped('gridex_received_sources.prodat_application_facets', 'assessment_id'),
    functionFacets: scoped('gridex_received_sources.prodat_source_function_facets', 'assessment_id'),
    timers: scoped('public.ediel_sla_timers', 'id', 'ediel_message_id'),
    expectations: scoped('public.ediel_business_expectations'),
    messages: sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'raw',raw_payload,'hash',immutable_payload_hash,
      'company',company_id,'environment',environment,'direction',direction,'family',message_family,'code',message_code,
      'customer',customer_id,'site',site_id,'point',metering_point_id,
      'related',related_message_id,'canonical',jsonb_build_object('pack',canonical_rule_pack_id,'key',rule_profile_key,
      'profile',rule_profile_version_id,'version',rule_profile_version,'checksum',rule_pack_checksum,'snapshot',rule_pack_snapshot),
      'execution',execution_context_snapshot) ORDER BY id),'[]')
      FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}`),
    outboxes: rows('public.ediel_outbox', f.companyId), attempts: rows('gridex_ediel_transport.attempts', f.companyId),
    sent: smtp.send.mock.calls.length }
}
  return { record, rows, business, sealed, durable, effectFailureDiagnostic }
}
