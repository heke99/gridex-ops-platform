# Architecture and data flow

## Canonical chain

```text
Supabase schema and immutable version rows
  -> RLS/grants and company/session helpers
  -> SECURITY DEFINER/RPC, triggers and service-role workers
  -> Next.js server modules and route handlers
  -> Zod/runtime schemas and response mappers
  -> OpenAPI current + immutable snapshots
  -> generated TypeScript declarations
  -> tenant website / customer portal / admin UI
  -> external EDIEL, market, email and identity services
  -> audit logs, request IDs and operational status
```

The strongest architecture pattern is company-scoped server authorization through active membership/company helpers. The weakest boundary found is where a global RBAC helper is reused for tenant-owned storage objects.

## Critical flows

### Website quote and application

1. API client/tenant context identifies company and scope.
2. Offer/publication/legal/price versions are resolved.
3. Energy/market data and price components form an immutable quote snapshot.
4. A hash binds quote fields, snapshots and validity timestamps.
5. Quote validation rehydrates database values and compares the hash.
6. Customer application orchestration creates customer/site/contract/legal/POA evidence and side effects.

Current inconsistency: `valid_until` is timestamp-canonicalized before hashing, while `market_data_timestamp` is not. The same instant can therefore hash differently after PostgreSQL/PostgREST serialization.

### Tenant and role access

1. Auth identity is resolved from `auth.uid()` and JWT.
2. `gridex_user_company_ids()` filters active memberships and active/non-suspended companies.
3. `gridex_can_read_company()` and `gridex_can_write_company()` enforce company scope and allowed operational roles.
4. RLS policies consume helpers or company membership predicates.
5. Platform admin is separately derived through active confirmed user state plus global admin role.

Current inconsistency: storage `customer-documents` policies call `gridex_has_permission(user, permission)` without company/path ownership, bypassing the otherwise company-aware model.

### EDIEL/actor/certificate

1. Actor registry import/verification populates platform-global actor and routing state.
2. Certificate refresh jobs fetch/validate certificate data and update directory/cache tables.
3. Service-role workers require explicit global access; tenant administrators must not read platform-global operational rows.
4. Migration `20260806122255` now enforces the read boundary in dev/main.

Current runtime error: an insert/update of `ediel_certificate_directory_cache` omitted `sha256_fingerprint`, violating a NOT NULL constraint.

### Customer portal

Customer routes are thin adapters over portal bundle/sync and company/customer-bound server modules. Contract/schema parity is partially supported by current OpenAPI artifacts, but exact generated-type and deployed-client parity was not executed in this audit.

## Ownership principles

- `companies.id` is the canonical tenant key; the database does not use a canonical `tenants` table.
- Client-supplied company identifiers are not authoritative without server-side membership/API-client validation.
- Platform-global reference data may be readable globally only when it contains no tenant-private operational rows.
- Service role is reserved for server/worker paths and must not replace tenant authorization.
- Immutable publication, legal, price and quote versions are the source for external contract behavior; UI labels are not canonical.
- Deployment is complete only after code, migration ledger, runtime schema, OpenAPI artifacts, client version and post-deploy tests align.