# OPS UI continuation — 2026-09-30

Status: IMPLEMENTED_NOT_RUNTIME_VERIFIED. No whole U01–U20 requirement is accepted by this worker.

Ownership: OPS read-only inventory and isolated company settings page/form/tests. Root owns company-settings/actions.ts, canonical domain/SQL, shared workflow, contracts, memory, publication and final evidence. Other ongoing source changes were preserved. No commit/push, hosted mutation, external message, production-mode toggle or provider call was performed here.

## Skills and source truth

Applied project skills: acquire-codebase-knowledge, code-review, systematic-debugging, test-driven-development, verification-before-completion, web-design-guidelines and relevant React/server-action guidance. AGENTS, active tenantservice recovery sections and masteruppdrag including every U01–U20 meaning were read; original matrix/inventory bytes were not overwritten. Installed Next16.3.8 docs `node_modules/next/dist/docs/01-app/02-guides/forms.md` and `01-app/03-api-reference/01-directives/use-server.md` are authoritative for form/action wiring. Fresh [official Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) were retrieved on 2026-09-30. Underlying Auth/security/SQL repair remains root-owned; full baseline security/static-tool/performance regeneration was outside this isolated UI package. No skill-authorship, hooks, new provider or cosmetic refactor.

## Full OPS denominator, with limits

The preserved initial inventory remains147 pages and3439 lexical UI candidates. The new reproducible AST/import-graph supplement includes every current147 `app/admin` page, its ancestor layouts and1102 reachable source modules. It records5806 page-specific control candidates from3318 reached source controls:2474 fields,1011 form commands,1042 form submissions,22 local actions,1149 navigations and108 unresolved controls. Outputs:

- `ops-ui-pages.jsonl`: every page, reachable graph, source guards and explicit static classification.
- `ops-ui-control-contexts.jsonl.gz`: stable context/action-case IDs, exact component/line/binding, field/resource expressions and unexecuted policy/effect/browser states.
- `ops-ui-inventory-summary.json`: denominator, source hash and explicit limitations.
- `ops-ui-business-action-map.jsonl`:17 manually traced handler families covering settings, navigation and platform users/roles/overrides.

Regenerate with Node22 `node scripts/tenantservice/ops-ui-context-inventory.mjs`; read exact rows with `gzip -dc quality/audits/tenantservice-api-ops-20260928/continuation-20260930/ops-ui-control-contexts.jsonl.gz`. Gzip level9 has zero mtime and retains exact SHA256 hashes for compressed and uncompressed content in the summary; repeated generation must be byte-identical. This deliberately does not rewrite the original147/3439 discovery receipt.

The derivative `node scripts/tenantservice/ops-ui-action-family-inventory.mjs` resolves exact source function declarations, imported/exported aliases, useActionState bindings, bound handlers and statically traversable callsites. Current outputs are323 source handler families (312 resolved,11 unresolved),2047 bound contexts and3759 separate field/navigation/unbound contexts.148 family traces hit a traversal bound;292 contain guard-source calls,291 contain database-source calls,292 contain downstream-effect-source calls, and125 have lexical test references. The three exact gzip files are `ops-ui-handler-families.jsonl.gz`, `ops-ui-control-family-links.jsonl.gz` and `ops-ui-navigation-fields.jsonl.gz`; `ops-ui-handler-summary.json` contains byte hashes and limits. Conditional rendering, inherited URL form-button bindings and dynamic/prop handlers remain explicit source interpretation obligations. A lexical test reference is not execution. Runtime-qualified families remain0/323 and unique semantic business actions remain unknown. Repeated final generation was byte-identical for all four gzip files.

**Unique semantic business-action total remains unknown (`null`); runtime-qualified contexts from this continuation remain0/5806.** A shared control is recorded separately for each reachable page; fields are not business actions; backend-only imports/re-exports/conditional rendering can overcount; dynamic component targets and alias equivalence still need manual interpretation. Every `CASE-OPS-CTX-*` is a stable planned qualification obligation, not an implemented or executed test. Actual customer/support/site/native/browser evidence from other owners must be mapped after it executes; it cannot silently change this static discovery into acceptance.

A supplemental literal `/admin` destination check against current page/route patterns found no missing target among the resolved literal controls. Fragment anchors, dynamic hrefs, authorization, redirects and persisted effects were not thereby verified. Existing analytics/export is a real guarded route; missing page.tsx is not a broken-link finding. No blanket dead-link or keyboard certification follows.

## Reproduced defects and bounded correction

| Finding | Proof before correction | Correction and remaining evidence |
| --- | --- | --- |
| SETTINGS-OUTCOME-DROPPED | Both page wrappers awaited an action then discarded its `{ok,message}`. Two real wrapper/React-tree regressions received `undefined` for action validation/denial. | One shared CompanySettingsForm passes real state, renders safe success/error/pending/read-only, preserves uncontrolled drafts by preventing automatic form reset, captures FormData before disabling, uses synchronous inFlight and disables fieldset while pending. Actual browser/result/persistence required. |
| SETTINGS-ENVIRONMENT-NO-EFFECT | Enabled environment select lacked name while hidden input always posted original value. Regression expected named chosen control, got undefined. | One named control submits selected allowed value. Unapproved state remains disabled and action still independently checks actual production approval; no production environment is exercised. |
| SETTINGS-APPROVAL-DIVERGENCE | UI used legacy `production_status` flags while action used getCompanyProductionStatus. Contradictory-flags regression rendered enabled despite server denial. | UI reads the same authoritative productionApproved source as action. Native fixture remains test-only. |
| SETTINGS-IGNORED-ROLE-CHOICE | Editable membership_role select was posted but action derives membership solely from role_key. | Removed this proven redundant selector; one role choice uses existing canonical mapping. Existing role-change security is not weakened. |
| SETTINGS-READONLY-MISMATCH | Page renders all edits/invitation to users.read actor although action needs tenants.invite/users.write. | Same permission projection disables editing and explains read-only; invitation hidden with reason. Actual server denial proven separately by native test, pending execution. |
| SETTINGS-GLOBAL-IDENTITY | Source trace found Auth/user_profiles writes before canonical company access, potentially modifying identity shared with another tenant. Root independently reproduced and repaired this action with its own6 tests. | This worker aligned UI: identity fields read-only, name/phone unnamed, current email readonly, one company-role action. Own regression initially failed on2 editable posted identity fields and passed after alignment. Genuine shared-user A/B native/browser proof authored. Root owns security acceptance. |

Company settings has no new revision/idempotency owner in this package. Pending/inFlight only suppresses one mounted form's repeated dispatch; it does not prove network retry/cross-session atomicity for company profile changes, invitations or all legacy OPS actions. Failed transport is explicitly unconfirmed and instructs reload. Canonical contact/billing/customer edit work from other owners remains separate.

Existing AdminUnsavedChanges registers company form drafts for native links/unload; accepted discard resets the mounted form and declined navigation retains fields. No browser Back/Forward draft persistence across unmounted company settings is claimed. Failure/error focus and full role-specific responsive behavior remain browser qualification obligations.

Independent read-only review by site worker found no concrete defect in the bounded client form semantics: explicit FormData capture precedes disabled state; manual startTransition avoids React automatic uncontrolled reset; inFlight blocks immediate duplicate dispatch; reset clears dirty state; server still owns environment/authorization. This review is source evidence, not runtime execution.

## Executed local verification

Runtime: explicit `/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node` (Node22). Default Node24 was not used.

- Initial `vitest run __tests__/company-settings-ui-actions.test.ts --reporter=dot`:5 RED assertion failures on the five expected source defects; no setup exception.
- After initial correction:6/6 PASS (includes read-only SSR).
- Added identity-display regression:1 RED /6 PASS; after root security/UI alignment7/7 PASS. An independent reviewer then found stale profile email preferred over actual authEmail:1 RED /7 PASS; named readonly identity field and submitted value now prefer actual Auth email (8/8 own regressions). Native seed deliberately preserves a stale global profile email and compares the unchanged snapshot after the role-only operation.
- Final `vitest run __tests__/company-settings-ui-actions.test.ts __tests__/tenantservice-ui-contract.test.ts __tests__/company-settings-user-identity-boundary.test.ts --reporter=dot`:49/49 PASS in3 files, including the final stale-profile-email regression. These are unit/mock/SSR boundaries; root's6 Auth-boundary tests are included, not authored here.
- Scoped ESLint for page, new client form, owned UI test and separate native test/config:PASS0 errors/warnings. One test-only createElement children-prop lint issue was corrected without changing requirements; duplicate ignored `.test.tsx` prototype removed.
- `tsc --noEmit -p tsconfig.tests.json --incremental false --pretty false`:PASS after required children typing correction.
- `tsc --noEmit -p tsconfig.scripts.json --incremental false --pretty false`:PASS on final native script.
- Browser spec `node --check`:PASS; Playwright `--list`:4 genuine scenarios listed, **0 executed locally**.
- Both AST inventory generators:PASS; repeat final gzip hashes identical; original files untouched. Final owned diff check:PASS.

## Genuine native/browser fixture, authored but not passed

Separate files `scripts/company-settings-browser-native.config.ts`, `scripts/company-settings-browser-native.test.ts` and `e2e/browser/tenantservice-company-settings-local.spec.mjs` require the established disposable CI Supabase API at127.0.0.1:54321 and PostgreSQL54322. Fail-closed config requires CI=true, local native-status keys, private RUNNER_TEMP fixture and newly generated synthetic password. No external browser/database fallback.

Required environment: GRIDEX_NATIVE_STATUS; GRIDEX_SETTINGS_FIXTURE_PATH under RUNNER_TEMP; GRIDEX_SETTINGS_TEST_PASSWORD; GRIDEX_SETTINGS_LOCAL_E2E=1 for browser; GRIDEX_SETTINGS_VERIFY_AFTER_BROWSER=1 only for postcheck. Secrets/fixture must not be published as artifacts.

Native seed creates companies A/B in test only, writer/reader/foreign/shared Auth identities, explicit company permissions and shared target membership in both companies. It checks actual reader RPC denial and unchanged company before emitting `TENANTSERVICE_COMPANY_SETTINGS_SEED_PASS`. Browser cases:

1. Real invalid organization number -> visible error with draft retained -> cancel restores -> double-click sends one invalid attempt -> one valid company-name save -> reload persisted correct value.
2. Reader sees explicit read-only controls/no invitation; mobile/keyboard screenshot.
3. Forged foreign user ID is visibly denied; dirty navigation declined preserves company draft; Cancel restores.
4. Shared Auth email read-only; forged changed email denied; legitimate finance_readonly company-role change succeeds and survives reload.

Post-browser native query verifies company A's persisted name/legal profile, unchanged company B and test environments, unchanged foreign identity/membership, unchanged shared safe Auth/profile snapshot and complete B membership/roles, and A finance_readonly. Shared profile email starts stale deliberately; the UI submits actual Auth email and the global profile remains unchanged. Only then emit `TENANTSERVICE_COMPANY_SETTINGS_NATIVE_PASS`. Screenshot files: tenantservice-company-settings-persisted.png; tenantservice-company-settings-readonly-mobile.png; tenantservice-company-settings-denied-resource.png; tenantservice-company-settings-shared-identity.png.

Local Docker/psql/disposable GoTrue absent: native/browser gate blocked locally, authored tests are not completion. Root owns wiring/execution and exact-head CI/native artifacts.

## Original U01–U20 final disposition from this worker

| Requirement | Current outcome and concrete remaining gate |
| --- | --- |
| U01 | PARTIAL: all147 page graphs enumerated/classified statically. Runtime role/context/domain classification remains incomplete. |
| U02 | BLOCKED_IMPLEMENTATION_SCOPE: unique semantic action denominator/complete action-to-real-test mapping still absent.5806 stable static contexts,323 exact source handler families and17 manual families do not satisfy it. |
| U03 | PARTIAL: corrected settings actions/resources; other family effects and actual persistence/denials need runtime. |
| U04 | PARTIAL: dropped settings outcome repaired; legacy platform user URL banners/remaining success paths not qualified. |
| U05 | PARTIAL: shared settings Save/Cancel/read-only state implemented;4 browser + native postcheck not executed. |
| U06 | PARTIAL: mounted form immediate duplicate guard; canonical/transport/cross-session semantics across full OPS unqualified. |
| U07 | BLOCKED_IMPLEMENTATION_SCOPE: combined search/filter/sort/pagination across all pages has no complete actual test matrix. |
| U08 | PARTIAL: literal targets exist and unsaved links guarded; dynamic links/browser history/cross-tab context require execution. |
| U09 | PARTIAL: settings visibility matches action permission and readonly identity; all role/deep-link/SQL denial matrix remains unqualified. |
| U10 | PARTIAL: native semantic forms/buttons/unsaved prompt; actual menus/dialog focus and all pages not browserverified. |
| U11 | PARTIAL: failure retains fields in shared settings form; actual validation/conflict/focus plus other forms still pending. |
| U12 | PARTIAL: native link/unload draft guard; unmounted company-settings browser history draft scope not implemented/proven. |
| U13 | PARTIAL: mobile/read-only screenshots authored; actual mobile/zoom all central controls pending. |
| U14 | PARTIAL: one settings form shell and canonical role action; full writer/component convergence not established. |
| U15 | PARTIAL: proven ignored membership selector consolidated; full OPS duplicate-purpose classification still absent. |
| U16 | PARTIAL: resolved literal targets exist; placeholders/dynamic targets/108 unresolved control contexts need manual/runtime trace. |
| U17 | BLOCKED_IMPLEMENTATION_SCOPE: actual upload/download/export content, privilege and resource matrix remains incomplete. |
| U18 | PARTIAL: settings pending/errors/readonly/empty/missing-company states; full other pages network/session/blocked states unqualified. |
| U19 | PARTIAL: existing permission-projected nav traced; every technical deep-link plus current-tenant server matrix still needs runtime proof. |
| U20 | BLOCKED_LOCAL_ENVIRONMENT + BLOCKED_IMPLEMENTATION_SCOPE:4 settings scenarios authored; no local native/browser executed and whole5806 context coverage not implemented. |

These dispositions do not supersede another worker's later genuine execution, and are not whole-masterplan terminal acceptance. Root must retain each original meaning and classify actual surviving code/test gaps separately from external deployment/issuer/provider boundaries.
