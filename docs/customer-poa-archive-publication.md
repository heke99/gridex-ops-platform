# Customer POA archive API publication

The customer POA archive reader is published as an independent additive contract,
using the same publication pattern as the independent staff-onboarding API.

- Current document: `/api/v1/openapi/poa-archive-v1.json`.
- Pinned document: `/api/v1/openapi/2026-10-19.1/poa-archive-v1.json`.
- Discovery: `GET /api/v1/customer/powers-of-attorney/evidence`.
- Verification/download:
  `GET /api/v1/customer/powers-of-attorney/evidence/{verificationReference}`.

The common registry makes both business routes visible in the existing unified
developer page and enforces their normal read-rate classification. Both existing
read scopes are required together. Existing Website, Customer Portal, Partner and
Staff document bodies and release history are preserved.

`info.version` and `x-gridex-release-version` identify this independent document
as `2026-10-19.1`. `x-contract-schema-version` retains the existing common envelope
revision. Business responses retain the normal common contract/documentation
headers; the independent document does not claim those headers changed.
The three supported customer representation profiles remain supported. Their
actual common formatter selects the envelope's version marker; the standalone
schemas enumerate those existing revisions, including errors. Documentation
publication does not force a client-profile upgrade.

The standalone document includes the four closed archive schemas and the
required common header/blocker components. Every business error response points
to the actual closed canonical error envelope, including its supported profile
versions; obsolete top-level error aliases from older response components are
excluded. Every local reference resolves
without fetching a different document. Its current and immutable artifacts are
initially byte-identical and use the established serializer, SHA-256 ETag and
conditional GET behavior. Existing immutable releases must never be rewritten.
Both operations document missing linked customers as 404, paused organizations
as 423 and closed/inactive organizations as 410. Retention guards remain active;
an unclassified retention-service failure follows the existing generic 500
response rather than promising a different runtime status.

## Integration

Call from the authenticated server with the registered API credential, both
`customer_power_of_attorney.read` and `customer_documents.read`, a fresh verified
`x-gridex-customer-assertion`, and at least one linked identity header
(`x-gridex-customer-portal-user-id` or `x-gridex-auth-user-id`). If both identity
headers are supplied they must identify the same subject. Each call needs a fresh
assertion/JTI; report-mode configuration does not waive verification here.

Use discovery with `limit` 1–100 and its opaque continuation cursor. Discovery
qualifies metadata only; `archived_unverified` does not mean PDF bytes passed
verification. Follow an available `download_url`, or request JSON detail with the
stored verification reference. `format=pdf` returns the verified original, while
JSON may compare an optional `sha256`; a mismatch is an explicit false boolean.
The client must inspect that boolean rather than infer equality from HTTP 200.

These reads never generate or archive a new PDF and never create consent. Source
IP and time are original captured facts or explicitly unavailable. A verification
reference and byte checksum are not a cryptographic PDF signature or BankID proof.
See [the detailed evidence contract](customer-poa-archive-api-supplement.md).
That guide's embedded patch records the original integration proposal; the
standalone served JSON is authoritative for this publication's envelope-profile
enumeration and operation registry metadata.

## Delivery

This is an additive publication source. Actual deployment still requires the
archive implementation, its qualified schema dependency, the existing serial
delivery checks and a controlled read of an existing authorized test archive.
A successful local build or unauthenticated route denial does not prove a live
customer archive can be retrieved. The normal release manifest for the three
existing contract bundles does not silently acquire this independent contract.
