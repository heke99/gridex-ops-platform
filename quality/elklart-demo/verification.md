# Latest runtime continuation — 2026-11-11

**The full system demo is not complete.** Current actual results and local links are in [runtime-verification.json](runtime-verification.json), [runtime-links.md](runtime-links.md), and the [operations runbook](../../docs/elklart-runtime-operations.md).

- Both separate local Supabase stacks and HTTPS applications run. No shared staging or production writes; Web schema-only export had explicit user approval. Captures/keys/passwords remain private outside Git.
- Actual portal registration/fresh login and canonical customer assertion registration/enforcement/signing passed. Local Auth auto-confirm is enabled; no confirmation-email journey is claimed.
- Ordinary BRP/routes, simulated sender verification, template/rule setup, legal profile/offer/channel publication, Capway TEST selection and a real OPS→local-provider Ping passed. These are configuration and provider-simulation results, not a published customer invoice or external market certification.
- Actual Karin staff case/call/internal note/public reply passed. Invoice relationship and public projection/internal-note exclusion remain unverified because portal reads stop at `organization_onboarding`.
- Actual four-account Auth/RLS matrix passed with own reads, same-session positive UPDATE controls for writers, cross-tenant read/write/context denial, support own-write denial and anonymous denial. Actual customer intake first refused the old wrong-tenant fallback; canonical control membership and subsequent ordinary intake wrote the exact intended tenant. Manual/bulk/preview/commit now bind rendered, canonical and operational company before side effects. A fictional tenant-owned network draft was also created through the ordinary UI; it is not source/market verified.
- Real full `foundation-qualified-v3-20261111` reset passed across 12 containers/four persistent volumes and matching private host state: deleted Auth identities/documents returned, post-baseline document disappeared in both projects. All 23 private functions ×17 captured properties and normalized ACLs match after restore. Earlier snapshots are retired: Storage xattrs were initially lost, BusyBox could not preserve them, and the original helper renderer misquoted multi-schema `search_path`. These failures led to a provenance-pinned scratch GNU tar helper and exact raw GUC transfer/readback.
- Final checks: 180 focused Vitest tests across20 files;53 Python tests;6 SMTP/DSO Node tests;17 Web Node tests; application/test TypeScript, scoped ESLint and both production webpack builds passed. Unit/mock/provider tests are distinct from the actual sessions above. Host POSIX ACL support is not claimed from the temporary-filesystem test; actual Storage attributes were verified in the immutable helper and full live reset.
- Two independent final reviewers checked runtime and flow changes, including fixes found during review. Exact source hashes are retained in [runtime-reviewed-files.sha256](runtime-reviewed-files.sha256). No merge, production deployment or certification collection was performed.

Remaining: a supported isolated demo activation lane or genuine external qualification, Anna/Samir/Sjövik/Bergdala/Jonas ordinary end-to-end flows, customer invoice publication, full customer-portal isolation/visibility, prepared persona start/final fallback states, and **two presentation rehearsals (0/2)**. Fresh empty-stack schema replay has not been rehearsed; current-stack exact completion and physical full restore have passed. The user has a pending choice about an explicit local demo lane with unchanged production protections. No fake certification approvals or forced active status were inserted.

# Earlier portfolio continuation verification — 2026-11-10

Scope: read-only supply-aware portfolio on PR1048. Source base266537758. No production changes, migrations or external messages.

## Passed

- Node22.23.4 targeted Vitest: five files, 21 tests. Covers supply boundaries, plan/confirmation, cancellation, current corrections, missing versus zero, overlapping readings, scope mismatches, DST92/100, manifest validation, API pagination including500-row caps, exact counts, authenticated company/customer/point query filters, wrong host/company rejection before loader, setup and read-error states, and real page rendering.
- Application TypeScript and full Next16.4.2 webpack production build passed under Node22. The build includes `/admin/elklart-demo/ops-portfolio`.
- Scoped ESLint and `git diff --check` passed.
- Chromium actual server-page HTML fixture with the real stylesheet:1440x1000 and390x844, interval selector interaction passed, no document overflow, no page errors, zero axe WCAG A/AA violations. Screenshots and browser.json retained here. Authenticated loader is stubbed for this browser boundary; this does not prove tenant RLS or live navigation/data refresh. Initial browser harness failures (strict text selector; axe requiring explicit context) were corrected and final run passed.
- Two independent read-only subagents (`review_data`, `review_ui`) re-reviewed the final implementation. Both report no remaining concrete defects. Their findings led to the zero-overlap reading guard, exact-count pagination, configured-customer filtering and mobile quarter selector. Reviewed source/test hashes are in `reviewed-files.sha256`.

## Limits and blockers

- Standalone TypeScript with default heap exhausted memory. Retried using Node22 with `--max-old-space-size=6144`: test typecheck passed after narrowing the config helper input to the three optional environment fields it reads. This also corrects the inherited PR tests' TS2345 errors from Next's required ProcessEnv.NODE_ENV augmentation. Both reviewers checked the type-only correction.
- No dedicated Elklart Supabase project found in the relevant linked OPS and Web accounts. Vercel search for demo found no project. Existing staging not assumed disposable. Asked user for isolated project targets; new billed projects need organization selection/cost confirmation.
- No real Supabase session or demo bindings available to execute live RLS queries. No actual portal-to-OPS signup, network-owner response, invoice publication, role login matrix, whole-environment reset or two rehearsals executed.
- Forecast and purchase volumes remain prepared demo assumptions. Supply eligibility and current measured consumption are read from OPS when deployed/configured. This is not a replacement for ordinary monthly forecasting or billing.
- Full uploaded plan remains incomplete pending isolated infrastructure and real scenario acceptance. Web PR66 was inspected and preserved without changes.
