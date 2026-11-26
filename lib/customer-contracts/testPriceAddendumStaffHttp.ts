import 'server-only'
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'

export const priceAddendumHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export const priceAddendumMaxDocumentBytes = 2_097_152
export const priceAddendumMaxBase64Length = Math.ceil(priceAddendumMaxDocumentBytes / 3) * 4
export const priceAddendumUuid = z.string().uuid().transform(value => value.toLowerCase())
export const priceAddendumSha256 = z.string().regex(/^[a-f0-9]{64}$/)

const reviewSourceReceipt = z.object({
  kind: z.literal('review_source'),
  documentId: priceAddendumUuid,
  documentSha256: priceAddendumSha256,
  byteLength: z.number().int().min(8).max(priceAddendumMaxDocumentBytes),
  bodyBase64: z.string().min(12).max(priceAddendumMaxBase64Length),
}).strict()
const pdfPrefix = Buffer.from('%PDF-')

export function priceAddendumError(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: priceAddendumHeaders })
}

export function isCanonicalPriceAddendumPdf(bytes: Buffer, encoded: string) {
  return bytes.byteLength >= 8 && bytes.byteLength <= priceAddendumMaxDocumentBytes
    && bytes.subarray(0, pdfPrefix.length).equals(pdfPrefix) && bytes.toString('base64') === encoded
}

export async function requirePriceAddendumStaffScope(contractId: string, purpose: 'custody' | 'activation' = 'custody') {
  const required = ['contracts.write', 'documents.write']
  if (purpose === 'activation') required.push('pricing.write')
  const access = await requireAdminApiAccess({ allOf: required })
  if (access.response) {
    for (const [name, value] of Object.entries(priceAddendumHeaders)) access.response.headers.set(name, value)
    return { response: access.response }
  }
  const company = priceAddendumUuid.safeParse(access.guard.companyId)
  if (!company.success) return { response: priceAddendumError('price_addendum_staff_scope_required', 403) }
  const contract = priceAddendumUuid.safeParse(contractId)
  if (!contract.success) return { response: priceAddendumError('price_addendum_contract_invalid', 400) }
  const client = await createSupabaseServerClient()
  const writable = await client.rpc('gridex_can_write_company', { p_company_id: company.data })
  if (writable.error) return { response: priceAddendumError('price_addendum_authority_unavailable', 503) }
  if (writable.data !== true) return { response: priceAddendumError('price_addendum_staff_scope_required', 403) }

  const contractRead = await client.from('customer_contracts')
    .select('id,company_id,customer_id')
    .eq('id', contract.data)
    .eq('company_id', company.data)
    .maybeSingle()
  if (contractRead.error) return { response: priceAddendumError('price_addendum_contract_unavailable', 503) }
  const customer = priceAddendumUuid.safeParse(contractRead.data?.customer_id)
  if (contractRead.data?.id !== contract.data || contractRead.data?.company_id !== company.data || !customer.success) {
    return { response: priceAddendumError('price_addendum_contract_not_found', 404) }
  }
  return { args: {
    p_company_id: company.data,
    p_actor_user_id: access.guard.userId,
    p_customer_id: customer.data,
    p_contract_id: contract.data,
  } }
}

type DocumentArgs = NonNullable<Awaited<ReturnType<typeof requirePriceAddendumStaffScope>>['args']> & { p_document_id: string }

export function priceAddendumNativeFailure(error: { code: string; message: string }) {
  if (error.code === '42501' && error.message === 'price_addendum_staff_scope_required') {
    return priceAddendumError(error.message, 403)
  }
  if (error.code === '23514' && error.message === 'price_addendum_test_scope_required') {
    return priceAddendumError(error.message, 403)
  }
  if (error.code === '55P03') return priceAddendumError('price_addendum_busy', 503)
  if (error.code === 'PGRST202') return priceAddendumError('price_addendum_unavailable', 503)
  return null
}

export async function readPriceAddendumReviewSource(args: DocumentArgs) {
  const { data, error } = await supabaseService.rpc('gridex_read_test_contract_price_addendum_review_source_v1', args)
  if (error) {
    return { response: priceAddendumNativeFailure(error) ?? priceAddendumError('price_addendum_source_unavailable', 500) }
  }
  if (data === null) return { response: priceAddendumError('price_addendum_source_not_found', 404) }
  const parsed = reviewSourceReceipt.safeParse(data)
  if (!parsed.success || parsed.data.documentId !== args.p_document_id) {
    return { response: priceAddendumError('price_addendum_source_unavailable', 500) }
  }
  const bytes = Buffer.from(parsed.data.bodyBase64, 'base64')
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (!isCanonicalPriceAddendumPdf(bytes, parsed.data.bodyBase64) ||
    bytes.byteLength !== parsed.data.byteLength || digest !== parsed.data.documentSha256) {
    return { response: priceAddendumError('price_addendum_source_unavailable', 500) }
  }
  return { bytes, digest }
}
