# API/UI save and merge preparation — 2026-10-01

The user now explicitly authorizes committing and merging the current implementation package and asks for a next-chat prompt for remaining work. This supersedes the earlier no-main-merge boundary only for this reviewed package; original75/P0–P8 acceptance, production migrations, live credentials, provider/customer communication and Ediel market activation are not completed by a merge.

## Routing and scope

Activated using-superpowers, finishing-a-development-branch and verification-before-completion for saving/review/integration; systematic-debugging and test-driven-development for the actual CI guard defect; requesting-code-review for independent bounded authorization review. Existing named worktrees provide isolation. Broad feature design, refactor, skill authoring, production infrastructure, unrelated scanners and new provider integrations are outside this save-and-merge task. No new functional masterplan package is imported from the preserved WIP branches here.

## Latest authentic preceding candidate

Source #422 head1d8fa083606b811c090d74a6eba31767e18d10a8, treee48d2412b2bb626f49e833f6193e59c5e4da6d69, OPS36874763327. Verify, quality-release-gates (7721 ordinary tests/532 files plus build), upgrade/actual backup/restore, pinned-old rollback and fresh-old backfill PASS. FullE2E smoke/coverage/certificate, tenant/Ediel/public browser PASS; full/staging/nightly SKIPPED. Purchase15 and account4 now genuinely PASS, including real sessions, revocation, overlap and late-write rollback. Purchase catalog prerequisites are corrected; do not restart the obsolete loader/P0001 repairs.

The clean replay first fails the private agreement browser. Authentic web logs show /login200, /dashboard200 after successful login, then /admin/agreements/grid-owners307 followed by /dashboard200. Safe snapshots show routefalse/heading0/form0/select0 before and after the unchanged selection timeout. Browser later phases and following suites are NOT_REACHED. Artifact11168509891 ZIP SHA2567d43911b0cdeb1a885ce0c99061e2156d5747198a900a438dda647cc18e19491 preserves the limited diagnostic. No raw Auth/session/body/URL or real customer data is copied here.

## Reproduced guard root cause and bounded correction

The unchanged native seed grants its genuine active actor through admin_users only. canonical_actor_is_platform_admin explicitly accepts that global grant; canonical_authenticated_tenant_context returns is_platform_admin=true, roles=[], permissions=[]. loadBaseAdminContext derived isAdmin only from the separate lists, so requireAdminAccess redirects a database-approved global admin to /login; the authenticated login proxy then returns the dashboard. Earlier page mocks projected an extra platform_admin role and missed the real shape.

Fresh Node22 RED for actual guards:12 cases,5 expected positive failures and7 retained denial controls PASS. The exact Next /login redirect and Unauthorized/action denial reproduce before production changes. Minimal fix ORs the authoritative current authenticated database flag into isAdmin. The existing company permission/role path and customer-only exclusion still apply to nonplatform contexts. No grant, SQL, migration, seed, selector, timeout, native assertion, provider behavior, schema/type artifact, dependency or workflow is changed.

Fresh Node22 GREEN12/12 and retained current-company29/29 =41/41 PASS; app TypeScript4GiB, tests TypeScript4GiB PASS (initial1.5GiB setup OOM retained), scoped ESLint and git diff --check PASS. Independent bounded reviewer /root/merge_guard_review reports no blocking finding, ready for CI; no whole-PR or masterplan certification. Changed-head actual browser and all subsequent native/HTTP/CI remain required before merge. A local guard test does not certify a browser or the entire API/UI masterplan.

## Preserved work

All seven dirty worktrees are committed and remotely preserved as WIP-only snapshots. worktree-save-publication-20261001.json records each file SHA256, exact tree, local commit and remote branch/commit. Trees match the corresponding remote trees exactly. These branches are continuation input, not automatically accepted or ready to merge. Older account/purchase/admin source is partly integrated already; compare semantically, never replay whole old trees onto current source.

The current #422 base remains #418/ae56. Review and require applicable genuine CI before integrating the stacked PRs into main. Keep every historical failure and remaining original requirement open until its own complete acceptance is demonstrated.

## Independent review scope and separate remaining read path

The read-only reviewer confirms the authenticated canonical SQL flag, affected Page/Layout, unchanged native admin_users-only seed and /login-to-dashboard proxy branch. The customer-only denial now explicitly carries a nonempty customers.read permission, retaining the existing exclusion. Bounded review does not certify every original75 surface or the entire895-file PR.

A separate inherited path remains OPEN: proxy platform-route checks and lib/tenant/scope.ts still call gridex_get_user_roles, while that exact function name is absent from the tracked canonical schema. Follow its genuine reachability and HTTP/native behavior in the next API/UI package; no broader role-policy redesign or guessed SQL forward is bundled into this correction.
