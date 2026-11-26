import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  priceAddendumError,
  priceAddendumHeaders,
  priceAddendumNativeFailure,
  priceAddendumSha256,
  priceAddendumUuid,
  readPriceAddendumReviewSource,
  requirePriceAddendumStaffScope,
} from '@/lib/customer-contracts/testPriceAddendumStaffHttp'
import { RequestedChangeBodyLimit, readRequestedChangeJson } from '@/lib/ediel/production/requestedChangeHttp'
import { supabaseService } from '@/lib/supabase/service'
import { stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ contractId: string; documentId: string }> }

const date = z.string().refine(value => {
  try { return strictIsoDate(value) === value } catch { return false }
})
const signerEvidence = z.string().max(256).refine(value => value.trim().length > 0)
const review = z.object({
  documentSha256: priceAddendumSha256,
  verification: z.object({
    kind: z.literal('staff_manually_verified_signed_addendum_v1'),
    signedOn: date,
    effectiveOn: date,
    supplierSignerEvidence: signerEvidence,
    customerSignerEvidence: signerEvidence,
    priceOrePerKwh: z.string().regex(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,8})?$/),
  }).strict(),
}).strict()
const reviewReceipt = z.object({
  kind: z.literal('reviewed_unapplied'),
  documentId: priceAddendumUuid,
  reviewSha256: priceAddendumSha256,
  effectiveAt: z.string().datetime({ offset: true })
    .refine(value => !/\.\d*[1-9]\d*(?:Z|[+-])/.test(value)),
  existing: z.boolean(),
}).strict()

async function requireDocumentScope(context: RouteContext) {
  const { contractId, documentId } = await context.params
  const scope = await requirePriceAddendumStaffScope(contractId)
  if (scope.response) return { response: scope.response }
  const document = priceAddendumUuid.safeParse(documentId)
  if (!document.success) return { response: priceAddendumError('price_addendum_document_invalid', 400) }
  return { args: { ...scope.args, p_document_id: document.data } }
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const scope = await requireDocumentScope(context)
    if (scope.response) return scope.response
    const source = await readPriceAddendumReviewSource(scope.args)
    if (source.response) return source.response
    return new Response(new Uint8Array(source.bytes), { headers: {
      ...priceAddendumHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="pristillagg-test.pdf"',
      'Content-Length': String(source.bytes.length),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Gridex-Document-Sha256': source.digest,
    } })
  } catch {
    return priceAddendumError('price_addendum_source_unavailable', 500)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const scope = await requireDocumentScope(context)
    if (scope.response) return scope.response
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      return priceAddendumError('price_addendum_json_required', 415)
    }
    const parsed = review.safeParse(await readRequestedChangeJson(request, 8_192))
    if (!parsed.success) return priceAddendumError('price_addendum_manual_evidence_invalid', 400)
    const { documentSha256, verification } = parsed.data
    const [year, month, day] = verification.effectiveOn.split('-').map(Number)
    const effectiveAt = stockholmLocalToUtc({ year, month, day })
    const source = await readPriceAddendumReviewSource(scope.args)
    if (source.response) return source.response
    if (source.digest !== documentSha256) return priceAddendumError('price_addendum_document_evidence_changed', 409)

    const { data, error } = await supabaseService.rpc('gridex_review_test_contract_price_addendum_v1', {
      ...scope.args,
      p_verified_sha256: source.digest,
      p_verification: verification,
    })
    if (error) {
      const shared = priceAddendumNativeFailure(error)
      if (shared) return shared
      if (error.code === '22023' && error.message === 'price_addendum_manual_evidence_invalid') {
        return priceAddendumError(error.message, 400)
      }
      if (error.code === '23514' && [
        'price_addendum_document_evidence_changed', 'price_addendum_original_signature_or_effective_scope_changed',
      ].includes(error.message)) return priceAddendumError(error.message, 409)
      if (error.code === '23505') return priceAddendumError('price_addendum_review_conflict', 409)
      return priceAddendumError('price_addendum_review_unconfirmed', 500)
    }

    const receipt = reviewReceipt.safeParse(data)
    if (!receipt.success || receipt.data.documentId !== scope.args.p_document_id ||
      Date.parse(receipt.data.effectiveAt) !== effectiveAt.getTime()) {
      return priceAddendumError('price_addendum_review_unconfirmed', 500)
    }
    return NextResponse.json(receipt.data, { status: receipt.data.existing ? 200 : 201, headers: priceAddendumHeaders })
  } catch (error) {
    if (error instanceof RequestedChangeBodyLimit) return priceAddendumError('price_addendum_review_too_large', 413)
    if (error instanceof SyntaxError) return priceAddendumError('price_addendum_manual_evidence_invalid', 400)
    return priceAddendumError('price_addendum_review_unconfirmed', 500)
  }
}
