# User-authorized protected case browser scope repair

Status: local bounded checks PASS; genuine authenticated browser rerun pending. Task base `805599a0beba201dac0369870e63b2bee1676c67`. The user's explicit continuation after the five-round stop authorizes this next concrete test defect; prior history remains, with no budget reset or whole-E035 approval.

Controller evidence: published805599a/run35905197064/native107331020594 passed retained124 and the full new case-native test, including populated-legacy retention and bad-owner rejection. Both protected browser tests then failed strict `locator('main')` ambiguity: the real admin layout renders `main.admin-saas-content` around the route's own main. The first failure was browser test line29 and the second the summary-only Control Tower content assertion. Post-browser and generated-artifact gates were not reached.

Only `e2e/browser/ediel-case-local.spec.mjs` changes. Its helpers now assert exactly one actual admin `main.admin-saas-content` for Control Tower/Support, or exactly one accessible `region` named `Ärendedetaljer` for the Ediel detail view. Source inspection confirms these are existing containers at `app/admin/layout.tsx:80` and the Ediel route's aria-labelled section. Detail headings, intent, description, next action, customer link and real writer form/action/result checks use the named detail region. Support content uses the admin container; Control Tower's actual case link and summary text use that same unique container. Existing whole-page absent source-link/no-case-read link/reader form checks and the foreign-customer body-negative remain unchanged. Real login, exact IDs, status submission, redirects and all other content/tenant/permission assertions remain. No first/last/nth selector, broad replacement body assertion, product UI change or unrelated nested-landmark cleanup was introduced. The existing nested-main semantics are separate from this test-only correction.

Applied previously read systematic-debugging, test-driven-development/writing-good-tests and verification-before-completion guidance. Actual CI supplies the observed RED failure; no protected local execution is claimed.

Executed bounded checks with Node22 `/root/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`:

- `--check e2e/browser/ediel-case-local.spec.mjs`: PASS.
- Playwright `test e2e/browser/ediel-case-local.spec.mjs --config=playwright.config.mjs --project=chromium --list`: PASS, both existing tests discovered (2 tests/1 file).
- ESLint on that browser spec: PASS, zero warnings/errors.
- `git diff --check`: PASS.
- Inspected actual JSX container/region definitions and reviewed every changed assertion against the prior spec. Installed project's Chromium executable and primary runtime Chromium executable are absent. Representative browser DOM/selector execution and genuine login/action verification are therefore NOT locally executed; no broad installation or unrelated test suite was run.

Root owns independent review/publication and ordinary authentic native/browser/post-browser execution plus generated artifacts. This commit contains only the test and this receipt; root memory/review docs remain untouched. No production, published migration, pin/ECR, gate, hosted database, PR310, market send or push change.
