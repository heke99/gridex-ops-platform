import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  RequestedChangeBodyLimit,
  readRequestedChangeJson,
} from '@/lib/ediel/production/requestedChangeHttp'
import {
  isCanonicalPriceAddendumPdf,
  priceAddendumError as response,
  priceAddendumHeaders as headers,
  priceAddendumMaxBase64Length as maxBase64Length,
  priceAddendumMaxDocumentBytes as maxDocumentBytes,
  priceAddendumSha256,
  priceAddendumUuid as uuid,
  requirePriceAddendumStaffScope,
} from '@/lib/customer-contracts/testPriceAddendumStaffHttp'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const upload = z.object({
  submissionKey: uuid,
  documentBase64: z.string().min(12).max(maxBase64Length),
}).strict()
const pendingReceipt = z.object({
  kind: z.literal('pending'),
  documentId: uuid,
  documentSha256: priceAddendumSha256,
  byteLength: z.number().int().min(8).max(maxDocumentBytes),
  existing: z.boolean(),
}).strict()

export async function POST(request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  try {
    const scope = await requirePriceAddendumStaffScope((await params).contractId)
    if (scope.response) return scope.response

    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      return response('price_addendum_json_required', 415)
    }
    const body = await readRequestedChangeJson(request, maxBase64Length + 512)
    const encoded = body && typeof body === 'object' && 'documentBase64' in body ? body.documentBase64 : null
    if (typeof encoded === 'string' && encoded.length > maxBase64Length) {
      return response('price_addendum_document_too_large', 413)
    }
    const parsed = upload.safeParse(body)
    if (!parsed.success) return response('price_addendum_document_invalid', 400)
    const { submissionKey, documentBase64 } = parsed.data
    const bytes = Buffer.from(documentBase64, 'base64')
    if (bytes.byteLength > maxDocumentBytes) return response('price_addendum_document_too_large', 413)
    if (!isCanonicalPriceAddendumPdf(bytes, documentBase64)) {
      return response('price_addendum_document_invalid', 400)
    }

    const { data, error } = await supabaseService.rpc('gridex_archive_test_contract_price_addendum_v1', {
      ...scope.args,
      p_submission_key: submissionKey,
      p_document_base64: documentBase64,
    })
    if (error) {
      if (error.code === '42501' && error.message === 'price_addendum_staff_scope_required') {
        return response('price_addendum_staff_scope_required', 403)
      }
      if (error.code === '23514' && error.message === 'price_addendum_test_scope_required') {
        return response('price_addendum_test_scope_required', 403)
      }
      if (error.code === '23514' && error.message === 'price_addendum_original_signature_required') {
        return response('price_addendum_original_signature_required', 409)
      }
      if (error.code === '22023' && error.message === 'price_addendum_document_invalid') {
        return response('price_addendum_document_invalid', 400)
      }
      if (error.code === '23505' && error.message === 'price_addendum_submission_conflict') {
        return response('price_addendum_submission_conflict', 409)
      }
      if (error.code === '55P03') return response('price_addendum_archive_busy', 503)
      if (error.code === 'PGRST202') return response('price_addendum_archive_unavailable', 503)
      return response('price_addendum_archive_unconfirmed', 500)
    }

    const receipt = pendingReceipt.safeParse(data)
    if (!receipt.success || receipt.data.byteLength !== bytes.byteLength ||
      receipt.data.documentSha256 !== createHash('sha256').update(bytes).digest('hex')) {
      return response('price_addendum_archive_unconfirmed', 500)
    }
    return NextResponse.json(receipt.data, { status: receipt.data.existing ? 200 : 201, headers })
  } catch (error) {
    if (error instanceof RequestedChangeBodyLimit) return response('price_addendum_document_too_large', 413)
    if (error instanceof SyntaxError) return response('price_addendum_document_invalid', 400)
    return response('price_addendum_archive_unconfirmed', 500)
  }
}
