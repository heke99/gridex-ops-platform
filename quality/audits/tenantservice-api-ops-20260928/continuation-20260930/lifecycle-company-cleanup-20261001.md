# Lifecycle company cleanup — bounded actual-source PostgreSQL verification

Only the new `scripts/lifecycle-company-cleanup-20261001.postgres.test.cjs` and this report are owned here. Root owns the native fixture correction, shared memory, generated files, workflow, index and publication. No native/Auth/provider execution, grant/role alteration, historical migration edit, trigger removal or published-status downgrade occurred in this verifier.

## Genuine failure and bounded causal reproduction

Published #422 head `0778df202b8b46d4ae92a51ffcc24cc25176edaa`, actual checkout `4b699b7db45b8a4098e7da7e0ed122b8ea80b113`, tree `61964676807b680d8133496c4b9cd6bd68cc444a`: OPS run `36843544066`, clean job `110308120604`, recorded three terminal source-binding failures at `lifecycle_cleanup_companies`, SQLSTATE `P0001`. Three business-body checkpoints appeared before the failed afterEach cleanup; they do not turn those three failed tests into PASS. The authentic underlying private primary database message is NOT_AVAILABLE in the retained artifact, so it is not attributed from CI text.

Fresh local PostgreSQL-core reproduction executes the exact company DELETE against the actual extracted company/legal table CREATE clauses, eleven PK/unique/FK clauses, five functions and two enabled triggers. Company INSERT invokes `companies_seed_default_legal_package`, which calls the actual seed functions and produces five published legal texts plus a bundle and five bundle items per tenant. `legal_text_versions_company_id_fkey` has `ON DELETE CASCADE`; the actual `legal_text_versions_immutable_when_published` BEFORE DELETE/UPDATE trigger then rejects the cascading published-text deletion with `P0001`.

The local rejection matches the exact fixed source literal in `gridex_prevent_published_legal_text_mutation`: “Published legal text versions cannot be deleted. Archive by publishing a new version instead.” The complete local parent/legal/mutable graph hash is unchanged after the failed company DELETE. This establishes the bounded causal chain from actual source. It does not recover the unavailable authentic CI primary message or claim complete schema/role qualification.

## Root correction independently reviewed

Root replaces only the final company DELETE with a readonly count assertion requiring two retained parents and zero owned decisions/cases/contracts/customers, plus equality of `retainedCompanyLegalGraph()` before/after. Existing quiet-tenant equality, owned fault cleanup and four owned mutable DELETE statements remain. Both companies and their automatically published legal graph remain until disposable stack destruction.

This verifier extracts actual `proofSql` templates and the actual count expectation from the native afterEach callback via the TypeScript AST. It separately extracts and executes the actual `retainedCompanyLegalGraph()` readonly SELECT before/after; it never imports or executes the native module. Independent PostgreSQL-side complete/global/foreign digests provide an additional check.

The three business `it` bodies are byte-identical to published 0778: 3,147 bytes from `it('actual PostgREST` through EOF, SHA256 `735e4148e2133f1e28712003b44ae968f9850c7ccd1b12119dc10fa925f6cf2a`. Root's corrected native file is 9,528 bytes, Git blob `23bb08cd60d4dd13287f20fac868a949b0a9329f`, SHA256 `6e4a747dc82f26a47f9bd7a0e4e87c6ccd853e1ff37e2e08af0045c1338f9440`. Published baseline is 7,520 bytes, Git blob `d3df5e9f8ffc12496fa0f1617dd137c3649307af`, SHA256 `607e333c78468b75249fa10d744b31c689c1ea5ec4c7b8f42943e68de8c35109`.

## Fresh executed evidence

Node `v22.23.3`, PGlite available through `NODE_PATH=/tmp/ediel-service-check/node_modules`.

| Check | Actual result | Limit |
| --- | --- | --- |
| Pre-correction exact native cleanup SQL | RED: 4/5 controls passed; actual expected-success corridor failed `lifecycle_cleanup_companies/P0001`, 35.811 s | Run completed before root edited the native file |
| Corrected actual cleanup plus expanded controls | GREEN: 8/8 PASS, 44.228 s | PostgreSQL core only; no native stack execution |
| Exact actual seed path | Five published texts, one bundle/five items per company; controlled three-company fixture produces 15/3/15 | Controlled published platform templates; no real customer/template data |
| Failed old company DELETE | `P0001`, exact fixed guard match, complete graph unchanged | Local causal reproduction; authentic CI primary message remains unavailable |
| Corrected actual count/hash oracles | Owned mutable rows zero, parents two, retained actual-helper output equal, global legal/parent and complete foreign digests unchanged | Four mutable tables are typed controlled canaries, not full production DDL/triggers |
| Missing customer DELETE control | Exact actual remaining-count SELECT returns customers=2; actual expected zero object rejects it | Does not waive cleanup cardinality |
| Missing selected-parent control | Actual readonly helper bound to a nonexistent owned ID changes parent/legal hashes and rejects baseline equality | Readback-selection control; protected parent was not physically deleted |
| Changed legal metadata control | Exact full-row helper detects change; all five owned legal texts remain published; company DELETE stays `P0001` | No status downgrade or immutable-content bypass |
| Direct published DELETE/content UPDATE controls | Both remain fatal `P0001`; complete graph unchanged | Fresh owned local business canaries only |
| CJS syntax | PASS | Source check |
| Explicit scoped CommonJS lint | PASS with `--no-ignore --rule '@typescript-eslint/no-require-imports: off'` | Default repo lint ignores CJS; forcing it without the CommonJS import exception reports seven require-style errors. Default lint PASS is not claimed |

Commands:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/lifecycle-company-cleanup-20261001.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node --check scripts/lifecycle-company-cleanup-20261001.postgres.test.cjs
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js --no-ignore --rule '@typescript-eslint/no-require-imports: off' scripts/lifecycle-company-cleanup-20261001.postgres.test.cjs --max-warnings 0
```

## Exact source receipt and scope

Canonical schema is the genuine 31-forward snapshot already adopted from CI: SHA256 `ac510feadf9cd4b7cc5009e92f92b54c5ea5209732c426a83558859b8cdfd39a`. The 23 extracted actual legal-chain fragments have combined SHA256 `fc2df55a83a2655f3e31636126dd138e5fd11fabb5e5ea7457cd5fb8fcb1e5bf`; that hash is unchanged between RED and GREEN. Tables: companies, platform_default_legal_templates, legal_text_versions, legal_bundles, legal_bundle_items. Functions: company default normalization/reference helpers, both actual seed functions, published legal-text mutation guard. Actual company seed and published-text immutability triggers remain enabled.

The four mutable canary tables deliberately cover only the columns/relationships needed to execute the cleanup templates. Other company/customer/correction-process triggers, actual Auth foreign keys, RLS/ACL, service identities and the complete physical Supabase schema are not installed or qualified. No Auth schema or roles are created, and no native imports or provider clients run. PostgreSQL calculates full-row JSON digests before JavaScript sees only hashes/counts. Unexpected backend errors are projected to fixed core stage/SQLSTATE fields; raw query/error contexts are not printed.

Owned CJS receipt: 16,673 bytes, Git blob `b4cfca49a33e4c3f31dd7475003e8b57b2e8197c`, SHA256 `7021a8e89f8e944b6c3bf7308c1c8002620cfe0b6b75732c0d411f58592f2c98`. This report's own hash is supplied separately. No commit, index mutation, publication or freeze was performed here.

Skill routing: systematic-debugging used actual FK/trigger/source flow rather than guessing from `P0001`; test-driven-development required observed old-source RED before the root correction; verification-before-completion required fresh actual-helper GREEN and business-body byte preservation. PostgreSQL guidance applies to statement rollback and cascades. No UI, provider, general authorization/privilege or full audit exercise was invoked. Root alone maintains shared project memory.

Next: root runs its broader scoped gates, captures the material correction and publishes through the existing #422 workflow. Corrected full native execution remains zero until that new authentic CI. The three historical native tests remain FAILED and subsequent original stages remain NOT_REACHED for 0778.
