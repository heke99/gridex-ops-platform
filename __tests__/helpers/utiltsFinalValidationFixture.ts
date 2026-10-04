import { createHash } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function fixtureUuid(value: string): string {
  const hex = digest(value)
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`
}

/** Simulate the database-insert receive context for this synthetic source,
 * after a test has built/mutated its own physical wire. No production context
 * or persisted decision is accepted through this test-only fixture builder. */
export function qualifyUtiltsFixtureSource<T extends EdielMessageRow>(message: T): T {
  if (!uuid.test(message.id)) message.id = fixtureUuid(`source:${message.id}`)
  if (message.company_id && !uuid.test(message.company_id)) message.company_id = fixtureUuid(`company:${message.company_id}`)
  message.execution_context_snapshot = {
    ...(message.execution_context_snapshot ?? {}),
    receivedUtiltsContext: {
      version: 1, contextOrigin: 'database_insert', sourceMessageId: message.id,
      companyId: message.company_id, environment: message.environment, messageCode: message.message_code,
      payloadHash: digest(message.raw_payload ?? ''), sourceReceivedAt: message.message_received_at,
      capturedAt: message.message_received_at,
    },
  }
  return message
}

type RpcResult = { data: unknown; error: null }
function rpcResult(data: unknown) {
  const result: RpcResult = { data, error: null }
  return Object.assign(Promise.resolve(result), { abortSignal: async (signal: AbortSignal) => {
    if (!(signal instanceof AbortSignal)) throw new Error('fixture_rpc_abort_signal_required')
    return result
  } })
}

/** Only the external database is doubled. The canonical registry decoder,
 * protected initial owner, final runtime owner, evidence builder, receipt
 * validation and source-capture decoder all run unchanged. */
export function createUtiltsFinalValidationIo() {
  const sourceWitnesses = new Map<string, Record<string, unknown>>()
  return (name: string, args: Record<string, unknown>) => {
    if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') {
      const revision = String(args.p_business_date) < '2026-10-01' ? '3' : '4'
      const guide = `25-A-${revision}`
      const packId = `33333333-3333-4333-8333-33333333333${revision}`
      const profileId = fixtureUuid(`profile:${args.p_message_code}:${revision}`)
      const key = `UTILTS:${args.p_message_code}:E5SE5A:${revision}`
      const sourceHash = digest(`synthetic-activation:${guide}`)
      return rpcResult([{
        rule_pack_id: packId, message_profile_id: profileId, market: 'electricity', family: 'UTILTS',
        guide_version: guide, guide_revision: revision, unh_association_code: 'E5SE5A',
        valid_from: revision === '3' ? '2025-06-01' : '2026-10-01', valid_to: revision === '3' ? '2026-09-30' : null,
        source_document: `Synthetic fixture ${guide}`, source_hash: sourceHash, field_matrix_version: guide,
        profile_key: key, business_process: 'metering_values', phase: null,
        profile: { family: 'UTILTS', messageCode: args.p_message_code, guideVersion: guide, guideRevision: revision },
        parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
        original_version: `${guide}:r${revision}`,
        original_snapshot: {
          rulePack: { id: packId, source_hash: sourceHash, guide_version: guide, guide_revision: revision },
          messageProfile: { id: profileId, rule_pack_id: packId, profile_key: key },
          guideSources: [{ id: fixtureUuid(`guide:${guide}`), rule_pack_id: packId }],
        },
      }])
    }
    if (name === 'gridex_record_utilts_source_validation_v4') {
      const facts = JSON.parse(String(args.p_facts_text)) as { rulePackEvidence: Record<string, unknown> | null }
      if (facts.rulePackEvidence) sourceWitnesses.set(String(args.p_source_message_id), facts.rulePackEvidence)
      return rpcResult({
        version: 4, assessmentId: fixtureUuid(`assessment:${args.p_source_message_id}`),
        companyId: args.p_company_id, environment: args.p_environment, sourceMessageId: args.p_source_message_id,
        sourcePayloadHash: args.p_source_payload_hash, sourceDisposition: 'not_established',
        factsHash: digest(String(args.p_facts_text)),
        transactionFactsHash: args.p_transaction_facts_text ? digest(String(args.p_transaction_facts_text)) : null,
        headerFactsHash: args.p_header_facts_text ? digest(String(args.p_header_facts_text)) : null,
        functionalFactsHash: args.p_functional_facts_text ? digest(String(args.p_functional_facts_text)) : null,
      })
    }
    if (name === 'ediel_probe_source_rule_pack_capture_v1') {
      const witness = sourceWitnesses.get(String(args.p_message_id))
      if (!witness) throw new Error('fixture_source_capture_without_final_witness')
      return rpcResult({ status: 'captured', evidence: {
        rulePackId: witness.rulePackId, messageProfileId: witness.messageProfileId, profileKey: witness.profileKey,
        version: witness.version, sourceHash: witness.sourceHash,
        snapshot: { profileKey: witness.profileKey, profileVersionId: witness.messageProfileId, version: witness.version,
          checksum: witness.sourceHash, originalSnapshot: witness.snapshot },
      } })
    }
    return undefined
  }
}
