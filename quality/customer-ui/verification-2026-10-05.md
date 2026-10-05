# Customer UI simplification — 2026-10-05

The requested registry, customer card, contracts and intake changes are implemented and locally verified. No commits, production data changes or deployment were made. Server loaders, company scope, permission checks and action logic remain intact.

## Behavior

- Registry: five responsive columns, compact counts, one primary action, dropdown filters and secondary action disclosures. Contact, identity and detailed status information expands on demand.
- Customer card: every platform tab is grouped; the existing five tenant groups remain permission-filtered. Mobile uses a labeled native select. Direct tab URLs remain supported.
- Contracts: short summaries with expandable history/details. Creation displays one chosen template or the manual form, preserves inputs across switches and falls back safely when templates change.
- Intake: separate manual/import modes; expandable sections; invalid controls and server errors reveal their section and receive focus. Secondary submit modes preserve original names/values.
- Catalogue: channel controls and creation are expandable; creation honors direct hash links and reopening the same hash.

## Independent root verification

Runtime: Node **22.23.3**, installed lockfile dependencies, Next **16.3.8**, React **19.2.4**. Initial Node 24 engine warning was avoided for verification using a separate Node 22 binary.

| Check | Outcome |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | PASS, exit 0 |
| Targeted Vitest suite below | PASS, 12 files / 61 tests |
| Scoped ESLint | PASS, 0 errors; 10 inherited unused-variable warnings; existing ignore config skips the CJS smoke script |
| `git diff --check` | PASS |
| Chromium registry/navigation | PASS, 5 interaction scenarios |
| Chromium intake | PASS, 5 interaction scenarios |
| Chromium contract picker/disclosure | PASS, 8 interaction scenarios |
| Axe WCAG 2/2.1 A/AA in four fixture views | 0 violations |

```sh
node node_modules/vitest/vitest.mjs run \
  __tests__/tenantservice-ui-workspace.test.ts \
  __tests__/customer-workspace-navigation.test.ts \
  __tests__/customer-overview-contact-summary.test.ts \
  __tests__/customer-registry-shell-performance.test.ts \
  __tests__/customer-registry-hydration-performance.test.ts \
  __tests__/customer-search-before-hydration-performance.test.ts \
  __tests__/customer-status-counts-performance.test.ts \
  __tests__/billing-chain-customer-card-regression.test.ts \
  __tests__/customer-onboarding-constraint-regression.test.ts \
  __tests__/contract-admin-schema.test.ts \
  __tests__/contract-commercial-selection.test.ts \
  __tests__/ediel-ops-02-customer-card-process-decision.test.ts
```

New tests call the real visibility policy/grouping functions to prove every platform tab is reachable exactly once and tenant navigation preserves contract/technical permissions.

## Browser scope

Real components ran in an isolated Vite fixture with Chromium at 1280 × 900 and 390 × 844. Routing/actions were stubbed; no database writes occurred. Registry snapshots use the real server page with synthetic loader data and a header fixture. This proves interaction/layout without claiming authenticated live-tenant or backend end-to-end coverage.

Checks cover Escape/focus/ArrowDown/outside-click menus; desktop/mobile selection; filters; native invalid controls in closed sections; server error ARIA/focus; manual/import state retention; sticky menu bounds; template switching/removal/empty fallback; hash/same-hash reopening; nested invalid field disclosure; and mobile overflow.

For the same three synthetic customers, final registry height fell from **1830 px to 999 px** at desktop width. Mobile registry and open intake sections have no horizontal overflow at 390 px. Screenshots contain synthetic data only.

Fixed findings: select names included option text; intake footer menu opened below viewport; an open intake section widened the mobile page to 484 px. Corresponding checks passed after correction. No uncaught browser exceptions occurred. The existing React `encType` warning remains in the intake fixture; that prop and submission behavior were retained.

## Existing static smoke failures

Four additional smoke scripts fail on pre-existing source-copy assertions. Referenced files byte-match HEAD; expected strings are already absent in HEAD:

| Script | Existing failure |
| --- | --- |
| `gridex-actor-registry-intake-hardening-regression.cjs` | Searches actor actions facade for `auto_send_allowed: false` |
| `gridex-tenant-ui-simplified-status-regression.cjs` | Searches customer list facade for loader implementation |
| `gridex-superadmin-diagnostics-ui-regression.cjs` | Searches customer detail facade for resolution/test-data props |
| `gridex-batch-2-3-4-6-regression.cjs` | External customer ID copy absent in unchanged portal/website facades; fails before intake checks |

The moved fullmakts-step assertion now references the actual form section. No backend work was added to repair unrelated static checks. Full authenticated journeys and publication were not executed.
