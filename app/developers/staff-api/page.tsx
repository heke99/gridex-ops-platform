import type { Metadata } from 'next'
import { CopyCodeBlock } from '@/components/developers/CopyCodeBlock'
import { PUBLIC_API_ENDPOINT_ROWS } from '@/lib/api/publicRouteRegistry'
import { STAFF_API_CONTRACT_VERSION, STAFF_OPENAPI_URL, STAFF_VERSIONED_OPENAPI_URL } from '@/lib/integrations/websiteIntegrationContract'

export const metadata: Metadata = {
  title: 'Gridex Staff API Documentation',
  description: 'Manage staff accounts and customer service from your own backend with signed staff identity and scoped access.',
}

export const revalidate = 3600

const signingExample = `import { createPrivateKey, randomUUID, sign } from 'node:crypto'

function staffAssertion(authenticatedStaffGridexUserId) {
  const iat = Math.floor(Date.now() / 1000)
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: process.env.GRIDEX_STAFF_KEY_ID })
  const payload = encode({
    iss: process.env.GRIDEX_STAFF_ISSUER,
    aud: process.env.GRIDEX_STAFF_AUDIENCE,
    sub: authenticatedStaffGridexUserId,
    iat, exp: iat + 300, jti: randomUUID(),
  })
  const input = header + '.' + payload
  const signature = sign('RSA-SHA256', Buffer.from(input),
    createPrivateKey(process.env.GRIDEX_STAFF_PRIVATE_KEY_PEM))
  return input + '.' + signature.toString('base64url')
}`

const scopes = [
  ['staff_users.read', 'List staff and roles', 'users.read'],
  ['staff_users.write', 'Invite, change roles, disable and reactivate', 'users.write'],
  ['staff_customers.read', 'Search and retrieve customers', 'customers.read'],
  ['staff_customers.write', 'Change contact details', 'masterdata.write'],
  ['staff_customers.write', 'Request identity change', 'customers.write'],
  ['staff_cases.read', 'Read cases, events and attachments', 'cases.read'],
  ['staff_cases.write', 'Create, reply, note, phone, status, assign and upload', 'cases.write'],
]

const errors = [
  ['400 / 422', 'Invalid request or Idempotency-Key', 'Correct fields or headers.'],
  ['401', 'staff_assertion_missing, staff_assertion_signature_invalid, staff_assertion_issuer_mismatch, staff_assertion_audience_mismatch, staff_assertion_expired, staff_assertion_replayed', 'Fix configuration or sign a fresh assertion.'],
  ['403', 'api_scope_missing, staff_provider_missing, staff_provider_invalid, staff_membership_inactive, staff_permission_denied, staff_role_ceiling_exceeded', 'Check configured scopes, provider, active membership and permissions.'],
  ['404', 'Resource unavailable in this organization', 'Use a current reference from the same organization.'],
  ['409', 'version_conflict, staff_self_disable_forbidden, staff_last_admin_required, staff_invalid_user_state, staff_self_role_change_forbidden, idempotency conflict', 'Reload and reconcile the operation without bypassing safeguards.'],
  ['413 / 415', 'Attachment size or type rejected', 'Use PDF, PNG or JPEG within 4 MiB.'],
  ['429', 'Rate limit exceeded', 'Observe Retry-After and sign a fresh assertion for the retry.'],
  ['412', 'storage_project_mismatch', 'Use the deployment serving the expected project; nothing was executed.'],
  ['500 / 503', 'Processing or service unavailable', 'Keep the request ID; retry only when safe and retryable.'],
]

export default function StaffApiGuide() {
  const endpoints = PUBLIC_API_ENDPOINT_ROWS.filter(([, path]) => path.startsWith('/api/v1/staff/'))
  return (
    <main className="mx-auto max-w-6xl space-y-10 px-6 py-12 text-slate-800">
      <header className="space-y-4">
        <a className="underline" href="/developers/customer-portal-api">Gridex API documentation</a>
        <h1 className="text-4xl font-semibold text-slate-950">Gridex Staff API</h1>
        <p>Release {STAFF_API_CONTRACT_VERSION}. Manage staff accounts and customer service from your own backend.</p>
        <p><a className="underline" href={STAFF_OPENAPI_URL}>Current OpenAPI</a> · <a className="underline" href={STAFF_VERSIONED_OPENAPI_URL}>Immutable release</a> · <a className="underline" href="/api/v1/openapi/release-manifest.json">Release manifest</a></p>
      </header>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Configure staff login</h2>
        <p>Create an API credential with the specific staff scopes you need. In Settings → Customer login, add an OIDC provider or your backend public signing key with purpose Staff. Copy its issuer and audience exactly. Existing website and customer scopes do not grant staff access.</p>
        <p>Your backend authenticates the person and maps their account to a Gridex user UUID. Keep the API credential and signing private key on your server. Derive the acting user from the authenticated account, never from a browser supplied UUID.</p>
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Sign each request</h2>
        <p>Send Authorization: Bearer &lt;GRIDEX_API_KEY&gt; and x-gridex-staff-assertion: &lt;SIGNED_JWT&gt; on every call. Supported algorithms are RS256, PS256 and ES256. The JWT requires the configured iss and aud, sub equal to the staff Gridex user UUID, integer iat and exp with a lifetime of at most 900 seconds, and a unique jti. Optional nbf controls the earliest valid time.</p>
        <p>Each assertion is accepted once. Generate a new assertion and jti for every attempt, including reads and retries. Gridex checks active organization membership and calculates the person&apos;s role permissions and overrides for every request.</p>
        <CopyCodeBlock code={signingExample} />
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Scopes and permissions</h2>
        <p>The credential scope and the person&apos;s permission are both required.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Scope', 'Operation', 'Permission'].map(h => <th key={h} className="border-b p-3">{h}</th>)}</tr></thead><tbody>{scopes.map(([scope, operation, permission]) => <tr key={`${scope}:${permission}`}><td className="border-b p-3 font-mono">{scope}</td><td className="border-b p-3">{operation}</td><td className="border-b p-3 font-mono">{permission}</td></tr>)}</tbody></table></div>
        <p>Staff cannot grant a role exceeding their own permissions or disable themselves. The final active administrator cannot be disabled or demoted. Assignees must be active staff in the same organization.</p>
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Writes and retries</h2>
        <p>Every POST and PATCH requires Idempotency-Key. Reuse that key and unchanged body for a retry, with a fresh assertion and jti. Use a new key for a new logical operation. Contact updates require expectedUpdatedAt from the latest customer updated_at and at least one editable field. A version conflict requires reloading and reconciling state. Identity changes preserve customer approval and contract acceptance.</p>
        <p>Customer and case paths use opaque references; staff account operations use Gridex user UUIDs. Identity numbers are masked in customer responses. Internal notes and phone logs require staff access. Writes are audited with the acting staff identity, API credential and staff_api channel.</p>
        <p>Upload a raw PDF, PNG or JPEG body up to 4 MiB with x-file-name and optional x-attachment-visibility: internal or customer (default internal). Only released attachments can be downloaded; the stored hash is verified on download.</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Replay, request IDs and storage project</h2>
        <p>Every Staff write response, including staff-user invite, role change, disable and enable, carries Idempotency-Replayed: true when a stored result is returned and false for a new execution. Current authentication and permission are checked before any replay.</p>
        <p>Gridex issues one server request ID per call and returns the same value in request_id, the X-Request-ID header and the request log, on success and on error. An inbound X-Request-ID is kept only as a separate client correlation value.</p>
        <p>The optional x-gridex-expected-project-ref header pins the storage project; a mismatch returns 412 storage_project_mismatch before any authentication or write. Responses carry X-Gridex-Project-Ref.</p>
        <p>Query parameters: existing parsing is kept by default. Send x-gridex-query-parsing: strict to require each parameter at most once and page, page_size and limit as plain decimal digits; violations return 422 invalid_field.</p>
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Endpoints</h2>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Method', 'Path', 'Scope', 'Operation'].map(h => <th key={h} className="border-b p-3">{h}</th>)}</tr></thead><tbody>{endpoints.map(([method, path, scope, description]) => <tr key={`${method}:${path}`}><td className="border-b p-3 font-mono">{method}</td><td className="border-b p-3 font-mono">{path}</td><td className="border-b p-3 font-mono">{scope}</td><td className="border-b p-3">{description}</td></tr>)}</tbody></table></div>
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Read complete case history</h2>
        <p>Case detail includes events_page and attachments_page. Follow next_cursor through GET /api/v1/staff/cases/&#123;reference&#125;/events or GET /api/v1/staff/cases/&#123;reference&#125;/attachments until has_more is false. Each list accepts limit from 1 to 100 (default 50) and cursor. Sign a fresh assertion for every page. Cursors are bound to the organization, customer and case.</p>
        <p>Customer detail marks its initial contacts, addresses and sites with contacts_page, addresses_page and sites_page: limit is 100, returned is the included count, and has_more identifies additional records beyond the initial collection.</p>
      </section>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Errors</h2>
        <p>JSON errors contain error.code, error.message, error.retryable, error.field and error.blockers, plus request_id, correlation_id and contract_schema_version. Success and error responses carry X-Request-ID and X-Gridex-Contract-Version.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['HTTP', 'Reason or code', 'Action'].map(h => <th key={h} className="border-b p-3">{h}</th>)}</tr></thead><tbody>{errors.map(([status, reason, action]) => <tr key={status}><td className="border-b p-3">{status}</td><td className="border-b p-3">{reason}</td><td className="border-b p-3">{action}</td></tr>)}</tbody></table></div>
      </section>
    </main>
  )
}
