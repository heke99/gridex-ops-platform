import { test, expect } from '@playwright/test'
import { localProofEnabled, localProofFixture, readAllPages, readGuardProof, revokeReadProof, refreshProofAssertions } from '../helpers/customer-api-proof.mjs'

const enabled = localProofEnabled('GRIDEX_LEGAL_READ_LOCAL_E2E', 'GRIDEX_LEGAL_READ_FIXTURE_PATH')
test.skip(!enabled, 'Requires the disposable local legal database and signed Auth fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
// This proves actual server/DB HTTP. It is deliberately not counted as interactive UI proof.
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
const f = enabled ? localProofFixture('GRIDEX_LEGAL_READ_FIXTURE_PATH') : null
const path = '/api/v1/customer/legal-acceptances'
const fields = ['acceptance_reference', 'acceptance_type', 'document_reference', 'document_code', 'document_version', 'document_hash', 'accepted_at', 'source', 'created_at']
test('actual legal HTTP pages preserve exact documents, microseconds, allowlists, isolation and current authority', async ({ request }) => {
  test.setTimeout(120_000)
  await refreshProofAssertions(f, path)
  let firstCursor
  for (const c of f.customers) {
    const result = await readAllPages(request, expect, path, c, fields)
    expect(result.rows).toEqual(c.expected)
    expect(new Set(result.rows.map(row => row.acceptance_reference)).size).toBe(c.expected.length)
    for (const row of result.rows) {
      expect(row.acceptance_reference).toMatch(/^acceptance_[A-Za-z0-9_-]{32}$/)
      if (row.document_reference) expect(row.document_reference).toMatch(/^legal_document_[A-Za-z0-9_-]{32}$/)
      expect(row.source).toBe('customer_portal')
    }
    expect(JSON.stringify(result.rows)).not.toMatch(/must not project|snapshot|metadata|company_id|customer_id|accepted_ip|trace_id|request_id/)
    if (c.tag === 'A1') {
      expect(result.pages).toBe(4)
      expect(result.rows[1].accepted_at).toBe(result.rows[2].accepted_at)
      expect(result.rows[1].accepted_at).toContain('.123456')
      expect(result.rows.filter(row => row.document_reference === null)).toHaveLength(1)
      expect(result.rows.filter(row => row.document_reference !== null && row.document_code === null)).toHaveLength(1)
      firstCursor = result.firstCursor
    }
  }
  await readGuardProof(request, expect, path, f, firstCursor)
  await revokeReadProof(request, expect, path, f)
  console.log('LEGAL_READ_HTTP_NATIVE_PASS customers=3 rows=6 bundle_and_legacy=true cursor_replay=true microseconds=true allowlist=true isolation=true revocation=true')
})
