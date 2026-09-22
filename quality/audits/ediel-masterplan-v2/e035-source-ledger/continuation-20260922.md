# E035 continuation from PR370

Baseline verified directly: PR370 OPEN/DRAFT at 92d4980e5f1e068a3d33826f4ef75d086bfaf714;
main eb2b8693130af8fa7976a93891b95973bc473b50; PR310 remains OPEN/DRAFT/PAUSED
e961135199f292b8210884f07de3b616a670161a. Clean isolated clone reproduces tree
b19587747eff6be6bc744c4954e7d815b62cc30c. Older working trees were left untouched.

## Skill routing

Using repository operating contract, writing/executing plans, test-driven development,
requesting-code-review, verification-before-completion, and Supabase/Postgres security
and migration guidance. Independent owner mapping and register-facet implementation
are bounded workstreams under the repository skills. Full quality-playbook/codebase
bootstrap, UI/React design, performance optimization, hooks and deployment are not this
feature task. Review the task's tenant boundaries and requirements, without claiming
a repository-wide security audit. Existing user authorization covers implementation,
publication and conditional merge; no additional permission checkpoint is introduced.

## Actual baseline verification

OPS35719151591: verify, quality-release-gates and clean-migration-replay SUCCESS.
Tenant35719151325 and Ediel35719151404 SUCCESS. Browser35719151400: public SUCCESS;
staging browser/ZAP/load/soak/certificate SKIPPED. Full35719151374: coverage/smoke/PR
certificate SUCCESS; real-customer/runtime/full/nightly staging SKIPPED.
Production crawler35719151370 SKIPPED. These results cover 92d4980e, not subsequent code.
CodeRabbit's two corrected findings are closed, not whole-delivery approval.

Source artifact10691240693 SHA256 bd7fa52875af11f8b2dd68161f14d974fa325a0d2432a0e7ed40a40a34f5caf8
matches downloaded bytes; inner SHA256 verified, tree matches actual PR clone.
Dependencies10691241350 ZIP SHA256 d96efde2e0b4cea490cfdfd2547f32606db65412f3adcd4718930f9be00ce11d;
inner tar SHA256 8149d1abc8d497a9947c1ca761ad8a3ba5dfd19fe33a281dbbf2ac6cf59a525c;
lockfile byte-identical. Artifact Node22.16, local runtime Node24.19: local results
are not claimed as ordinary Node22 CI. Existing validation-evidence 27 tests pass locally.

## Actual owner map and execution order

1. Canonical register rules are invoked in canonicalPolicyFieldValidator, using the
   resolved policy and validateProdatRegisterPolicy. Extract explicit object-level
   facets at that invocation; do not rerun an invented approval engine or derive
   acceptance from global canonicalAccepted. Preserve every existing decision.
2. Persist those facets in source/hash/original-company/environment/rulepack-bound
   immutable assessments via a new CLI-created forward migration. Keep the existing
   RPC signature, predecessor chain and closed full-source approval flags.
3. Connect genuine tenant/legal-party/business disposition owners only where evidence
   exists. resolveInboundTenant accepts existing company_id; this is routing, not
   independent legal-party authorization. FR/DO versus MS/MR wire correspondence is
   not legal authorization. Per-object onboardCustomerGraph receipts prove graph
   application, not complete register/source acceptance. Z04 persists switch and
   supply state; Z06/Z10 initially create review cases.
4. Full source approval, timeline/supersession and E61/E62 selection remain pending
   until those owners are qualified. The assessment predecessor is not a market
   supersession rule. Missing evidence remains explicit, never autoapproved.
5. Run targeted behavior/SQL/tenant/concurrency checks, generated contracts from a
   disposable database, full exact-candidate ordinary CI and independent review.
   Merge only after the complete user-requested A/B/C delivery is accepted.

No live database experiments, market messages or PR310 imports.

## Implemented continuation and executed evidence

Actual canonical register validator emits per-object facets, including physical register occurrence tuples and rejected/unavailable results. Original payload binding verifies the complete projected physical scope. Optional SQL facets retain original company/environment/hash/rulepack and immutable predecessor protection; no full acceptance flag is opened. Tenant identity resolver now supports explicit microsecond as-of evaluation and detached row provenance, with historicalKnowledge/sourceDisposition not_established and independent_reads. This helper is not yet integrated into full source acceptance.

Supabase CLI2.101.0 run35731853885 created forward migration20260922131136_ediel_received_register_validation.sql. Migration SHA256 eab2138bc7d1be4018bb5c110c84ea44bdec19a5da0718a80282e2f328aa9258. Native35733290443 at4c87398d passed48newSQL, prior suites, schema lint, tenant invariants, parity negative controls and repeated schema/types; later test typecheck caught a fieldRules union access, corrected with explicit property narrowing. Native35733978604 at40aa0e39 passed expanded58SQL and actual concurrent append/committed correction/tenant/role/immutability probes. Overall run FAILURE: sourced clean replay leaves temporary marker migrations until EXIT, so later file-contract tests saw missing historical files. This preparation lifecycle problem does not count as passing full CI. No history files or test expectations were modified to hide it. Actual ordinary delivery CI is still required.

Verified artifact10696911924 ZIP SHA256 edad486cad94b2575a23f597e3aa9b54c999bde83f17a020e15971789d43e9bd. Repeated DB-generated types identical to repository e6086663a93bccc4605eaece24fb83e645b79b90d0b3e744f7862a4ebd856f4e. Schema SHA256 ee92447a428b10618bea5ccf5943bcc2460804fde55925b94c867f2457435841; fingerprint file596a0f8861d7ed6570d70976f8f1cfb0e67909a0953beba4c606bc5b69360e5d. Schema diff only private append_validation body; no grants, tables or signatures changed. Advisor reports one pre-existing public.gridex_grid_owner_name_key mutable search_path warning, none on changed private function. Security warning is not claimed fixed.

Local complete working-tree tests5565/340PASS with Node24 and explicit TAP reporter; app/tests typechecksPASS, lint0errors/101warnings. No test assertions changed for reporter compatibility. Register binding test-first17fail/1pass then18pass; identity API12fail/1pass before implementation; independent ID-1 test reproduced row-order-dependent profile validity, fixed using eager interval validation in explicit/evidence calls,22/22PASS and independent closure. Bounded independent register/SQL/identity reviews do not approve full A/B/C or merge.

Still required: full actual tenant/legal sender/facility/business acceptance chain and immutable full disposition, complete approval snapshot availability, correction/supersession semantics, timeline and E61/E62 consumer integration. These are implementation gaps; not a request for user permission. Continue from published work without rebuilding existing ledger or importing PR310.
