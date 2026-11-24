import { processInboundUtiltsMessage, type DurableE66RequestBasis } from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import type { E66RequestCorrelationReview } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import type { prepareUtiltsPersistenceRpcArguments } from '@/lib/ediel/utilts/transactionPersistence'
import { supabaseService } from '@/lib/supabase/service'

export type DurableE66Scope = {
  actorUserId: string
  companyId: string
  environment: 'test' | 'production'
  mailboxId: string
}

type QualificationResult =
  | { state: 'idle' }
  | { state: 'qualified' | 'registration_rejected' | 'request_review'; sourceId: string }

type NativeScope = {
  p_company: string
  p_environment: DurableE66Scope['environment']
  p_mailbox: string
  p_actor: string
}

type NativeCommit = NativeScope & {
  p_source: string
  p_lease: string
  p_transactions: ReturnType<typeof prepareUtiltsPersistenceRpcArguments>['p_transactions']
}

type Outcome = PromiseLike<{ data: unknown; error: { message: string } | null }>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sha256 = /^[0-9a-f]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function qualifyNextDurableE66(scope: DurableE66Scope): Promise<QualificationResult> {
  // The local forward migration supplies these RPCs. Generated types remain
  // owned by the official generator for the final migration graph.
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as {
    (name: 'gridex_claim_e66_qualification_v1', args: NativeScope): Outcome
    (name: 'gridex_commit_e66_qualification_v1', args: NativeCommit): Outcome
    (name: 'gridex_commit_e66_matched_qualification_v1', args: NativeCommit & {p_reply: DurableE66RequestBasis}): Outcome
    (name: 'gridex_hold_e66_request_correlation_v1', args: Omit<NativeCommit,'p_transactions'> & {p_review:E66RequestCorrelationReview}): Outcome
    (name: 'gridex_commit_e66_registration_rejection_v1', args: NativeCommit): Outcome
    (name: 'gridex_finish_e66_registration_rejection_v1', args: Omit<NativeCommit,'p_transactions'>): Outcome
  }
  const nativeScope = {
    p_company: scope.companyId,
    p_environment: scope.environment,
    p_mailbox: scope.mailboxId,
    p_actor: scope.actorUserId,
  }
  const claim = await rpc('gridex_claim_e66_qualification_v1', nativeScope)
  if (claim.error) throw new Error(`e66_qualification_claim_failed:${claim.error.message}`)
  if (!isRecord(claim.data)) throw new Error('e66_qualification_claim_invalid')
  const { kind, phase, sourceId, leaseToken } = claim.data
  if (kind === 'idle') return { state: 'idle' }
  if (kind !== 'claimed' || phase !== 'qualification' ||
      typeof sourceId !== 'string' || !uuid.test(sourceId) ||
      typeof leaseToken !== 'string' || !uuid.test(leaseToken)) {
    throw new Error('e66_qualification_claim_invalid')
  }

  const claimedSource = { ...nativeScope, p_source:sourceId,p_lease:leaseToken }
  let rejectedRegistration = false
  let heldForRequestReview = false
  const applicationResult = await processInboundUtiltsMessage({
    actorUserId: scope.actorUserId,
    edielMessageId: sourceId,
    async holdDurableE66RequestReview(review) {
      const reply = await rpc('gridex_hold_e66_request_correlation_v1',{...claimedSource,p_review:review})
      if (reply.error) throw new Error(`e66_request_correlation_hold_failed:${reply.error.message}`)
      if (reply.data!==sourceId) throw new Error('e66_request_correlation_receipt_invalid')
      heldForRequestReview=true
    },
    async persistDurableE66RegistrationRejection(command) {
      if (command.p_actor_user_id !== scope.actorUserId || command.p_company_id !== scope.companyId ||
          command.p_environment !== scope.environment || command.p_source_message_id !== sourceId ||
          command.p_message_code !== 'E66' || command.p_transactions.length !== 1) {
        throw new Error('e66_registration_rejection_command_scope_invalid')
      }
      const reply = await rpc('gridex_commit_e66_registration_rejection_v1',{
        ...claimedSource,p_transactions:command.p_transactions,
      })
      if (reply.error) throw new Error(`e66_registration_rejection_persist_failed:${reply.error.message}`)
      rejectedRegistration = true
      return reply.data
    },
    async commitDurableE66Qualification(command) {
      if (command.p_actor_user_id !== scope.actorUserId || command.p_company_id !== scope.companyId ||
          command.p_environment !== scope.environment || command.p_source_message_id !== sourceId ||
          command.p_message_code !== 'E66' || command.p_transactions.length !== 1) {
        throw new Error('e66_qualification_command_scope_invalid')
      }
      const commitArgs = {
        ...nativeScope,
        p_source: sourceId,
        p_lease: leaseToken,
        p_transactions: command.p_transactions,
      }
      const commit = command.matchedRequestBasis
        ? await rpc('gridex_commit_e66_matched_qualification_v1', { ...commitArgs, p_reply: command.matchedRequestBasis })
        : await rpc('gridex_commit_e66_qualification_v1', commitArgs)
      if (commit.error) throw new Error(`e66_qualification_commit_failed:${commit.error.message}`)
      if (!isRecord(commit.data) || commit.data.kind !== 'qualified' ||
          commit.data.transactionId !== command.p_transactions[0].transactionId ||
          typeof commit.data.seriesId !== 'string' || !uuid.test(commit.data.seriesId) ||
          typeof commit.data.contractHash !== 'string' || !sha256.test(commit.data.contractHash) ||
          typeof commit.data.replayed !== 'boolean') {
        throw new Error('e66_qualification_receipt_invalid')
      }
    },
  })
  if (heldForRequestReview) return { state: 'request_review', sourceId }
  if (rejectedRegistration) {
    const finished = await rpc('gridex_finish_e66_registration_rejection_v1',claimedSource)
    if (finished.error) throw new Error(`e66_registration_rejection_ack_failed:${finished.error.message}`)
    if (typeof finished.data !== 'string' || !applicationResult.ackIds.includes(finished.data)) {
      throw new Error('e66_registration_rejection_ack_receipt_invalid')
    }
    return { state:'registration_rejected',sourceId }
  }
  if (applicationResult.durableQualificationCommitted !== true) throw new Error('e66_qualification_held')
  return { state: 'qualified', sourceId }
}
