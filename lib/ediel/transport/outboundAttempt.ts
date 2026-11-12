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
import { SmtpDeliveryUncertainError } from './smtpOutcome'
import { smtpErrorEvidence, smtpResultEvidence } from './smtpEvidence'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { OutboundDispatchOwner } from '@/lib/ediel/sources/correctionOutboundDispatch'
import {transportExceptionBinding,type TransportExceptionAuthorization} from './exception/source'

type ProviderResult = Awaited<ReturnType<typeof sendEdielEmail>> & { dispatchReplay?: boolean; dispatchObservedAt?: string }
type Receipt = { proceed?: boolean; classification?: string; state?: string; providerReceipt?: ProviderResult; observedAt?: string; localTestWait?: unknown }
/** A committed native refusal/wait is not permission to resend. */
export class LocalTestTransportWaitError extends Error {
  readonly code = 'ediel_local_test_retry_wait'
  constructor(readonly notBefore: string, readonly deadline: string) { super('ediel_local_test_retry_wait') }
}

class AcceptedProjection extends Error { constructor(readonly result: ProviderResult) { super('ediel_transport_projection_only') } }

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
  let prepared = false, entered = false, observed = false, callbackUsed = false
  let capturedSmtpEndpoint: unknown = null
  const call = async (action: string, extra: Record<string, unknown> = {}): Promise<Receipt> => {
    // This host uses Next's default .next directory. Match Next getBuildId's
    // trimmed UTF-8 identity, never a request field or environment opt-in.
    // Re-read at BOTH boundaries; no cached identity survives a build switch.
    const needsBuild = message.environment === 'test' && (action === 'prepare' || action === 'enter')
    let serverBuildSha256: string | null = null
    if (needsBuild) {
      try {
        const bytes = await readFile(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8')
        const buildId = bytes.trim()
        if (buildId && Buffer.byteLength(bytes, 'utf8') <= 1024 && !/[\u0000-\u001f\u007f]/.test(buildId)) {
          serverBuildSha256 = createHash('sha256').update(buildId, 'utf8').digest('hex')
        }
      } catch { /* A registered LOCAL policy rejects missing identity in SQL. */ }
    }
    const { data, error } = await supabaseService.rpc('gridex_ediel_transport_attempt_v1', {
      p_input: { ...identity, action, ...extra, ...(needsBuild ? { serverBuildSha256, serverSmtpEndpoint: capturedSmtpEndpoint } : {}) },
    })
    if (error) throw error
    if (!data || typeof data !== 'object') throw new Error('ediel_transport_receipt_invalid')
    return data as Receipt
  }
  const entry = {
    archiveContext: { companyId: message.company_id, messageId: message.id },
    ...(message.environment === 'test' ? { captureLocalTransportEndpoint: true as const } : {}),
    beforeProviderCall: async (actual: Record<string, unknown>) => {
      if (callbackUsed) throw new Error('ediel_transport_callback_reused')
      callbackUsed = true
      // The email helper supplies this from the SAME captured transporter
      // options. Never re-read server SMTP config after archive awaits.
      if (message.environment === 'test') {
        capturedSmtpEndpoint = actual.localSmtpEndpoint && typeof actual.localSmtpEndpoint === 'object'
          ? Object.freeze(structuredClone(actual.localSmtpEndpoint)) : null
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
      const authorization = await call('enter')
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
        let receipt: Receipt | null = null
        try { receipt = await call('observe', { result: smtpErrorEvidence(error) }) } catch { /* lost commit response remains reconciliation-only */ }
        const wait = receipt?.localTestWait as Record<string, unknown> | undefined
        const provider = error as { responseCode?: unknown } | null
        const started = typeof wait?.observedAt === 'string' ? Date.parse(wait.observedAt) : NaN
        const due = typeof wait?.notBefore === 'string' ? Date.parse(wait.notBefore) : NaN
        const end = typeof wait?.deadline === 'string' ? Date.parse(wait.deadline) : NaN
        if (message.environment === 'test' && context.owner?.kind === 'worker'
          && receipt?.classification === 'explicit_negative' && receipt.state === 'observed' && wait?.version === 1
          && wait.policyVersion === 'local-test-4xx-v1' && wait.environment === 'test'
          && wait.companyId === identity.companyId && wait.messageId === identity.messageId
          && wait.attemptId === identity.attemptId && wait.outboxId === context.owner.outboxId
          && typeof provider?.responseCode === 'number' && Number.isInteger(provider.responseCode)
          && provider.responseCode >= 400 && provider.responseCode <= 499 && wait.smtpCode === provider.responseCode
          && typeof wait.delaySeconds === 'number' && Number.isInteger(wait.delaySeconds)
          && wait.delaySeconds >= 1 && wait.delaySeconds <= 3600
          && Number.isFinite(started) && Number.isFinite(due) && Number.isFinite(end)
          && receipt.observedAt === wait.observedAt && due - started === wait.delaySeconds * 1000 && end > due) {
          throw new LocalTestTransportWaitError(wait.notBefore as string, wait.deadline as string)
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
