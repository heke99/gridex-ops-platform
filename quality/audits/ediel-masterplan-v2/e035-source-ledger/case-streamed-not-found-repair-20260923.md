# User-authorized streamed not-found browser assertion repair

Status: bounded local checks PASS; actual protected-browser rerun remains pending. Task base `7555066d98b0acdb7c64bc888f33b9dcb78a117e`. This follows the user's explicit best-action continuation authorization, preserving the original five-round history without a budget reset or merge-readiness claim.

Controller evidence: run35906409888/native107335097956 passes retained124 plus the entire new case-native test. Protected browser test2 now passes the real writer action, reader and no-case-read flows. Test1 passes its normal detail, old exact-ID and Support assertions, then fails solely at the foreign-ID navigation's strict HTTP404 expectation because the received status is200. Post-browser and generated-artifact gates remain pending.

Installed Next16.3.5 documentary evidence:

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`, `not-found.js` opening paragraph: streamed notFound responses use200; nonstreamed responses use404.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md`, opening behavior and “Calling notFound() after streaming has started”: the404 fallback exception terminates segment rendering and injects noindex; already-streamed response status cannot change.
- `node_modules/next/dist/client/components/builtin/not-found.js` supplies status404 and `This page could not be found.` to `http-access-fallback/error-fallback.js`, which renders h1/h2. The installed `http-access-fallback/error-boundary.js` emits `<meta name="robots" content="noindex">`. This application has no custom app not-found override.

Confirmed actual route behavior remains intact: `getCustomerCaseById(requestedId, companyId)` applies tenant scope; missing/non-Ediel selected case calls notFound before event/list/reference reads or selected-case rendering. Existing authorization-denial unit coverage remains unchanged.

Only the foreign-ID assertion block in `e2e/browser/ediel-case-local.spec.mjs` changes. Documented status200/404 is accepted only alongside the exact requested Ediel foreign-ID URL, visible default404 heading and exact not-found message, and a noindex marker. It additionally requires no case-detail region, status select/save action, customer/source links, foreign description/title/next action/customer UUID/source UUID. Existing whole-body foreign-description assertion remains. Generic200, login redirects or generic error fallback cannot satisfy this combined boundary. All other content, link, tenant, permission, real login and status assertions remain unchanged. No product, proxy, schema, migration, generated artifacts or gates were changed.

Applied previously read systematic-debugging, test-driven-development/writing-good-tests and verification-before-completion guidance. Actual ordinary CI provides the observed status-assumption failure; no protected local browser result is claimed.

Executed bounded checks with Node22 `/root/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`:

- Node `--check` on the browser spec: PASS.
- Playwright `--list` for this spec and chromium project: PASS, both existing tests discovered (2/1).
- ESLint for this spec: PASS, zero warnings/errors.
- Rendered the actual installed Next builtin not-found component using ReactDOM server and verified its404 h1/exact message h2: PASS. This confirms UI contract only, not browser/streaming behavior.
- Retained `__tests__/ediel-operational-case-route.test.ts`: **7/7 PASS**, including cross-company/non-Ediel denial before events/references.
- `git diff --check`: PASS.

Chromium remains unavailable locally; real navigation/noindex/streamed-boundary assertions, post-browser verification and generated-contract reconciliation are unexecuted locally. Root must publish and run ordinary native/browser/post-browser gates. This commit contains only the browser test and this receipt. Root memory/review work and unrelated production findings remain untouched; no hosted action, market communication, PR310 change or push.
