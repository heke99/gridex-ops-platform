import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ receipt: vi.fn() }))
vi.mock('@/lib/customer-contracts/onlineSigning', () => ({
  loadOnlineSignatureReceipt: io.receipt,
  loadOnlineSignaturePoaTerms: vi.fn(),
  frozenPriceSummary: vi.fn(),
  ONLINE_POA_TERMS_VERSION: 'unit',
}))
vi.mock('@/lib/customer-contracts/confirmationDelivery', () => ({ loadContractConfirmationState: vi.fn() }))
vi.mock('@/app/sign/contract/[token]/actions', () => ({ signContractAction: vi.fn() }))
vi.mock('@/app/sign/contract/[token]/SignSubmitButton', () => ({ default: () => null }))

import ContractSigningPage from '@/app/sign/contract/[token]/page'
import { SIGNED_AGREEMENT_IMPORT_FAILED_MESSAGE } from '@/lib/customer-contracts/signingMethod'

beforeEach(() => {
  vi.stubGlobal('React', React)
  io.receipt.mockReset()
})

async function failedPage(error: unknown, token = 'existing-token') {
  io.receipt.mockRejectedValueOnce(error)
  const page = await ContractSigningPage({ params: Promise.resolve({ token }) })
  return renderToStaticMarkup(page)
}

describe('public signing receipt read failures', () => {
  it.each([
    new TypeError('fetch failed'),
    { code: '502', message: 'Bad Gateway' },
    { code: '40001', message: 'signature_request_scope_changed' },
    { code: 'P0002', message: 'some_other_record_not_found' },
    { code: '55000', message: 'signature_tenant_not_operational' },
  ])('keeps the original link available after an unclassified read failure: %j', async (error) => {
    const html = await failedPage(error)
    expect(html).toContain('Försök igen med samma länk')
    expect(html).toContain('href="/sign/contract/existing-token"')
    expect(html).not.toContain('har löpt ut')
    expect(html).not.toContain('en ny länk')
    expect(html).not.toContain('fetch failed')
    expect(html).not.toContain('<form')
    expect(io.receipt).toHaveBeenCalledExactlyOnceWith('existing-token')
  })

  it.each([
    new Error('online_signature_token_invalid'),
    { code: 'P0002', message: 'signature_link_not_found' },
    { code: '55000', message: 'signature_link_expired' },
    { code: '55000', message: 'signature_link_revoked' },
  ])('only reports a rejected link on the exact authoritative reason: %j', async (error) => {
    const html = await failedPage(error)
    expect(html).toContain('Signeringslänken kan inte användas')
    expect(html).toContain('har löpt ut')
    expect(html).not.toContain('Försök igen med samma länk')
    expect(html).not.toContain('<form')
  })

  it('encodes the original route token in a retry link', async () => {
    const html = await failedPage(new Error('unavailable'), 'token/with?parts')
    expect(html).toContain('href="/sign/contract/token%2Fwith%3Fparts"')
  })

  it('does not assert an unsigned contract after an unconfirmed PDF import', () => {
    expect(SIGNED_AGREEMENT_IMPORT_FAILED_MESSAGE).not.toContain('avtalet är inte signerat')
    expect(SIGNED_AGREEMENT_IMPORT_FAILED_MESSAGE).toContain('kunde inte bekräftas')
    expect(SIGNED_AGREEMENT_IMPORT_FAILED_MESSAGE).toContain('innan')
  })
})
