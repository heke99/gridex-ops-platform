# Broader admin UI verification — 2026-10-05

The user extended the customer UI task to other system areas. This round simplifies seven daily admin areas and shared navigation. The previously verified customer register, customer card, contracts and intake changes remain in the local diff. No commit, publication or production writes were made.

## Inventory and resulting behavior

| Area | Observed problem | Result |
| --- | --- | --- |
| Shared navigation | Sidebar hidden on mobile without replacement; long header and descriptions on every link | Permission-filtered mobile page select; compact desktop groups; most-specific active destination; preserved view/company controls and intent prefetch |
| Dashboard | Large statistics and repeated information cards | Two-column mobile statistics; compact summaries; extra information expandable; warnings and unavailable counts remain visible |
| Work queue | Six columns and exposed internal identifiers | Four grouped columns; stacked mobile rows; identifiers expandable; original priorities, status, descriptions and action links retained |
| Support | Five status buttons per case; long description and creation form | Explicit status select and save; expandable description/new case form; customer/phone defaults and idempotency retained |
| Website applications | Eight-column table and wide inline workspace; six filter links | Responsive application cards with visible missing fields/next steps; status select; full-width expandable review form; secondary form actions in menu |
| Supplier switches | Permanent status editor and many actions per card | Compact summaries; details/status editor expandable; secondary actions in menu; readiness blockers/failures and ready-only completion visible |
| Billing | Three download links per file and long file history | Expandable history and download menu preserving CSV/Excel/JSON URLs; responsive invoice rows; send consequence and invoice blockers visible |
| Company settings | Long combined profile and user editor | Six expandable profile sections; user editors expandable; legal deficiencies and go-live limitation visible; section anchors honor sticky header |

`AdminActionsMenu` and `AdminDisclosurePanel` now live under `components/admin/ui`. Customer imports re-export them for compatibility. Shared layout provides mobile navigation, a keyboard skip link and a 260 px desktop sidebar with a flexible content column.

## Independent review

Root reviewed the implementation independently of the UI agent. The data-loading/guard/scope portions before the rendered UI are unchanged across all seven pages and the shared layout. The action-binding sets are unchanged; no named form field was removed. Website filtering adds only its GET `status` control. Exact comparison evidence is in `admin-presentation-scope-proof.json`; the verified source hashes are in `admin-final-source-sha256.json`.

Review found that an unavailable dashboard count could be hidden among expandable information because it used a normal tone. The final implementation keeps `Kunde inte hämtas (...)` values visible and marks them as errors. A browser fixture exercises that failure path.

## Verification

- Application TypeScript: Node 22.23.3, exit 0.
- Scoped ESLint: 29 TS/TSX files, exit 0; ten inherited unused-variable warnings on the customer overview. Final touched-file checks also exit 0.
- Vitest: **21 files / 155 tests pass**, exit 0, two workers and a 15-second CLI timeout; selected files cover customer navigation/scoping, registry loading, contract selection, dashboard loading, support isolation/conversations, invoice export/readiness and website/operations boundaries.
- `git diff --check`: exit 0.
- Browser: six shared navigation scenarios and fourteen admin interaction scenarios pass, including explicit status choice, tenant/form payload preservation, ready-only switch completion, download formats, closed-section validation, hash navigation and visible count failures. The original eighteen customer interaction scenarios were rerun successfully after generalizing the components.
- Layout: 56 states (seven pages × four widths × default/expanded) pass without horizontal page overflow. Widths: 320, 390, 1024 and 1280 px; desktop cases include the sidebar/content columns.
- Axe WCAG 2/2.1 A/AA: zero violations in 32 admin states (eight views × mobile/desktop × default/expanded), plus zero violations in the four customer fixture views. Contrast checks wait for the existing entry animation to finish.

Some consolidated test attempts hit the existing 5-second timeout while importing the support modules. One overloaded attempt also reported a later support assertion. The final check passes all unchanged assertions using two workers and a 15-second per-test timeout; no test-source or application changes were made to address the timing. Attempts and final outcome are retained in the evidence logs.

## Browser scope and limits

The seven page trees are generated from the actual async server page functions with mocked loaders and synthetic data. The browser renders their real client menu/disclosure components and native forms. Router and server actions are stubbed; submissions capture the action name and FormData without writing data. `CompanyUserInviteForm` is a fixture placeholder, so invite submission is not verified. Registry evidence uses the existing real-page render fixture. The temporary harness is in `/tmp/gridex-ui-browser`; fixture source and interaction scripts are retained as text snapshots in this directory.

Authenticated tenant journeys, production builds and deployment were not run. No tenant credentials are configured. This is UI verification of the listed areas, not a complete audit of every technical, Ediel, pricing or platform page. The four pre-existing static smoke failures documented in `verification-2026-10-05.md` remain outside this presentation change.

Evidence: `admin-results.json`, `navigation-results.json`, `admin-layout-results.json`, `admin-axe-results.json`, customer scenario JSONs, scoped logs, source proof/hashes, and synthetic screenshots. Use normal review/release steps when publication is requested.
