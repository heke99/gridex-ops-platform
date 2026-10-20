# Exact two-file donor review — SOURCE_ACCEPTABLE_FOR_SELECTIVE_ADOPTION

Independent read-only source review on 2026-10-14. Base/origin-main: `573d74371086da585a5cff6abee95eadfe58899e`. Donor/worktree HEAD: `6047439998a677a34f154b353c575687d01ca81a`. Worktree clean before and after review. Exact byte/blob identities are in `hashes.json`; exact two-file diff is in `exact-two-files.patch`.

Scope: only scripts/gridex-website-quote-integrity-regression.mjs and scripts/gridex-price-area-assurance-regression.cjs. No production edits, shared memory, spec, wire, GEN, native, CI, tests or DB/API writes. No regression executable was run. This is source mapping review, not operational PASS, actual-DB certification, whole donor approval or merge clearance. Parent supplied board #766 comment6170786846 as routing; this reviewer did not independently read/authenticate that remote comment, and makes no custody claim.

## Skills and instructions

Read AGENTS.md, current memory/start/workflow/reservations; dated memory observations are not current assignments. Read local using-superpowers (explicit subagent exemption), code-review, differential-review, spec-to-code-compliance and verification-before-completion. Applied bounded differential/code/contract mapping and fresh immutable-source/hash verification. Runtime, SQL/schema, Supabase, performance, UI, static-scanner, test-writing and deployment skill groups were not activated: no changes or audit of those subsystems is authorized in this exact source mapping task. User prohibition on tests controls over local testing guidance. No additional agent or producer was created. Private report only; no repository/shared-memory edits.

## Production source oracle on actual main

* lib/integrations/websiteIntegrationContract.ts:9-13 separately declares runtime WEBSITE_INTEGRATION_CONTRACT_VERSION=2026-10-09.1, documentation API_DOCUMENTATION_VERSION=2026-10-12.1, and minimum tenant revision 2026-10-02.3. Its versioned document paths use the documentation constant.
* scripts/lib/current-api-contract.cjs:13-28 derives both constants from production source, validates all three current OpenAPI documents against their respective versions, and expressly keeps currentContractVersion as a legacy documentation-path alias. This file is byte-identical at base and donor.
* scripts/finalize-openapi-release.cjs:5,13,20,105-139 uses documentation version for info.version and runtime version for x-contract-schema-version, business envelope contract_schema_version and wire-header schemas. Portal finalizer:954-959 re-normalizes both current documents then writes the fixture named for runtime version. Both finalizers are unchanged base versus donor; they were read, not executed.
* Production lib/website/publicContractApi.ts:64 binds PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION to WEBSITE_INTEGRATION_CONTRACT_VERSION. app/api/v1/website/public-contracts/route.ts:44,312 emits this binding in header and meta. Both are byte-identical at base and donor. Actual main apiResponseProfile.ts:101-104 keeps credential-selected runtime revision in X-Gridex-Contract-Version and documentation revision in X-Gridex-Documentation-Version. Donor also contains separate apiResponseProfile.ts changes outside this review: DO NOT adopt that file under this verdict.
* Actual main website, customer-portal and staff current JSON documents each declare info.version=2026-10-12.1 and x-contract-schema-version=2026-10-09.1 and are byte-identical to their immutable 2026-10-12.1 releases. Website public-contracts example and immutable runtime fixture both carry contract_schema_version=2026-10-09.1. Metadata was extracted without executing any regression/checker.
* All four enforcement consumers checked by the website donor (compatibility, release verification, documentation-version, public-contract runtime/OpenAPI checker) are byte-identical at base and donor and already use documentation/runtime separation. Source checkers and exporter, rather than synthetic unit-test output, substantiate this review.

## Changed atoms and safety

Website donor:
1. Import explicit documentation+runtime bindings; compare current document release against documentation version.
2. Require finalizer's existing explicit two-version import and existing runtime x-contract normalization.
3. Compare production wire constant against runtime version.
4. Update compatibility/release/documentation source-mapping required effects to their existing runtime x-contract gates; preserve document-version and release-path gates.
5. Update public-contracts fixture path and meta check to runtime version; remove requirement that checker mutate fixture.meta before checking it. Existing checker reads the original fixture and validates it with validateResponse; removing a nonexistent normalization atom preserves the original unmodified-fixture gate.
6. Require each consumer's existing explicit two-version import; compare public-contracts example wire marker against runtime version.
All quote persistence/schema, timestamp, uppercase price-area, immutable current/release parity, immutable route existence, registry, payload-example and developer-page assertions remain.

Price-area donor:
1. Import explicit documentation+runtime bindings.
2. Use documentation version for immutable release paths and document info.version.
3. Check current x-contract-schema-version against runtime version.
All migration SHA256 checks, resolver confidence/evidence/dispatch gates, required assurance schema/field, and website/portal immutable equality assertions remain.

No assertion is changed to unconditional success, skipped, caught or downgraded; neither file changes runtime, database, applied migration, fixed requirements, minimum revision, CI command, timeout or ledger. The false requirement that documentation revisions equal deployed wire revisions is corrected against existing production source. A wire bump to 2026-10-12.1 would contradict actual main and is neither needed nor permitted by these atoms.

## Verdict and applicability

SOURCE_ACCEPTABLE_FOR_SELECTIVE_ADOPTION of exactly the two donor blobs against exactly base573d. No confirmed defect in these changed atoms. Strong source confidence; no unit/regression execution or actual-DB result claimed. This verdict does not transfer custody, approve unrelated donor changes, waive mandatory final candidate gates, establish whole acceptance coverage or authorize delivery. Re-check exact source applicability if main or affected dependencies move.
