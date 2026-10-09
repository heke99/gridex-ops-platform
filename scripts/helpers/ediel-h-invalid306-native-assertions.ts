// Test-only downstream contract. Entrance stays behind the native strict E22
// A/R/A + actual typed306/42 gate. No fixture writes, sends or owner capture.
import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { listBusinessAckMessagesForSource } from '@/lib/ediel/inbound/businessAckMessages'
import { readPersistedEdielTechnicalContrlBasis } from '@/lib/ediel/ack/technicalSyntaxAuthority'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { originalAckPartyIdentities } from '@/lib/ediel/core/originalAckPartyIdentities'
import { segmentComposite, segmentElementCount, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import { nativeSql as sql, literal } from './ediel-normal-switch-native-fixture'

type Row = Record<string, unknown>
type Input = {
  companyId: string; actorUserId: string; point: string; li: string
  source: EdielMessageRow; decision: CanonicalRuntimeDecision
  business: () => unknown; durable: () => Row; sourceSeal: () => unknown
  rereadControl: () => Promise<void>; negativeAcknowledgement: () => Promise<void>
  smtpCalls: () => number
}
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
/** Diagnostic codes come only from fixed canonical ACK/preflight owners.
 * Source wrapper text grants no ACK authority; descriptions are never logged. */
const nativeAckWrapperCodes=new Set([
  'ACK_APERAK_ACCEPTANCE_CODE_INVALID',
  'ACK_APERAK_BGM_CARDINALITY',
  'ACK_APERAK_DOCUMENT_DATE_INVALID',
  'ACK_APERAK_ERROR_GROUP_MISSING',
  'ACK_APERAK_FIELD_REFERENCE_INVALID',
  'ACK_APERAK_LEGAL_PARTY_INVALID',
  'ACK_APERAK_ORIGINAL_LEGAL_PARTY_MISMATCH',
  'ACK_APERAK_OWN_TEXT_INVALID',
  'ACK_APERAK_POSITIVE_TEXT_INVALID',
  'ACK_APERAK_PROFILE_INVALID',
  'ACK_GUIDE_ONE_MESSAGE_REQUIRED',
  'ACK_ORIGINAL_TECHNICAL_ROUTE_MISMATCH',
  'ACK_PRODAT_APPLICATION_TEXT_INVALID',
  'ACK_PRODAT_FIELD_REFERENCE_UNKNOWN',
  'ACK_PRODAT_INVALID_TEXT_INVALID',
  'ACK_PRODAT_MESSAGE_FUNCTION_INVALID',
  'ACK_PRODAT_MISSING_TEXT_INVALID',
  'ACK_PRODAT_ORIGINAL_DOCUMENT_INVALID',
  'ACK_PRODAT_ORIGINAL_DOCUMENT_MISMATCH',
  'ACK_PRODAT_OWN_OBJECT_OUTCOME_CONFLICT',
  'ACK_PRODAT_OWN_OBJECT_REFERENCE_INVALID',
  'ACK_PRODAT_OWN_OBJECT_REFERENCE_MISMATCH',
  'ACK_PRODAT_OWN_OBJECT_SCOPE_MISMATCH',
  'ACK_PRODAT_UNUSED_DOCUMENT_ELEMENT',
  'ACK_PRODAT_WHOLE_REJECTION_ACCEPTANCE_CONFLICT',
  'ACK_SOURCE_FAMILY_MISMATCH',
  'AI_BI_NOT_SEMICOLON',
  'AI_BI_VERSION_MISSING',
  'APERAK_ERC_WITHOUT_FTX',
  'APERAK_POSITIVE_WITHOUT_OK_FTX',
  'APERAK_UTILTS_E66_GENERIC_ERC40_BLOCKED',
  'APERAK_UTILTS_E66_GENERIC_FTX40_BLOCKED',
  'BOM_NOT_ALLOWED',
  'EDIFACT_LATIN1_ENCODING_HELD',
  'EDIFACT_LINEBREAKS',
  'EMPTY_PAYLOAD',
  'IDENTIFIER_INVALID_CHARACTERS',
  'MESSAGE_PROFILE_MISSING',
  'MIME_TYPE_NOT_EDIFACT',
  'MISSING_BGM',
  'MISSING_UNB',
  'MISSING_UNH',
  'MISSING_UNT',
  'MISSING_UNZ',
  'PAYLOAD_TOO_LARGE',
  'PRODAT_COMPOSITE_BGM_BLOCKED',
  'PRODAT_ENERGY_PRODUCT_CAV_COMPONENT_MISMATCH',
  'PRODAT_REGISTER_EVIDENCE_INVALID',
  'PRODAT_Z13VH_DTM_90_MISSING',
  'PRODAT_Z13VH_DTM_91_MISSING',
  'PRODAT_Z13VH_DTM_92_FORBIDDEN',
  'PRODAT_Z13_NAD_UD_ID_MISSING',
  'PRODAT_Z13_NAD_UD_MISSING',
  'PRODAT_Z18_DTM_164_MISSING',
  'PRODAT_Z18_NAD_IT_FORBIDDEN',
  'PRODAT_Z18_NAD_UD_MISSING',
  'PRODAT_Z18_RFF_Z09_MISSING',
  'PROFILE_APPLICATION_REFERENCE_MISSING',
  'PROFILE_BGM_CODE_NOT_ALLOWED',
  'PROFILE_FIELD_LENGTH_EXCEEDED',
  'PROFILE_FORBIDDEN_SEGMENT_PRESENT',
  'PROFILE_REQUIRED_SEGMENT_MISSING',
  'PROFILE_SEGMENT_ORDER_WARNING',
  'PROFILE_SEGMENT_REPEATED_TOO_MANY_TIMES',
  'PROFILE_UNH_TOKEN_MISMATCH',
  'UNA_NOT_STANDARD',
  'UNB_APPLICATION_REFERENCE_TOO_LONG',
  'UNB_RECEIVER_SUBADDRESS_TOO_LONG',
  'UNB_RECEIVER_TOO_LONG',
  'UNB_REFERENCE_TOO_LONG',
  'UNB_SENDER_SUBADDRESS_TOO_LONG',
  'UNB_SENDER_TOO_LONG',
  'UNB_SYNTAX_NOT_UNOC3',
  'UNB_UNZ_REFERENCE_MISMATCH',
  'UNH_REFERENCE_TOO_LONG',
  'UNH_UNT_REFERENCE_MISMATCH',
  'UNSM_DIRECTORY_SOURCE_UNAVAILABLE',
  'UNSM_MESSAGE_STRUCTURE_INVALID',
  'UNT_COUNT_MISMATCH',
  'UNZ_COUNT_MISMATCH',
  'UTILTS_CONSERVATIVE_PACKING_LIMIT',
  'UTILTS_COPIED_TRANSACTION_REFERENCE_INVALID',
  'UTILTS_ERR_BGM_NOT_ERR',
  'UTILTS_PHYSICAL_TRANSACTION_REFERENCE_INVALID',
  'XML_BOM_NOT_ALLOWED',
  'XML_MIME_WARNING',
])
// Exact leading machine markers from the independently reviewed C143 inventory.
const nativeAckMachineCodes=new Set([
  'ediel_existing_ack_original_read_unavailable','ediel_existing_ack_original_source_mismatch',
  'ediel_source_rule_pack_basis_required','ediel_historical_rule_pack_basis_unavailable',
  'prodat_bilateral_original_metadata_unqualified','prodat_bilateral_capability_required',
  'canonical_ack_actual_original_mismatch','prodat_response_original_owner_unavailable',
  'prodat_response_original_rule_witness_mismatch','prodat_response_frozen_owner_binding_unavailable',
  'prodat_response_frozen_owner_binding_changed','prodat_response_established_original_changed',
  'prodat_domain_response_frozen_owner_required','prodat_domain_response_frozen_owner_changed',
  'prodat_domain_response_source_required','prodat_domain_response_scope_required',
  'prodat_domain_response_own_effect_unavailable','prodat_domain_response_original_guide_unavailable',
  'prodat_domain_response_own_plan_unavailable','prodat_domain_response_own_effect_required',
  'prodat_structural_response_source_required','prodat_structural_response_scope_required',
  'prodat_structural_response_own_effect_unavailable','historical_rule_pack_basis_unavailable',
  'supply_final_response_scope_required','supply_final_response_source_changed',
  'supply_final_response_admitted_canonical_required','supply_final_response_own_effect_required',
  'supply_final_response_own_effect_uncommitted','ediel_existing_ack_original_object_scope_unavailable',
  'ediel_existing_ack_original_basis_unavailable','ediel_existing_ack_original_outcome_unavailable',
  'ack_source_scope_unavailable','ack_actual_original_unavailable',
  'ack_source_owner_qualification_required','historical_rule_pack_guide_scope_unavailable',
  'canonical_ack_original_family_mismatch','canonical_ack_source_scope_mismatch',
  'canonical_ack_draft_physical_outcome_mismatch','canonical_ack_prodat_source_code_profile_mismatch',
  'canonical_ack_owner_scope_required','ediel_historical_ack_guide_basis_unavailable',
  'ediel_ack_guide_original_basis_changed','ediel_native_ack_guide_invalid',
  'ediel_inbound_legal_context_required','ediel_historical_identity_basis_unavailable',
  'ediel_ack_current_captured_role_unavailable','ediel_technical_endpoint_unqualified',
  'ediel_ack_replay_actor_not_authorized','ediel_ack_replay_actual_source_unavailable',
  'ediel_ack_replay_legal_scope_invalid','ediel_business_ack_current_actor_required',
  'ediel_fresh_ack_envelope_invalid','ediel_message_reference_length_invalid',
  'ediel_unh_unused_element','ediel_prodat_aperak_unused_document_element',
  'ediel_native_ack_guide_source_required','ediel_registered_original_guide_unavailable',
  'prodat_response_native_scope_invalid','ediel_ack_atomic_outcome_required',
  'ediel_ack_atomic_wire_outcome_mismatch','ediel_ack_atomic_draft_whitelist_required',
  'ediel_ack_atomic_wire_required','ediel_ack_atomic_wire_family_mismatch',
  'ediel_ack_atomic_owner_scope_mismatch','ediel_ack_atomic_metadata_required',
  'ediel_ack_atomic_route_changed','ediel_ack_atomic_foreign_source_resource',
  'ediel_ack_atomic_postwrite_owner_mismatch','canonical_ack_route_profile_required',
  'canonical_ack_atomic_output_scope_mismatch','canonical_ack_draft_outcome_scope_mismatch',
  'canonical_ack_physical_scope_required','canonical_ack_duplicate_scope_mismatch',
  'canonical_ack_physical_scope_receipt_mismatch','ediel_existing_ack_original_current_actor_required',
  'ediel_existing_ack_original_read_scope_invalid','ack_source_qualification_scope_mismatch',
  'ack_original_application_reference_ambiguous','aperak_prodat_document_reference_required',
  'aperak_original_legal_party_projection_conflict','aperak_prodat_selected_scope_invalid',
  'aperak_prodat_requested_scope_unqualified','aperak_prodat_own_line_reference_required',
  'ediel_ack_route_profile_required','ediel_ack_route_profile_scope_mismatch',
  'ediel_ack_route_profile_basis_required','canonical_route_environment_mismatch',
  'canonical_route_profile_environment_mismatch','canonical_route_tenant_mismatch',
  'ediel_tenant_actor_required','ediel_tenant_permission_required',
  'ediel_tenant_actor_forbidden','ediel_tenant_permission_forbidden',
  'blocked_final_ack_exists','outbound_ediel_canonical_policy_evidence_missing',
  'ediel_ack_replay_scope_required','ediel_ack_replay_own_response_ambiguous',
  'ediel_ack_replay_private_own_wire_unavailable','ediel_ack_replay_original_basis_mismatch',
  'ediel_ack_replay_physical_source_mismatch','ediel_ack_replay_physical_prodat_scope_required',
  'ediel_historical_prodat_ack_scope_basis_unavailable','ediel_prodat_ack_scope_conflicting_outcome',
  'ediel_prodat_ack_scope_partially_fixed','ediel_ack_actual_original_unavailable',
  'ediel_original_bytes_retention_tombstoned','ediel_outbound_owner_witness_required',
  'ediel_outbound_owner_actor_scope_required','ediel_outbound_owner_preparation_permission_required',
  'ediel_prodat_ack_physical_scope_required','ediel_prodat_ack_contradictory_own_outcome',
  'ediel_outbound_owner_witness_scope_invalid','ediel_historical_outbound_owner_witness_unavailable',
  'ediel_outbound_owner_witness_already_consumed','ediel_business_ack_private_relation_changed',
  'prodat_structural_response_frozen_binding_changed',
])
export function nativeAckBlockedReasonDiagnostic(message: unknown) {
  const prefix='APERAK skapades inte: '
  const reason=typeof message==='string'&&message.startsWith(prefix)?message.slice(prefix.length):null
  if(reason===null)return {kind:'unexpected_event',codes:[],unknownCodeCount:0,reasonHash:null,reasonLength:null}
  const canonical=reason.match(/^Outbound APERAK APERAK blockerades av canonical Ediel-policy: ([A-Z][A-Z0-9_]{0,127}) - /)
  if(canonical)return {kind:'canonical_policy',codes:nativeAckWrapperCodes.has(canonical[1])?[canonical[1]]:[],
    unknownCodeCount:nativeAckWrapperCodes.has(canonical[1])?0:1,reasonHash:hash(reason),reasonLength:reason.length}
  const preflight='EDIFACT envelope stoppades av payload preflight: '
  if(reason.startsWith(preflight)){
    const reported=reason.slice(preflight.length).split(' | ').slice(0,8)
      .flatMap(item=>{const code=item.match(/^([A-Z][A-Z0-9_]{0,127}): /);return code?[code[1]]:[]})
    return {kind:'payload_preflight',codes:reported.filter(code=>nativeAckWrapperCodes.has(code)),
      unknownCodeCount:reported.filter(code=>!nativeAckWrapperCodes.has(code)).length,reasonHash:hash(reason),reasonLength:reason.length}
  }
  // Match only the primary reason, never a code mentioned by details/hint text.
  const machine=/^([a-z][a-z0-9_]*)(?=$|[:\s])/.exec(reason)?.[1]
  if(machine&&nativeAckMachineCodes.has(machine))return {kind:'machine_guard',codes:[machine],
    unknownCodeCount:0,reasonHash:hash(reason),reasonLength:reason.length}
  return {kind:'unclassified',codes:[],unknownCodeCount:0,reasonHash:hash(reason),reasonLength:reason.length}
}
function record(v: unknown): Row {
  expect(v).not.toBeNull(); expect(typeof v).toBe('object'); expect(Array.isArray(v)).toBe(false)
  return v as Row
}
function array(v: unknown): Row[] { expect(Array.isArray(v)).toBe(true); return (v as unknown[]).map(record) }
function text(v: unknown): string { expect(typeof v).toBe('string'); return v as string }
function instant(v: unknown): number { const n = Date.parse(text(v)); expect(Number.isFinite(n)).toBe(true); return n }
function facts(row: Row, column = 'facts_text', digest = 'facts_hash'): Row {
  expect(row[digest]).toBe(hash(text(row[column]))); return record(JSON.parse(text(row[column])))
}
function rows(table: string, company: string, key = 'id'): Row[] {
  return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY ${key}),'[]') FROM ${table} r WHERE company_id=${literal(company)}`)
}
// Every old row remains byte-identical; additions cannot hide replacement,
// duplicates or an unrelated-source write behind an aggregate count.
function added(before: Row[], after: Row[], key = 'id'): Row[] {
  expect(new Set(after.map(r => r[key])).size).toBe(after.length)
  for (const row of before) expect(after.find(r => r[key] === row[key])).toEqual(row)
  return after.filter(r => !before.some(old => old[key] === r[key]))
}
const observationTables = {
  canonical: ['gridex_received_sources.validation_assessments', 'id', 'facts_text', 'facts_hash'],
  ignored: ['gridex_received_sources.prodat_ignored_field_facets', 'canonical_assessment_id', 'fields_text', 'fields_hash'],
  object: ['gridex_received_sources.prodat_object_validation_facets', 'assessment_id', 'facts_text', 'facts_hash'],
  response: ['gridex_received_sources.prodat_response_facets', 'assessment_id', 'response_facts_text', 'response_facts_hash'],
  application: ['gridex_received_sources.prodat_application_facets', 'assessment_id', 'application_facts_text', 'application_facts_hash'],
  function: ['gridex_received_sources.prodat_source_function_facets', 'assessment_id', 'function_facts_text', 'function_facts_hash'],
  composition: ['gridex_received_sources.object_assessments', 'id', 'facts_text', 'facts_hash'],
  availability: ['gridex_received_sources.object_availability_witnesses', 'id', '', ''],
} as const
type Observations = Record<keyof typeof observationTables, Row[]>
function observations(i: Input): Observations {
  return Object.fromEntries(Object.entries(observationTables).map(([kind, [table, key]]) =>
    [kind, rows(table, i.companyId, key)])) as Observations
}
function technical(i: Input) {
  return { sources: rows('gridex_ediel_technical_ack.sources', i.companyId, 'source_message_id'),
    syntax: rows('gridex_ediel_technical_ack.syntax_facets', i.companyId),
    replies: rows('gridex_ediel_technical_ack.replies', i.companyId, 'source_message_id') }
}
function ownSource(i: Input, r: Row) {
  expect(r).toMatchObject({ company_id: i.companyId, environment: 'test', source_message_id: i.source.id })
}
function canonical(i: Input, r: Row) {
  ownSource(i, r); expect(r.source_payload_hash).toBe(hash(i.source.raw_payload!))
  expect(r.owner).toBe('canonical-runtime-with-registry-v1')
  const f = facts(r)
  expect(f).toMatchObject({ version: 1, owner: 'canonical-runtime-with-registry-v1', syntaxDecision: 'accepted',
    applicationDecision: 'rejected', functionalDecision: 'accepted', sourceDisposition: 'not_established',
    objectDisposition: 'not_checked', partyDisposition: 'not_checked', coverage: 'canonical_runtime_only' })
  const reasons = i.decision.issues.filter(e => e.layer === 'application' && e.severity === 'error'
    && e.prodatDiagnostic?.kind === 'field' && e.prodatDiagnostic.fieldNumber === '306'
    && e.prodatDiagnostic.errorKind === 'invalid').map(e => e.code)
  expect(reasons.length).toBeGreaterThan(0); expect(f.reasonCodes).toEqual(expect.arrayContaining(reasons))
  return f
}
function physicalScope(i: Input) {
  const wire = tokenizeEdifact(i.source.raw_payload!)
  const result = prodatRegisterGroups(wire.segments, wire.una)
  expect(result.problems).toEqual([]); expect(result.groups).toHaveLength(1)
  const g = result.groups[0]
  expect(g).toMatchObject({ messageIndex: 0, itemId: i.point, identityAgency: '9', validRegisterChain: true,
    registerCount: 1, registerPosition: 1, firstLineIndex: 0 })
  const unh = wire.segments.filter(s => s.tag === 'UNH'); expect(unh).toHaveLength(1)
  const refs = g.segments.filter(s => s.tag === 'RFF' && segmentComposite(s, 1, wire.una)[0] === 'LI')
  expect(refs).toHaveLength(1); expect(segmentComposite(refs[0], 1, wire.una)).toEqual(['LI', i.li])
  return { scope: { messageIndex: 0, messageReference: segmentComposite(unh[0], 1, wire.una)[0],
    objectId: i.point, identityAgency: '9', registers: [{ lineIndex: g.lineIndex, lineNumber: g.lineNumber,
      registerIndex: g.registerIndex, registerPosition: g.registerPosition, segmentIndex: g.segments[0].index }] },
    lineIndex: g.segments[0].index }
}
function response(i: Input, r: Row) {
  const { lineIndex } = physicalScope(i), f = facts(r, 'response_facts_text', 'response_facts_hash')
  expect(f).toEqual({ version: 1, sourcePayloadHash: hash(i.source.raw_payload!),
    objects: [{ lineIndex, registerLineIndices: [lineIndex], id: i.point, li: i.li, outcome: 'negative' }],
    responses: [{ scope: 'object', lineIndex, ercCode: '42', fieldCode: '306',
      text: 'Felaktigt Installationsstatus E22', id: i.point, li: i.li }] })
}
function chain(history: Row[]) {
  expect(history.filter(r => r.previous_assessment_id === null)).toHaveLength(1)
  for (const row of history) {
    const visited = new Set<unknown>([row.id]); let parent = row.previous_assessment_id
    while (parent !== null) {
      expect(visited.has(parent)).toBe(false); visited.add(parent)
      const previous = history.find(r => r.id === parent); expect(previous).toBeDefined()
      parent = previous!.previous_assessment_id
    }
  }
}
function qualifyObservations(i: Input, before: Observations, after: Observations) {
  for (const [kind, [, key, column, digest]] of Object.entries(observationTables)) {
    const k = kind as keyof Observations
    for (const row of added(before[k], after[k], key)) {
      ownSource(i, row)
      if (kind !== 'availability') {
        expect(row.source_payload_hash).toBe(hash(i.source.raw_payload!))
        expect(row[digest]).toBe(hash(text(row[column])))
      }
    }
  }
  const actual = after.canonical.filter(r => r.source_message_id === i.source.id)
  expect(actual.length).toBeGreaterThan(0); chain(actual)
  for (const a of actual) canonical(i, a)
  const { scope } = physicalScope(i)
  for (const kind of ['ignored', 'object', 'response', 'application', 'function'] as const) {
    const [, key, column, digest] = observationTables[kind]
    const selected = after[kind].filter(r => r.source_message_id === i.source.id)
    if (kind === 'response' || kind === 'application') expect(selected.length).toBeGreaterThan(0)
    for (const r of selected) {
      ownSource(i, r); expect(r.source_payload_hash).toBe(hash(i.source.raw_payload!))
      const a = actual.find(v => v.id === r[key]); expect(a).toBeDefined(); canonical(i, a!)
      expect(r[digest]).toBe(hash(text(r[column])))
      if (kind === 'response') response(i, r)
      if (kind === 'application') {
        const f = facts(r, column, digest)
        expect(f).toMatchObject({ version: 1, owner: 'canonical-prodat-application-all-v1',
          coverage: 'canonical_own_application_only', sourcePayloadHash: hash(i.source.raw_payload!), headerDecision: 'accepted' })
        const objects = array(f.objects); expect(objects).toHaveLength(1)
        expect(objects[0]).toMatchObject({ ...scope, applicationDecision: 'rejected' })
        expect(objects[0].reasonCodes).toEqual(expect.arrayContaining(arrayReasons(i)))
      }
      if (kind === 'object') {
        const f = facts(r)
        expect(f).toMatchObject({ version: 1, owner: 'canonical-full-prodat-object-validation-v1',
          coverage: 'full_canonical_guide_objects_only', sharedAccepted: true })
        const objects = array(f.objects); expect(objects).toHaveLength(1)
        expect(objects[0]).toMatchObject({ objectId: i.point, identityAgency: '9', messageReference: scope.messageReference,
          firstLineIndex: 0, lineItemReference: i.li, disposition: 'rejected', negativeFields: ['306'] })
        expect(objects[0].reasons).toEqual(expect.arrayContaining(arrayReasons(i)))
      }
    }
  }
  const compositions = after.composition.filter(r => r.source_message_id === i.source.id)
  expect(compositions.length, 'Completed rejection must persist its actual object composition').toBeGreaterThan(0)
  chain(compositions)
  for (const r of compositions) {
    ownSource(i, r); expect(r.source_payload_hash).toBe(hash(i.source.raw_payload!)); expect(r.owner_readsets).toEqual([])
    const a = actual.find(v => v.id === r.canonical_assessment_id); expect(a).toBeDefined()
    const f = facts(r)
    expect(f).toMatchObject({ version: 1, owner: 'received-source-object-decisions-v1', ruleVersion: '1', canonicalFactsHash: a!.facts_hash })
    const objects = array(f.objects); expect(objects).toHaveLength(1)
    expect(objects[0]).toMatchObject({ object: scope, disposition: 'rejected', business: null, party: null })
    expect(objects[0].reasons).toEqual(expect.arrayContaining(arrayReasons(i)))
    const witnesses = after.availability.filter(w => w.assessment_id === r.id)
    expect(witnesses, 'Actual separate committed visibility is mandatory').toHaveLength(1)
    const w = witnesses[0]; ownSource(i, w); expect(w.facts_hash).toBe(r.facts_hash)
    expect(text(w.visibility_snapshot).length).toBeGreaterThan(0)
    expect(instant(w.observed_at)).toBeGreaterThanOrEqual(instant(r.assessed_at))
    expect(sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM gridex_received_sources.object_assessments a
      JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id
      WHERE a.id=${literal(text(r.id))} AND w.id=${literal(text(w.id))}
      AND a.company_id=${literal(i.companyId)} AND w.company_id=a.company_id AND a.environment='test' AND w.environment=a.environment
      AND a.source_message_id=${literal(i.source.id)} AND w.source_message_id=a.source_message_id
      AND w.facts_hash=a.facts_hash AND a.created_xid<>pg_current_xact_id()
      AND pg_visible_in_snapshot(a.created_xid,w.visibility_snapshot::pg_snapshot)))`)).toBe(true)
  }
  for (const w of after.availability.filter(r => r.source_message_id === i.source.id))
    expect(compositions.some(a => a.id === w.assessment_id && a.facts_hash === w.facts_hash)).toBe(true)
}
function arrayReasons(i: Input) { return i.decision.issues.filter(e => e.layer === 'application' && e.severity === 'error'
  && e.prodatDiagnostic?.kind === 'field' && e.prodatDiagnostic.fieldNumber === '306'
  && e.prodatDiagnostic.errorKind === 'invalid').map(e => e.code) }

function completedInvocation(i: Input, result: Awaited<ReturnType<typeof processInboundEdielMessage>>, o: Observations) {
  // Use THIS real processor return, never a latest mutable public-row report
  // or a source-wide old-history existence check (especially under concurrency).
  expect(result).toMatchObject({ id: i.source.id, company_id: i.companyId, environment: 'test', direction: 'inbound',
    raw_payload: i.source.raw_payload, immutable_payload_hash: hash(i.source.raw_payload!) })
  const receipt = record(record(result.validation_report).receivedSourceValidationEvidence)
  expect(receipt).toMatchObject({ status: 'recorded', sourceDisposition: 'not_established' })
  const assessmentId = text(receipt.assessmentId), factsHash = text(receipt.factsHash)
  const assessments = o.canonical.filter(a => a.id === assessmentId)
  expect(assessments).toHaveLength(1); canonical(i, assessments[0]); expect(assessments[0].facts_hash).toBe(factsHash)
  for (const kind of ['application', 'response'] as const) {
    const facets = o[kind].filter(f => f.assessment_id === assessmentId)
    expect(facets, `This completed invocation requires its own ${kind} facet`).toHaveLength(1)
    ownSource(i, facets[0]); expect(facets[0].source_payload_hash).toBe(hash(i.source.raw_payload!))
  }
  // qualifyObservations already validates every composition's full rejected
  // physical scope, canonical facts hash, NULL business/party and real committed
  // witness. Require that proof for this returned invocation's canonical ID.
  const compositions = o.composition.filter(a => a.canonical_assessment_id === assessmentId)
  expect(compositions.length, 'This completed invocation must have its own committed rejected composition').toBeGreaterThan(0)
  for (const a of compositions) {
    ownSource(i, a)
    expect(o.availability.filter(w => w.assessment_id === a.id)).toHaveLength(1)
  }
}

async function acknowledgements(i: Input, o: Observations) {
  // Guarded public reader is always authoritative; SQL only supplements it.
  const acks = await listBusinessAckMessagesForSource({ companyId: i.companyId, sourceMessageId: i.source.id,
    actorUserId: i.actorUserId, environment: 'test' })
  if (!acks.some(a => a.message_family === 'APERAK')) {
    // Only this original's already persisted ACK guard events. Log fixed
    // classifications, never their messages, payloads or source identifiers.
    const blocked = sql<Array<{ message: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('message',e.message)
      ORDER BY e.created_at,e.id),'[]') FROM public.ediel_message_events e
      WHERE e.company_id=${literal(i.companyId)} AND e.ediel_message_id=${literal(i.source.id)}
        AND e.event_type='manual_note' AND e.event_status='warning'
        AND e.event_payload->>'blockedBy'='canonical_inbound_ack_guard' AND e.event_payload->>'ackFamily'='APERAK'
        AND e.event_payload->>'sourceMessageId'=${literal(i.source.id)}`)
    const allowedGuards = ['ediel_existing_ack_original_read_unavailable', 'ediel_existing_ack_original_source_mismatch',
      'ediel_source_rule_pack_basis_required', 'ediel_historical_rule_pack_basis_unavailable',
      'prodat_bilateral_original_metadata_unqualified', 'prodat_bilateral_capability_required',
      'canonical_ack_actual_original_mismatch', 'prodat_response_original_owner_unavailable',
      'prodat_response_original_rule_witness_mismatch', 'prodat_response_frozen_owner_binding_unavailable',
      'ediel_existing_ack_original_current_actor_required', 'ediel_existing_ack_original_read_scope_invalid',
      'ediel_existing_ack_original_object_scope_unavailable', 'ediel_existing_ack_original_basis_unavailable',
      'ediel_existing_ack_original_outcome_unavailable', 'ack_source_scope_unavailable',
      'ack_actual_original_unavailable', 'historical_rule_pack_basis_unavailable',
      'ack_source_owner_qualification_required', 'historical_rule_pack_guide_scope_unavailable',
      'canonical_ack_original_family_mismatch', 'ack_original_application_reference_ambiguous',
      'aperak_prodat_requested_scope_unqualified', 'aperak_prodat_document_reference_required',
      'aperak_original_legal_party_projection_conflict', 'PRODAT_APERAK_TEXT_REVIEW_REQUIRED',
      'APERAK_PRODAT_OBJECT_OUTCOME_SCOPE_MISMATCH', 'APERAK_PRODAT_OBJECT_OUTCOME_MISSING',
      'ack_correlation_envelope_invalid', 'ack_correlation_wire_context_invalid',
      'ack_object_result_unavailable', 'ack_processed_negative_scope_unavailable',
      'ack_prodat_original_object_scope_ambiguous', 'ack_prodat_original_object_scope_mismatch',
      'ack_object_result_conflict', 'ack_correlation_outcome_invalid',
      'ack_correlation_stored_family_mismatch', 'ack_correlation_original_document_required',
      'canonical_ack_source_scope_mismatch', 'canonical_ack_draft_physical_outcome_mismatch',
      'canonical_ack_draft_outcome_scope_mismatch', 'canonical_ack_prodat_source_code_profile_mismatch',
      'canonical_ack_owner_scope_required', 'canonical_ack_physical_scope_required',
      'canonical_ack_duplicate_scope_mismatch', 'canonical_ack_physical_scope_receipt_mismatch',
      'canonical_ack_atomic_output_scope_mismatch', 'ediel_native_ack_guide_source_required',
      'ediel_registered_original_guide_unavailable', 'prodat_response_native_scope_invalid',
      'prodat_response_frozen_owner_binding_changed', 'prodat_response_established_original_changed',
      'ediel_outbound_owner_witness_required', 'ediel_outbound_owner_witness_scope_invalid',
      'prodat_domain_response_frozen_owner_required', 'ediel_historical_ack_guide_basis_unavailable',
      'ediel_ack_guide_original_basis_changed', 'ediel_native_ack_guide_invalid'] as const
    const guards = blocked.map(e => allowedGuards.find(guard => typeof e.message === 'string'
      && e.message.startsWith('APERAK skapades inte: ') && e.message.slice('APERAK skapades inte: '.length).includes(guard)) ?? null)
    console.error('H_NATIVE_INVALID306_ACK_GATE', JSON.stringify({ stage: 'invalid306_actual_negative_ack_missing',
      blockedAckEventCount: blocked.length, guards, unknownGuardCount: guards.filter(guard => guard === null).length,
      blockedReasons: blocked.map(event=>nativeAckBlockedReasonDiagnostic(event.message)) }))
  }
  expect(acks.map(a => a.message_family).sort()).toEqual(['APERAK', 'CONTRL'])
  const source = tokenizeEdifact(i.source.raw_payload!), envelope = EdifactEnvelopeCodec.decode(i.source.raw_payload!)
  const sourceOne = (tag: string) => { const a = source.segments.filter(s => s.tag === tag); expect(a).toHaveLength(1); return a[0] }
  const parties = originalAckPartyIdentities({ rawPayload: i.source.raw_payload! })
  for (const ack of acks) {
    expect(ack).toMatchObject({ company_id: i.companyId, environment: 'test', direction: 'outbound', related_message_id: i.source.id,
      ack_outcome: ack.message_family === 'CONTRL' ? 'positive' : 'negative', immutable_payload_hash: hash(ack.raw_payload!) })
    const wire = tokenizeEdifact(ack.raw_payload!), reverse = EdifactEnvelopeCodec.decode(ack.raw_payload!)
    const one = (tag: string) => { const a = wire.segments.filter(s => s.tag === tag); expect(a).toHaveLength(1); return a[0] }
    const unb = one('UNB'), unh = one('UNH'), unt = one('UNT'), unz = one('UNZ')
    expect([wire.segments[0], wire.segments[1], wire.segments.at(-2), wire.segments.at(-1)]).toEqual([unb, unh, unt, unz])
    expect(segmentElementCount(unt, wire.una)).toBe(2); expect(segmentElementCount(unz, wire.una)).toBe(2)
    expect(segmentComposite(unt, 1, wire.una)).toEqual([String(wire.segments.length - 2)])
    expect(segmentComposite(unt, 2, wire.una)).toEqual(segmentComposite(unh, 1, wire.una))
    expect(segmentComposite(unz, 1, wire.una)).toEqual(['1'])
    expect(segmentComposite(unz, 2, wire.una)).toEqual(segmentComposite(unb, 5, wire.una))
    expect(segmentComposite(unh, 2, wire.una)).toEqual(ack.message_family === 'CONTRL'
      ? ['CONTRL', '2', '2', 'UN', 'EDIEL2'] : ['APERAK', 'D', '96A', 'UN', 'E2SE6A'])
    expect(reverse).toMatchObject({ sender: envelope.receiver, senderQualifier: envelope.receiverQualifier,
      senderSubAddress: envelope.receiverSubAddress, receiver: envelope.sender, receiverQualifier: envelope.senderQualifier,
      receiverSubAddress: envelope.senderSubAddress, environment: 'test', applicationReference: '23-DDQ-PRODAT' })
    expect(segmentComposite(unb, 2, wire.una)).toEqual(segmentComposite(sourceOne('UNB'), 3, source.una))
    expect(segmentComposite(unb, 3, wire.una)).toEqual(segmentComposite(sourceOne('UNB'), 2, source.una))
    if (ack.message_family === 'CONTRL') {
      const uci = one('UCI')
      expect(segmentComposite(uci, 1, wire.una)).toEqual([envelope.interchangeReference!.slice(0, 14)])
      expect(segmentComposite(uci, 4, wire.una)).toEqual(['1'])
      for (const n of [2, 3]) expect(segmentComposite(uci, n, wire.una)).toEqual(segmentComposite(sourceOne('UNB'), n, source.una))
      for (const ucm of wire.segments.filter(s => s.tag === 'UCM')) {
        expect(segmentComposite(ucm, 1, wire.una)).toEqual(segmentComposite(sourceOne('UNH'), 1, source.una))
        expect(segmentComposite(ucm, 3, wire.una)).toEqual(['1'])
      }
      const basis = await readPersistedEdielTechnicalContrlBasis({ companyId: i.companyId, environment: 'test',
        ackMessageId: ack.id, expectedRawPayload: ack.raw_payload!, actorUserId: i.actorUserId, phase: 'read' })
      expect(basis.ackMessage.id).toBe(ack.id)
      expect(basis.evidence).toMatchObject({ sourceMessageId: i.source.id, sourceHash: hash(i.source.raw_payload!), syntaxDecision: 'accepted' })
    } else {
      const bgm = one('BGM'); expect(segmentElementCount(bgm, wire.una)).toBe(3)
      expect([1, 2, 3].map(n => segmentComposite(bgm, n, wire.una))).toEqual([[''], [''], ['34']])
      const erc = one('ERC'), ftx = one('FTX')
      expect(wire.segments.indexOf(ftx)).toBe(wire.segments.indexOf(erc) + 1)
      expect(segmentComposite(erc, 1, wire.una)).toEqual(['42', '', '260'])
      expect(segmentComposite(ftx, 3, wire.una)).toEqual(['306', '', '260'])
      expect(segmentComposite(ftx, 4, wire.una)).toEqual(['Felaktigt Installationsstatus E22'])
      for (const [q, value] of [['ACW', segmentComposite(sourceOne('BGM'), 2, source.una)[0]], ['Z07', i.point], ['LI', i.li]]) {
        const refs = wire.segments.filter(s => s.tag === 'RFF' && segmentComposite(s, 1, wire.una)[0] === q)
        expect(refs).toHaveLength(1); expect(segmentComposite(refs[0], 1, wire.una)).toEqual([q, value])
      }
      for (const [role, party] of [['FR', parties.legalReceiver], ['DO', parties.legalSender]] as const) {
        const nad = wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === role)
        expect(nad).toHaveLength(1); expect(segmentComposite(nad[0], 2, wire.una)).toEqual(party.identityComponents)
      }
      const witnessId = record(ack.execution_context_snapshot).outboundOwnerWitnessId
      const witnesses = rows('gridex_ediel_outbound_owner.witnesses', i.companyId).filter(w => w.id === witnessId)
      expect(witnesses).toHaveLength(1)
      expect(witnesses[0]).toMatchObject({ company_id: i.companyId, environment: 'test', actor_user_id: i.actorUserId,
        family: 'APERAK', related_message_id: i.source.id, payload_sha256: hash(ack.raw_payload!) })
      const consumed = rows('gridex_ediel_outbound_owner.consumptions', i.companyId, 'witness_id').filter(c => c.witness_id === witnessId)
      expect(consumed).toHaveLength(1)
      expect(consumed[0]).toMatchObject({ source_message_id: ack.id, company_id: i.companyId, environment: 'test', payload_sha256: hash(ack.raw_payload!) })
      const bindings = rows('gridex_ediel_ack_guide.prodat_response_owner_bindings', i.companyId, 'witness_id').filter(b => b.witness_id === witnessId)
      expect(bindings).toHaveLength(1)
      const b = bindings[0]; expect(b).toMatchObject({ source_message_id: i.source.id, company_id: i.companyId,
        environment: 'test', ack_hash: hash(ack.raw_payload!) })
      const canonicalRow = o.canonical.find(a => a.id === b.assessment_id); expect(canonicalRow).toBeDefined(); canonical(i, canonicalRow!)
      const facet = o.response.find(r => r.assessment_id === b.assessment_id); expect(facet).toBeDefined()
      ownSource(i, facet!); expect(facet!.source_payload_hash).toBe(hash(i.source.raw_payload!)); response(i, facet!)
      expect(b.facet_hash).toBe(facet!.response_facts_hash)
    }
    const queued = rows('public.ediel_outbox', i.companyId).filter(q => q.ediel_message_id === ack.id)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ company_id: i.companyId, environment: 'test', source_message_id: i.source.id,
      ediel_message_id: ack.id, message_family: ack.message_family, ack_outcome: ack.ack_outcome,
      immutable_payload_hash: hash(ack.raw_payload!), status: 'queued', sent_at: null,
      created_by: i.actorUserId, route_profile_id: ack.route_profile_id })
    expect(ack.route_profile_id).not.toBeNull(); expect(ack.communication_route_id).not.toBeNull(); instant(queued[0].queued_at)
  }
  await i.negativeAcknowledgement()
  return acks
}

function firstGraph(i: Input, before: Row, after: Row, acks: EdielMessageRow[]) {
  const special = new Set(['messages', 'outboxes', 'ownerWitnesses', 'ownerConsumptions', 'responseBindings', 'requests'])
  for (const key of Object.keys(before)) if (!special.has(key)) expect(after[key], key).toEqual(before[key])
  const additions = (key: string, identity = 'id') => added(array(before[key]), array(after[key]), identity)
  const messages = additions('messages'); expect(messages).toHaveLength(2)
  expect(messages.map(m => m.id).sort()).toEqual(acks.map(a => a.id).sort())
  const outboxes = additions('outboxes'); expect(outboxes).toHaveLength(2)
  expect(outboxes.map(m => m.ediel_message_id).sort()).toEqual(acks.map(a => a.id).sort())
  const aperak = acks.find(a => a.message_family === 'APERAK')!
  const witnessId = record(aperak.execution_context_snapshot).outboundOwnerWitnessId
  expect(additions('ownerWitnesses').map(w => w.id)).toEqual([witnessId])
  expect(additions('ownerConsumptions', 'witness_id').map(w => [w.witness_id, w.source_message_id])).toEqual([[witnessId, aperak.id]])
  expect(additions('responseBindings', 'witness_id').map(w => w.witness_id)).toEqual([witnessId])
  for (const r of additions('requests')) {
    const linked = acks.filter(a => a.outbound_request_id === r.id); expect(linked.length).toBeGreaterThan(0)
    expect(r).toMatchObject({ company_id: i.companyId, created_by: i.actorUserId })
    for (const a of linked) {
      for (const column of ['customer_id', 'site_id', 'metering_point_id'] as const) expect(r[column]).toBe(a[column])
      expect(r.communication_route_id).toBe(a.communication_route_id)
      expect(r.ediel_route_profile_id).toBe(a.route_profile_id)
      // The actual atomic APERAK inherits the inbound resource pointer;
      // the new ACK's own operation/intent is a separate original namespace.
      expect(a.message_family).toBe('APERAK'); expect(a.outbound_request_id).toBe(i.source.outbound_request_id)
      for (const column of ['customer_id', 'site_id', 'metering_point_id'] as const) expect(a[column]).toBe(i.source[column])
    }
  }
}
function qualifyTechnical(i: Input, before: ReturnType<typeof technical>, after: ReturnType<typeof technical>) {
  for (const k of ['sources', 'syntax', 'replies'] as const) for (const row of added(before[k], after[k], k === 'syntax' ? 'id' : 'source_message_id')) {
    ownSource(i, row); expect(row.payload_sha256).toBe(hash(i.source.raw_payload!))
    if (k === 'syntax') facts(row)
  }
  for (const k of ['sources', 'syntax', 'replies'] as const)
    expect(after[k].filter(r => r.source_message_id === i.source.id)).toHaveLength(1)
}
function timers(i: Input, before: Row[], after: Row[]) {
  for (const t of added(before, after)) expect(t).toMatchObject({ company_id: i.companyId, ediel_message_id: i.source.id })
  const selected = after.filter(t => t.ediel_message_id === i.source.id)
  expect(selected.map(t => t.timer_type).sort()).toEqual(['aperak_due', 'contrl_due'])
  expect(EDIEL_ACK_DEADLINE_MINUTES).toBe(30)
  const anchor = instant(i.source.message_received_at), due = anchor + 30 * 60000
  for (const t of selected) {
    expect(t).toMatchObject({ company_id: i.companyId, status: 'open', created_by: i.actorUserId, updated_by: i.actorUserId,
      payload: { receivedAt: i.source.message_received_at, anchorKind: 'local_ingress_at', anchorCertainty: 'observed' } })
    expect(instant(t.due_at)).toBe(due); expect(instant(t.warning_at)).toBe(due - 10 * 60000)
    expect(instant(t.critical_at)).toBe(due - 5 * 60000)
  }
}
function stableSource(i: Input, before: Row) {
  const after = record(i.sourceSeal()), withoutRules = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'rules'))
  expect(withoutRules(after)).toEqual(withoutRules(before))
  if (before.rules !== null) expect(after.rules).toEqual(before.rules)
  else if (after.rules !== null) {
    const r = record(after.rules); ownSource(i, r); expect(r.payload_sha256).toBe(hash(i.source.raw_payload!))
    expect(r.direction).toBe('inbound')
  }
}
export async function assertInvalid306NativeContract(i: Input) {
  physicalScope(i)
  const beforeBusiness = i.business(), beforeGraph = i.durable(), beforeSeal = record(i.sourceSeal()), sends = i.smtpCalls()
  let previous = observations(i)
  const technicalBefore = technical(i), timersBefore = rows('public.ediel_sla_timers', i.companyId)
  const expectationsBefore = rows('public.ediel_business_expectations', i.companyId)
  const process = () => processInboundEdielMessage({ actorUserId: i.actorUserId, edielMessageId: i.source.id })
  const firstResult = await process()
  const firstObservations = observations(i); qualifyObservations(i, previous, firstObservations); previous = firstObservations
  completedInvocation(i, firstResult, firstObservations)
  const acks = await acknowledgements(i, firstObservations)
  firstGraph(i, beforeGraph, i.durable(), acks); expect(i.business()).toEqual(beforeBusiness); stableSource(i, beforeSeal)
  const firstTechnical = technical(i); qualifyTechnical(i, technicalBefore, firstTechnical)
  const firstTimers = rows('public.ediel_sla_timers', i.companyId); timers(i, timersBefore, firstTimers)
  expect(rows('public.ediel_business_expectations', i.companyId)).toEqual(expectationsBefore)
  expect(i.smtpCalls()).toBe(sends); await i.rereadControl()
  const firstGraphSnapshot = i.durable()
  const firstSourceSeal = i.sourceSeal()
  for (const stage of ['sequential', 'concurrent'] as const) {
    const returned: Awaited<ReturnType<typeof processInboundEdielMessage>>[] = []
    if (stage === 'sequential') returned.push(await process())
    else {
      const results = await Promise.allSettled([process(), process()])
      expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled'])
      for (const result of results) {
        if (result.status !== 'fulfilled') throw result.reason
        returned.push(result.value)
      }
    }
    const current = observations(i); qualifyObservations(i, previous, current); previous = current
    for (const result of returned) completedInvocation(i, result, current)
    expect(await acknowledgements(i, current)).toEqual(acks)
    expect(i.durable(), stage).toEqual(firstGraphSnapshot); expect(i.business()).toEqual(beforeBusiness); stableSource(i, beforeSeal)
    expect(i.sourceSeal(), 'First captured rule basis and full immutable source seal stay frozen').toEqual(firstSourceSeal)
    expect(technical(i)).toEqual(firstTechnical); expect(rows('public.ediel_sla_timers', i.companyId)).toEqual(firstTimers)
    expect(rows('public.ediel_business_expectations', i.companyId)).toEqual(expectationsBefore)
    expect(i.smtpCalls()).toBe(sends); await i.rereadControl(); expect(i.durable()).toEqual(firstGraphSnapshot)
  }
}
