import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  priceAddendumError,
  priceAddendumHeaders,
  priceAddendumNativeFailure,
  priceAddendumSha256,
  priceAddendumUuid,
  requirePriceAddendumStaffScope,
} from '@/lib/customer-contracts/testPriceAddendumStaffHttp'
import { RequestedChangeBodyLimit, readRequestedChangeJson } from '@/lib/ediel/production/requestedChangeHttp'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const activationIntent = z.object({ reviewSha256: priceAddendumSha256 }).strict()
const activationReceipt = z.object({
  kind: z.literal('applied'),
  documentId: priceAddendumUuid,
  reviewSha256: priceAddendumSha256,
  priceSnapshotId: priceAddendumUuid,
  priceSnapshotSha256: priceAddendumSha256,
  effectiveAt: z.string().datetime({ offset: true }),
  actorUserId: priceAddendumUuid,
  activatedAt: z.string().datetime({ offset: true }),
  existing: z.boolean(),
}).strict()
const nativeHeldReasons = new Set([
  'price_addendum_original_signature_required',
  'price_addendum_review_evidence_changed',
  'price_addendum_initial_timeline_changed',
  'price_addendum_fixed_energy_only_required',
])
type RouteContext = { params: Promise<{ contractId: string; documentId: string }> }

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { contractId, documentId } = await params
    const scope = await requirePriceAddendumStaffScope(contractId, 'activation')
    if (scope.response) return scope.response
    const document = priceAddendumUuid.safeParse(documentId)
    if (!document.success) return priceAddendumError('price_addendum_document_invalid', 400)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      return priceAddendumError('price_addendum_json_required', 415)
    }
    const intent = activationIntent.safeParse(await readRequestedChangeJson(request, 512))
    if (!intent.success) return priceAddendumError('price_addendum_review_digest_required', 400)

    // The native transaction checks the stored review and its exact digest under the contract lock.
    const { data, error } = await supabaseService.rpc('gridex_activate_test_contract_price_addendum_v1', {
      ...scope.args,
      p_document_id: document.data,
      p_review_sha256: intent.data.reviewSha256,
    })
    if (error) {
      const shared = priceAddendumNativeFailure(error)
      if (shared) return shared
      if (error.code === '42501' && error.message === 'price_addendum_pricing_scope_required') {
        return priceAddendumError(error.message, 403)
      }
      if ((error.code === '23514' && nativeHeldReasons.has(error.message)) ||
          (error.code === '23505' && error.message === 'price_addendum_application_conflict')) {
        return priceAddendumError(error.message, 409)
      }
      return priceAddendumError('price_addendum_activation_unconfirmed', 500)
    }

    const receipt = activationReceipt.safeParse(data)
    if (!receipt.success || receipt.data.documentId !== document.data ||
      receipt.data.reviewSha256 !== intent.data.reviewSha256 ||
      (!receipt.data.existing && receipt.data.actorUserId !== scope.args.p_actor_user_id.toLowerCase())) {
      return priceAddendumError('price_addendum_activation_unconfirmed', 500)
    }
    return NextResponse.json(receipt.data, {
      status: receipt.data.existing ? 200 : 201,
      headers: priceAddendumHeaders,
    })
  } catch (error) {
    if (error instanceof RequestedChangeBodyLimit) return priceAddendumError('price_addendum_activation_too_large', 413)
    if (error instanceof SyntaxError) return priceAddendumError('price_addendum_review_digest_required', 400)
    return priceAddendumError('price_addendum_activation_unconfirmed', 500)
  }
}
