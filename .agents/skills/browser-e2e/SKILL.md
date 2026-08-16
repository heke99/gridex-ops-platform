---
name: browser-e2e
description: Use for repeatable real-browser end-to-end verification of any web project. Drives the product through user-visible flows, captures browser/network evidence, keeps authentication isolated per tenant/account, and hands failures back to the full E2E orchestrator for diagnosis and remediation.
---

# Browser E2E

## Purpose

Provide the browser boundary for any project. Prefer `agent-browser` when available. A browser scenario is not satisfied by direct API calls alone.

## Driver preflight

1. Determine the target URL from `PROJECT_E2E.yaml`, deployment metadata, or the active dev server.
2. Check that the browser driver is available.
3. Use a unique browser session name per run and per tenant/account.
4. Never reuse cookies, local storage, saved auth state, or session files across tenants.
5. Never print credentials or auth-state contents.

If no compatible browser driver exists, mark browser-required scenarios `BLOCKED`; do not fake them with curl.

## Core flow

For each browser scenario:

1. Open the exact entry URL.
2. Wait for stable load/network state.
3. Capture a fresh interactive snapshot.
4. Check visible framework/runtime error overlays.
5. Check browser console errors and failed network requests.
6. Perform the real user actions.
7. Re-snapshot after every navigation or material DOM update.
8. Capture sanitized screenshot evidence at important checkpoints.
9. Verify the terminal user-visible result.
10. Hand request IDs, URLs, status codes, and observed failures to the full E2E orchestrator for API/DB/log correlation.

Typical `agent-browser` sequence:

```bash
agent-browser --session "$E2E_SESSION" open "$E2E_URL"
agent-browser --session "$E2E_SESSION" wait --load networkidle
agent-browser --session "$E2E_SESSION" snapshot -i
# interact with fresh @refs or semantic locators
agent-browser --session "$E2E_SESSION" screenshot --full
```

Always obtain new refs after navigation or dynamic replacement.

## Forms

Test:

- valid submission;
- required-field validation;
- malformed input where relevant;
- double click / duplicate submit protection;
- refresh/back/re-entry for critical multi-step flows;
- clear actionable error feedback.

Do not bypass a critical public/customer form by posting directly to its API unless the scenario explicitly tests the API boundary separately.

## Authentication

- Save auth state only within a single tenant/account test session.
- Name state files/session identifiers with the run ID and tenant slug.
- Close/destroy state after the tenant completes.
- In single-tenant mode, never load another tenant's auth state.
- Verify logout/session expiry for auth-critical flows where configured.

## Tenant isolation

Browser evidence must prove that visible navigation, data and actions are scoped to the active tenant/account.

In strict single-tenant mode:
- do not log into or mutate another tenant;
- do not run multi-tenant comparison journeys;
- authorization negatives should use anonymous, unauthenticated, expired, or unauthorized actors within the selected tenant when possible.

## Responsive coverage

For configured critical public/customer P0 flows, run desktop and mobile-sized verification. Do not fail a business flow for purely cosmetic differences unless usability prevents completion or the project contract treats the visual defect as blocking.

## Evidence

Capture:

- entry/final URL;
- session/tenant identifier (non-secret);
- key screenshots;
- console failures;
- failed request method/path/status;
- visible validation/error text;
- terminal UI state.

Never capture secrets, passwords, authorization headers, cookies, personal data, or private keys.

## Failure handling

At the first broken browser boundary:

1. record the exact step;
2. capture sanitized screenshot/snapshot;
3. record failed request/console evidence;
4. stop that scenario after the broken boundary;
5. return evidence to `full-e2e-verification`;
6. after remediation, rerun the exact browser journey from the beginning, not from a cached mid-flow state.

Always close browser sessions after the scenario/tenant finishes.
