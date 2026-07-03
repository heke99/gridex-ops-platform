# AGT/Test vs Production/Live Separation

How the Gridex Ops Platform keeps actor testing (AGT/TGT) and production Ediel
traffic apart. Verified against the codebase 2026-07-03.

## Concepts

- **AGT/test**: Ediel actor testing against the test portal/receiver. Uses
  `environment = 'test'` rows in `ediel_actor_settings` and
  `ediel_route_profiles`, routes with `target_system = 'ediel'` (or TGT portal
  routes) and `default_test_flag = 1`.
- **Production/live**: real market traffic. Uses `environment = 'production'`
  rows, routes materialized with `target_system = 'production_ediel'`,
  `default_test_flag = 0` (`lib/ediel/routeMaterializer.ts`,
  `lib/ediel/routeMatrix.ts` → `targetSystemForEnvironment`).

## Where test routes are configured

- `app/admin/ediel` (routes, route profiles) with `environment='test'`
- AGT runtime + test packages: `app/admin/platform/actor-testing`,
  `lib/ediel/agtRuntime.ts`, `lib/ediel/systemTestPackages.ts`

## Where production routes are configured

- Route materialization from platform actor registry:
  `lib/ediel/routeMaterializer.ts` (per company, per message family,
  `environment='production'`)
- Production readiness per route: `lib/ediel/routeProfileProductionReadiness.ts`
  (certificates, SMTP identity, encryption mode, `is_production_ready`)

## How superadmin sees the difference

- `app/admin/platform/go-live` — production readiness, blockers, live gate
- `app/admin/platform/actor-testing` — AGT status, clearly test-scoped
- Route lists show `environment` and `target_system` per profile

## What blocks production send (fail-closed guard chain)

Layer order for an outbound production message:

1. **Environment resolution** — flows resolve the environment explicitly
   (`lib/ediel/customerInfoEnvironmentResolver.ts`,
   `resolveOutboundRuntimeEnvironment`); `resolveSenderSettings` rejects
   anything but explicit `test`/`production`.
2. **Route decision engine** (`lib/routes/routeDecisionEngine.ts`) — scopes
   routes by `company_id` + `environment`, refuses disabled/portal-TGT routes
   in production, syncs production readiness.
3. **Company go-live state** — `getCompanyProductionReadiness`
   (`lib/ediel/productionReadiness.ts`) blocks when the company is not `live`
   (or is `paused` → `production_paused` blocker).
4. **First-send approval** — `lib/ediel/productionSendApproval.ts`
   (`production_send_lock_enabled` on actor settings until first production
   send is approved).
5. **Outbox readiness guard** — `lib/ediel/outbox/readinessGuard.ts` +
   `lib/ediel/outbox/routeContract.ts` (runtime subaddress, certificate
   environment match, receiver actor readiness).
6. **Send locks** — active `ediel_send_locks` rows per company/environment
   block claiming (`lib/ediel/outbox/sendOutboxItem.ts`).

Removing or weakening any single layer is prohibited; they guard different
failure modes (identity, route, tenant state, first-send, transport, ops pause).

## What happens when a tenant is made live

`activateLiveEdielAction` (see
`docs/electricity-company-onboarding-production-readiness.md` Step 8):
sets live flags + audit trail. It does **not** dispatch messages; it only allows
future production outbound to pass guard layer 3.

## How test data is kept out of production

- **Inbound**: the canonical tenant resolver
  (`lib/ediel/tenant/resolveInboundTenant.ts`) requires an explicit
  `environment`; missing environment → `unresolved` (never guessed). Evidence
  from actor settings and route profiles is filtered by environment. AGT/test
  inbound PRODAT/UTILTS is short-circuited to the actor-testing engine in
  `lib/ediel/flows/inboundProcessing.ts` and never updates production customer
  operations.
- **Outbound**: AGT sends resolve test routes only (environment-scoped); the
  production resolver cannot select a test route (`target_system` mismatch +
  environment filter), and TGT portal routes are explicitly rejected in
  production (`lib/ediel/core/routeRegistry.ts`).
- **Mailboxes**: shared inbound mailboxes store messages tenant-neutral first;
  the mailbox hint can never override EDIFACT routing evidence — disagreement
  yields `ambiguous` → manual review.
- **Events**: customer operation events are emitted by production flows;
  AGT runs record `actor_test_results` instead.

## How production events are kept out of AGT

- Actor-testing sync only consumes messages flagged as test
  (`message.test_flag` / parsed AGT/TGT markers,
  `lib/ediel/orchestrator/edielProcessingPipeline.ts` `contextKind`).
- Production inbound cannot be treated as AGT: the AGT short-circuit requires
  test context; production-environment messages flow to business processing.

## Known accepted gaps (documented, not fixed — audit 2026-07-03)

- `resolveCanonicalRouteContext` still has a deprecated `environment ?? 'test'`
  default. A call-site audit shows every runtime caller passes an explicit
  environment; the default is documented as deprecated in code and must not be
  relied upon by new callers.
- The inbound unique dedupe index on `(sender, interchange_reference)`
  (`batch 3.sql`) does not include `environment`; the poller's dedupe *queries*
  are environment-scoped, so cross-environment reference reuse is only a risk
  for direct DB writes outside the poller. Suggested fix post-launch: extend the
  unique index with `environment` after checking legacy duplicates.
- `lib/ediel/transport/tenantResolver.ts#resolveTenantFromEdifact` and
  `lib/ediel/orchestrator.ts#inspectManualRouteRuntime` are dead code
  (no callers); the former is marked `@deprecated`. Do not wire them into new
  flows.
