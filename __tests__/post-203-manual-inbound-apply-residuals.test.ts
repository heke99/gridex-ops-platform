import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ingestion = readFileSync('lib/inbound-mail/manualInboundIngestion.ts', 'utf8')
const correlation = readFileSync('lib/inbound-mail/manualInboundCorrelation.ts', 'utf8')
const parser = readFileSync('lib/customer-operations/manualFacilityResponseParser.ts', 'utf8')

describe('post-#203 manual inbound apply and correlation residuals', () => {
  it('does not downgrade a completed facility request after successful apply', () => {
    // completeFacilityLookup / gridex_complete_facility_response already sets
    // status=completed. Overwriting to manual_response_received against open
    // statuses throws on zero rows and leaves IMAP Seen unmarked + sticky matched.
    expect(ingestion).not.toMatch(
      /parse\.outcome === 'applied'[\s\S]{0,400}status:\s*'manual_response_received'/,
    )
    expect(ingestion).toContain('Do not overwrite status')
  })

  it('treats completion ok:false as needs_review, never applied', () => {
    // Conflict paths return { ok: false } without throwing. Marking applied then
    // falsely advances inbound processing_state and request lifecycle.
    expect(parser).toMatch(
      /const completion = await completeFacilityLookupAndRunNextSteps\([\s\S]*?if\s*\(\s*!completion\.ok\s*\)/,
    )
    expect(parser).toMatch(
      /if\s*\(\s*!completion\.ok\s*\)[\s\S]*?outcome:\s*'needs_review'/,
    )
    expect(parser).toMatch(
      /return \{\s*outcome:\s*'applied'[\s\S]*?\}/,
    )
  })

  it('requires verified contact or reply-bound recipient before sender credibility', () => {
    // Bare From == request.recipient_email is spoofable on IMAP. Auto-apply must
    // require a verified contact channel or reply-header binding to that request.
    const credibleFn = correlation.match(
      /function senderIsCredible\([\s\S]*?\n\}/,
    )?.[0]
    expect(credibleFn).toBeTruthy()
    expect(credibleFn).toMatch(/replyBound|boundByReply|requestBoundByReply/)
    expect(credibleFn).not.toMatch(
      /if \(normalizeEmail\(input\.request\?\.recipient_email\) === from\) return true\n/,
    )
  })

  it('does not attribute tenant FKs for ignored/ambiguous/unmatched resolutions', () => {
    // Spoofed reply/case evidence must stay in correlation_evidence, not become
    // tenant-readable company_id/request_id under RLS before sender credibility.
    expect(ingestion).toMatch(
      /const persistTenantBinding\s*=\s*correlation\.resolutionStatus\s*===\s*['"]matched['"]/,
    )
    expect(ingestion).toMatch(
      /const boundCompanyId\s*=\s*persistTenantBinding\s*\?\s*correlation\.companyId\s*:\s*null/,
    )
    expect(ingestion).toMatch(
      /const boundRequestId\s*=\s*persistTenantBinding\s*\?\s*correlation\.requestId\s*:\s*null/,
    )
    expect(ingestion).toMatch(/company_id:\s*boundCompanyId/)
    expect(ingestion).toMatch(/request_id:\s*boundRequestId/)
  })

  it('escapes LIKE wildcards in email contact lookups', () => {
    // PostgREST ilike treats _ and % as wildcards; grid-owner emails can contain _.
    expect(correlation).toMatch(/escapeIlike|escapeLike|escapePostgrestLike/)
    expect(correlation).toMatch(/\.ilike\('email',\s*escape/)
  })
})
