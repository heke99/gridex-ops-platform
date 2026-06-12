# Gridex OPS Batch A–G patch

Scope implemented against the uploaded zip:

- Batch A: customer card UX/language cleanup, customer-friendly labels, archived-state handling.
- Batch B: audit/usage mirroring for important lifecycle, archive, delete-test, switch and actor verification actions.
- Batch C: archive, withdrawal/cancel flow, billing block, switch cancellation, safe test-customer deletion usage event.
- Batch D/E: customer intake/customer list labels, filters, missing-data language, grid-owner verification visibility.
- Batch F/G: actor/grid-owner register language, import/verification usage logging, contact/route verification visibility.
- Support/customer-case UI scope is redirected out of OPS; operational follow-up now uses customer_operation_tasks in touched flows.

Verification run locally:

- npx tsc -p tsconfig.changed.json --pretty false: PASS on changed files
- npx eslint <changed files>: PASS with 0 errors
- npm run gridex:customer-intake-regression: PASS
- npm run gridex:actor-registry-intake-hardening-regression: PASS
- npm run gridex:ui-db-mismatch-regression: PASS
- npm run gridex:external-contract-intake-regression: PASS
- npm run gridex:company-statistics-regression: PASS

Known environment/baseline notes:

- Full `npm run build` did not complete in this sandbox before timeout; the same happened on a clean extraction of the uploaded zip before applying this patch, so this was not introduced by the patch.
- Full `npm run security:rbac` already fails on a clean extraction because the existing review-list does not include several admin files using supabaseService. This patch did not introduce that baseline failure.
