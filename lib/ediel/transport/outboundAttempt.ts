// masterplan: GOV-04, AT-GOV-04
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielBusinessExpectationPlan, EdielTechnicalExpectationPlan } from '@/lib/ediel/businessExpectations'
import type {EdielMeteringMethodExpectationPlan} from '@/lib/ediel/meteringMethodExpectationPolicy'
import type { ProdatTransportRetryBasis } from '@/lib/ediel/recovery/transportRetry'
import type {EdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import type {TechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import type {ProdatCommonHeaderRejectionEvidence} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import { sendEdielEmail, type SendEdielEmailInput } from '@/lib/email/sendEdielEmail'
import { SmtpCertificateRejectedBeforeSmtpError, SmtpDeliveryUncertainError } from './smtpOutcome'
import { smtpErrorEvidence, smtpResultEvidence } from './smtpEvidence'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { OutboundDispatchOwner } from '@/lib/ediel/sources/correctionOutboundDispatch'
import {transportExceptionBinding,type TransportExceptionAuthorization} from './exception/source'

type ProviderResult = Awaited<ReturnType<typeof sendEdielEmail>> & { dispatchReplay?: boolean; dispatchObservedAt?: string }
type Receipt = { proceed?: boolean; classification?: string; providerReceipt?: ProviderResult; observedAt?: string; state?: string; localTestWait?: unknown }
class AcceptedProjection extends Error { constructor(readonly result: ProviderResult) { super('ediel_transport_projection_only') } }

export class LocalTestTransportWaitError extends Error {
  readonly code = 'ediel_local_test_retry_wait'
  constructor() { super('ediel_local_test_retry_wait') }
}

export class LocalTestTransportWaitUnconfirmedError extends SmtpDeliveryUncertainError {}

async function localBuildHash(): Promise<string | null> {
  try {
    const bytes = await readFile(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8')
    const id = bytes.trim()
    if (id && Buffer.byteLength(bytes, 'utf8') <= 1024 && !/[\u0000-\u001f\u007f]/.test(id)) {
      return createHash('sha256').update(id, 'utf8').digest('hex')
    }
  } catch { /* The configured local SQL policy denies incomplete evidence. */ }
  return null
}

export class SmtpPermanentRejectionError extends Error {
  readonly code = 'ediel_smtp_permanent_rejection'
  constructor(readonly smtpCode: number) {
    super(`ediel_smtp_permanent_rejection: ${smtpCode}`)
    this.name = 'SmtpPermanentRejectionError'
  }
}

export const CANCELLED_APERAK_TRANSPORT = 'ediel_transport_aperak_cancelled'
export const EDIEL_WORKER_FENCE_LOST = 'ediel_transport_worker_fence_lost'

export function isCancelledAperakTransport(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return code === 'GX104' && message === CANCELLED_APERAK_TRANSPORT
}

export function isEdielWorkerFenceLost(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return code === 'P0001' && message === EDIEL_WORKER_FENCE_LOST
}

export type GenericEdielDispatchContext = {
  message: EdielMessageRow; actorUserId: string; owner?: OutboundDispatchOwner; mimeMode: string; payload: Buffer; encoding: string;
  admissionDecision?: Readonly<Record<string, unknown>> | null
  businessExpectationPlan?: EdielBusinessExpectationPlan | null
  technicalExpectationPlan?: EdielTechnicalExpectationPlan | null
  meteringMethodExpectationPlan?: EdielMeteringMethodExpectationPlan | null
  recoveryAuthorization?: ProdatTransportRetryBasis | null
  sourceRulePackEvidence?: EdielSourceRulePackEvidence | null
  technicalSyntaxAckEvidence?: TechnicalSyntaxAckEvidence | null
  prodatCommonHeaderRejectionEvidence?: ProdatCommonHeaderRejectionEvidence | null
  transportException?: TransportExceptionAuthorization | null
}

/** A date change requires the full send admission to run again. Never relabel
 * the sealed source/ACK guide or replace a historical accepted observation. */
export function assertEdielAdmissionDateCurrent(decision: Readonly<Record<string, unknown>> | null | undefined): void {
  if (decision && decision.referenceDate !== stockholmBusinessDate()) {
    throw new Error('ediel_transport_admission_changed_retry_required')
  }
}

/** One attempt gate can receive an already archived binding without recompiling MIME. */
export function createGenericEdielAttemptGate(input: SendEdielEmailInput, context: GenericEdielDispatchContext) {
  const { message } = context
  if (!message.company_id) throw new Error('ediel_transport_company_required')
  const identity = { companyId: message.company_id, environment: message.environment, messageId: message.id, actorUserId: context.actorUserId, attemptId: randomUUID() }
  const localWorker = message.environment === 'test' && message.message_family === 'CONTRL' && context.owner?.kind === 'worker'
    ? context.owner : null
  let capturedSmtpEndpoint: unknown = null
  let prepared = false, entered = false, observed = false, callbackUsed = false
  const call = async (action: string, extra: Record<string, unknown> = {}): Promise<Receipt> => {
    const localBinding = localWorker && capturedSmtpEndpoint && (action === 'prepare' || action === 'enter')
      ? { serverBuildSha256: await localBuildHash(), serverSmtpEndpoint: capturedSmtpEndpoint } : {}
    const { data, error } = await supabaseService.rpc('gridex_ediel_transport_attempt_v1', {
      p_input: { ...identity, action, ...extra, ...localBinding },
    })
    if (error) throw error
    if (!data || typeof data !== 'object') throw new Error('ediel_transport_receipt_invalid')
    return data as Receipt
  }
  const entry = {
    archiveContext: { companyId: message.company_id, messageId: message.id },
    includeLocalSmtpIdentity: localWorker ? true as const : undefined,
    beforeProviderCall: async (actual: Record<string, unknown>) => {
      if (callbackUsed) throw new Error('ediel_transport_callback_reused')
      callbackUsed = true
      if (localWorker && actual.localSmtpEndpoint && typeof actual.localSmtpEndpoint === 'object') {
        capturedSmtpEndpoint = Object.freeze(structuredClone(actual.localSmtpEndpoint))
      }
      assertEdielAdmissionDateCurrent(context.admissionDecision)
      const binding = {
        ...actual, originalHash: createHash('sha256').update(message.raw_payload ?? '', 'utf8').digest('hex'), routeId: message.communication_route_id,
        mimeMode: context.mimeMode, encoding: context.encoding, payloadHash: createHash('sha256').update(context.payload).digest('hex'), payloadLength: context.payload.length,
        admissionDecision: context.admissionDecision ?? null,
        businessExpectationPlan: context.businessExpectationPlan ?? null,
        technicalExpectationPlan: context.technicalExpectationPlan ?? null,
        meteringMethodExpectationPlan: context.meteringMethodExpectationPlan ?? null,
        recoveryAuthorization: context.recoveryAuthorization ?? null,
        sourceRulePackEvidence: context.sourceRulePackEvidence ?? null,
        technicalSyntaxAckEvidence: context.technicalSyntaxAckEvidence ?? null,
        prodatCommonHeaderRejectionEvidence: context.prodatCommonHeaderRejectionEvidence ?? null,
        transportException: context.transportException ? transportExceptionBinding(context.transportException,message,context.actorUserId) : null,
      }
      const reservation = await call('prepare', { owner: context.owner ?? { kind: 'direct' }, binding })
      if (reservation.proceed !== true) {
        const prior = reservation.providerReceipt
        if (reservation.classification === 'accepted' && prior && Array.isArray(prior.accepted) && prior.accepted.length > 0 && prior.accepted.every(v=>typeof v==='string'&&v.toLowerCase()===input.to.toLowerCase()) && Array.isArray(prior.rejected) && prior.rejected.length === 0 && typeof reservation.observedAt === 'string' && Number.isFinite(Date.parse(reservation.observedAt))) {
          throw new AcceptedProjection({ ...prior, dispatchReplay: true, dispatchObservedAt: reservation.observedAt })
        }
        throw new SmtpDeliveryUncertainError(new Error('ediel_transport_resend_suppressed'))
      }
      prepared = true
      assertEdielAdmissionDateCurrent(context.admissionDecision)
      // Set before awaiting RPC. A lost response may follow committed entry.
      entered = true
      let authorization: Receipt
      try {
        authorization = await call('enter')
      } catch (error) {
        // This SQL refusal is only raised before entry and rolls back the RPC.
        if (isCancelledAperakTransport(error) || isEdielWorkerFenceLost(error)) entered = false
        throw error
      }
      if (authorization.proceed !== true) throw new Error('ediel_transport_entry_denied')
      assertEdielAdmissionDateCurrent(context.admissionDecision)
    },
  }
  const capture = async (result: ProviderResult): Promise<ProviderResult> => {
    if (!callbackUsed || !entered) throw new Error('ediel_transport_callback_missing')
    const observation = await call('observe', { result: smtpResultEvidence(result) })
    observed = true
    if (observation.classification !== 'accepted') throw new SmtpDeliveryUncertainError(new Error(`ediel_transport_${observation.classification ?? 'unknown'}`), result.messageId ?? null)
    if (typeof observation.observedAt !== 'string' || !Number.isFinite(Date.parse(observation.observedAt))) throw new SmtpDeliveryUncertainError(new Error('ediel_transport_capture_clock_missing'), result.messageId ?? null)
    return { ...result, dispatchObservedAt: observation.observedAt }
  }
  const fail = async (error: unknown): Promise<ProviderResult> => {
    if (error instanceof AcceptedProjection) return error.result
    if (entered) {
      if (!observed) {
        const result = smtpErrorEvidence(error)
        let receipt: Receipt | undefined
        try { receipt = await call('observe', { result }) } catch { /* committed entry remains no-resend authority */ }
        if (error instanceof SmtpCertificateRejectedBeforeSmtpError && receipt?.state === 'observed'
          && receipt.classification === 'pre_connect_negative'
          && typeof receipt.observedAt === 'string' && Number.isFinite(Date.parse(receipt.observedAt))) {
          throw error
        }
        const code = result.smtpCode
        const replyCode = result.error.response?.match(/^([45]\d{2})(?:[ -]|$)/)?.[1]
        const value = receipt?.localTestWait
        const wait = value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown> : null
        const started = typeof wait?.observedAt === 'string' ? Date.parse(wait.observedAt) : NaN
        const due = typeof wait?.notBefore === 'string' ? Date.parse(wait.notBefore) : NaN
        const end = typeof wait?.deadline === 'string' ? Date.parse(wait.deadline) : NaN
        const localRefusal = localWorker && capturedSmtpEndpoint && error instanceof Error && code !== null && code >= 400 && code < 500
          && code === result.error.responseCode && replyCode === String(code)
        if (localRefusal && receipt?.state === 'observed' && receipt.classification === 'explicit_negative' && wait?.version === 1
          && wait.policyVersion === 'local-test-4xx-v1' && wait.environment === 'test'
          && wait.companyId === identity.companyId && wait.messageId === identity.messageId
          && wait.attemptId === identity.attemptId && wait.outboxId === localWorker.outboxId && wait.smtpCode === code
          && typeof wait.delaySeconds === 'number' && Number.isInteger(wait.delaySeconds)
          && wait.delaySeconds >= 1 && wait.delaySeconds <= 3600
          && Number.isFinite(started) && Number.isFinite(due) && Number.isFinite(end)
          && receipt.observedAt === wait.observedAt && due - started === wait.delaySeconds * 1000 && end > due) {
          // SQL has already persisted the queue and lease change atomically.
          throw new LocalTestTransportWaitError()
        }
        // The same measured local 4xx may have committed without its reply.
        if (localRefusal) throw new LocalTestTransportWaitUnconfirmedError(error)
        // Only a real provider reply plus the durable observation of the same
        // scoped attempt is terminal. A lost write response is inconclusive.
        if (value === undefined && receipt?.state === 'observed' && receipt.classification === 'explicit_negative'
          && typeof receipt.observedAt === 'string' && Number.isFinite(Date.parse(receipt.observedAt))
          && error instanceof Error && code !== null && code >= 500 && code < 600 && code === result.error.responseCode && replyCode === String(code)) {
          throw new SmtpPermanentRejectionError(code)
        }
      }
      throw error instanceof SmtpDeliveryUncertainError ? error : new SmtpDeliveryUncertainError(error)
    }
    if (prepared) { try { await call('release') } catch { /* response loss cannot authorize reset */ } }
    throw error
  }
  return { entry, capture, fail }
}

/** Stable no-resend fence covering every ordinary outbound family. SMTP entry is not acceptance. */
export async function sendGenericFencedEdielEmail(input: SendEdielEmailInput, context: GenericEdielDispatchContext): Promise<ProviderResult> {
  const gate = createGenericEdielAttemptGate(input, context)
  try {
    return await gate.capture(await sendEdielEmail(input, gate.entry))
  } catch (error) {
    return gate.fail(error)
  }
}

/** A DSN match is a transport candidate, never automatic delivery or business acceptance. */
export async function findEdielDsnAttemptCandidates(input: { companyId: string; environment: 'test' | 'production'; mailboxId: string; rfcMessageId: string; finalRecipient: string }): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseService.rpc('gridex_ediel_dsn_attempt_candidates_v1', {
    p_company_id: input.companyId, p_environment: input.environment, p_mailbox_id: input.mailboxId,
    p_rfc_message_id: input.rfcMessageId, p_final_recipient: input.finalRecipient,
  })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('ediel_dsn_candidate_result_invalid')
  return data
}
