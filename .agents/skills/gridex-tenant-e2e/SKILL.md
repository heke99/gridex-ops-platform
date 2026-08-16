---
name: gridex-tenant-e2e
description: Use when Gridex Ops or Gridex Web must be tested end to end for one tenant or all tenants. Resolves Gridex tenant capabilities from canonical Supabase data, drives website/internal/API flows, validates downstream Gridex state and integrations, fixes authorized defects, and reruns the exact tenant scope.
---

# Gridex Tenant E2E

## Relationship to generic skills

This is the Gridex adapter. It MUST use:

- `../full-e2e-verification/SKILL.md` as the orchestration contract;
- `../browser-e2e/SKILL.md` for real UI/browser boundaries;
- `/PROJECT_E2E.yaml` as the Gridex scenario contract;
- `/PROJECT_E2E_TENANTS.yaml` as the Gridex tenant-scope/capability overlay.

The tenant overlay refines scope and applicability; it does not replace the base project contract. Do not duplicate generic E2E rules here.

## Scope resolution

### User names one tenant

Examples: "kör Nibela", "testa Gridex El", "E2E för company X".

1. Set mode to `single_tenant`.
2. Resolve exactly one row from canonical `public.companies` using, in order, exact ID, exact company/tenant slug, exact external tenant reference, then exact normalized name.
3. Record the resolved company ID and slug internally.
4. Do not run another tenant's business flows.
5. Do not mutate another tenant.
6. Do not silently substitute Gridex El or a test company when the requested tenant is not ready.
7. Run shared release gates once, then the selected tenant from beginning to end.
8. A capability that the selected tenant is supposed to have but cannot execute is `BLOCKED` or `FAIL`, not `NOT_APPLICABLE`.

### User asks for all tenants

1. Discover canonical tenants from `public.companies`.
2. Read capability/readiness state from:
   - `public.company_capabilities`;
   - `public.tenant_website_readiness_v`;
   - `public.tenant_launch_states`;
   - `public.platform_tenant_governance_overview`;
   - implementation-specific readiness views referenced by the scenario.
3. Build a capability matrix first.
4. Complete each tenant before starting the next.
5. Never clone one tenant's credentials/configuration into another just to make tests runnable.

## Per-tenant lifecycle

For each selected tenant:

1. **Baseline**
   - lifecycle/status;
   - enabled capabilities/readiness/blockers;
   - API client/allowed origin/public offer readiness;
   - email sender/template readiness;
   - Ediel test/production readiness;
   - route/certificate prerequisites;
   - partner/webhook capability;
   - billing/invoice capability;
   - active contract/publication state.

2. **Isolated fixtures**
   - use a unique run ID;
   - prefix all safe test records with the configured E2E marker plus tenant slug;
   - never reuse an earlier customer's identity as proof;
   - verify a new flow actually created/bound the intended canonical state.

3. **Execute applicable P0**
   - website sales path when enabled/expected;
   - internal/manual intake when enabled/expected;
   - missing-facility recovery;
   - legal acceptance and power of attorney;
   - grid-owner resolution/routing;
   - email lifecycle;
   - website/customer API;
   - Partner API/webhooks when enabled/expected;
   - RBAC/superadmin boundaries for the selected tenant;
   - lifecycle/go-live protection;
   - Ediel environment/role separation;
   - multi-site when supported;
   - read-back through the promised UI/API.

4. **Verify every boundary**
   - Gridex Web/browser;
   - Gridex Ops/server API;
   - canonical Supabase rows and ownership;
   - workflow/jobs/events/outbox;
   - email provider acceptance/delivery where observable;
   - Ediel/outbound intent only when prerequisites allow it;
   - final customer/company/API/dashboard state.

5. **Failure → fix loop**
   - identify first broken boundary;
   - inspect Vercel/runtime logs, Supabase state, events/jobs and provider state;
   - fix root cause when authorized;
   - add regression coverage;
   - rerun that flow from its first entrypoint;
   - rerun selected tenant P0 if shared Gridex code changed.

6. **Cleanup and verdict**
   - clean only tagged E2E fixtures using safe project cleanup mechanisms;
   - record PASS/FAIL/BLOCKED/NOT_APPLICABLE per scenario;
   - produce a single-tenant verdict in `single_tenant` mode.

## Existing Gridex regression assets

Use existing repository regression scripts as supporting evidence, not substitutes for live E2E. In particular, reuse relevant scripts for clean website flow, missing facility safeguards, routing, tenant isolation, communications, multisite, API contracts, and Ediel guards when they match the scenario.

`npm test` or a Gridex regression script cannot by itself prove a browser-required scenario.

## Gridex Web

When a tenant exposes a website/customer acquisition channel, test the actual user-facing Gridex Web route or tenant-specific website entrypoint. Confirm:

- offers shown belong to the selected tenant/publication;
- form submission binds to the selected tenant;
- legal/POA acceptance is persisted correctly;
- result is visible in Gridex Ops and promised API/read-back surface;
- communications are sent using selected tenant configuration;
- facility/grid-owner downstream state is selected from canonical data;
- no other tenant's branding, offers, sender, API client, customer, contract, route, event or message leaks into the flow.

## Safety

Production-safe E2E may create isolated test records only where `PROJECT_E2E.yaml` permits it. Never send uncontrolled real-market messages merely to prove a test. A fail-closed outbound blocker is a correct result when production prerequisites are intentionally absent.
