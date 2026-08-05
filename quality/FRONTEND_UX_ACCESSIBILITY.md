# Gridex OPS — Frontend, UX and Accessibility

## Scope and status

Overall status: `partially_fixed` for documentation visibility; runtime accessibility validation remains `blocked`.

The audit reviewed representative Next.js layout/components and repository-wide search results. It did not run a browser, screen reader, axe, Lighthouse or full Playwright accessibility suite, so no WCAG conformance claim is made.

## Verified strengths

| Control | Evidence | Status |
|---|---|---|
| Document language | root layout renders `<html lang="sv">` | `verified` |
| Focus visibility | shared button styling includes `focus-visible` ring behavior | `verified` |
| Accessible naming | many interactive controls provide `aria-label` in inspected/searchable sources | `verified` |
| Server/client structure | project uses Next.js App Router and explicit client components | `verified` |
| User-facing error boundary discipline | inspected API helper keeps internal 500 details generic; UI behavior still requires browser verification | `verified` for API, `unverified` for all UI surfaces |
| Authorization boundary | existing audit treats UI visibility as insufficient and verifies server-side permissions separately | `verified` in reviewed backend paths |

## Gaps and observations

### UX-001 — No verified global skip link

- Severity: `Low`
- Status: `unverified`
- Category: keyboard navigation/accessibility
- Evidence: repository search did not find an established skip-link pattern or matching “skip to content” text; root layout contains no visible skip link.
- Expected behavior: keyboard users should be able to bypass repeated navigation to the main content region.
- Impact: possible increased keyboard navigation effort; no complete runtime reproduction was performed.
- Safest next step: add a visually-hidden/focus-visible skip link only after confirming the shell's stable main-content ID across authenticated and public layouts.
- Verification: keyboard test in representative pages plus automated accessibility scan.

This observation is not added to the central severity totals until a complete shell/runtime check confirms the absence across all layouts.

### UX-002 — Automated accessibility gate is not proven

- Severity: `Low`
- Status: `blocked`
- Category: CI/test coverage
- Evidence: the inspected hardening workflow does not run axe, Lighthouse or an accessibility-focused Playwright command.
- Expected behavior: critical user journeys should receive reproducible keyboard/name/role/state checks in CI.
- Blocker: no repository-approved accessibility command/fixture was identified and deployed authenticated test data is unavailable.
- Safest next step: add focused Playwright + axe coverage using non-production fixtures after the test environment is documented.

### UX-003 — Runtime responsive and state handling remains unverified

- Severity: `Low`
- Status: `blocked`
- Areas:
  - responsive layouts and overflow,
  - loading and empty states,
  - failed mutation retry behavior,
  - focus management after dialogs/navigation/errors,
  - screen-reader announcements,
  - color contrast,
  - reduced-motion behavior.
- Blocker: connector-backed source inspection cannot reproduce browser layout, computed contrast or assistive-technology behavior.

## Security boundary

The following were explicitly not accepted as authorization evidence:

- hidden menu items,
- role-based rendering,
- disabled buttons,
- client-side route guards.

Authorization must continue to be enforced in server routes/actions and database policies. No UI change was made that weakens those controls.

## User-facing language

The project is primarily Swedish and the root language metadata matches that. Internal error codes, request IDs and technical diagnostics may be appropriate in operator/admin views, but should not replace clear next-action text in customer-facing flows. A comprehensive copy review remains `blocked` without running all user journeys.

## Verification matrix

| Check | Result | Status |
|---|---|---|
| Static root language inspection | Swedish language declared | `verified` |
| Static focus-style inspection | shared focus-visible behavior found | `verified` |
| Static accessible-name sampling | multiple `aria-label` usages found | `verified` |
| Global skip-link presence | not found in inspected shell/search | `unverified` |
| Keyboard-only navigation | not run | `blocked` |
| Screen reader | not run | `blocked` |
| Automated axe scan | not run | `blocked` |
| Lighthouse accessibility | not run | `blocked` |
| Responsive viewport matrix | not run | `blocked` |
| Authenticated role/tenant UI E2E | not run | `blocked` |

## Recommended next steps

1. Establish a non-production authenticated Playwright fixture for at least super-admin, tenant admin and restricted user.
2. Add keyboard and accessible-name assertions for navigation, dialogs, forms and destructive actions.
3. Add axe scans to a small set of stable critical pages before expanding coverage.
4. Confirm the application shell's main landmark and add a skip link if the runtime audit confirms it is absent.
5. Keep server authorization tests separate from UI visibility tests.
