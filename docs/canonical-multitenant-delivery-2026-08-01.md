# Canonical multi-tenant delivery — 2026-08-01

## Scope

Reviewed and patched the supplied `gridex-ops-platform` repository against the canonical multi-tenant target. No source repository was supplied for tenant websites, separate customer portals, partner services or other workers. No database or staging credentials were available.

## Confirmed findings

### Critical findings fixed in this patch

1. **Billing webhook accepted a client tenant hint.** `x-gridex-company-id`, `company_id` or `companyId` could influence the invoice lookup. The hint is removed. Tenant is now resolved only from the verified provider plus the persisted provider invoice GUID, and ambiguous matches fail.
2. **Integration authentication did not return an explicit tenant context.** API routes read `auth.client.company_id` directly. Authentication now creates a frozen `TenantContext`, and v1 routes use `auth.context.companyId`.
3. **Canonical onboarding trusted a command company ID without an explicit context argument.** Every implemented intake call now supplies a server-created context; mismatches fail before the RPC is called.
4. **The canonical onboarding runtime name was tenant-branded.** Runtime now calls `canonical_onboard_customer_graph`. A service-only forward alias delegates to the legacy implementation for compatibility.
5. **Contract/application numbering had runtime-generated fallback IDs.** These could bypass tenant number configuration when the database function was missing. Number generation now uses neutral service-only aliases and fails closed when schema is absent.
6. **Auth mail had a hard-coded sender fallback.** `no-reply@gridex.se` and the legacy alternate env fallback are removed. `AUTH_SMTP_FROM` is mandatory.
7. **Manual email protection hard-coded one Ediel address.** Reserved transport addresses are now loaded from server env and active `ediel_mailboxes` rows.
8. **Superadmin forms prefilled Gridex origins/mailboxes.** Tenant/API and Ediel forms no longer silently seed Gridex values.
9. **No canonical capability table existed.** `company_capabilities` is added with disabled/fail-closed defaults, readiness status, blockers, configuration, RLS and a typed loader.
10. **Key parent-child relations relied on single-column foreign keys/application checks.** The forward migration creates tenant-qualified candidate keys, `company_id IS NOT NULL` guards and composite tenant foreign keys as `NOT VALID`, protecting new writes while legacy rows are reviewed.
11. **No platform-wide deterministic remediation package existed.** Added tenant-neutral preflight, dry-run, safe apply and post-verification SQL. Non-null cross-tenant conflicts are never moved automatically.

### Important findings not completed by this repository-only patch

- The codebase still contains approximately **886 `gridex` occurrences in 220 runtime TS/TSX files**. This is a lexical inventory, not 886 defects. Large groups are legacy SQL/RPC namespaces, Ediel test fixtures, provider identifiers, product branding and documentation. Each remaining runtime occurrence still requires classification before claiming zero tenant-specific logic.
- `GRIDEX_AUTOMATION_USER_ID` remains a global compatibility configuration in `lib/customer-operations/automationConfig.ts`. A complete platform design should resolve an automation/service identity from verified tenant configuration or a documented platform identity, then remove this tenant-branded environment contract.
- Customer-operation statuses and transition logic remain distributed across older workflow modules. This patch does not prove that every status mutation uses one state machine.
- Outbound delivery is implemented across several domain-specific modules. The patch hardens one webhook and the tenant context but does not prove that email, webhook, Ediel, SFTP/API callback and manual work all use one universal pipeline.
- Capability rows are created fail-closed but are not yet enforced at every feature entry point; enabling enforcement requires validated configuration/backfill per tenant to avoid disabling production tenants blindly.
- Historical `gridex_*` database functions/views remain compatibility implementations. New neutral aliases were added for onboarding, numbering and legal projection, but a complete namespace migration must be staged after all deployed clients are known.

## Database delivery

### Migration order

1. Reconcile the existing migration ledger and historical checksums.
2. Apply all earlier verified migrations in repository order.
3. Apply `20260801143000_canonical_multitenant_platform_hardening.sql`.
4. Run preflight and dry-run backfill.
5. Resolve all non-null cross-tenant conflicts manually.
6. Apply deterministic backfill.
7. Re-run preflight and post-verification.
8. Validate each generated `mt_*` constraint only when its corresponding conflict count is zero.

### Commands

```bash
npm run tenant:preflight
npm run tenant:backfill:dry-run
npm run tenant:backfill:apply
npm run tenant:post-verify
```

The apply script only performs:

- `company_id IS NULL` → parent’s non-null verified `company_id`;
- missing UUID correlation IDs → generated UUID where tenant is already known;
- an `audit_logs` entry for each deterministic repair.

It never changes a conflicting non-null tenant and never copies data between companies.

## Verification evidence

| Control | Result | Evidence |
|---|---|---|
| Canonical multi-tenant static regression | PASS | `npm run tenant:multitenant:static` |
| Existing manual mailbox/Ediel separation regression | PASS | `node scripts/gridex-manual-grid-owner-information-request-regression.cjs` |
| Modified TS/TSX syntax transpilation | PASS | TypeScript 5.8.3 `transpileModule` over modified files |
| Isolated strict typecheck of `lib/tenant/context.ts` | PASS | global TypeScript 5.8.3 with minimal Node crypto declaration |
| New migration checksum registration | PASS | SHA-256 stored in `scripts/migration-history-manifest.json` |
| Repository migration integrity | FAIL | changed checksum for `20260730220000...`; missing manifest entry for `20260731210000...` |
| Dependency installation | BLOCKED | `npm ci` received registry 404 for `zod-validation-error-4.0.2.tgz` |
| Full app typecheck | BLOCKED | dependencies/type definitions unavailable after install failure |
| Vitest suite | NOT RUN | dependencies unavailable |
| ESLint | NOT RUN | dependencies unavailable |
| Production build | NOT RUN | dependencies unavailable |
| Fresh database migration | NOT RUN | no isolated database supplied |
| Existing database upgrade | NOT RUN | no database supplied |
| RLS/RBAC database tests | NOT RUN | no database/auth test environment supplied |
| Backfill dry-run/apply/second dry-run | NOT RUN | no database supplied |
| Three-tenant E2E/concurrency tests | NOT RUN | no database/staging and other client repositories absent |
| Deployed runtime/OpenAPI/client drift | NOT RUN | no staging deployment or external repositories supplied |

## Required release blockers

### Blocker 1 — historical migration integrity

- **Risk:** unverifiable migration history can apply different SQL than production expects.
- **Affected tenants:** all.
- **Component:** migration ledger.
- **Missing evidence:** authoritative bytes/applied-ledger proof for `20260730220000...` and registration decision for `20260731210000...`.
- **Required action:** restore from authoritative Git/applied database evidence; never overwrite the trusted checksum by assumption.
- **Verify:** `npm run db:migrations:integrity`.

### Blocker 2 — full build/test unavailable

- **Risk:** type, test or bundling regression may remain undetected.
- **Affected tenants:** all consuming OPS/API.
- **Component:** Node dependency and CI environment.
- **Missing evidence:** clean `npm ci`, typechecks, tests, lint and production build.
- **Required action:** use a registry containing every lockfile artifact, then run the repository verification commands.
- **Verify:** `npm ci && npm run verify:canonical-multitenant:static && npm run lint`.

### Blocker 3 — database isolation not applied

- **Risk:** legacy cross-tenant rows may exist; constraints/RLS are not proven in the target database.
- **Affected tenants:** potentially all existing companies.
- **Component:** PostgreSQL/Supabase.
- **Missing evidence:** preflight, migration apply, dry-run, audited apply, second dry-run, constraint validation and RLS tests.
- **Required action:** execute the runbook in isolated staging, resolve ambiguous rows and validate constraints.
- **Verify:** `npm run tenant:preflight && npm run tenant:backfill:dry-run && npm run tenant:post-verify` plus three-tenant RLS tests.

### Blocker 4 — platform repositories missing

- **Risk:** tenant websites/portals/partners may still send or trust tenant IDs, duplicate business rules or use old contracts.
- **Affected tenants:** every tenant using an external client.
- **Component:** repositories outside supplied OPS ZIP.
- **Missing evidence:** source inspection, generated-client drift checks and E2E against the same API version.
- **Required action:** apply the same server-authenticated tenant contract in each repository and remove client-owned business logic.
- **Verify:** each repository’s install/typecheck/test/build plus cross-repository contract tests.

### Blocker 5 — remaining legacy tenant-branded runtime inventory

- **Risk:** hidden defaults or compatibility paths may still behave as tenant-specific production logic.
- **Affected tenants:** depends on each occurrence; potentially all.
- **Component:** 220 runtime files containing the legacy term.
- **Missing evidence:** complete per-hit classification and remediation.
- **Required action:** classify each as branding, configuration, fixture, migration compatibility or prohibited logic; remove prohibited paths and add regressions.
- **Verify:** an allowlisted static scan with zero unclassified runtime occurrences.

## Production decision

# NO-GO

The supplied OPS repository is materially hardened, but the strict acceptance target requires database/staging evidence, full tests/build, reconciled migration history and all platform repositories. None may be inferred as passing.
