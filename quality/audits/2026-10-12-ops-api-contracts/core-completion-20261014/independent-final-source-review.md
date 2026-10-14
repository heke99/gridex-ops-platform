# Independent final SOURCE review — scoped Staff completion changes

Verdict: no blocking finding in the scoped new code/docs. This is SOURCE ONLY, not full core readiness, tenant readiness, native execution or delivery approval.

Repository `/tmp/gridex-ops-final`, observed HEAD `f13bb4f30766dfdc76dc25b5b234a6dfc31be85e`. Reviewed current uncommitted changes to the following seven files. Older unchanged branch work is outside this verdict.

| File | Reviewed SHA-256 |
| --- | --- |
| `lib/staff-api/onboarding.ts` | `0d6e9d6731b164b214d09e7e66c9c4ec5d291320be1706456551cd1285c9b84a` |
| `lib/staff-api/identityResolution.ts` | `e05e23dbeac7b535b4f1ed48e42a5333312edbff054d9218c8904e120a1b8dcc` |
| `docs/gridex-staff-api.md` | `28a3e7d28f5b88313379153c6cd9ed876de047aebc9e9353eec7ce0d65a626ce` |
| `docs/api-index.md` | `dfdc9b2c7c8b67f5da3cbe79e9dca4970416e23664a1f27b594902afc255716a` |
| `docs/staff-api/independent-onboarding.md` | `6ad12f4f74d172147bb5f9338d6a936ce74be0fca7258d2ba9152450d0b4e118` |
| `docs/staff-api/support123-integration.md` | `179e2593368d323e89287cb4c9cd451e6964713018855dd252fbd64ceeb3b7db` |
| `docs/staff-api/tenant-invitation-delivery.md` | `283fa02de1a62156ddb937c63dcfd05dfc372b41f4f2217e94f4b516d0626eb7` |

## Request ID source review

Read both complete changed handlers and the actual logger contract in `lib/integrations/apiAuth.ts`. Each handler allocates exactly one `randomUUID()` at entry, before method/project/auth checks. Both JSON helpers require that ID explicitly and emit it consistently as envelope `request_id` and `X-Request-ID`. Every response construction supplies that same ID. All four existing log call sites (success and authenticated failure in each handler) now pass `requestId`; the logger selects `input.requestId` ahead of the inbound `x-request-id` and persists it as `request_id`.

This resolves the concrete former correlation gap: the response UUID was created inside JSON formatting while the logger could use the caller's header or null. The change does not alter actor/company authority, authentication, assertion verification, invitation checks, idempotency, native command contents, status codes or logging eligibility. Early method/project rejections and unauthenticated denials retain their existing logging behavior; this change does not establish a persisted audit row for every rejected request. A logging failure can still affect a response through existing error handling; that is older behavior outside this patch, not a new regression.

## Documentation source review

Compared the complete new delivery guide to the actual unchanged `lib/auth/tenantStaffDelivery.ts` and `lib/customer-portal/customerAssertion.ts`:

- Registered delivery URL/audience, HTTPS issuer shape, key ID, public-only RSA JWK and minimum key strength match registration checks. OPS request signing and tenant receipt signing are correctly separated; the guide keeps private keys server-side.
- Request method, redirect refusal, ten-second timeout, JSON assertion envelope, idempotency header, RS256 request header and signed claims match the worker.
- Callback origin/path/query restrictions, original tenant/client/provider/invitation/delivery authority, request fingerprint and distinct local subject match preparation and receipt checks.
- The guide states HTTP 200, JSON, exactly one receipt field, 24,576 response-byte limit and 16,384 receipt-character limit correctly.
- Its exact 17 receipt claims, signature algorithm family, `token_use`, `status`, subject identity, maximum 60-second declared lifetime and copied original fields match verifier/worker checks. Actual shared verifier allows 60 seconds of clock skew; the guide's instruction to produce current proofs is compatible with that validation.
- OPS verification/JTI consumption precedes canonical delivery recording. The guide correctly distinguishes a sent receipt from successful OPS recording and later invitation acceptance.
- Private tenant claim durability, completed retry without resend, and reconciliation of unknown provider outcomes are requirements for the future tenant bridge, not claims that OPS implements that bridge. The updated onboarding/support guides now make this limitation explicit rather than linking to a presumed existing tenant README/migration. No tenant setup values are invented.

Checked `tenantApiAccessError` in the actual API auth source: paused maps to 423, closed/inactive lifecycle states to 410. The new error-table row agrees. `readJsonObject` throws `payload_too_large` with 413; attachment handler source rejects unsupported MIME types with 415. The corrected 409 code punctuation changes no contract. The API index's new immutable route exists at `app/api/v1/openapi/2026-10-12.1/staff-v1.json/route.ts`, imports the matching release document and uses one-year immutable caching.

## Evidence, routing and limits

Applied local code-review/differential-review guidance and verification-before-completion claim discipline. Read the Supabase skill for relevant Auth, privileged-key and tenant-boundary considerations; no Supabase product implementation or schema changes were performed. Runtime/schema query advice was not executed because this bounded assignment explicitly prohibits tests/DB/CI/GEN activity. This is not a repository-wide audit.

Evidence consists of current HEAD/status/scoped diffs, complete changed handler and new guide reads, relevant unchanged worker/verifier/logger/lifecycle/parser/attachment source, existing immutable route inspection, reference search and SHA-256 calculation. One reference-search command initially named nonexistent `lib/staff-api/attachments.ts`; the same search located the actual attachment handler in `caseHandlers.ts`, resolving that path mistake. It was not a test failure.

No tests, typecheck, database, native, CI, GEN, provider effect, publication or ref changes were performed. The parent's reported native observations (25 Staff RPCs, 19 relations/columns/RLS, public EXECUTE restrictions and internal SECURITY DEFINER helper chain) were not independently collected here and receive no fresh PASS from this report. No older unchanged branch approval or complete core-ready claim follows from this scoped source verdict. Only this private report was written; all repository files were read only. Rebind review if these exact bytes change.
