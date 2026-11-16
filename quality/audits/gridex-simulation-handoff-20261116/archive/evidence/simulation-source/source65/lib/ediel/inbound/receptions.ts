import { supabaseService } from '@/lib/supabase/service'
import { createHash } from 'node:crypto'

/** Transport custody only: this never grants legal or business authority. */
export type UnattributedTechnicalIntake = {
  kind: 'unattributed_technical_intake'
  version: 1
  disposition: 'technical_only_unattributed'
  sourceMessageId: string
  inboundEmailMessageId: string
  parseResultId: string
  companyId: null
  resolvedCompanyId: null
  technicalCompanyId: string
  environment: 'test' | 'production'
  sourcePayloadHash: string
  receivedAt: string
  executionActorUserId: string
  authorizesBusinessEffect: false
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function technicalIntake(value: unknown, input: {
  actorUserId: string | null
  inboundEmailMessageId?: string
  sourceMessageId?: string
  parseResultId?: string
  sourcePayloadHash?: string
  environment?: string
}): UnattributedTechnicalIntake {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ediel_technical_intake_receipt_invalid')
  const r = value as UnattributedTechnicalIntake
  if (r.kind !== 'unattributed_technical_intake' || r.version !== 1 || r.disposition !== 'technical_only_unattributed' ||
    ![r.sourceMessageId, r.inboundEmailMessageId, r.parseResultId, r.technicalCompanyId]
      .every(id => typeof id === 'string' && uuid.test(id)) ||
    r.companyId !== null || r.resolvedCompanyId !== null || r.authorizesBusinessEffect !== false ||
    !input.actorUserId || r.executionActorUserId !== input.actorUserId ||
    typeof r.environment !== 'string' || !['test', 'production'].includes(r.environment) ||
    typeof r.sourcePayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.sourcePayloadHash) ||
    typeof r.receivedAt !== 'string' || !Number.isFinite(Date.parse(r.receivedAt)) ||
    (input.inboundEmailMessageId !== undefined && r.inboundEmailMessageId !== input.inboundEmailMessageId) ||
    (input.sourceMessageId !== undefined && r.sourceMessageId !== input.sourceMessageId) ||
    (input.parseResultId !== undefined && r.parseResultId !== input.parseResultId) ||
    (input.sourcePayloadHash !== undefined && r.sourcePayloadHash !== input.sourcePayloadHash) ||
    (input.environment !== undefined && r.environment !== input.environment)) throw new Error('ediel_technical_intake_receipt_invalid')
  return Object.freeze(r)
}

export async function admitUnattributedTechnicalSource(input: {
  actorUserId: string
  inboundEmailMessageId: string
  parseResultId: string
  rawPayload: string
  environment: string
}): Promise<UnattributedTechnicalIntake> {
  if (!input.actorUserId || !uuid.test(input.inboundEmailMessageId) || !uuid.test(input.parseResultId)) {
    throw new Error('ediel_technical_intake_actor_and_source_required')
  }
  const sourcePayloadHash = createHash('sha256').update(input.rawPayload, 'utf8').digest('hex')
  const { data, error } = await supabaseService.rpc('ediel_admit_unattributed_technical_source_v1', {
    p_inbound_email_message_id: input.inboundEmailMessageId,
    p_parse_result_id: input.parseResultId,
    p_actor_user_id: input.actorUserId,
    p_expected_payload_hash: sourcePayloadHash,
    p_expected_environment: input.environment,
  })
  if (error) throw error
  return technicalIntake(data, { ...input, sourcePayloadHash })
}

export async function readUnattributedTechnicalIntake(input: {
  actorUserId: string | null
  inboundEmailMessageId?: string
  sourceMessageId?: string
  sourcePayloadHash?: string
  environment?: string
}): Promise<UnattributedTechnicalIntake | null> {
  if (Boolean(input.inboundEmailMessageId) === Boolean(input.sourceMessageId)) throw new Error('ediel_technical_intake_exact_selector_required')
  const { data, error } = await supabaseService.rpc('ediel_read_unattributed_technical_intake_v1', {
    p_inbound_email_message_id: input.inboundEmailMessageId ?? null,
    p_source_message_id: input.sourceMessageId ?? null,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw error
  return data === null ? null : technicalIntake(data, input)
}

export type InboundReception = {
  companyId: string
  sourceMessageId: string
  inboundEmailMessageId: string
  parseResultId: string
  receptionId: string
  classification: 'first_reception' | 'protocol_duplicate' | 'identity_conflict'
  isReplay: boolean
  receivedAt: string
  canonicalPayloadHash: string
  receivedPayloadHash: string
  responseRequestId: string | null
  status: 'observed' | 'held'
  reason: string | null
  businessEffectAuthorized: false
}

type ReceptionScope = { companyId: string; messageId: string; inboundEmailMessageId: string }

function reception(value: unknown, input: ReceptionScope): InboundReception {
  if (!value || typeof value !== 'object') throw new Error('ediel_reception_result_invalid')
  const r = value as InboundReception
  const first = r.classification === 'first_reception'
  if (
    r.companyId !== input.companyId || r.sourceMessageId !== input.messageId || r.inboundEmailMessageId !== input.inboundEmailMessageId ||
    !['first_reception', 'protocol_duplicate', 'identity_conflict'].includes(r.classification) ||
    typeof r.receptionId !== 'string' || typeof r.parseResultId !== 'string' || typeof r.isReplay !== 'boolean' ||
    typeof r.receivedAt !== 'string' || !Number.isFinite(Date.parse(r.receivedAt)) ||
    !/^[a-f0-9]{64}$/.test(r.canonicalPayloadHash) || !/^[a-f0-9]{64}$/.test(r.receivedPayloadHash) ||
    r.businessEffectAuthorized !== false ||
    (first ? r.status !== 'observed' || r.responseRequestId !== null || r.reason !== null :
      r.status !== 'held' || typeof r.responseRequestId !== 'string' || !r.responseRequestId || typeof r.reason !== 'string' || !r.reason) ||
    (r.classification === 'identity_conflict' ? r.receivedPayloadHash === r.canonicalPayloadHash : r.receivedPayloadHash !== r.canonicalPayloadHash)
  ) throw new Error('ediel_reception_result_invalid')
  return r
}

export async function recordInboundReception(input: ReceptionScope & { actorUserId: string; parseResultId: string }): Promise<InboundReception> {
  const { data, error } = await supabaseService.rpc('ediel_record_inbound_reception_v1', {
    p_company_id: input.companyId,
    p_message_id: input.messageId,
    p_actor_user_id: input.actorUserId,
    p_inbound_email_message_id: input.inboundEmailMessageId,
    p_parse_result_id: input.parseResultId,
  })
  if (error) throw error
  return reception(data, input)
}

export async function readInboundReceptionRequest(input: ReceptionScope & { actorUserId: string }): Promise<InboundReception | null> {
  const { data, error } = await supabaseService.rpc('ediel_inbound_reception_request_v1', {
    p_company_id: input.companyId,
    p_message_id: input.messageId,
    p_actor_user_id: input.actorUserId,
    p_inbound_email_message_id: input.inboundEmailMessageId,
  })
  if (error) throw error
  return data === null ? null : reception(data, input)
}

/** A newly received duplicate never inherits permission to reset an old ACK. */
export class InboundReceptionHeldError extends Error {
  constructor(readonly reception: InboundReception) {
    super(reception.reason ?? 'ediel_duplicate_response_source_required')
    this.name = 'InboundReceptionHeldError'
  }
}

export function requireFirstReception(r: InboundReception): void {
  if (r.status === 'held' || r.classification !== 'first_reception') throw new InboundReceptionHeldError(r)
}
