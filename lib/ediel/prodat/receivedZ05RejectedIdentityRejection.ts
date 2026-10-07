// Initial explicit deny-all API for executable feature TDD. No source or
// response authority exists until the actual private READ owner is implemented.
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import type {ProdatRegisterValidationEvidence} from './prodatRegisterValidationEvidence'
import type {receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

type Input = {rawSegments: readonly string[]; una?: EdifactServiceStringAdvice}
type Witness = NonNullable<ReturnType<typeof receivedOriginalRulePackWitness>>
declare const rejectionBrand: unique symbol
export type ReceivedZ05RejectedIdentityRejection = Readonly<{[rejectionBrand]: true}>
export function observeReceivedZ05RejectedIdentity(_input: Input): EdielRulebookIssue[] {return []}
export function validateReceivedZ05RejectedIdentityStructure(_input: Input): {evidence: ProdatRegisterValidationEvidence; issues: EdielRulebookIssue[]} | null {return null}
export async function loadReceivedZ05RejectedIdentityRejection(_source: EdielMessageRow, _actor: string): Promise<ReceivedZ05RejectedIdentityRejection | null> {return null}
export function readReceivedZ05RejectedIdentityWitness(_token: ReceivedZ05RejectedIdentityRejection, _source: EdielMessageRow, _actor: string): Witness | null {return null}
export function ownReceivedZ05RejectedIdentityRejection(_decision: CanonicalRuntimeDecision, _source: EdielMessageRow, _actor: string, _token: ReceivedZ05RejectedIdentityRejection): boolean {return false}
export function hasReceivedZ05RejectedIdentityRejection(_decision: object, _source: unknown, _actor?: string): boolean {return false}
