# GRIDEX-AUD-001 Remediation Report

## Status

- Finding: `GRIDEX-AUD-001`
- Status: `DEV_VERIFIED`
- Severity: High
- Audit source: `quality/audits/gridex-ops-full-integrity-performance-security-review-2026-08-06/`
- Audit commit: `fc8c861ffc833143b48f21eface0169f8b068b2e`
- Remediation base: `origin/main` at `bb877506fb176d61095eb90e7af7df968e88f432`
- Branch: `remediation/gridex-aud-001-document-storage-isolation`
- Implementation head before this report: `27a5c6c0124b3e6f38cf3b4ad9b1b34032c0a00f`
- Database verification target: Supabase project `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
- Production changed: No
- Staging changed: No
- Automatically merged: No

`VERIFIED_CLOSED` is not used. Post-deploy verification has not occurred.

## Reproduction on main

The finding was reproduced against the unchanged remediation base.

1. The `customer-documents` bucket had authenticated `SELECT`, `INSERT`, and `UPDATE` policies based on global permissions only.
2. The policies did not parse the object path or prove that the path company, customer, and optional site matched canonical database ownership.
3. There was no authenticated `DELETE` policy.
4. A separate service-role `ALL` policy existed, but the authenticated boundary was not tenant-safe.
5. Four upload paths built object names independently and had drifted:
   - three admin paths omitted `companyId`;
   - the website power-of-attorney path used a legacy `authorizations` layout without a canonical `documentType` segment.
6. The signed-URL route checked database tenant access before using the service-role client, but did not check that `file_path` encoded the same company, customer, and site as the database row.
7. Nine existing objects in the development bucket used legacy or orphaned paths. Their path customer IDs could not be matched to current canonical customer ownership.

## Root cause

The storage authorization model trusted broad application permissions instead of deriving tenant ownership from one canonical storage key and validating it against the database. Object-key construction was duplicated across consumers, so path formats diverged. Service-role signing also trusted the stored path after validating only the metadata row.

## Affected surface inventory

### Upload and read consumers

- `app/admin/customers/actions.ts`
- `app/admin/customers/[id]/actions.ts`
- `app/admin/customers/[id]/document-actions.ts`
- `lib/website/customerApplications.ts`
- `app/api/admin/customer-documents/[documentId]/route.ts`
- `lib/customer-operations/requestMissingFacilityInformation.ts` was inspected as a downstream attachment consumer.

### Database and Storage objects

- `storage.objects`
- Storage bucket `customer-documents`
- `public.customers`
- `public.customer_sites`
- `public.customer_authorization_documents`
- `public.powers_of_attorney`
- `public.company_memberships`
- `public.user_permissions`
- `public.permissions`
- `public.gridex_actor_has_company_permission(uuid, uuid, text)`

### Policies and service-role flow

The final policy set is deliberately split into:

- authenticated `SELECT`;
- authenticated `INSERT`;
- authenticated `UPDATE`;
- authenticated `DELETE`;
- separate service-role `ALL`.

The service-role policy is not used as a substitute for authenticated tenant isolation.

## Remediation

### Canonical path

All upload paths now use the shared builder in `lib/customer-documents/storagePath.ts` and emit:

```text
companies/{companyId}/customers/{customerId}/{scope}/{documentType}/{filename}
```

Supported scope values are:

- `customer`
- `site-{siteId}`

Supported document types are:

- `power_of_attorney`
- `complete_agreement`
- `grid_invoice_suggested`

The shared module validates UUIDs, sanitizes file names, parses canonical paths, and compares a path to expected database ownership.

### Fail-closed database authorization

The final helper is `gridex_private.customer_document_path_allows(text, text)`. It is a `SECURITY DEFINER` function with a fixed search path outside PostgREST-exposed schemas. It returns false when any of the following is invalid:

- segment count or literal prefixes;
- company or customer UUID;
- scope or site UUID;
- document type;
- filename;
- customer-to-company ownership;
- site-to-customer/company ownership;
- required company-scoped read or write permission;
- any runtime exception.

The temporary public helper introduced by the first forward migration was removed by a second forward migration after Supabase Advisor identified it as an exposed RPC surface. The first applied migration was not edited.

### Signed URL

The route now loads `site_id` and rejects the request before service-role signing unless the stored path company, customer, and site match the database row. Tenant access is still verified separately.

### Retry and idempotency

Website power-of-attorney uploads preserve a deterministic object key by disabling timestamp-prefixing for the existing power-of-attorney identifier. Admin uploads retain unique timestamped filenames. The canonical parser accepts both patterns while enforcing the same ownership boundary.

## Forward migrations

| Repository migration | SHA-256 | Dev ledger version | Result |
| --- | --- | --- | --- |
| `20260806165000_gridex_aud_001_customer_document_storage_isolation.sql` | `0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16` | `20260806151106` | Applied |
| `20260806172000_gridex_aud_001_storage_helper_private_schema.sql` | `ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f` | `20260806152004` | Applied |

Both checksums are pinned in `scripts/migration-history-manifest.additions.json`.

No Supabase migration ledger row was edited manually.

## Regression coverage

### Database regression

`scripts/gridex-aud-001-customer-document-storage-isolation-regression.sql` was executed in one transaction and rolled back all fixture data.

It used two companies and three authenticated actors:

- company A writer;
- company A read-only user;
- company B writer.

Verified results:

- company A writer can select, insert, update, and delete company A objects;
- company A writer cannot see, update, delete, or insert company B objects;
- company A read-only user can read company A objects but cannot insert, update, or delete;
- company B writer sees only company B canonical objects;
- mismatched company/customer paths fail closed;
- malformed and legacy paths fail closed for authenticated actors;
- site scope must match company and customer;
- service role can separately access canonical and quarantined legacy objects;
- all five explicit policies exist.

Supabase Storage's `storage.protect_delete()` statement trigger was kept enabled. The regression sets the same transaction-local `storage.allow_delete_query=true` flag used by Storage before issuing a delete, so the actual RLS delete policy is exercised without bypassing Storage protection.

Result: PASS in `gridex-ops-dev`.

### Source and route regressions

- `scripts/gridex-aud-001-customer-document-storage-isolation-regression.cjs`
  - canonical shared path required;
  - duplicate local builders prohibited;
  - website retry path deterministic;
  - signed URL validation must precede signing;
  - policy structure and migration checksum pinned.
- `scripts/gridex-aud-001-private-storage-helper-regression.cjs`
  - helper must remain in the private schema;
  - fixed search path and grants required;
  - public helper removal required;
  - migration checksum pinned.
- `__tests__/customer-document-signed-url.test.ts`
  - canonical path succeeds;
  - download filename is propagated;
  - path/database mismatch returns 422 before service-role storage access;
  - tenant denial returns 403 before service-role storage access;
  - Storage signing failure returns a controlled error.

These tests are wired into `.github/workflows/ops-hardening.yml` and are subject to exact-head pull-request CI.

## Supabase inspection

After the two forward migrations:

- the public helper no longer exists;
- only `gridex_private.customer_document_path_allows(text, text)` remains;
- authenticated has schema usage and function execute;
- anon has neither function execute nor schema usage;
- all authenticated policies reference the private helper;
- the service-role policy remains explicit and separate;
- the new exposed-RPC Advisor warning disappeared;
- no new final Storage errors were present in the 24-hour Storage log;
- Postgres log entries from this work were limited to intentionally reproduced negative test cases before the final passing regression.

The public database function surface was inspected directly. The full repository generated-type parity gate remains part of the later OpenAPI/generated-types finding family and exact-head CI; no claim of complete generated-type parity is made here.

## Existing-object compatibility plan

Nine development objects remain legacy/orphaned. They are intentionally inaccessible to authenticated users under the new policies and remain available only through the separate service-role administrative path.

They must not be guessed into a tenant. Before staging or production rollout, an operator must:

1. inventory each legacy object and all metadata references;
2. prove the canonical company, customer, optional site, and document type;
3. copy the object through the Storage API to the canonical key;
4. update the owning metadata row in one controlled operation;
5. verify signed-URL access for the intended tenant and denial for another tenant;
6. delete the legacy object through the Storage API only after verification;
7. record unmappable objects as quarantined or delete them under an approved retention decision.

## Changed files

- `.github/workflows/ops-hardening.yml`
- `__tests__/customer-document-signed-url.test.ts`
- `app/admin/customers/[id]/actions.ts`
- `app/admin/customers/[id]/document-actions.ts`
- `app/admin/customers/actions.ts`
- `app/api/admin/customer-documents/[documentId]/route.ts`
- `lib/customer-documents/storagePath.ts`
- `lib/website/customerApplications.ts`
- `scripts/gridex-aud-001-customer-document-storage-isolation-regression.cjs`
- `scripts/gridex-aud-001-customer-document-storage-isolation-regression.sql`
- `scripts/gridex-aud-001-private-storage-helper-regression.cjs`
- `scripts/migration-history-manifest.additions.json`
- `supabase/migrations/20260806165000_gridex_aud_001_customer_document_storage_isolation.sql`
- `supabase/migrations/20260806172000_gridex_aud_001_storage_helper_private_schema.sql`
- this report.

## Verification state and blockers

### Completed

- `REPRODUCED`
- `ROOT_CAUSE_CONFIRMED`
- `CODE_REMEDIATED`
- `DEV_VERIFIED`

### Not completed

- `STAGING_VERIFIED`
- `DEPLOYED`
- `VERIFIED_CLOSED`

### Verifiable blockers

1. No approved staging target has been selected or connected for this remediation.
2. No production deployment is permitted in this campaign.
3. The nine legacy/orphaned objects require an explicit ownership and retention decision before migration.
4. A real authenticated HTTP Storage upload/download/delete test with persisted bytes must be run in staging; the available verification combined database RLS execution with route-level signed-URL tests.
5. Exact-head pull-request CI is recorded in the draft PR conversation after this report commit so that the evidence points to the final tested SHA.

## Exact next step

Open the draft PR, require exact-head CI to pass, review the nine-object compatibility inventory, then apply the same two forward migrations to an approved staging environment and run real Storage API cross-tenant and signed-URL tests. Keep the finding at `DEV_VERIFIED` until that occurs.
