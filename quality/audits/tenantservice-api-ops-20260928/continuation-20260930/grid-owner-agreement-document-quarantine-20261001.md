# Agreement document resource boundary — 2026-10-01

Status: bounded defensive source repair VERIFIED locally; Supabase/GoTrue/HTTP/browser/Storage acceptance NOT_EXECUTED. The missing canonical agreement table is an implementable provisioning gap. No external request, authentication probe, provider traffic or live release link was performed.

## Finding and resulting behavior

The existing exported `GET` in `app/admin/agreements/grid-owners/documents/route.ts` ran the canonical platform page guard, then interpreted the caller's `path` as an arbitrary `bucket:path` and invoked the service Storage signer without a current agreement record. An owned, controlled harness previously retained by root demonstrated that signer dispatch bypassed the separate support quarantine consumer. This establishes a source/caller boundary defect, not a successful download of real quarantined bytes.

The repair preserves the existing UI query format and the legitimate global platform scope. A resource belonging to another company is allowed when it is an actual agreement and the caller has current global platform authority. An unbound reference is denied; this is not a new selected-tenant restriction.

The route now requires:

- The existing canonical platform guard receipt, followed by a successful actual server Auth read with exactly the same user ID. A populated user plus Auth error is rejected.
- Only the configured agreement bucket, with `customer-support-quarantine` always rejected. Configuring that reserved bucket as the agreement bucket yields safe 503 before data access.
- One current `grid_owner_access_agreements` record with a nonempty database ID and an exact `document_path` match. Missing/inconsistent rows yield 404; missing table, ambiguous rows and database failure yield a constant 503 without signing.
- A successful service Storage result for that bound agreement resource. Returned or thrown private error messages are not copied into responses. Actual installed Next control flow is preserved with `unstable_rethrow`; the platform guard remains outside the catch.

The shared pure `lib/routes/gridOwnerAgreementDocumentKey.ts` validates canonical object identities matching the actual existing ASCII upload keys. Dot segments, backslashes, percent encodings, query/fragment delimiters, empty folders, leading/trailing slash and malformed identities are rejected before database access. The legacy unprefixed stored path remains supported in the configured agreement bucket. No scanner approval, support release, grant, provider activation, financial or lifecycle state was added. The record lookup and Storage signing are separate operations, so this packet does not establish transaction-spanning revocation or byte lineage for agreement documents.

## Executed local RED/GREEN

The new unit file calls the actual exported route using actual installed `NextRequest`/`NextResponse`. Canonical guard, server Auth, data query and Storage are controlled test boundaries; the signing double returns only a fixed localhost receipt. No network or real signing operation occurs.

Before production editing: 18 failures and 2 passes among 20 controls. The material RED outcomes included arbitrary bucket requests and an unbound reference returning 307, absent/mismatched/failed Auth being ignored, and no authoritative record query. Missing-path and actual guard-redirect controls already passed. The full count includes desired query and error-response assertions; it is not a count of independent vulnerabilities.

After the initial restrictive route change: 20/20 PASS. Controls cover three arbitrary buckets, a legitimate but unbound reference, a valid current agreement, configured bucket and legacy path, missing/inconsistent record receipt, three actual-Auth failure shapes, the real installed Next guard redirect signal, missing/ambiguous table, reserved bucket misconfiguration, missing/empty path and returned/thrown private error canaries.

Root then explicitly authorized defensive malformed-key validation after read-only inspection of the installed Storage client URL concatenation. Twelve controls with controlled current matching rows first returned 307 (RED) and now return 400 without database access or signing (GREEN). No URL request or real signing was performed. Final route controls: 32/32 PASS; combined with retained actual attachment metadata boundary tests: 41/41 in two files. This approved delta supersedes the earlier three-file freeze.

Executed commands from repository root:

```sh
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/grid-owner-agreement-document-quarantine-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/admin/agreements/grid-owners/documents/route.ts lib/routes/gridOwnerAgreementDocumentKey.ts __tests__/grid-owner-agreement-document-quarantine-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/typescript/bin/tsc -p /tmp/grid-agreement-document-scope-20261001.json
git diff --check -- app/admin/agreements/grid-owners/documents/route.ts
```

All final commands PASS. The temporary TypeScript config extends the actual repository config, disables incremental output and plugins, and includes only this route and unit file with their real import closure. No broad concurrent application typecheck was run. The runtime emits its existing experimental EnvHttpProxyAgent warning.

Skills routing: systematic debugging, TDD, security/variant review, Supabase, installed Next route/control-flow documentation and verification before completion apply to this boundary. Parent owns the original masterplan baseline, integration and independent review. UI performance, external deployment/provider and historical migration edits are outside this packet. Parent remains the sole canonical memory and publisher owner.

## Read-only feature and provisioning inventory

All actual agreement feature loaders, writers and upload consumers located by repository symbol/table/bucket searches were inspected. This is source inventory, not executed database acceptance.

| Existing source | Actual dependency and behavior |
| --- | --- |
| `app/admin/agreements/grid-owners/page.tsx` | Canonical global platform guard; service lists agreements plus current companies, grid owners and routes. |
| `components/admin/agreements/GridOwnerAgreementForm.tsx` | Calls the existing save Action; multipart upload or manual stored path; scope/status/references and optional new grid owner. |
| `components/admin/agreements/GridOwnerAgreementTable.tsx` | Builds the existing `?path=` download URL from the stored agreement path; calls archive Action. |
| `app/admin/agreements/grid-owners/actions.ts` | Canonical platform Action guard; service grid-owner lookup/create, service Storage upload, then agreement save; archive separately. Upload bucket is configured/default `grid-owner-agreements`, path is company-or-platform/grid-owner-or-unknown/timestamp-safe-filename. Operations are not one database transaction and cache refresh is separate. |
| `lib/routes/gridOwnerAgreements.ts` | Service list/get/find-active; direct service insert/update/archive with supplied actor or null. Five table operations; all declared fields mirror the old feature DDL. No current-session SQL command is used. `getGridOwnerAccessAgreementById` has no located caller. |
| `lib/routes/agreementReferenceResolver.ts` | For processes requiring agreement, requires actual company/grid-owner/scope, selects active date-valid rows and denies missing/ambiguous matches. It does not sign Storage. |
| `lib/routes/routeDecisionEngine.ts` | Uses that resolver for agreement reference, application reference, receiver and route preferences; missing/ambiguous agreement remains a readiness blocker. Actual Ediel route context/masterdata callers consume the route decision. |
| `lib/inbound-mail/smokeTests.ts` | Checks that this table exists/readable with service; this is a diagnostic consumer, not provisioning. |
| `supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql` | Old noncanonical filename declares the table, 29 original columns, two indexes and historical RLS policies. The historical tenant-readable/platform-write intent does not itself establish current effective grants or current-session writes. |
| `supabase/migrations/20260528_batch_7a1_inbound_hardening.sql` | Old noncanonical private agreement bucket provisioning and role-name Storage policies. Its `user_roles` query lacks the current global `company_id IS NULL` boundary and must not be copied. |

The old files remain present and checksum-recorded in `scripts/migration-history-manifest.json`. Neither `supabase/schema.sql` nor `supabase/database.types.ts` contains `grid_owner_access_agreements`, and the public canonical artifacts do not establish actual Storage bucket provisioning. This is a canonical artifact gap, not a probe of a hosted database. The new route safely fails with 503 if its current deployment lacks the table. A legitimate positive in isolated native CI needs a real forward provision, not a synthetic fixture table or fake grants.

The actual canonical `public.gridex_user_is_platform_admin()` filters functioning Auth/profile identity, confirmed email and global platform roles (`user_roles.company_id IS NULL`), and powers the real guard. Existing service-only `public.canonical_actor_is_platform_admin(uuid)` has the same global role boundary but does not itself require confirmed email/session. Existing `private.gridex_profile_session_active_v1(uuid,uuid)` independently checks active identity and locks current profile/session with `clock_timestamp()` expiry. A future service command must combine the appropriate existing authority and current-session checks; an actor supplied by the form is insufficient.

## Proposed next bounded forward stage — not implemented

Root authorized this separate stage after the inventory; no stage source or migration has been written at this defensive packet freeze. Its reserved paths are a CLI-created fresh migration (name `grid_owner_access_agreement_atomic_provisioning`, actual timestamp returned by CLI), `lib/routes/gridOwnerAgreements.ts`, `app/admin/agreements/grid-owners/actions.ts`, and uniquely named agreement command core/unit/native/report files. No old DDL, generated schema/types, workflow or registry edits belong to this owner.

Provision only this existing feature's canonical table, original compatible columns and necessary indexes, private default agreement bucket and narrowly authorized command/audit/idempotency structures. Preserve old valid rows if present; preflight incompatible shape/data and block explicitly instead of silently rewriting them. Do not port the unrelated old Batch 7A inbound-mail/route foundations. Do not copy old permissive global-role or broad table policies.

Replace direct agreement DML with a service-only invoker wrapper around a narrowly privileged private command, allowing existing service consumers to SELECT while withholding general table DML. The private command must check the server-derived real actor/session, lock actual Auth/profile/global role authority rows and current target, enforce current canonical global platform authority, and recheck clock-based session expiry after resource/audit waits. Keep actual company/grid-owner/route relationships valid; global platform agreements may remain company-null. Save/archive, revision/idempotency and immutable audit must succeed or roll back together. No current caller requires an authenticated direct Data API writer, and no new broad Auth grants are justified.

The existing optional grid-owner creation must not become an unqualified side effect before a denied agreement write. Either include its authorized database work in the same command or use a separately proven current-session canonical grid-owner command; root must decide the smallest compatible scope. Storage upload cannot join the SQL transaction, so orphan cleanup and a confirmed-save cache outcome need explicit handling. This initial document repair does not change those writers.

Required next proofs: actual PostgreSQL missing-table RED before applying the fresh forward; valid save/archive and resolver outcomes; tenant-bound platform-name and inactive/revoked/expired-session denial; foreign/incompatible relationship denial; command replay/conflict; audit failure rollback; no direct anon/authenticated/service DML bypass; reserved support quarantine never becomes an agreement document; native clean replay/upgrade and actual guarded caller using the real schema. Real-provider/market activation remains separate. This proposal is neither schema execution nor completion of T36 or the whole original plan.

## Frozen source manifest

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `app/admin/agreements/grid-owners/documents/route.ts` | `121119948dba004b88788a613f04faeefdfe88d0` | `3ecd257306774fd628de9e00274b8ce92bcf08ff4fa6b1d567dc0e491e7e38ab` |
| `lib/routes/gridOwnerAgreementDocumentKey.ts` | `664e6eeb2250ead78ac7cc43a73de99356247472` | `6cab0d78c3f1892ad391a8ed3d1307efea3e11d4ded55fe7d92fc36381ec89ac` |
| `__tests__/grid-owner-agreement-document-quarantine-20261001.test.ts` | `38557fa6729dc827634446f9b96c73315268bc9e` | `36de0739c2d8387fff98a7f24d2e59925e5833a5096418a585179e0424ad9e8d` |

The separate report hash is sent to root after writing, avoiding a self-referential hash. Independent source/unit review is requested; no native/HTTP/browser PASS is claimed. Frozen earlier packets and unrelated ongoing edits were preserved. No commit, push, hosted write or live signing was performed by this owner.
