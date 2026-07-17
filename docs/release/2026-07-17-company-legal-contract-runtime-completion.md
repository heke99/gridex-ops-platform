# Company, legal profile and contract runtime completion — 2026-07-17

## Scope

This release completes the forward-only repair for the canonical chain:

`companies → generated tenant legal profile → explicit legal review → versioned pricing/legal bundle → publication → customer contract snapshot`.

It does not update or delete published legal text versions, published contract versions, locked price versions, signed customer contracts, generated PDFs, signature evidence or email evidence.

## Migration history integrity

`20260717190000_company_legal_profile_single_editor.sql` and its manifest entry were introduced in the same repository commit, but the stored manifest digest did not match the committed file bytes. There is therefore no earlier committed byte-identical migration file to restore from Git history.

The manifest is aligned to the committed migration source as part of this release. This alignment is not treated as proof of the live database state. Before applying the new forward-only migration, deployment must compare the live migration history and effective runtime definitions. Do not overwrite or re-run the old migration in production.

## Forward-only migration

Apply:

`supabase/migrations/20260717233000_company_legal_contract_runtime_completion.sql`

The migration:

- verifies `pgcrypto` is installed in the Supabase `extensions` schema;
- repairs the effective `search_path` for every public function using pgcrypto;
- asserts no relevant function remains without `extensions`;
- removes the legacy duplicate legal-profile trigger and leaves one canonical sync trigger;
- separates normal save from legal approval;
- introduces `complete_unreviewed` readiness;
- validates country codes, postal codes and Swedish organisation numbers;
- rebuilds the full legal source snapshot and hash;
- renders billing and dispute information as readable text rather than JSON;
- exposes `gridex_company_legal_contract_runtime_health()` for live verification.

## Required live preflight

After deployment, run:

```bash
npm run ops:company-legal-live-preflight
```

This requires:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The command must return `ok: true`, one company legal-profile sync trigger, no pgcrypto function missing the `extensions` search path, and readable legal rendering.

## Rollout rule

If migration history, runtime health, RBAC, typecheck, tests or build is red, stop the release. Do not compensate by editing a previously applied migration or by deleting immutable legal history.
