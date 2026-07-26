# Gridex OPS — contract, admin and API alignment

Date: 2026-07-26

## Result

The verified contract visibility, lifecycle and API documentation gaps are
closed in one forward-only delivery.

### Database

- Added `20260726230000_contract_admin_api_alignment.sql`.
- The final deployed definition of `gridex_transition_tenant_lifecycle` is
  repaired without editing migration history:
  - `valid_to` is qualified as `ch.valid_to`;
  - closing a tenant ends both active and paused contract channels.
- Direct `authenticated` execution of the `SECURITY DEFINER`
  `gridex_preview_delete_unused_contract` function is revoked. Admin runtime
  resolves actor/company scope and calls it through the service path.
- Permanent deletion remains limited to unused `draft/ready` offers. A
  previously published offer is preserved after unpublish and must use
  archive/terminal lifecycle handling.

### Admin

- Contract mutations revalidate `/admin/contracts`, `/admin/companies` and the
  selected `/admin/companies/[companyId]`.
- Company-to-contract navigation always carries `company_id`.
- Company list and detail pages separately show contract products, currently
  public offers and signed/customer contracts.

### API

- Developer documentation and website OpenAPI use the runtime auth codes
  `missing_api_token`, `invalid_api_token` and `api_scope_missing`.
- Resolver examples check `capabilities.pricing_ready` and
  `capabilities.quote_ready`. HTTP 200 from resolution is not treated as
  automatic price/quote readiness.
- The guide blocks `postal_suggested` from price/quote until the relevant
  capability is ready.

## Local verification

- `npm run typecheck`: passed.
- `npm test -- --testTimeout=15000`: 54 files, 354 tests passed.
- `npm run api:docs`: passed.
- `npm run db:migrations:check`: 303 files, 208 version groups passed.
- Contract deletion/lifecycle regressions: passed.
- `npm run typecheck:contract-go-live`: passed.
- `npm run lint`: 0 errors, 125 existing warnings.
- `npm run build`: passed.

## Remaining environment gate

The forward migration must still be applied and transaction-tested against an
authorized Supabase/PostgreSQL environment. No database URL or Supabase runtime
was available in the build workspace.
