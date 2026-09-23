### Spec Compliance

- ✅ **SPEC compliant; strict main ambiguity ADDRESSED statically** for BASE `805599a0beba201dac0369870e63b2bee1676c67` → HEAD `b1599548ce7cdeb4e59f3703c991da55c65f4644`. Ambiguous generic-main assertions now use the existing unique admin content container or exact named detail region, with explicit uniqueness checks (`e2e/browser/ediel-case-local.spec.mjs:21–31,36–58,69–86`).
- ✅ All original content, href, exact-case navigation, foreign-tenant 404/body-negative, no-case-read redirect/link-negative, reader form-negative, real login and writer status/action/result assertions remain. Scope is narrowed to the intended content rather than selecting an arbitrary match; no first/last/nth workaround is added (`e2e/browser/ediel-case-local.spec.mjs:13–19,33–95`; supplied complete diff).
- ✅ The only changed files are the browser spec and receipt. No product UI, production behavior, SQL, migration, native/post-browser gate or infrastructure configuration changes appear in the supplied diff (`quality/audits/ediel-masterplan-v2/e035-source-ledger/case-browser-scope-repair-20260923.md:7,19`).
- ⚠️ **Protected browser and final native acceptance remain pending.** The receipt explicitly reports syntax/discovery/lint checks and no local DOM or authenticated browser execution (`quality/audits/ediel-masterplan-v2/e035-source-ledger/case-browser-scope-repair-20260923.md:11–19`). Root's actual CI must qualify browser actions, post-browser persistence/invariants and generated artifacts; this static review does not reset previous repair history or establish whole-E035 acceptance.

### Strengths

- ✅ Both helper functions require exactly one intended scope, so duplicate containers still fail explicitly rather than silently choosing an element (`e2e/browser/ediel-case-local.spec.mjs:21–31`).
- ✅ Ediel details use an exact accessible region name; the route places the selected heading, description, next action, customer link, status form and event history inside that existing region (`e2e/browser/ediel-case-local.spec.mjs:27–31,41–47,80–86`; `app/admin/ediel/operational-cases/page.tsx:83–94`).
- ✅ Permission and information-leak negatives that must cover the whole page remain whole-page checks, including absent source/customer-case links, absent reader form and foreign description (`e2e/browser/ediel-case-local.spec.mjs:48,59–61,71–73,92–94`).

### Issues

#### Critical (Must Fix)

- None identified.

#### Important (Should Fix)

- None identified in the bounded correction.

#### Minor (Nice to Have)

- None introduced by this diff. Existing nested-main markup is outside the authorized test correction and remains unchanged (`app/admin/layout.tsx:80`; `app/admin/ediel/operational-cases/page.tsx:76,95`).

### Assessment

- **Task quality: Approved statically. Main ambiguity: ADDRESSED.** Selectors now identify the intended existing containers while preserving the real workflow and all retained assertions. Final runtime acceptance remains Root's actual CI gate.
- **Focused selector-contract check:** inspected only the existing admin container at `app/admin/layout.tsx:80` and the relevant Ediel route JSX at `app/admin/ediel/operational-cases/page.tsx:76–95` to resolve the concrete risk that newly scoped content/form/event assertions might sit outside the named region. All scoped Ediel targets are inside it.
- **Review checks:** read the supplied task brief, report and full diff; compared every changed assertion. No tests rerun, source edits, git-state mutations or hosted actions; only this requested report was written.
