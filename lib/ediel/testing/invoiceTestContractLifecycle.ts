import { randomBytes } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import {
  assertInvoiceTestCustomer,
  INVOICE_TEST_CUSTOMER_KIND,
} from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function testKind(metadata: unknown): string | null {
  return text(objectValue(objectValue(metadata).test_center).kind)
}

export async function signInvoiceTestContractCanonically(input: {
  companyId: string
  customerId: string
  contractId: string
  actorUserId: string
}) {
  const customer = await assertInvoiceTestCustomer({
    companyId: input.companyId,
    customerId: input.customerId,
  })

  const contractResult = await supabaseService
    .from('customer_contracts')
    .select('id,company_id,customer_id,status,invoice_email,metadata,signed_at,locked_at,signature_snapshot_sha256,contract_price_snapshot_id,contract_product_version_id,contract_publication_version_id,legal_bundle_version_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.contractId)
    .maybeSingle()
  if (contractResult.error) throw contractResult.error
  const contract = contractResult.data as Row | null
  if (!contract || testKind(contract.metadata) !== INVOICE_TEST_CUSTOMER_KIND) {
    throw new Error('Fakturatest blockerad: avtalet saknar explicit Fakturatest-markör.')
  }

  const status = text(contract.status)
  if (status === 'signed' || status === 'active') return contract
  if (!['draft', 'pending_signature', 'signature_failed'].includes(status ?? '')) {
    throw new Error(`Fakturatest blockerad: avtalsstatus ${status ?? 'saknas'} kan inte signeras canonical.`)
  }

  const recipientEmail = text(contract.invoice_email) ?? text(customer.email)
  if (!recipientEmail) throw new Error('Fakturatest blockerad: faktura-/kund-e-post saknas för test-signeringen.')

  // The value itself never leaves the backend. The production signing RPC only
  // stores and consumes the SHA-style token key; this is explicit synthetic
  // acceptance for an is_test_data customer, never a real customer signature.
  const tokenHash = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  const prepared = await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_contract_id: input.contractId,
    p_token_hash: tokenHash,
    p_recipient_email: recipientEmail,
    p_expires_at: expiresAt,
    p_actor_user_id: input.actorUserId,
    p_channel: 'internal',
  })
  if (prepared.error) throw prepared.error

  const finalized = await supabaseService.rpc('gridex_finalize_customer_contract_signature_v1', {
    p_token_hash: tokenHash,
    p_signed_ip_hash: null,
    p_signed_user_agent: 'Gridex Fakturatest synthetic acceptance · TEST ONLY',
  })
  if (finalized.error) throw finalized.error

  const verified = await supabaseService
    .from('customer_contracts')
    .select('id,company_id,customer_id,status,metadata,signed_at,locked_at,signature_snapshot_sha256,contract_price_snapshot_id,contract_product_version_id,contract_publication_version_id,legal_bundle_version_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.contractId)
    .maybeSingle()
  if (verified.error) throw verified.error
  const row = verified.data as Row | null
  if (
    !row ||
    text(row.status) !== 'signed' ||
    !text(row.signed_at) ||
    !text(row.locked_at) ||
    !text(row.signature_snapshot_sha256) ||
    !text(row.contract_price_snapshot_id) ||
    !text(row.contract_product_version_id) ||
    !text(row.contract_publication_version_id) ||
    !text(row.legal_bundle_version_id) ||
    testKind(row.metadata) !== INVOICE_TEST_CUSTOMER_KIND
  ) {
    throw new Error('Fakturatest blockerad: canonical test-signering kunde inte verifieras komplett.')
  }
  return row
}
