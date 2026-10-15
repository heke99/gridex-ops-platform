# Bounded derived-replay source review — 2026-10-14

Reviewed checkout HEAD: `d086941e288c9062d153b7652c3ca1d4077d3aa4` (read-only). Proposal directory: `quality/audits/2026-10-12-ops-api-contracts/release-proposals/quote-nonexpiring-derived-replay-20261014/`.

## Scope and routing

Activated local `code-review`, `find-bugs`, `differential-review`, and `verification-before-completion`; applied `fp-check` direct source/caller/false-positive verification to the suspected guards. `using-superpowers` explicitly excludes dispatched subagents. This is a narrow Python/source-routing review, not a repository-wide baseline audit. SQL/database/Supabase, UI/Next, performance, scanners, remediation/TDD and delivery workflows are outside this delegated scope. No subagents, unit tests, SQL execution, database access, CI, GEN, refs, network publication, or shared writes occurred. Only this private report was written. This review makes no full-replay PASS claim.

## Result

One confirmed provenance-validation defect in the proposed helper, and one bounded execution-boundary guard gap. Neither proves that the currently proposed quote descriptor selects incorrect bytes: its pins and its current chronological bracket are consistent. Trusted committed-plan configuration is the input; these are fail-closed/integrity defects, not demonstrated remote security vulnerabilities.

### R1 — conflicting identity overrides are silently discarded (medium; confirmed source defect)

Affected proposal: `gridex-derived-replay-inputs.py:31`. Existing shared implementation has the same merge behavior at `scripts/gridex-aud-003-clean-replay.sh:166`; the proposed clean-replay patch does not address it.

`derived.update(plan.get('derivedBootstrap') or {})` replaces a base descriptor with an additions descriptor before either is validated. Consequently a duplicate path with different `source`, `artifactSha256`, or explicit `sourceSha256` can hide the first identity entirely. The later `if name in result` at helper line53 only detects two surviving artifact keys for the same source; it cannot detect two conflicting descriptors for the same artifact key. Subsequent hashes verify only the winning descriptor, so they cannot recover or reject the discarded ambiguity.

Proof by source flow: base has `derivedBootstrap[P]={source:S1,artifactSha256:H1}` and additions has `derivedBootstrap[P]={source:S2,artifactSha256:H2}`. Both have committed checksum-bound bytes and P is declared. After update, only S2/H2 survive. With S2 selected, the source/artifact hash checks pass and S2 is replaced. With only S1 selected, the surviving descriptor is skipped at line50 and S1 stays original. Neither case rejects the incompatible source declaration. A same-source changed artifact hash is likewise accepted if its committed artifact matches the additions hash.

Root cause: identity-bearing merge uses unrestricted last-wins dictionary update. Impact: ambiguous committed source routing is accepted despite the handoff's promise that ambiguous bindings refuse. Fix: validate each incoming descriptor against any prior descriptor before merging; reject conflicting source identities or artifact/source pins, while retaining established compatible metadata augmentations. Apply the matching guard to the private clean-replay patch if it promises the same invariant; C2 remains the writer of actual shared files.

False-positive check: four duplicate paths already exist intentionally, with identical `source` and `artifactSha256`; additions add `preserveSourceReplay:true` and `purpose`. Their path stems are `20260611_grid_owner_information_request_foundation`, `20260613_powers_of_attorney_customer_site_foundation`, `20260618_customer_application_workflows_foundation`, and `20260724_customer_application_continuation_schema_foundation`. A blanket duplicate-key rejection is incorrect and breaks genuine established source replay. R1 concerns conflicting identity only, not those four compatible overrides.

### R2 — declared bracket does not establish equivalent executable placement (medium guard gap; current quote unaffected)

Affected helper: lines64–70, plus builder-proposals upgrade lines90–98 and history-union lines219–231. Shared clean-replay placement: `scripts/gridex-aud-003-clean-replay.sh:268–277`.

The helper checks `after < sourceVersion < before` and that both endpoints appear somewhere in the checksum manifest. Its builders then retain the original source's sorted position. Clean replay instead removes substituted sources, validates endpoints against its executable timestamped list (after exclusions/foundation routing), and inserts the adapter immediately before the before-endpoint.

Concrete source proof: with committed versions A < S < X < B, an interleaved descriptor for derived(S) declaring A..B passes the helper. Upgrade/union order is A,derived(S),X,B; clean order is A,X,derived(S),B. Alternatively a checksum-present endpoint excluded as noncanonical satisfies helper `available` but clean replay rejects it as non-executable. The builders provide no further boundary validator; they write the rows/list directly.

Root cause: manifest presence and broad numeric containment stand in for actual execution-plan placement. Impact: helper success does not prove the promised exact clean-replay boundary, and future changed committed inputs can silently produce different chronological placement. Fix: retain explicit boundary provenance and compare the planned executable sequence against clean replay's boundary semantics, or restrict source-position substitutions to cases with no intervening executable migration before the before-endpoint and ensure endpoint applicability. Account for legitimately already-applied ancestor endpoints; do not simply require both endpoints to be new pending inputs.

Current quote source evidence refutes an immediate mismatch: the complete canonical manifests contain exactly these three versions in its bracket: `20261013093621`, `20261013093906`, `20261013093922`. No intervening migration exists today. R2 is not evidence that this exact adapter currently runs at a wrong boundary.

## Hash/path/consumer observations and rejected claims

- All nine files listed in the proposal `manifest.json` match both recorded byte length and SHA256. Actual original quote SQL SHA256 is `7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce`, matching the descriptor and manifest. No mismatch found.
- The helper validates original committed source bytes against the canonical manifest and optional explicit source pin, and separately validates committed artifact bytes against `artifactSha256`. Materialization retains original bytes in `original-sources`, emits canonical `sha256`/`sourceSha256`, and emits adapter `executedSha256`. This separation is correct.
- Current consumers `scripts/gridex-ediel-upgrade-replay.sh` and `scripts/gridex-ediel-applied-txt-branch-upgrade.sh` execute materialized `.list` paths using `psql -f`. Neither verifies these input files against the old `sha256` field. Therefore the suspicion that existing consumers reject derivatives by comparing adapter bytes with the canonical source hash is FALSE POSITIVE. Adding `executedSha256` does not itself create a wrong-digest comparison.
- Consumers currently also do not recheck `executedSha256` immediately before `psql`. This is an existing materialization-to-execution integrity limitation, not a demonstrated concurrent mutation or introduced checksum bypass; do not classify it as an exploitable race without evidence.
- Helper `_safe` rejects absolute paths, traversal parts, noncanonical normalization, and NUL/CR/LF. Migration source must be exactly two POSIX path parts under `migrations/`; output migration names are constrained by both callers. No concrete helper path traversal found. No claim is made that unchanged shared clean replay has the helper's same path protections.
- Builder-proposal snapshot files expect installation alongside the new helper in `scripts/`; their current `builder-proposals/` folder lacks that sibling. Treat them as source handoff snapshots, not directly executable qualification artifacts.
- SQL adapter and genuine component qualifications were deliberately not re-audited. Historical HANDOFF status wording is for root to reconcile against the existing genuine qualification receipt and independent review, not grounds to invalidate those SQL observations.

## Evidence and limits

Complete helper, both complete builder proposal files, three complete patch files, descriptor, manifest and HANDOFF were read. Shared builders were compared completely with their snapshots via `diff -u`; differences are exactly the proposed routing/materialization changes. Both shell consumers were read completely. Shared clean replay's complete routing/preflight Python segment was read, with line-numbered executable placement. Relevant actual plans and manifests were inspected; private read-only Python JSON/hash inspection established duplicate descriptors, all nine file identities, original quote identity, and its complete bracket migration list. `git status --short` was empty before review.

Checklist: no added external calls beyond Git reads/imports; no DB queries in the helper/builders; no product auth/session/XSS/CSRF surface; migration/tenant effects unverified and out of scope; no demonstrated injection, remote attacker control, resource exhaustion or concurrent mutation. Cryptographic byte checks are present and consistent; provenance merge and execution-boundary semantics are the material findings above. No runtime replay or unit-test oracle was used. The static findings do not authorize changes to C2-owned scripts.

Next action: root may prepare minimal private proposal guard revisions for R1, preserve all four compatible existing additions overrides, update own manifest/HANDOFF honestly, and hand off the concrete proposed changes to C2. Real shared routing, source qualification, complete replay and exact-head gates remain with existing owners.

## Independent assessment of root's private R1 correction

Re-read the exact updated full helper and full clean-replay patch, and compared the new guard with the first embedded Python segment of `/tmp/gridex-ops-replay-review-20261014/clean-replay-source-proposal.sh`. The helper now calls `_merge_derived`; the patch applies its equivalent inline. Both validate each descriptor as a dict, check simultaneous `source`/`sourceKind`/`artifactSha256`/`sourceSha256` values for conflicts before combining, and enrich with `{**previous,**meta}`. The four genuine duplicate descriptors have unchanged identity fields, so they retain additions' `preserveSourceReplay:true` and purpose. An explicit source pin omitted by later compatible metadata is retained. A changed source or changed existing artifact/source pin is rejected before source selection or preserveSourceReplay skipping can hide it.

Assessment: this is a narrowly correct source-level correction of R1; approve that specific private guard revision. R1 remains present in unchanged shared implementation until C2 integrates the handoff. This is not runtime or replay qualification. No other proposal/shared implementation was edited by this reviewer. Static verification freshly parsed the complete helper and first embedded clean-replay Python segment using `ast.parse`; `bash -n` on the private full shell source exited0. No unit-test oracle or replay was run. R2 remains an explicit bounded limitation and does not disprove current quote placement.

## Final exact private revision — R2 chronological guard

Independently re-read the complete final helper and complete clean-replay patch. The new `between` set includes all checksum-manifest filenames with a valid14-digit prefix strictly between the declared endpoint versions and requires that set to equal exactly `{name}`. This conservatively refuses the proved A<S<X<B divergent-order case before returning a substitution. It does not reorder executable inputs or weaken either hash/source-pin guard. The current complete three-manifest interval contains only `20261013093906_ops_api_website_quote_nonexpiring_policy.sql`, so the present quote declaration satisfies the new condition. The four compatible descriptor enrichments remain unaffected. Approve this specific source-level chronological-ambiguity correction.

R2 endpoint applicability remains a separate recorded limitation: manifest presence alone does not establish that an endpoint remains executable after exclusions/foundation routing; unchanged clean replay still guards that condition. Do not describe this source check as a complete new replay-plan equivalence proof. No currently excluded quote endpoint was found.

Final independently reviewed helper SHA256: `f198a4e7cd800f4faa9629a9a34ae99d003f637613eb3831d77449d9595acb6c`. Final independently reviewed clean-replay patch SHA256: `c1c654766d711757d4c04837b5768bdc618f47279724f751090005840de46569`. Fresh complete-helper `ast.parse` succeeded. Only source/hash/manifest inspection was used; no helper execution, unit tests, DB, GEN or replay occurred. Shared implementations remain unchanged and require existing-owner integration and genuine exact-head gates.
