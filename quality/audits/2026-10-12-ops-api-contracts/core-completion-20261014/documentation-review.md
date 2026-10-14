# OPS documentation completion review — 2026-10-14

Reviewed `/tmp/gridex-ops-final` at `f13bb4f3` (working tree clean). This is a bounded read-only review of current integration documentation, OpenAPI method/path presence and the independent Staff onboarding call chain. Only this report is written. No tests, database calls, CI, GEN, ref mutation, network request, publication or application/source edit was performed.

## Result

No missing current OpenAPI handler was found: every declared method in the four current documents resolves to an actual Next route export, including Staff re-exports. Counts are Website 63, Customer 52, Staff 27 and independent onboarding 3; these include shared/publication aliases and are not unique business-route counts. These results prove source routing presence, not response execution or hosted readiness. The parent's prior 53 production OpenAPI 200/parity result is existing evidence, not re-executed here.

The current compatibility policy accurately separates documentation `2026-10-12.1`, ordinary Website/Customer/Staff wire `2026-10-09.1`, separate onboarding `2026-10-05.2`, and supported earlier credential-pinned profiles. The three checksum-bound validator errata remain intact. The support123 requirements correctly describe tenant-owned Supabase e-mail/password Auth, `tenant_key` signature configuration without an external SSO vendor, non-login OPS compatibility actors, explicit invitation acceptance and current-binding resolution. They do not require employees to log in to central OPS.

Three remaining documentation gaps are confirmed below. None establishes a new runtime security defect. DOC-FRESH-01 is the most useful API documentation completion item before a future frontend/tenant builder takes over.

## Confirmed findings

### DOC-FRESH-01 — P2: the required tenant invitation bridge lacks a self-contained wire contract in OPS documentation

**Evidence:** `docs/staff-api/independent-onboarding.md:168-171` delegates server configuration to the external web app's `apps/support/README.md`, without a repository/commit link. `docs/staff-api/support123-integration.md:29` requires a delivery endpoint and signed receipt but does not define their closed wire shapes. Searches for `staff_invitation_delivery`, receipt claim lists and delivery request headers in these guides and `docs/openapi/staff-onboarding-v1.json` find no wire specification. The onboarding OpenAPI intentionally describes only OPS-facing resolve/accept and its publication route; it does not describe the tenant-owned delivery endpoint.

The existing OPS worker's real contract is strict (`lib/auth/tenantStaffDelivery.ts:23-29,43-58,102-150,165-167`):

- POST exactly to `<registered-origin>/api/internal/staff/invitations/deliver`, no redirect, `Content-Type: application/json`, `Idempotency-Key: <delivery_id>`, body `{ "assertion": "<OPS signed JWS>" }`.
- OPS request JWS uses RS256, the registered public JWK's `kid`, registered delivery issuer/audience, `sub=invitation_id`, `token_use=staff_invitation_delivery`, integer `iat`, 60-second `exp`, fresh `jti`, and payload `delivery_id`, `actor_user_id`, `company_id`, `api_client_id`, `provider_id`, `invitation_id`, `recipient_email`, nullable `full_name`, `auth_issuer`, `callback_url`, `request_hash`.
- Success is HTTP 200, JSON content type, exactly `{ "receipt": "<tenant signed JWS>" }`; body at most 24,576 bytes and receipt at most 16,384 characters.
- Receipt is verified with the registered Staff provider, not the OPS request key. It must contain exactly `api_client_id`, `aud`, `auth_issuer`, `company_id`, `delivery_id`, `email`, `exp`, `iat`, `invitation_id`, `iss`, `jti`, `local_auth_subject`, `provider_id`, `request_hash`, `status`, `sub`, `token_use`. Purpose is `staff_invitation_delivery_receipt`, lifetime at most 60 seconds, `status=sent`, `sub=local_auth_subject` and distinct from the OPS actor. The authority/provenance tuple, Auth issuer and recipient email must match the original request. A completed tenant retry signs a fresh receipt from stored delivery data.
- OPS requires a matching server-only `GRIDEX_STAFF_DELIVERY_PRIVATE_KEY`; its registered request key is RSA >=2048 bits with no private JWK fields. The receive-side signature/session/durability rules remain tenant responsibilities; an arbitrary JSON success or unsigned receipt cannot complete onboarding.

**Impact/root cause:** a developer implementing the required tenant endpoint from the central guide cannot reproduce the existing strict request/receipt protocol without reading OPS source or finding an unlinked external README. A plausible endpoint can send an invitation yet fail receipt recording and leave enrollment unqualified. This is an omitted integration contract, not missing delivery implementation in OPS.

**Targeted fix:** root should add a versioned delivery-protocol subsection or linked OPS contract document containing the above shapes, signing direction, limits, original authority equality and stable-delivery/fresh-proof retry semantics. Link it from both onboarding guides and identify the future tenant-private durability migration/implementation's verified source when available. No new public OPS endpoint, weaker receipt validation, tenant deployment or live invitation is necessary for this documentation fix. Existing indeterminate-delivery reconciliation instructions must remain.

**Refutation check:** the guide already explains the one-worker owner, delivery durability and unknown-outcome behavior; these are correct and should not be replaced. The omission is specifically the closed wire protocol and retrievable external reference. No claim is made that another tenant repository has no such documentation.

### DOC-FRESH-02 — P2: Markdown Staff error guidance omits company lifecycle statuses and misdescribes JSON 413

**Evidence:** `docs/gridex-staff-api.md:195-205` has no 410/423 row and says 413/415 concern only attachments. Real shared admission maps paused to `423 organization_paused`, closed to `410 organization_closed`, and archived/pending-deletion/deleted-test-only to `410 organization_inactive` (`lib/integrations/apiAuth.ts:196-207`), propagated through `lib/staff-api/context.ts:139-140` and `lib/staff-api/http.ts`. JSON body limits throw `413 payload_too_large` (`lib/api/strictRequest.ts:29-35`). Both the current Staff OpenAPI and `app/developers/staff-api/page.tsx:46-47` already document these cases.

**Impact/root cause:** the Markdown integration guide can lead a frontend/backend builder to treat a company lifecycle refusal as an unexpected error, or incorrectly ask a JSON writer to convert a request to PDF/PNG/JPEG. The machine-readable contract and public page were updated while the Markdown summary was left behind.

**Targeted fix:** add the existing 410/423 lifecycle row and make 413 cover JSON `payload_too_large` as well as upload size, leaving 415 for attachment content type. Copy the existing public page's guidance; do not change status handling or frozen specifications. The malformed inline-code span around the two 409 codes at line 202 is a minor adjacent formatting fix.

**Refutation check:** the table is an example summary, not an exhaustive error registry, so omission alone is not a routing defect. The corrective guidance is nevertheless materially inconsistent for a real JSON 413. Current specs already contain these statuses; no spec regeneration is needed.

### DOC-FRESH-03 — P3: API index Staff route inventory misses the current immutable publication route

**Evidence:** `docs/api-index.md:137-139` lists immutable Staff publications for `2026-10-04.1` and `2026-10-09.1`, but omits `/api/v1/openapi/2026-10-12.1/staff-v1.json`. Actual GET handler is `app/api/v1/openapi/2026-10-12.1/staff-v1.json/route.ts`; the current Staff specification declares it. The index's top documentation links already point to the correct immutable source file.

**Impact/root cause:** the current inventory table is incomplete for discovery. This is a publication-row omission, not an inaccessible specification or business-handler omission.

**Targeted fix:** add the one GET row. Keep dated audit counts identified as historical; do not rewrite old evidence to manufacture fresh totals.

## Correct boundaries and dependencies

| Concern | Source/documentation result | Completion boundary |
| --- | --- | --- |
| Independent staff password login | OPS accepts verified tenant bearer only for resolve/accept; `registeredStaffTenantAuth` requires a distinct canonical external Supabase project and public Auth key | Future tenant login/session/password callback/SMTP and actual operator-owned registrations, not an OPS password endpoint |
| Onboarding assertion | Local Auth UUID in `sub`, distinct purpose, <=60s, verified e-mail, explicit Staff scope, required central expected-project header, closed request | Two actual handlers and separate 05.2 envelope; ordinary Staff closed error envelope must not be imposed on these responses |
| Normal Staff assertion | Central actor UUID plus independent binding claims; current membership/client/provider/binding checked; no fresh tenant `getUser` on already signed normal request | Tenant verifies session before signing each new assertion; disabled/revoked authority remains fail-closed |
| First administrator | Authenticated OPS control and sole leased canonical worker | No implicit email/UUID linking, public bootstrap endpoint, inferred company or automatic admin role |
| API versions | 10-12 docs are distinct from 10-09 default wire; Staff supports 10-04 and 10-09; onboarding only 05.2 | Existing tenant runtime admission is not tied to latest documentation date; operator-owned pins select older response shapes |
| Database readiness | `docs/api-index.md:42,188` records actual bb0 install and ready runtime capability gate | This audit did not requery DB; installed function/catalog readiness does not prove all clean/upgrade history, provider or business flows |
| Quote replay/GEN | Index keeps complete-history quote routing and canonical schema/type reconciliation open | Source-guarded/isolated component qualification must not be relabeled complete-history or canonical GEN acceptance |
| support123 activation | Guide correctly says login not built and four Staff aggregates are zero | No domain/company/client/key/Auth mapping inferred; genuine tenant delivery, acceptance, read/write/audit/retry/revocation remain future hosted qualification |

The independent onboarding guide's older source-check/native qualification section must be read alongside the current API index receipt. It describes gates and separates hosted activation; its wording is not proof the newly installed OPS module is absent. Optional improvement: link the latest index/database delivery receipt there so a new reader does not rerun protected historical Auth-owner scripts. This is advisory, not a fourth confirmed defect. Existing unresolved clean/upgrade, GEN and provider limitations must remain visible.

## Preserved history and false-positive register

- Current four-document method/path/export inventory: no missing handler confirmed. Initial simple export parser missed Staff `export { handler as GET }`; direct inspection and corrected re-export parser resolved every apparent omission.
- All three errata source and patch SHA-256 values match `docs/api-validator-errata/manifest.json` (Customer 10-02.3 support detail; Website 10-02.3 and 10-04.1 fixed quote market null). Frozen artifacts are unchanged by this task. No blanket old-validator compatibility claim is made.
- Old README/test-count claims and the dated original documentation audit are historical, not current route/database truth.
- Generic OIDC can remain documented for the legacy central Staff flow; the support123 first-delivery path correctly requires `tenant_key`. No commercial SSO dependency is introduced.
- The OPS onboarding 05.2 envelope intentionally contains `data/error`, `request_id`, `contract_schema_version`, with a minimal error code/message; ordinary Staff `retryable/field/blockers/correlation_id` is a different contract. No mismatch reported.
- The docs do not claim full request or cross-database atomicity, global profile-writer serialization, or that normal signed Staff requests independently revoke external Auth sessions. These limits match the implementation reviewed.

## Skill routing and verification

Read repository `AGENTS.md`, current memory/state/task/checkpoint/handover/blockers/work-plan and relevant decisions/known-failures. Read installed using-superpowers (subagent exemption), spec-to-code-compliance, code-review, fp-check, verification-before-completion, acquire-codebase-knowledge and quality-playbook guidance. Applied direct spec/code tracing, explicit false-positive challenge and evidence-limited completion. Full spec delegation, quality generation/TDD, memory writes and repository-wide inventory are overridden by the parent's explicit narrow read-only/report-only assignment; no further agents or generated repository artifacts were created. Database/security scanner/performance/UI authoring skills have no implementation or scan trigger in this documentation-only packet. No source-remediation skills or Supabase operations were performed.

Read-only verification comprised `rg` file/text discovery; current guide/spec/route/callee inspection; a Python JSON/method/export inventory including aliased exports; Python SHA-256 checks for the three immutable errata inputs and patches; `git status --short` (clean before report), and `git log -3 --oneline` (HEAD f13bb4f3). No runtime/test acceptance claim follows. Deeper field-by-field business response validation and current live Auth/provider flows remain outside this bounded packet. Root alone owns any verified documentation/source fix.

## Independent final source review of root's documentation corrections

**Verdict: APPROVE for the exact five documentation postimages below; no blocking source/documentation mismatch found.** DOC-FRESH-01, DOC-FRESH-02 and DOC-FRESH-03 are addressed. This is source review only: no tests, database/network requests, hosted flow, GEN or publication were performed. Root's simultaneous changes to the resolve/accept handlers are outside this final documentation-review packet and receive no approval from it.

The new delivery document matches `lib/auth/tenantStaffDelivery.ts` for the exact request envelope, request headers, RS256 request proof/key registration, 10-second transport timeout, callback binding, success status/content type/closed envelope, byte/character bounds, receipt purpose/authority equality and canonical native record sequence. The receipt list contains exactly the actual 17 accepted fields. It correctly distinguishes OPS request keys/issuer/audience from the tenant Staff provider's receipt verification configuration, and OPS compatibility actor from local Auth subject. RS256/PS256/ES256 receipt support matches the shared verifier in `lib/customer-portal/customerAssertion.ts`; it does not mistakenly advertise those three algorithms for OPS's RS256-only delivery request. Private keys remain server-only and no local/central UUID fallback is suggested.

The ten-second timeout and started-delivery unknown-outcome instructions correctly deny automatic resend and require original provider-evidence reconciliation. Completed retries use stored facts and fresh proof, without treating an e-mail effect or tenant receipt as proof of successful OPS record completion. The added document accurately describes requirements for the future tenant bridge rather than claiming existing tenant deployment or a verified private migration. Both current onboarding guides now link directly to this same contract. The removed external `apps/support/README.md` dependency and unverified single-migration assertion no longer prevent a source-based tenant handoff.

The Markdown Staff status table now matches shared 410/423 lifecycle errors and JSON 413 behavior, and separates 415 content type. The immutable current Staff GET row matches its actual handler/spec. Frozen OpenAPI/errata artifacts were not part of these documentation changes.

Exact reviewed SHA-256 postimages:

| File | SHA-256 |
| --- | --- |
| `docs/staff-api/tenant-invitation-delivery.md` | `283fa02de1a62156ddb937c63dcfd05dfc372b41f4f2217e94f4b516d0626eb7` |
| `docs/staff-api/independent-onboarding.md` | `6ad12f4f74d172147bb5f9338d6a936ce74be0fca7258d2ba9152450d0b4e118` |
| `docs/staff-api/support123-integration.md` | `179e2593368d323e89287cb4c9cd451e6964713018855dd252fbd64ceeb3b7db` |
| `docs/gridex-staff-api.md` | `28a3e7d28f5b88313379153c6cd9ed876de047aebc9e9353eec7ce0d65a626ce` |
| `docs/api-index.md` | `dfdc9b2c7c8b67f5da3cbe79e9dca4970416e23664a1f27b594902afc255716a` |

Reference source SHA-256: `lib/auth/tenantStaffDelivery.ts` = `0d99671c63840d1cf02d142c7eca68084f5d8bf31bfe3dbac730f5742dbde1ae`; `lib/customer-portal/customerAssertion.ts` = `4e7019cc9de07b19031a04e2100866ae7260102240bac44ed77d602d4157e947`. Evidence was fresh full documentation diff/new document reading, focused actual signing/receipt/timeout/verifier body reading and `sha256sum` on these seven files. Approval binds these bytes; later changes require renewed applicability review.
