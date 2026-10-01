# Tenantservice P0: inventory, findings and register

- Base: `origin/main` @ `53bf989` (2026-10-01). #420 is included.
- Branch: `claude/bold-edison-vgwx65`.
- The masterplan file `Gridex_Tenantservice_API_OPS_Masterplan_v2_2026-09-28.md` is not in the repo. The prompt is used as a self-contained specification.
- Evidence types used below: **S** = static code reading, **T** = verified by a test in this repo, **B** = blocked (live DB or external environment not reachable from this session).

## Skill routing
**Activated (the guidelines from the installed skills applied manually):**
- acquire-codebase-knowledge
- find-bugs
- fp-check
- systematic-debugging
- test-driven-development
- code-security / sharp-edges (identity and trust boundary)
- verification-before-completion

**Conditional:**
- supabase, supabase-postgres-best-practices: from P2/P4, when migrations are added.
- web-design-guidelines: P5.
- performance-optimization, sql-optimization-patterns: P7.

**Skipped:**
- semgrep, codeql: not installed or runnable in the session. Planned for P7.
- install-hooks: not requested.
- writing-skills: no skill changes.

## Entry points and writers (customer, contact, billing settings, portal identity, support)
| Entry point | Type | Writes | Guard / actor | Status |
|---|---|---|---|---|
| `app/admin/customers/[id]/profile-actions.part-1.ts` `saveCustomerProfileAction` | Server Action | `customers`, primary `customer_contacts` | `requireAdminActionAccess(masterdata.write)` + `assertUserCanOperateCompany`; actor from server | Change in P2 (command, version, audit for contact) |
| `profile-actions.part-1.ts` `closeCustomerLifecycleAction`, `part-2` archive/test/delete | Server Action | customer graph | as above | Keep; high-risk flow |
| `app/admin/customers/duplicates/actions.ts` merge | Server Action | contacts, cases re-parented | `customers.write`, blocks cross-tenant | Keep |
| `app/admin/customer-cases/actions.ts` create/status | Server Action | `customer_cases`, events, audit | `cases.write`, operational scope | Change in P4 (channel, visibility, mandatory idempotency) |
| SQL `gridex_update_customer_case_status` (20260923180557) | RPC, invoker | case, event, audit atomically | membership + `cases.write` | Keep. B: live definition not verified |
| `lib/customer-cases/support.ts` | lib | `customer_cases` | caller's tenant; graph check OK | Change in P4 (unique idempotency) |
| `app/api/v1/customer/profile-update/route.ts` | API POST | `customers` incl. `invoice_email`, site address, completion | integration scope + resolver | Change in P2 (shared command, audit); **binding gate added P1a** |
| `app/api/v1/customer/{me,events,portal-bundle,…}` GET | API | ~~portal account/identity via resolver~~ | integration scope | **Fixed P1a: reads never write** |
| `app/api/v1/customer/{move-out,notifications/read,portal-bundle POST}` | API POST | customer data | integration scope | **P1a: requires linked portal account** |
| `app/api/v1/customer/sync/route.ts` | API POST (machine) | customer data, link | `customer_sync.write` | P1a: explicit `mode:'link'`, machine flow. Stronger proof in P1b |
| `app/api/v1/customer-portal/sync/route.ts` | API POST | upsert `customer_portal_identities` | `customer_sync.write` | Change in P1b (S5) |
| `lib/customer-portal/customerEvents.ts`, `app/api/v1/events`, `website/customer-events` | API events | support case, events | API client; no human actor | P4: limited intake for unidentified contact |
| `lib/website/customerApplication{Process,Persistence}.ts` | OPS application flow | `ensureCustomerPortalUserLink` | internal flow | Inventory; assess in P1b |
| `lib/billing/billingReadiness.ts` | read model | – | pure | Change in P3 (shared recipient resolver) |
| Customer card `app/admin/customers/[id]/page.part-*` | UI read | – | `requireAdminPageAccess` | P5 |
| Imports, cron, webhooks (`lib/billing/providerWebhooks.ts` and others) | jobs | various | – | **Not yet inventoried in depth.** Continued in P1b/P2 |

## Findings register
| # | Severity | Status | Description | Evidence | Fix |
|---|---|---|---|---|---|
| F1 (S2) | High | **Fixed (T)** | GET/read endpoints upserted `customer_portal_accounts`/`identities` with `role:owner`, `status:active` and a new `verified_at` | `customerResolver.ts` (previously at lines 740-750) ran on every read; the test fails on base | P1a: `mode:'read'` default, links only in `mode:'link'` |
| F2 (S3) | High | **Fixed (T)** | A blocked or deactivated account fell back to identifier matching and was given a new active owner account | tests for read and link mode | P1a for reads. P1b: `hasBlockedPortalLink` in `ensureCustomerPortalUserLink` also covers `lib/website/customerApplication*` (variant) |
| F3 (S1) | High | **Fixed (T, unit)** | End-customer writes were accepted on an identifier-only match (customer number or email alone) | `profile-update` never checked binding | P1a: `customer_identity_binding_required` (403) for mutations without a linked portal account |
| F4 (S4) | High | Open (S) | The first link relies on tenant-supplied factors only (customer number + email); there is no customer-side proof | `hasStrongFirstLinkFactors` | P1b: signed identity/delegation proof (iss/aud/exp/tenant/relation) |
| F5 (S5) | Medium | **Fixed (T, unit)** | `customer-portal/sync` upsert can repoint or null `customer_id`/`auth_user_id` on an existing identity | `route.ts:216` | P1b: `lib/customer-portal/identityTransition.ts` → 409 |
| F6 (S7) | Medium | **Fixed (T)** | Admin profile `status` has no allowlist, so the archive flow can be bypassed | `part-1.ts:231,290` | P2 |
| F7 (S8/S9) | Medium | **Fixed (T, unit + static adapter)** | Primary contact sync is destructive in OPS and missing in the API, so data drifts; the contact change is not audited | `part-1.ts:309-356` | P2: shared contact command |
| F8 (S10) | Medium | **Fixed (T)** | Invoice email silently falls back to `customer.email` | `billingReadiness.ts:198` | P3 |
| F9 (S11) | Medium | Open (S) | Case idempotency is check-then-insert with no unique constraint; the admin key is optional | `support.ts:124` | P4 |
| F10 (S12) | Medium | **Fixed (T, static)** | Portal profile change writes no `audit_logs` row with before/after values | `profile-update/route.ts` | P2 |
| F11 | Info | Open (S) | `customer_cases`/events lack channel, interaction and visibility fields; there is no `/api/v1/customer/support` | migrations 20260520_batch_5 | P4 |

## False positives
- **S6** (PostgREST `.or()` injection in `customer-portal/sync`): `identifier` passes through `normalizeDigits` (`route.ts:268`), so only digits can reach the filter. Classified as a false positive.
- **S13** (customer row loaded before the tenant check in admin save): the row is not returned and the update is filtered on `company_id`. Low risk; tidied up in P2.

## Blocked checks
- **Live DB:** active RLS, grants, RPC and constraint definitions. No isolated Supabase branch has been approved in this session, so migration files are the only evidence.
- **External tenant clients (customer websites):** cannot be inventoried from the repo. The P1a change is a **breaking change** for clients that rely on auto-link on GET, or on writes using only customer number or email. A controlled transition is required before rollout (see PR).
- **Pre-existing red regression scripts on base `53bf989`** (not caused by this branch):
  - `scripts/gridex-batch-6-api-client-regression.cjs`
  - `scripts/gridex-batch-2-3-4-6-regression.cjs`
  - `scripts/gridex-batch-1-9-regression.cjs`

## Verification matrix (P1a)
| Command | Result |
|---|---|
| `npx vitest run __tests__/tenantservice-portal-resolver-read-only.test.ts` | 8/8 pass; 6/8 fail on base code (reproduction) |
| `npx vitest run __tests__` | 387 files / 6235 tests pass |
| `npm run typecheck` | OK |
| `node scripts/gridex-portal-identity-match-strength-regression.cjs`, `…live-schema-code-sync…`, `…multitenant-website-application-flow…`, `check-api-performance-tenant-gates.cjs` | OK |
| eslint on changed files | 0 errors, 0 warnings |

## P2a (contact change): what was done and what remains
**Done:**
- `lib/customer-service/contactChange.ts` holds the shared rules for both adapters:
  - field semantics (omitted / null / value);
  - status allowlist;
  - email and phone validation;
  - primary-contact rule (private customers mirror, company contacts are never cleared);
  - diff for audit.
- OPS action:
  - validated status;
  - optimistic lock through `expected_updated_at`;
  - non-destructive contact sync;
  - contact changes recorded in the audit.
- API `profile-update`:
  - omitted fields stay untouched;
  - validation;
  - version lock (409);
  - same contact rule;
  - fail-closed `audit_logs` with `actor_type: customer_portal_account` and the API client.

**Remaining (P2b), requires a migration and an isolated DB:**
- A single DB transaction (RPC) covering the change, contact, audit, idempotency and outbox. Today these are sequential PostgREST calls: a failure after the customer update leaves the contact and audit unwritten.
- A unique outbox intent.
- Legal identity fields (personal number / org number) in the ordinary OPS profile should move to a separate high-risk flow. **Open, F12.**
- `profile-update` triggers `enqueueCustomerDataRequestAutomation` as fire-and-forget. **Open, F13.**

## P3 (billing consistency)
**Verified extra divergence (F14, fixed):**
- Readiness inherited `customer.invoice_email`, falling back to `customer.email`.
- Invoice review (`invoiceReviewPrepare.ts:242`) and export (`exportCenter.ts:181`) read only the contract.
- Result: an underlay could count as ready while the invoice got no email, and a customer billing-profile change never reached invoices.
- Readiness could also combine street and city from different sources.

**Done:**
- `lib/billing/effectiveInvoiceDelivery.ts` is used by readiness, review and export.
- Contract exceptions and the inherited customer profile are kept apart.
- The address is taken as a whole unit from one source.
- There is no fallback to the contact email.
- Source evidence is added to readiness.
- The partner payload is unchanged (no new fields in `invoice_address_snapshot`).
- Snapshot locking: the export/review item stores the effective address at decision time. Issued items are not rewritten.

**Behaviour change (requires backfill/decision in P8):** customers with only a contact email and no invoice email or postal address are now blocked with `invoice_distribution_missing` instead of being invoiced to the contact email. The test `billing-readiness.test.ts` was updated to the new rule deliberately; it was not exempted.

**Remaining:**
- Versioned billing profile with revision id on the item. Needs a migration.
- Show the impact in the UI (P5).
- Resend to a new address as a separate delivery decision.

## P4a (web/phone/support)
**Done (no schema change):**
- `lib/customer-service/supportConversation.ts` is built on `customer_cases` and `customer_case_events`.
- Entry types are kept apart:
  - customer message;
  - staff reply;
  - internal note;
  - phone interaction (internal; the summary is published only through an explicit staff reply of kind `phone_summary`).
- Visibility is fail-closed: an entry is public only if its event type is on the allowlist **and** `payload.visibility='customer'`. Filters run in the DB before limiting, and visibility is checked again after the query.
- Public DTOs use explicit field lists. Staff identity is not exposed.
- Public `case_reference` is a hash. The reference alone grants nothing; every lookup is bounded to tenant + customer.
- Phone verification:
  - the method is recorded (unverified / strong e-ID / portal confirmation / callback to registered number);
  - `unverified` gives no customer access (limited intake);
  - a representative or mandate reference can be recorded.
- OPS actions: reply, internal note, phone interaction. All require `cases.write`, act under the employee's own identity, and refuse the submit when the tenant was switched in another tab (`expected_company_id`).
- Idempotency:
  - the same key gives no duplicate case or first message;
  - a retry after a crash completes the missing steps;
  - `/api/v1/customer/support/cases` may be retried after `failed` with the same key.
- New scopes `customer_support.read` / `customer_support.write`. They are explicit and are **not** implied by `customer_portal.*`.
- API handlers are in `lib/customer-service/supportApiHandlers.ts`.

**Deliberately not mounted:** the public API surface is locked to OpenAPI release 2026-08-22.2 with immutable artefacts. The route files `app/api/v1/customer/support/**` are added together with the next contract release (P6), so no undocumented endpoint becomes reachable.

**Remaining (P4b, needs a migration + isolated DB):**
- Unique DB constraint for the support idempotency key (F9).
- Dedicated `channel` column and interaction table if reporting needs them.
- Private attachments with quarantine and scanning: **not built.** No attachment endpoint exists. Unknown scan status must never count as approved.
- Action-bound, expiring verification proof stored in the DB.
