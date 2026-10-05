# Customer UI Simplification Implementation Plan

> **For agentic workers:** Execute task-by-task using the existing delegated UI agent. Root independently reviews and verifies each deliverable.

**Goal:** Make customer registration, customer cards, contracts and intake easier to scan and navigate, with shorter default views and fewer visible actions.

**Scope extension:** The user also requested review and improvement of other system areas. Continue the same presentation-only work through common admin navigation and high-use operational pages, preserving the verified customer changes.

**Architecture:** Preserve server loaders, permissions, URL-based navigation and existing forms. Add small client components only for accessible disclosure menus, responsive workspace navigation and intake mode selection. Default views expose key information and the primary action; additional details expand on demand.

**Tech Stack:** Next.js 16.3.8, React 19.2.4, TypeScript and Tailwind CSS 4; existing dependency lockfile.

## Global Constraints

- Preserve tenant scope, authorization, validation, action semantics and deep links.
- Keep blockers, errors and the next necessary step visible.
- No new dependencies, database changes, deployment or production communication.
- Invalid required fields inside disclosures must open before focus/validation.
- Menus support keyboard activation, Escape, outside click and clear focus.
- Verify desktop and mobile with synthetic data when authenticated tenants are unavailable.

## Task 1: Compact customer register

Files: `app/admin/customers/page.part-2.tsx`, new customer action disclosure.

- [x] Replace large company/KPI panels with a compact summary.
- [x] Keep search and primary filters visible; move additional filters to labeled native selects in a disclosure, retaining URL state and pagination.
- [x] Group identity/contact/status/contract/process into a compact list with one customer link and secondary navigation in a menu.
- [x] Review permissions and confirm existing register regression tests.

## Task 2: Customer card navigation and summaries

Files: `app/admin/customers/[id]/{page.part-4.tsx,workspaceGroups.ts,layout.tsx}`, `components/admin/customers/{CustomerWorkspaceNav.tsx,CustomerProcessTimeline.tsx}`.

- [x] Group all existing tabs for platform and tenant roles; filter every group by existing visibility rules.
- [x] Keep URL-backed direct links and use native select navigation on mobile.
- [x] Shorten header, overview and process content while preserving status and blockers.
- [x] Verify each existing tab remains reachable and long customer names/contact details wrap.

## Task 3: Contracts and intake

Files: `components/admin/customers/contracts/CustomerContractsCard.tsx`, `components/admin/customers/{CustomerIntakeForm.tsx,CustomerIntakeWorkspace.tsx}`, `app/admin/customers/intake/page.tsx`.

- [x] Show contract summaries first with expandable details and creation forms.
- [x] Separate manual intake and bulk import views; shorten explanatory/context panels.
- [x] Preserve form fields/defaults/actions and expand disclosures containing invalid controls.
- [x] Verify form validation and keyboard/mobile controls with synthetic fixtures.

## Task 4: Review and evidence

- [x] Inspect the whole relevant diff for broken links, hidden blockers, authorization drift and inaccessible controls.
- [x] Run scoped ESLint, application TypeScript and relevant existing customer regressions.
- [x] Run browser interaction checks and record any unavailable authenticated scenario.
- [x] Update the UI checkpoint and `quality/customer-ui/` with exact results and deliver a concise Swedish summary.

## Task 5: Other admin views and shared navigation

- [x] Inventory dashboard, work queue, website applications, support, billing, switches and settings, then record concrete UI issues and chosen changes.
- [x] Restore global navigation on mobile with a permission-filtered page select; compact desktop navigation into expandable groups with correct active destination and preserved intent prefetch.
- [x] Simplify the prioritized page layouts and secondary actions without changing data loading, authorization or action semantics.
- [x] Independently review and verify the expanded diff, accessible interactions and mobile layout. Record exact scope and unavailable authenticated checks.

## Task 6: Remaining operational views and functional verification

- [x] Simplify information requests, facility requests and metering, then outbound, messages/events, pricing/campaigns and users/billing integrations.
- [x] Follow visible buttons through server authorization, domain operations and actual database schema; run only read-only queries on the confirmed OPS production project.
- [x] Exercise meaningful action payloads, isolated database operations and negative permission/company cases without external sends.
- [x] Verify responsive/accessible real component interactions, relevant existing regressions, application types and scoped lint; record exact limits.

Final follow-up evidence: `quality/customer-ui/remaining-admin-verification-2026-10-05.md`. Verified functional fixes include saved customer/company binding and explicit facility read relationships; no schema change or production business write. All authorized UI groups complete locally; authenticated live journeys and publication remain outside executed checks.
