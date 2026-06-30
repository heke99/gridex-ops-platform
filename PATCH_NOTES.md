# Gridex OPS API production fix

This patch fixes the website customer application failure around `site_create`, `idempotent_failed`, and atomic site provisioning.

## Fixed

1. Replaces `public.gridex_create_customer_site_with_address(...)` with a corrected production-safe body using the same signature:
   - no broken/duplicated `customer_sites` insert columns;
   - site + customer address + address history are written in one PostgreSQL transaction;
   - existing address-hash match is idempotently reused;
   - service_role execute grant is preserved;
   - PostgREST schema cache reload is requested via `pg_notify('pgrst', 'reload schema')`.

2. Improves OPS runtime error classification:
   - treats `PGRST202`, `PGRST204`, and schema-cache function lookup errors as schema/provisioning issues;
   - stops hiding a callable/runtime provisioning issue behind the misleading old “migration missing” text;
   - preserves DB code/message/hint in internal error details.

3. Handles failed idempotency after `site_create` safely:
   - if a previous request failed before durable site/meter/contract creation at `site_create`, OPS can release the old failed idempotency row and let the same retry create a new complete application;
   - other failed/successful idempotency cases remain protected and still return `409 idempotent_failed` or `idempotent_application_missing_poa` as before.

4. Cleans duplicate `signerIdentityNumber` mapping.

5. Updates developer docs for:
   - `failed idempotency ger 409 idempotent_failed`;
   - `public.metering_points`;
   - `external_customer_id krävs`;
   - `sender_email` / `reply_to_email`;
   - retry behavior after failed site provisioning.

## Apply

From the OPS project root:

```bash
unzip -o ~/Downloads/gridex-ops-api-production-fix-direct.zip
supabase db push
npm run db:migrations:check
npm run gridex:batch-8-1-live-schema-regression
npm run ops:final-contract-regression
npm run build
```

Then redeploy OPS.

## After deploy

Retry the website signup. If the same old web submit still reuses the old idempotency key, this patch allows retry only for the safe case where the previous attempt failed at `site_create` before site/meter/contract creation. Otherwise use a fresh `Idempotency-Key` or repair from admin.

## Verified in sandbox

Passed:

- `node scripts/gridex-batch-8-1-live-schema-regression.cjs`
- `node scripts/ops-final-contract-regression.cjs`
- `node scripts/gridex-website-api-power-of-attorney-regression.cjs`
- `node scripts/gridex-batch-7-website-foundation-regression.cjs`
- `node scripts/gridex-ops-continuation-hardening-regression.cjs`
- `npm run db:migrations:check`

Not run to completion in sandbox:

- `npm run build` because this uploaded zip has no `node_modules` and `next` is not installed in the sandbox (`next: not found`).
