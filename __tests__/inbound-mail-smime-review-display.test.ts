import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const fixture = vi.hoisted(() => ({
  authorize: vi.fn(), from: vi.fn(), rpc: vi.fn(), message: null as Row | null, attachments: [] as Row[], jobs: [] as Row[],
  diagnostic: [] as Row[], attachmentError: null as Error | null, diagnosticError: null as Error | null,
  diagnosticQuery: vi.fn(),
}))

vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: fixture.authorize }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/app/admin/inbound-mail/actions', () => ({ reprocessInboundEmailAction: vi.fn() }))
vi.mock('@/app/admin/inbound-mail/[id]/reviewActions', () => ({ resolveInboundManualReviewUiAction: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: fixture.from, rpc: fixture.rpc } }))

import InboundMailDetailPage from '@/app/admin/inbound-mail/[id]/page'

const messageId = '00000000-0000-4000-8000-000000000001'
const jobId = '00000000-0000-4000-8000-000000000002'
const actorId = '00000000-0000-4000-8000-000000000009'
const earlierOriginalId = '00000000-0000-4000-8000-000000000008'
const otherJobId = '00000000-0000-4000-8000-000000000003'
const companyId = '00000000-0000-4000-8000-000000000004'
const legacyJob = { id: jobId, status: 'manual_review', step: 'manual_review', review_reason: 'manual_review', error_message: null, payload: { hasRawEdifactPayload: false } }
const attachment = (securityStatus: string, evidence?: Row): Row => ({
  filename: 'smime.p7m',
  mime_type: 'application/pkcs7-mime',
  metadata: { securityStatus, encryptedPayloadRef: 'inbound-smime://fixture', smimeValidationError: 'synthetic-private-error', evidence },
})

const renderPage = async () => renderToStaticMarkup(await InboundMailDetailPage({ params: Promise.resolve({ id: messageId }) }))
const statusSelect = (html: string) => html.match(/<select[^>]*name="next_status"[^>]*>[\s\S]*?<\/select>/)?.[0]
const jobForm = (html: string, id: string) => html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g)?.find(form => form.includes(`name="job_id" value="${id}"`)) ?? ''

beforeEach(() => {
  vi.stubGlobal('React', React)
  fixture.message = { id: messageId, company_id: companyId, environment: 'test', raw_edifact_payload: null, raw_email: 'Synthetic retained mail', match_status: 'missing_payload' }
  fixture.attachments = []
  fixture.attachmentError = null
  fixture.jobs = [legacyJob]
  fixture.diagnostic = []
  fixture.diagnosticError = null
  fixture.diagnosticQuery.mockClear()
  fixture.authorize.mockReset().mockResolvedValue({ email: 'operator@example.invalid', userId: actorId })
  fixture.rpc.mockReset().mockResolvedValue({ data: null, error: null })
  fixture.from.mockReset().mockImplementation((table: string) => {
    const data = table === 'inbound_email_messages' ? fixture.message : table === 'inbound_email_attachments' ? fixture.attachments :
      table === 'inbound_processing_jobs' ? fixture.jobs : table === 'ediel_messages' ? fixture.diagnostic : []
    const error = table === 'inbound_email_attachments' ? fixture.attachmentError : table === 'ediel_messages' ? fixture.diagnosticError : null
    const recordDiagnostic = (...step: unknown[]) => { if (table === 'ediel_messages') fixture.diagnosticQuery(...step) }
    const query = {
      select: (projection: string) => { recordDiagnostic('select', projection); return query },
      eq: (column: string, value: string) => {
        if (table !== 'ediel_messages') expect(value).toBe(messageId)
        recordDiagnostic('eq', column, value)
        return query
      },
      is: (column: string, value: null) => { recordDiagnostic('is', column, value); return query },
      order: (column: string, options: { ascending: boolean }) => { recordDiagnostic('order', column, options); return query },
      limit: (value: number) => { recordDiagnostic('limit', value); return query },
      maybeSingle: () => query,
      then: (resolve: (result: { data: unknown; error: Error | null }) => unknown) => Promise.resolve({ data, error }).then(resolve),
    }
    return query
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('inbound mail S/MIME review', () => {
  it('explains a missing readable private certificate and requires an explicit review choice', async () => {
    fixture.attachments = [attachment('decrypt_failed', { decryptMethod: 'node_forge_pkcs7', privateCertificateProfiles: 0 })]
    const html = await renderPage()
    const notice = html.match(/<section[^>]*role="status"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? ''
    expect(notice).toContain('S/MIME kunde inte dekrypteras')
    expect(notice).toContain('Det krypterade originalet är sparat.')
    expect(notice).toContain('Inget läsbart privat certifikat hittades för mejlets bolag och miljö.')
    expect(notice).toContain('href="/admin/ediel/certificates"')
    expect(notice).not.toContain('synthetic-private-error')
    expect(html).not.toContain('Match: missing_payload')
    const select = statusSelect(html)
    expect(select).toMatch(/<select[^>]*required=""/)
    expect(select).toMatch(/<option[^>]*value=""[^>]*selected=""[^>]*>Välj nästa status/)
    expect(select).not.toMatch(/value="queued" selected=/)
    expect(select).toContain('Köa om')
  })

  it('shows a format problem without asserting that a private certificate is missing', async () => {
    fixture.attachments = [attachment('decrypt_failed', { decryptMethod: 'node_forge_pkcs7_required' })]
    fixture.message = { ...fixture.message, raw_email: null }
    const html = await renderPage()
    expect(html).toContain('Det krypterade innehållet kunde inte läsas. Kontrollera S/MIME-formatet i originalet.')
    expect(html).not.toContain('Det krypterade originalet är sparat.')
    expect(html).not.toContain('Inget läsbart privat certifikat')
    expect(html).not.toContain('href="/admin/ediel/certificates"')
  })

  it('offers both checks for an undifferentiated legacy decrypt failure', async () => {
    fixture.attachments = [attachment('decrypt_failed')]
    const html = await renderPage()
    expect(html).toContain('Kontrollera S/MIME-formatet och det privata certifikatet.')
    expect(statusSelect(html)).toContain('Välj nästa status')
  })

  it.each(['missing', 'invalid', 'unavailable'])('uses the canonical diagnostic when attachment metadata is %s', async mode => {
    fixture.diagnostic = [{ processing_status: 'smime_decrypt_failed' }]
    if (mode === 'invalid') fixture.attachments = [{ metadata: 'invalid legacy metadata' }]
    if (mode === 'unavailable') fixture.attachmentError = new Error('synthetic-private-read-error')
    const html = await renderPage()
    expect(html).toContain('S/MIME kunde inte dekrypteras')
    expect(html).toContain('Kontrollera S/MIME-formatet och det privata certifikatet.')
    expect(html).not.toContain('Inget läsbart privat certifikat')
    expect(statusSelect(html)).toContain('Välj nästa status')
    expect(fixture.diagnosticQuery.mock.calls).toEqual([
      ['select', 'processing_status'], ['eq', 'inbound_email_message_id', messageId], ['eq', 'direction', 'inbound'],
      ['eq', 'environment', 'test'], ['eq', 'company_id', companyId], ['order', 'created_at', { ascending: false }], ['limit', 1],
    ])
    if (mode === 'unavailable') {
      expect(html).toContain('Bilagor kunde inte läsas.')
      expect(html).not.toContain('synthetic-private-read-error')
    }
  })

  it('keeps the linked diagnostic in the original null-company scope', async () => {
    fixture.message = { ...fixture.message, company_id: null }
    fixture.diagnostic = [{ processing_status: 'smime_decrypt_failed' }]
    expect(await renderPage()).toContain('S/MIME kunde inte dekrypteras')
    expect(fixture.diagnosticQuery).toHaveBeenCalledWith('is', 'company_id', null)
    expect(fixture.diagnosticQuery.mock.calls).not.toContainEqual(['eq', 'company_id', companyId])
  })

  it('uses the newest linked status rather than searching for an older failure', async () => {
    fixture.diagnostic = [{ processing_status: 'parsed' }, { processing_status: 'smime_decrypt_failed' }]
    const html = await renderPage()
    expect(html).not.toContain('S/MIME kunde inte dekrypteras')
    expect(statusSelect(html)).toMatch(/value="queued" selected=""/)
  })

  it('keeps ordinary details available when the optional diagnostic read fails', async () => {
    fixture.diagnosticError = new Error('synthetic-private-diagnostic-error')
    const html = await renderPage()
    expect(html).not.toContain('S/MIME kunde inte dekrypteras')
    expect(html).not.toContain('synthetic-private-diagnostic-error')
    expect(statusSelect(html)).toMatch(/value="queued" selected=""/)
  })

  it('changes only the review job associated with the missing payload', async () => {
    fixture.attachments = [attachment('decrypt_failed')]
    fixture.jobs = [{ ...legacyJob, id: otherJobId, review_reason: 'tenant_not_found' }, legacyJob]
    const html = await renderPage()
    expect(jobForm(html, jobId)).toContain('Kontrollera S/MIME-formatet och det privata certifikatet.')
    expect(statusSelect(jobForm(html, jobId))).toContain('Välj nästa status')
    expect(jobForm(html, otherJobId)).toContain('Orsak: tenant_not_found')
    expect(statusSelect(jobForm(html, otherJobId))).toMatch(/value="queued" selected=""/)
  })

  it('keeps the message notice while two legacy reviews are indistinguishable', async () => {
    fixture.attachments = [attachment('decrypt_failed')]
    fixture.jobs = [legacyJob, { ...legacyJob, id: otherJobId }]
    const html = await renderPage()
    expect(html).toContain('S/MIME kunde inte dekrypteras')
    for (const id of [jobId, otherJobId]) expect(statusSelect(jobForm(html, id))).toMatch(/value="queued" selected=""/)
  })

  it('uses an explicit S/MIME job code before a generic legacy review', async () => {
    fixture.attachments = [attachment('decrypt_failed')]
    fixture.jobs = [legacyJob, { ...legacyJob, id: otherJobId, step: 'smime_decrypt_failed' }]
    const html = await renderPage()
    expect(statusSelect(jobForm(html, otherJobId))).toContain('Välj nästa status')
    expect(statusSelect(jobForm(html, jobId))).toMatch(/value="queued" selected=""/)
  })

  it.each(['new decrypted attachment', 'stored EDIFACT', 'ordinary mail'])('preserves ordinary review for %s', async recovered => {
    if (recovered === 'new decrypted attachment') {
      fixture.attachments = [attachment('decrypted'), attachment('decrypt_failed')]
      fixture.diagnostic = [{ processing_status: 'smime_decrypt_failed' }]
    }
    if (recovered === 'stored EDIFACT') {
      fixture.attachments = [attachment('decrypt_failed')]
      fixture.message = { ...fixture.message, raw_edifact_payload: 'Synthetic stored EDIFACT' }
    }
    const html = await renderPage()
    expect(html).not.toContain('S/MIME kunde inte dekrypteras')
    expect(statusSelect(html)).toMatch(/value="queued" selected=""/)
    expect(html).toContain('Orsak: manual_review')
    if (recovered !== 'ordinary mail') expect(fixture.diagnosticQuery).not.toHaveBeenCalled()
  })

  it('checks platform access before reading the mail or attachments', async () => {
    fixture.authorize.mockRejectedValueOnce(new Error('denied'))
    await expect(renderPage()).rejects.toThrow('denied')
    expect(fixture.from).not.toHaveBeenCalled()
  })
})


function heldReception(classification: 'identity_conflict' | 'protocol_duplicate') {
  const receipt = {
    companyId, sourceMessageId: earlierOriginalId, inboundEmailMessageId: messageId,
    parseResultId: 'synthetic-parse-result', receptionId: 'synthetic-reception', responseRequestId: 'synthetic-response-request',
    receivedAt: '2026-11-20T10:00:00.000Z', isReplay: true, status: 'held', classification,
    canonicalPayloadHash: 'a'.repeat(64), receivedPayloadHash: (classification === 'identity_conflict' ? 'b' : 'a').repeat(64),
    reason: 'synthetic-native-reason', businessEffectAuthorized: false,
  }
  fixture.message = {
    ...fixture.message,
    raw_edifact_payload: 'Synthetic received original',
    processing_status: 'manual_review',
    match_status: 'protocol_response_held',
    match_payload: { protocolReception: { sourceMessageId: earlierOriginalId } },
  }
  fixture.rpc.mockResolvedValue({ data: receipt, error: null })
  return receipt
}

describe('Ediel inbound reception conflicts', () => {
  it('distinguishes a verified reference conflict and keeps both reviews reachable', async () => {
    heldReception('identity_conflict')
    const html = await renderPage()
    expect(html).toContain('Referenskonflikt i Ediel-mottagningen')
    expect(html).toContain('href="#inbound-original"')
    expect(html).toContain('id="inbound-original"')
    expect(html).toContain('Synthetic received original')
    expect(html).toContain('href="/admin/ediel/messages/' + earlierOriginalId + '"')
    expect(html).not.toContain('Dubblett väntar på protokollsvar')
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('ediel_inbound_reception_request_v1', {
      p_company_id: companyId, p_message_id: earlierOriginalId, p_actor_user_id: actorId, p_inbound_email_message_id: messageId,
    })
  })

  it('retains the separate genuine duplicate label for equal hashed originals', async () => {
    heldReception('protocol_duplicate')
    const html = await renderPage()
    expect(html).toContain('Dubblett väntar på protokollsvar')
    expect(html).not.toContain('Referenskonflikt i Ediel-mottagningen')
  })

  it.each(['denied', 'missing', 'foreign', 'unconfirmed', 'bad-selector'])('holds the source link when receipt read is %s', async mode => {
    const receipt = heldReception('identity_conflict')
    if (mode === 'denied') fixture.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'synthetic-private-denial' } })
    if (mode === 'missing') fixture.rpc.mockResolvedValue({ data: null, error: null })
    if (mode === 'foreign') fixture.rpc.mockResolvedValue({ data: { ...receipt, companyId: jobId }, error: null })
    if (mode === 'unconfirmed') fixture.rpc.mockResolvedValue({ data: { ...receipt, receivedPayloadHash: receipt.canonicalPayloadHash }, error: null })
    if (mode === 'bad-selector') fixture.message = { ...fixture.message, match_payload: { protocolReception: { sourceMessageId: 'invalid' } } }
    const html = await renderPage()
    expect(html).toContain('Mottagningskvittot kunde inte verifieras')
    expect(html).toContain('Synthetic received original')
    expect(html).not.toContain('Referenskonflikt i Ediel-mottagningen')
    expect(html).not.toContain('href="/admin/ediel/messages/' + earlierOriginalId + '"')
    expect(html).not.toContain('synthetic-private-denial')
    if (mode === 'bad-selector') expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it('does not read the receipt when the mail is no longer held for a protocol response', async () => {
    heldReception('identity_conflict')
    fixture.message = { ...fixture.message, match_status: 'protocol_response_prepared' }
    expect(await renderPage()).not.toContain('Referenskonflikt i Ediel-mottagningen')
    expect(fixture.rpc).not.toHaveBeenCalled()
  })
})
